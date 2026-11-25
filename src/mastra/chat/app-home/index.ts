import { logger } from '../../lib/logger';
import { isOwnerActor } from '../../lib/owner';
import type { AppHomeBot } from '../../types';
import { chat } from '../instance';
import { registerGitHub } from './github';
import { registerCustomInstructions } from './instructions';
import { registerMCPServers } from './mcp';
import { registerScheduledTasks } from './scheduled-tasks';
import { publishHome } from './view';

// Every App Home control acts as the clicker (GitHub tokens, MCP servers the
// host connects to, instructions), so anyone but the owner is ignored.
export function ownerOnly(bot: AppHomeBot): AppHomeBot {
  return {
    onAction: (actionIds, handler) =>
      bot.onAction(actionIds, (event) =>
        isOwnerActor(event.user) ? handler(event) : undefined
      ),
    onModalSubmit: (callbackIds, handler) =>
      bot.onModalSubmit(callbackIds, (event) =>
        isOwnerActor(event.user) ? handler(event) : undefined
      ),
  };
}

export function registerAppHome(): void {
  chat().onAppHomeOpened((event) =>
    publishHome(event.userId).catch((error: unknown) =>
      logger.error('[app-home] publishHome failed', { error })
    )
  );
  const bot = ownerOnly(chat());
  registerCustomInstructions({ bot, publishHome });
  registerGitHub({ bot, publishHome });
  registerMCPServers({ bot, publishHome });
  registerScheduledTasks({ bot, publishHome });
}
