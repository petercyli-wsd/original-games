import { defineReactGame } from '@originals/game-sdk/react';
import Game from './Game';
import { kitStyles } from '@originals/game-sdk/ui';
import styles from './styles.css?inline';

export default defineReactGame(Game, { styles: kitStyles + styles });
