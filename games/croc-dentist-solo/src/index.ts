import { defineReactGame } from '@originals/game-sdk/react';
import crocStyles from '@originals/crocodile-dentist/styles.css?inline';
import App from './App';
import styles from './styles.css?inline';

// Shares the croc and its layout with the vs House game, plus a few solo-only rules.
export default defineReactGame(App, { styles: crocStyles + styles });
