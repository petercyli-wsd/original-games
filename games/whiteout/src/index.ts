import { defineReactGame } from '@originals/game-sdk/react';
import { slotGameStyles } from '@originals/slots/ui';
import Game from './Game';

export default defineReactGame(Game, { styles: slotGameStyles });
