import type { AppHomeBot } from '../../../types';
import { registerConnect } from './connect';
import { registerSettings } from './settings';

export { githubBlocks } from './blocks';

export function registerGitHub({
  bot,
  publishHome,
}: {
  bot: AppHomeBot;
  publishHome: (userId: string) => Promise<void>;
}): void {
  registerConnect({ bot, publishHome });
  registerSettings({ bot, publishHome });
}
