import { defineReactGame } from '@originals/game-sdk/react';
import { tokenStyles } from '@originals/game-sdk/ui';
// Its own copy of the stylesheet it was built on (Crocodile Dentist moved onto the kit layout on 2026-11-13).
import crocStyles from './croc-styles.css?inline';
import App from './App';
import styles from './styles.css?inline';

// Shares the croc and its layout with the vs House game, plus a few solo-only rules.
// The shared CSS uses the kit's tokens (docs/STYLE.md), so they come first.
export default defineReactGame(App, { styles: tokenStyles + crocStyles + styles });
