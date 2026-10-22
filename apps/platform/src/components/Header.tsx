import { formatAmount } from '@originals/game-sdk';
import { useStore } from '@originals/game-sdk/react';
import { Link, NavLink } from 'react-router-dom';
import { BRAND } from '../brand';
import { settings, wallet } from '../host/session';
import { reviewPrefs, setShowAi } from '../lib/preferences';

export function Header() {
  const balance = useStore(wallet.balance);
  const { turbo } = useStore(settings);
  const { showAi } = useStore(reviewPrefs);

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="logo">
          <span className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="3" />
            </svg>
          </span>
          <span className="logo-wordmark">
            <span className="logo-brand">{BRAND.name.toUpperCase()}</span>
            <span className="logo-product">{BRAND.product}</span>
          </span>
        </Link>

        <div className="header-controls">
          <NavLink to="/rankings" className="nav-link">
            ★ Rankings
          </NavLink>
          <NavLink to="/evaluator" className="nav-link">
            ✦ Evaluator
          </NavLink>
          <button
            className={`toggle ai-toggle ${showAi ? 'on' : ''}`}
            aria-pressed={showAi}
            onClick={() => setShowAi(!showAi)}
            title={showAi ? 'Hide AI reviews, so your own review is not influenced' : 'Show AI reviews'}
          >
            ✦<span className="toggle-label"> AI {showAi ? 'on' : 'off'}</span>
          </button>
          <button
            className={`toggle ${turbo ? 'on' : ''}`}
            aria-pressed={turbo}
            onClick={() => settings.set({ ...settings.get(), turbo: !turbo })}
            title="Faster animations in every game"
          >
            ⚡<span className="toggle-label"> Turbo</span>
          </button>
          <div className="balance-card" aria-label="Balance">
            <span className="balance-label">Balance</span>
            <span className="balance-amount">{formatAmount(balance, 2)}</span>
            <span className="balance-currency">{wallet.currency}</span>
          </div>
          <button className="btn-ghost" onClick={() => wallet.reset()} title={`Reset play balance to ${BRAND.startingBalance}`}>
            Refill
          </button>
        </div>
      </div>
    </header>
  );
}
