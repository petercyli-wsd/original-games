import { defineReactGame } from '@originals/game-sdk/react';
import { kitStyles } from '@originals/game-sdk/ui';
import Game from './Game';
import styles from './styles.css?inline';

export default defineReactGame(Game, { styles: kitStyles + styles });

