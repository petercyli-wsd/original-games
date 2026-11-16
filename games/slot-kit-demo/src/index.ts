// Throwaway demo of the slot UI kit on a stub engine (packages/slots/src/ui/demo). Not a lobby game.
import { defineReactGame } from '@originals/game-sdk/react';
import { slotGameStyles } from '@originals/slots/ui';
import Demo from '../../../packages/slots/src/ui/demo/Demo';

export default defineReactGame(Demo, { styles: slotGameStyles });
