import type { Job } from '@originals/api/shared';
import { useStore } from '@originals/game-sdk/react';
import { useState, type FormEvent } from 'react';
import { adminKey, lock, unlock } from '../lib/evaluator';

/** Passphrase field for actions that call Claude. Shows "Lock" once unlocked. */
export function AdminUnlock({ compact = false }: { compact?: boolean }) {
  const key = useStore(adminKey);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (key) {
    return (
      <div className="admin-unlock unlocked">
        <span>🔓 Admin unlocked</span>
        <button type="button" className="btn-link" onClick={lock}>
          Lock
        </button>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await unlock(value.trim());
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`admin-unlock${compact ? ' compact' : ''}`} onSubmit={(e) => void submit(e)}>
      <input
        type="password"
        placeholder="Admin passphrase"
        autoComplete="current-password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Admin passphrase"
      />
      <button type="submit" className="btn-ghost" disabled={busy || !value.trim()}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
      {error && <span className="form-error">{error}</span>}
    </form>
  );
}

export function JobProgress({ job }: { job: Job }) {
  const pct = job.total ? (job.done / job.total) * 100 : job.status === 'running' ? 5 : 100;
  return (
    <div className={`job job-${job.status}`} role="status">
      <div className="job-head">
        <span>{job.label}</span>
        <span>
          {job.status === 'running' ? `${job.done}/${job.total || '…'}` : job.status === 'done' ? 'Done' : 'Failed'}
          {job.failed ? ` · ${job.failed} failed` : ''}
        </span>
      </div>
      <div className="job-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      {job.errors.length > 0 && (
        <details className="job-errors">
          <summary>{job.errors.length} error{job.errors.length === 1 ? '' : 's'}</summary>
          <ul>
            {job.errors.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
