import type { Channel, Thread } from 'chat';
import type { Target } from '../types';
import { chat } from './instance';

export async function resolveTarget(target: Target): Promise<Channel | Thread> {
  if (target.type === 'channel') {
    return chat().channel(target.id);
  }
  if (target.type === 'user') {
    return await chat().openDM(target.id);
  }
  return chat().thread(target.id);
}
