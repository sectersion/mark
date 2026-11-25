import { expect, test } from 'bun:test';
import { codeModeSlackTools } from './slack';

test('code mode exposes only read-only Slack tools', () => {
  const names = Object.keys(codeModeSlackTools);
  for (const write of [
    'post_message',
    'upload_file',
    'react',
    'create_canvas',
    'edit_canvas',
    'upload_emoji',
    'join_thread',
    'leave_thread',
    'propose_rule',
    'pass_to_owner',
  ]) {
    expect(names).not.toContain(write);
  }
  expect(names.sort()).toEqual([
    'get_channel_info',
    'get_permalink',
    'get_slack_file',
    'get_user',
    'list_canvases',
    'list_channels',
    'list_threads',
    'lookup_canvas_sections',
    'read_canvas',
    'read_conversation_history',
    'search_slack',
    'summarize_thread',
  ]);
});
