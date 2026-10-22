// Client for the AI evaluator. Reading reviews is public; running reviews and
// refining the prompt cost money, so they send an admin passphrase that this
// browser remembers once entered.

import type {
  AgreementRow,
  EvaluationSummary,
  EvaluationView,
  EvaluatorStatus,
  Job,
  PromptVersion,
} from '@originals/api/shared';
import { createStore } from '@originals/game-sdk';
import { apiEnabled, apiRequest, jsonBody } from './api';
import { safeStorage } from './storage';

const ADMIN_KEY = 'originals.adminKey';

export const evaluatorEnabled = apiEnabled;

function readKey(): string {
  try {
    return safeStorage()?.getItem(ADMIN_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The admin passphrase, or '' when locked. */
export const adminKey = createStore<string>(readKey());

export async function unlock(key: string): Promise<void> {
  await apiRequest('/evaluator/admin-check', jsonBody('POST', {}, { 'x-admin-key': key }));
  try {
    safeStorage()?.setItem(ADMIN_KEY, key);
  } catch {
    /* remembered for this page only */
  }
  adminKey.set(key);
}

export function lock() {
  try {
    safeStorage()?.removeItem(ADMIN_KEY);
  } catch {
    /* storage unavailable */
  }
  adminKey.set('');
}

const admin = (method: string, body: unknown = {}) => jsonBody(method, body, { 'x-admin-key': adminKey.get() });

export const fetchStatus = () => apiRequest<EvaluatorStatus>('/evaluator');
export const fetchEvaluation = (gameId: string) => apiRequest<EvaluationView | null>(`/evaluations/${gameId}`);
export const fetchVersions = () => apiRequest<PromptVersion[]>('/evaluator/versions');
export const fetchAgreement = () => apiRequest<{ rows: AgreementRow[]; spearman: number | null; mae: number | null }>('/evaluator/agreement');
export const fetchJobs = () => apiRequest<Job[]>('/evaluator/jobs');

export const startEvaluate = (target: string) => apiRequest<Job>('/evaluations', admin('POST', { target }));
export const startRefine = () => apiRequest<Job>('/evaluator/refine', admin('POST'));
export const startBacktest = (versionId: number) => apiRequest<Job>(`/evaluator/versions/${versionId}/backtest`, admin('POST'));
export const promote = (versionId: number) => apiRequest<PromptVersion>(`/evaluator/versions/${versionId}/promote`, admin('POST'));

/** AI overall scores per game under the active prompt, shared by the lobby and rankings. */
export const evaluationSummaries = createStore<Record<string, EvaluationSummary>>({});

let summariesRequest: Promise<void> | null = null;
export function loadEvaluationSummaries(force = false) {
  if (!evaluatorEnabled || (summariesRequest && !force)) return;
  summariesRequest = apiRequest<Record<string, EvaluationSummary>>('/evaluations')
    .then((all) => evaluationSummaries.set(all))
    .catch((err: unknown) => {
      console.warn('Could not load AI reviews', err);
      summariesRequest = null;
    });
}

/** Polls a job every `intervalMs` until it finishes, reporting progress. */
export async function followJob(job: Job, onProgress: (job: Job) => void, intervalMs = 2000): Promise<Job> {
  let current = job;
  onProgress(current);
  while (current.status === 'running') {
    await new Promise((r) => setTimeout(r, intervalMs));
    current = await apiRequest<Job>(`/evaluator/jobs/${job.id}`);
    onProgress(current);
  }
  return current;
}

export const RECOMMENDATION_LABEL = { ship: 'Ship', iterate: 'Iterate', drop: 'Drop' } as const;
