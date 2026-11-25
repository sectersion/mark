import { afterEach, expect, spyOn, test } from 'bun:test';
import { RequestContext } from '@mastra/core/request-context';
import { noopObserve } from '@mastra/core/tools';
import { slack } from '../../chat/client';
import { createCanvasTool } from './create';
import { editCanvasTool } from './edit';
import { assertNoThirdPartyMentions } from './utils';

const refused = 'cannot mention anyone but the owner';

test('a canvas mention of someone other than the owner is refused', () => {
  for (const markdown of [
    'hey ![](@UOTHER) look',
    '![]( @UOTHER )',
    '![](@UOTHER "title")',
    '![](<@UOTHER>)',
    '[ping](@UOTHER)',
    'raw <@UOTHER> mention',
    'raw <@UOTHER|other> mention',
    'empty ![](@)',
  ]) {
    expect(() => assertNoThirdPartyMentions(markdown)).toThrow(refused);
  }
});

test('a document with any non-owner mention is refused, even beside the owner', () => {
  expect(() =>
    assertNoThirdPartyMentions(
      '![](@UOWNER) then <@UOWNER> then ![](<@UOTHER>)'
    )
  ).toThrow(refused);
});

test("the owner's own mention is allowed in every spelling", () => {
  expect(() =>
    assertNoThirdPartyMentions(
      'note for ![](@UOWNER), ![](@UOWNER "t"), ![](<@UOWNER>) and <@UOWNER>'
    )
  ).not.toThrow();
});

test('markdown with no mentions is allowed', () => {
  expect(() =>
    assertNoThirdPartyMentions('# Plan\n\n- ship it\n- see ![](#C123)')
  ).not.toThrow();
});

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

function context() {
  const requestContext = new RequestContext();
  requestContext.set('channel', {
    userId: 'UOWNER',
    channelId: 'slack:C111',
    threadId: 'slack:C111:1700000000.000100',
  });
  return { requestContext, observe: noopObserve };
}

test('create_canvas refuses a non-owner mention before calling Slack', async () => {
  const create = spyOn(slack.webClient.canvases, 'create').mockResolvedValue({
    ok: true,
    canvas_id: 'F0123',
  });
  spies.push(create);
  await expect(
    createCanvasTool.execute?.(
      { mode: 'standalone', markdown: 'hi ![](@UOTHER)' },
      context()
    )
  ).rejects.toThrow(refused);
  expect(create).not.toHaveBeenCalled();

  await createCanvasTool.execute?.(
    { mode: 'standalone', markdown: 'hi ![](@UOWNER)' },
    context()
  );
  expect(create).toHaveBeenCalledTimes(1);
});

test('edit_canvas refuses a non-owner mention before calling Slack', async () => {
  const info = spyOn(slack.webClient.files, 'info').mockResolvedValue({
    ok: true,
    file: {},
  });
  spies.push(info);
  await expect(
    editCanvasTool.execute?.(
      {
        canvasId: 'F0123',
        changes: [
          {
            operation: 'insert_at_end',
            document_content: { type: 'markdown', markdown: '<@UOTHER>' },
          },
        ],
      },
      context()
    )
  ).rejects.toThrow(refused);
  expect(info).not.toHaveBeenCalled();
});
