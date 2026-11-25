import { expect, test } from 'bun:test';
import { assertNoThirdPartyMentions } from './utils';

test('a canvas mention of someone other than the owner is refused', () => {
  expect(() => assertNoThirdPartyMentions('hey ![](@UOTHER) look')).toThrow(
    'cannot mention anyone but the owner'
  );
  expect(() =>
    assertNoThirdPartyMentions('![](@UOWNER) and ![]( @UOTHER )')
  ).toThrow('cannot mention anyone but the owner');
});

test("the owner's own mention is allowed", () => {
  expect(() =>
    assertNoThirdPartyMentions('note for ![](@UOWNER)')
  ).not.toThrow();
});

test('markdown with no mentions is allowed', () => {
  expect(() =>
    assertNoThirdPartyMentions('# Plan\n\n- ship it\n- see ![](#C123)')
  ).not.toThrow();
});
