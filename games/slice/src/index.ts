import { defineReactGame } from '@originals/game-sdk/react';
import { kitStyles } from '@originals/game-sdk/ui';
import App from './App';
import styles from './styles.css?inline';

export default defineReactGame(App, { styles: kitStyles + styles });
