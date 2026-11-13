import { defineReactGame } from '@originals/game-sdk/react';
import App from './App';
import { kitStyles } from '@originals/game-sdk/ui';
import styles from './styles.css?inline';

export default defineReactGame(App, { styles: kitStyles + styles });
