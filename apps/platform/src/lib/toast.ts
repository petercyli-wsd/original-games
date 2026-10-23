// Short-lived notifications ("Review saved"), shown by <Toaster /> at the
// bottom of the screen.

import { createStore } from '@originals/game-sdk';

export interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

export const toasts = createStore<Toast[]>([]);

let nextId = 1;

export const dismissToast = (id: number) => toasts.set(toasts.get().filter((t) => t.id !== id));

/** Shows a notification for a few seconds. */
export function notify(message: string, tone: Toast['tone'] = 'success', ms = 3500) {
  const id = nextId++;
  toasts.set([...toasts.get().slice(-2), { id, message, tone }]);
  setTimeout(() => dismissToast(id), ms);
}
