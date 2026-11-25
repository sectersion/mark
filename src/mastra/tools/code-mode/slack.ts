import type { ToolsInput } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { createCodeMode, createCodeModeTool } from '@mastra/core/tools';
import { E2BCodeModeTransport } from '@mastra/e2b';
import { sandbox as sandboxConfig } from '../../config';
import { mcpTools } from '../../mcp';
import { codeModePrompt } from '../../prompts/features/code-mode';
import { codeModeToolNames, getSandbox } from '../../workspace';
import { workspaceTools } from '../../workspace/tools';
import { canvasTools } from '../canvas';
import { slackTools } from '../slack';
import { slackReadOnlyKey } from '../slack/utils';

const transport = new E2BCodeModeTransport();

// Read-only on purpose: model-written programs never get a tool that posts,
// uploads, reacts, or edits, so the outbound approval rule has no way around it.
export const codeModeSlackTools = {
  search_slack: slackTools.search_slack,
  read_conversation_history: slackTools.read_conversation_history,
  list_threads: slackTools.list_threads,
  get_user: slackTools.get_user,
  get_channel_info: slackTools.get_channel_info,
  list_channels: slackTools.list_channels,
  get_permalink: slackTools.get_permalink,
  get_slack_file: slackTools.get_slack_file,
  summarize_thread: slackTools.summarize_thread,
  list_canvases: canvasTools.list_canvases,
  read_canvas: canvasTools.read_canvas,
  lookup_canvas_sections: canvasTools.lookup_canvas_sections,
};

async function getSandboxTools(
  requestContext?: RequestContext
): Promise<ToolsInput> {
  const tools = await workspaceTools(requestContext);
  return {
    ...Object.fromEntries(
      Object.entries(tools).filter(([name]) => codeModeToolNames.has(name))
    ),
  };
}

const RESULT_LIMIT = 60_000;

function capResult(outcome: unknown): unknown {
  const size = JSON.stringify(outcome ?? null)?.length ?? 0;
  if (size <= RESULT_LIMIT) {
    return outcome;
  }
  return {
    success: false,
    error: {
      message: `The program returned ${size} characters, over the ${RESULT_LIMIT} limit, so nothing was kept. Return a summary computed inside the program (counts, the few records that matter, a written answer) rather than the rows you read, or write the full data to a file and return its path.`,
      name: 'ResultTooLarge',
    },
  };
}

async function createCodeModeInstance({
  workspaceAccess,
}: {
  workspaceAccess: boolean;
}) {
  const slackCodeTools = { ...(await mcpTools()), ...codeModeSlackTools };
  const tools = workspaceAccess
    ? { ...slackCodeTools, ...(await getSandboxTools()) }
    : slackCodeTools;
  const modeConfig = {
    id: 'slack',
    timeout: sandboxConfig.executionTimeout,
    tools,
  };
  const mode = createCodeMode(modeConfig, transport);

  mode.tool.execute = async (input, context) => {
    if (!context.requestContext) {
      throw new Error('No request context available for Slack code mode.');
    }
    const sandbox = await getSandbox(context.requestContext);
    if (!sandbox) {
      throw new Error('No E2B sandbox available for Slack code mode.');
    }

    const { execute } = createCodeModeTool(
      {
        ...modeConfig,
        sandbox,
        tools: workspaceAccess
          ? {
              ...slackCodeTools,
              ...(await getSandboxTools(context.requestContext)),
            }
          : slackCodeTools,
      },
      transport
    );
    if (!execute) {
      throw new Error('Slack code mode is not executable.');
    }
    // A copy, so the flag that stops these tools joining channels does not leak
    // into the rest of the turn's direct tool calls.
    const requestContext = new RequestContext(context.requestContext.entries());
    requestContext.set(slackReadOnlyKey, true);
    return capResult(await execute(input, { ...context, requestContext }));
  };

  return mode;
}

type CodeModeInstance = Awaited<ReturnType<typeof createCodeModeInstance>>;

const instances = new Map<string, Promise<CodeModeInstance>>();

function codeMode(workspaceAccess: boolean): Promise<CodeModeInstance> {
  const key = workspaceAccess ? 'workspace' : 'slack';
  const existing = instances.get(key);
  if (existing) {
    return existing;
  }
  const started = createCodeModeInstance({ workspaceAccess });
  instances.set(key, started);
  return started;
}

export function workspaceCodeMode(): Promise<CodeModeInstance> {
  return codeMode(true);
}

export function slackCodeMode(): Promise<CodeModeInstance> {
  return codeMode(false);
}

export async function workspaceCodeModePrompt(): Promise<string> {
  return codeModePrompt({
    instructions: (await workspaceCodeMode()).instructions,
    files: true,
  });
}

export async function slackCodeModePrompt(): Promise<string> {
  return codeModePrompt({
    instructions: (await slackCodeMode()).instructions,
    files: false,
  });
}
