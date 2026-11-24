import { Agent } from '@mastra/core/agent';
import { receptionist as config } from '../config';
import { defaultErrorProcessors } from '../lib/error-handling';
import { stepCountIs, toolCall } from '../lib/tools';
import { receptionistPrompt } from '../prompts/receptionist';
import { orchestrator as orchestratorModel } from '../providers';
import { passToOwnerTool } from '../tools/receptionist/pass-to-owner';

export const receptionist = new Agent({
  id: config.id,
  name: 'Receptionist',
  instructions: receptionistPrompt,
  model: orchestratorModel,
  tools: { pass_to_owner: passToOwnerTool },
  errorProcessors: defaultErrorProcessors(),
  maxProcessorRetries: 2,
  defaultOptions: {
    // One card per turn: a message asking for the tool to be called again
    // must not be able to flood the owner's DMs.
    stopWhen: [toolCall('pass_to_owner'), stepCountIs(3)],
  },
});
