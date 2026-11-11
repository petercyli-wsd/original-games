import { defineReactGame } from '@originals/game-sdk/react';
import Game from './Game';
import { tokenStyles } from '@originals/game-sdk/ui';
import styles from './styles.css?inline';

export default defineReactGame(Game, { styles: tokenStyles + styles });
