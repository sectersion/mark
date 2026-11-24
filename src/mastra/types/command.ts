import type { Author, Message, Thread } from 'chat';

export type CommandThread = Pick<Thread, 'id' | 'isDM'> & {
  postEphemeral: (
    user: Author,
    text: string,
    options: { fallbackToDM: boolean }
  ) => Promise<unknown>;
};

export type CommandHandler = (options: {
  message: Message;
  thread: CommandThread;
}) => Promise<void>;
