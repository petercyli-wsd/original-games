import { defineReactGame } from '@originals/game-sdk/react';
import { tokenStyles } from '@originals/game-sdk/ui';
import App from './App';
import styles from './styles.css?inline';

export default defineReactGame(App, { styles: tokenStyles + styles });
