import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { RequestContext } from '@mastra/core/request-context';
import { noopObserve } from '@mastra/core/tools';
import { slack } from '../../chat/client';

const realAudit = await import('../../db/queries/audit');
const realExports = { ...realAudit };
const written: {
  actor: string;
  action: string;
  detail?: Record<string, unknown>;
}[] = [];

mock.module('../../db/queries/audit', () => ({
  ...realExports,
  writeAudit: (row: {
    actor: string;
    action: string;
    detail?: Record<string, unknown>;
  }) => {
    written.push(row);
    return Promise.resolve();
  },
}));

const { createCanvasTool } = await import('./create');
const { editCanvasTool } = await import('./edit');
const { assertNoThirdPartyMentions } = await import('./utils');

afterAll(() => {
  mock.module('../../db/queries/audit', () => realExports);
});

beforeEach(() => {
  written.length = 0;
});

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

test.each([
  ['a backslash escape', '![](\\@UOTHER)'],
  ['a decimal entity', '![](&#64;UOTHER)'],
  ['a zero-padded decimal entity', '![](&#00064;UOTHER)'],
  ['a hex entity', '![](&#x40;UOTHER)'],
  ['a zero-padded hex entity', '![](&#X0040;UOTHER)'],
  ['a named entity', '![](&commat;UOTHER)'],
  ['percent-encoding', '![](%40UOTHER)'],
  ['lowercase percent-encoding', '![](%40uother)'],
  ['double percent-encoding', '![](%2540UOTHER)'],
  ['a fullwidth at sign', '![](＠UOTHER)'],
  ['a reference definition', '![][x]\n\n[x]: @UOTHER'],
  ['an HTML link', '<a href="@UOTHER">hi</a>'],
  ['an owner token run into another', '![](@UOWNER@UOTHER)'],
  ['an owner id with extra characters', '![](@UOWNERX)'],
  ['a bare token in prose', 'cc @UOTHER on this'],
])('a non-owner mention written as %s is refused', (_, markdown) => {
  expect(() => assertNoThirdPartyMentions(markdown)).toThrow(refused);
});

test('a plain email address is allowed', () => {
  expect(() =>
    assertNoThirdPartyMentions('mail a@example.com about it')
  ).not.toThrow();
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
  expect(written).toEqual([
    {
      actor: 'mark',
      action: 'post',
      detail: { kind: 'canvas_create', mode: 'standalone', canvasId: 'F0123' },
    },
  ]);
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
