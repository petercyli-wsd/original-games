import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  StageTop,
  VolBadge,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import { Dial, type DialState } from './Board';
import {
  MAX_CHANCE,
  MAX_TARGET,
  MIN_CHANCE,
  MIN_TARGET,
  PRESETS,
  RTP,
  clampTarget,
  fmtPct,
  fmtX,
  play,
  targetForChance,
  volatilityOf,
  winChance,
} from './math';

const ACCENT = '#a855f7';

interface Last {
  id: number;
  result: number;
  win: boolean;
  multiplier: number;
  stake: number;
  target: number;
}

/** Counter animation length: longer for bigger results, ~25% in turbo. */
const climbMs = (x: number, turbo: boolean) => {
  const ms = Math.min(1250, 560 + 170 * Math.log10(Math.max(1, x)));
  return turbo ? Math.round(ms * 0.25) : ms;
};

const presetLabel = (t: number) => (t >= 1000 ? `${t / 1000}k×` : `${t}×`);

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const [history, pushHistory] = useHistory(14);

  const [target, setTargetRaw] = useState(2);
  const [rolling, setRolling] = useState(false);
  const [display, setDisplay] = useState(1);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // The outcome is fixed before the counter starts; leaving mid-climb settles at it.
  const resolved = useRef(0);
  const ticket = useTicket(() => (rolling ? resolved.current : 0));

  const chance = winChance(target);
  const level = volatilityOf(target);

  /** Climbs the counter from 1.00× to x on a log scale (ease-out), then resolves. */
  function climb(x: number, ms: number) {
    return new Promise<void>((resolve) => {
      const t0 = performance.now();
      const lx = Math.log(Math.max(1, x));
      const frame = (now: number) => {
        const e = Math.min(1, (now - t0) / ms);
        const eased = 1 - Math.pow(1 - e, 3);
        setDisplay(e >= 1 ? x : Math.max(1, Math.floor(Math.exp(lx * eased) * 100) / 100));
        if (e >= 1) resolve();
        else raf.current = requestAnimationFrame(frame);
      };
      raf.current = requestAnimationFrame(frame);
    });
  }

  async function playOnce(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    const t = target;
    const out = play(rng.next, t);
    resolved.current = out.multiplier;
    setRolling(true);
    setLast(null);
    setDisplay(1);
    await climb(out.result, climbMs(out.result, turbo.turbo));
    ticket.settle(out.multiplier);
    pushHistory(out.multiplier);
    setLast({ id: ++seq.current, result: out.result, win: out.win, multiplier: out.multiplier, stake, target: t });
    setRolling(false);
    return out.multiplier;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  const busy = rolling || auto.running;

  /** Any settings change after a round clears the board back to the idle preview. */
  const setTarget = (t: number) => {
    if (busy) return;
    const next = clampTarget(t);
    setTargetRaw(next);
    if (last) {
      setLast(null);
      setDisplay(1);
    }
  };

  const main = () => {
    if (auto.mode === 'auto') {
      if (auto.running) auto.stop();
      else if (!rolling && !bet.blocked) auto.start();
      return;
    }
    if (!busy && !bet.blocked) void playOnce(bet.value);
  };
  useHotkeys({ space: main }, !infoOpen);

  // Letter shortcuts: A / S halve / double the bet, Q / W halve / double the target.
  const keys = useRef({ bet, setTarget, target, busy });
  keys.current = { bet, setTarget, target, busy };
  useEffect(() => {
    if (infoOpen) return;
    const onDown = (e: KeyboardEvent) => {
      const el = e.composedPath()[0] as HTMLElement | undefined;
      if (el?.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const k = keys.current;
      if (k.busy) return;
      const key = e.key.toLowerCase();
      if (key === 'a') k.bet.half();
      else if (key === 's') k.bet.double();
      else if (key === 'q') k.setTarget(k.target / 2);
      else if (key === 'w') k.setTarget(k.target * 2);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [infoOpen]);

  // Target and chance are typed as text and kept in step.
  const [targetText, setTargetText] = useState(target.toFixed(2));
  const [chanceText, setChanceText] = useState(fmtPct(chance * 100));
  useEffect(() => {
    setTargetText(target.toFixed(2));
    setChanceText(fmtPct(winChance(target) * 100));
  }, [target]);

  const commitTarget = () => {
    const t = parseFloat(targetText.replace(/,/g, ''));
    if (Number.isFinite(t) && t > 0) setTarget(t);
    setTargetText(clampTarget(Number.isFinite(t) && t > 0 && !busy ? t : target).toFixed(2));
  };
  const commitChance = () => {
    const c = parseFloat(chanceText);
    if (Number.isFinite(c) && c > 0) setTarget(targetForChance(c));
    else setChanceText(fmtPct(chance * 100));
  };

  const state: DialState = rolling ? 'rolling' : last ? (last.win ? 'won' : 'lost') : 'idle';
  const profit = Math.max(0, bet.value * target - bet.value);

  const status = rolling
    ? 'Climbing…'
    : last
      ? `${last.win ? 'Won' : 'Lost'} · ${fmtX(last.result)}×`
      : `Reach ${fmtX(target)}× to win`;

  return (
    <GameLayout
      name="Limbo"
      accent={ACCENT}
      className="limbo-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={rolling} />
          <BetField bet={bet} disabled={busy} />
          <Label hint={`${fmtX(target)}× payout`}>Profit on win</Label>
          <div className="limbo-profit">+{formatAmount(profit, 2)}</div>

          <Label hint={<VolBadge level={level} />}>Quick target</Label>
          <Chips
            label="Quick target"
            wrap
            value={(PRESETS as readonly number[]).includes(target) ? target : -1}
            onChange={setTarget}
            disabled={busy}
            options={PRESETS.map((t) => ({ value: t, label: presetLabel(t), title: `${t}× · ${fmtPct((RTP / t) * 100)}% chance` }))}
          />

          {auto.mode === 'manual' ? (
            <>
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtPct(chance * 100)}%</dd>
                <dt>Payout</dt>
                <dd>{fmtX(target)}×</dd>
              </dl>
              <ActionButton disabled={busy || !!bet.blocked} onClick={() => void playOnce(bet.value)}>
                {rolling ? 'Climbing…' : 'Bet'}
              </ActionButton>
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || rolling}>
              <p className="limbo-auto-note">
                Each bet targets <b>{fmtX(target)}×</b> ({fmtPct(chance * 100)}%). Set the target under the dial.
              </p>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="limbo-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={rolling ? 'live' : last ? (last.win ? 'won' : 'lost') : 'idle'} history={history} />

      <Board className="limbo-board">
        <InstantResult multiplier={last && !rolling ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <Dial target={last && !rolling ? last.target : target} value={display} state={state} burstId={last?.id ?? 0} />
      </Board>

      <div className="limbo-inputs">
        <label className="limbo-field">
          <span>Target multiplier</span>
          <div className="limbo-input">
            <input
              value={targetText}
              inputMode="decimal"
              aria-label="Target multiplier"
              disabled={busy}
              onChange={(e) => setTargetText(e.target.value)}
              onBlur={commitTarget}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
            <b>×</b>
            <button type="button" disabled={busy || target <= MIN_TARGET} onClick={() => setTarget(target / 2)} aria-label="Halve target" title="Halve target (Q)">
              ½
            </button>
            <button type="button" disabled={busy || target >= MAX_TARGET} onClick={() => setTarget(target * 2)} aria-label="Double target" title="Double target (W)">
              2×
            </button>
          </div>
        </label>
        <label className="limbo-field">
          <span>Win chance</span>
          <div className="limbo-input">
            <input
              value={chanceText}
              inputMode="decimal"
              aria-label="Win chance"
              disabled={busy}
              onChange={(e) => setChanceText(e.target.value)}
              onBlur={commitChance}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
            <b>%</b>
          </div>
        </label>
      </div>

      {infoOpen && (
        <InfoModal title="Limbo" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Name a target multiplier. A result is drawn and the counter climbs to it. If the result reaches your target, you win your bet × the target.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Type a target ({fmtX(MIN_TARGET)}× to 1,000,000×) or a win chance; the other follows. Quick-target chips and ½ / 2× set common values.</li>
              <li>Press Bet (or Space). The result appears at once; play is never blocked by a pop-up.</li>
              <li>Auto runs a series of bets at your target, with on-win / on-loss stake changes and stop limits. Space starts and stops it.</li>
              <li>Keys: Space bet · A / S halve / double bet · Q / W halve / double target.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The dial is drawn on the scale 1 − 0.99 ÷ x. On that scale the green arc past your target is exactly your chance to win, and the needle lands
              uniformly along the dial: a result is as likely to land in any stretch as that stretch is long.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The result follows the fair crash law P(result ≥ x) = 0.99 ÷ x. It is drawn as result = ⌊99 ÷ U⌋ ÷ 100 for a uniform U, so for a target t in whole
              cents, result ≥ t exactly when U ≤ 0.99 ÷ t. Win chance = 0.99 ÷ t and the payout is t, so every target returns 0.99 × stake on average.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              RTP is {(RTP * 100).toFixed(0)}% for every target: the target only changes how often you win and how much. Chance runs from {fmtPct(MAX_CHANCE)}% (
              {fmtX(MIN_TARGET)}×) to {fmtPct(MIN_CHANCE)}% (1,000,000×). U is drawn on a 2⁵² grid with exact integer arithmetic, which keeps every target
              within 0.00000003% of 99%, never above. Results show at least 1.00× and at most 1,000,000×.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
