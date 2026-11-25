import { afterEach, expect, spyOn, test } from 'bun:test';
import type { ActionHandler, Author, ModalSubmitHandler } from 'chat';
import { slack } from '../client';
import { content } from '../content';
import { ownerOnly } from './index';
import { publishHome } from './view';

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

function user(userId: string): Author {
  return {
    userId,
    userName: userId,
    fullName: userId,
    isBot: false,
    isMe: false,
  };
}

function guarded() {
  const actions: ActionHandler[] = [];
  const submits: ModalSubmitHandler[] = [];
  const bot = ownerOnly({
    onAction: (_, handler) => {
      actions.push(handler);
    },
    onModalSubmit: (_, handler) => {
      submits.push(handler);
    },
  });
  const ran: string[] = [];
  bot.onAction('connect', (event) => {
    ran.push(`action:${event.user.userId}`);
  });
  bot.onModalSubmit('modal', (event) => {
    ran.push(`submit:${event.user.userId}`);
  });
  const press = (author: Author) =>
    actions[0]?.({
      actionId: 'connect',
      adapter: slack,
      messageId: '',
      openModal: () => Promise.resolve(undefined),
      raw: {},
      thread: null,
      threadId: '',
      user: author,
    });
  const submit = (author: Author) =>
    submits[0]?.({
      adapter: slack,
      callbackId: 'modal',
      raw: {},
      user: author,
      values: {},
      viewId: 'V1',
    });
  return { press, submit, ran };
}

test('App Home actions and modal submits run only for the owner', async () => {
  const { press, submit, ran } = guarded();
  await press(user('UOTHER'));
  await press(user(''));
  await press({ ...user('UOWNER'), isBot: true });
  await submit(user('UOTHER'));
  expect(ran).toEqual([]);
  await press(user('UOWNER'));
  await submit(user('UOWNER'));
  expect(ran).toEqual(['action:UOWNER', 'submit:UOWNER']);
});

test('a stranger opening App Home gets the front desk view', async () => {
  const published: unknown[] = [];
  const publish = spyOn(slack, 'publishHomeView').mockImplementation(
    (_, view) => {
      published.push(view);
      return Promise.resolve();
    }
  );
  spies.push(publish);
  await publishHome('UOTHER');
  expect(published).toEqual([content.frontDesk]);
});
