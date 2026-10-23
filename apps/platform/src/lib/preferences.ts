import { createStore } from '@originals/game-sdk';
import { persistedStore } from './storage';

/**
 * Per-browser review preferences. Hiding AI reviews lets human reviewers rate
 * games without being anchored by the AI's scores.
 */
export const reviewPrefs = persistedStore('originals.reviewPrefs', { showAi: true });

export const setShowAi = (showAi: boolean) => reviewPrefs.set({ ...reviewPrefs.get(), showAi });

/** The lobby URL with its current search and filters, so "← Lobby" returns to the same view. */
export const lobbyPath = createStore('/');
