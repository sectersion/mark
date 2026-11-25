import type { ActionHandler, ModalSubmitHandler } from 'chat';

export interface AppHomeBot {
  onAction: (actionIds: string[] | string, handler: ActionHandler) => void;
  onModalSubmit: (
    callbackIds: string[] | string,
    handler: ModalSubmitHandler
  ) => void;
}
