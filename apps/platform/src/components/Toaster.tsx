import { useStore } from '@originals/game-sdk/react';
import { dismissToast, toasts } from '../lib/toast';

/** Notifications from `notify()`, announced to screen readers as they appear. */
export function Toaster() {
  const list = useStore(toasts);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span className="toast-icon" aria-hidden="true">
            {t.tone === 'success' ? '✓' : '!'}
          </span>
          <span className="toast-message">{t.message}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
