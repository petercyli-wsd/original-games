import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  StageTop,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MAX_CHANCE, MIN_CHANCE, RTP, chanceForMultiplier, chanceOf, clampChance, multiplierFor, roll, targetFor, type Direction } from './math';

interface Last {
  id: number;
  result: number;
  win: boolean;
  multiplier: number;
  stake: number;
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [dir, setDir] = useState<Direction>('over');
  const [chance, setChance] = useState(49.5);
  const [rolling, setRolling] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  const resolved = useRef(0);
  const ticket = useTicket(() => (rolling ? resolved.current : 0));

  const target = targetFor(chance, dir);
  const multiplier = multiplierFor(chance);
  const animMs = turbo.turbo ? 90 : 420;

  async function playOnce(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    const { result, win } = roll(rng.next(), target, dir);
    const mult = win ? multiplier : 0;
    resolved.current = mult;
    setRolling(true);
    setLast({ id: ++seq.current, result, win, multiplier: mult, stake });
    await timers.wait(animMs);
    ticket.settle(mult);
    pushHistory(mult);
    setRolling(false);
    return mult;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  const busy = rolling || auto.running;

  useHotkeys({ space: () => (auto.mode === 'manual' && !busy && !bet.blocked ? void playOnce(bet.value) : undefined) }, !infoOpen);

  // Multiplier and chance are typed as text; the slider and the swap keep them in step.
  const [multText, setMultText] = useState(multiplier.toFixed(4));
  const [chanceText, setChanceText] = useState(chance.toFixed(2));
  useEffect(() => {
    setMultText(multiplier.toFixed(4));
    setChanceText(chance.toFixed(2));
  }, [chance]);

  const setFromTarget = (t: number) => setChance(clampChance(chanceOf(t, dir)));
  const minTarget = dir === 'over' ? 100 - MAX_CHANCE : MIN_CHANCE;
  const maxTarget = dir === 'over' ? 100 - MIN_CHANCE : MAX_CHANCE;

  const resultPos = last ? last.result : null;
  const winZone = dir === 'over' ? { left: target, width: 100 - target } : { left: 0, width: target };

  return (
    <GameLayout
      name="Dice"
      accent="#3b82f6"
      panel={
        <>
          <ModeTabs auto={auto} disabled={rolling} />
          <BetField bet={bet} disabled={busy} />
          <Label hint={`${fmtMult(multiplier)} payout`}>Profit on win</Label>
          <div className="dice-profit">{formatAmount(Math.max(0, bet.value * multiplier - bet.value), 2)}</div>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={busy || !!bet.blocked} onClick={() => void playOnce(bet.value)}>
              {rolling ? 'Rolling…' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || rolling} />
          )}
          {bet.blocked && <p className="dice-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop
        status={rolling ? 'Rolling…' : last ? `Rolled ${last.result.toFixed(2)}` : `Roll ${dir} ${target.toFixed(2)} to win`}
        tone={rolling ? 'live' : last ? (last.win ? 'won' : 'lost') : 'idle'}
        history={history}
      />

      <Board className="dice-board">
        <InstantResult multiplier={last && !rolling ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className="dice-wrap">
          <div className="dice-scale" aria-hidden="true">
            {[0, 25, 50, 75, 100].map((v) => (
              <span key={v} style={{ left: `${v}%` }}>
                {v}
              </span>
            ))}
          </div>
          <div className="dice-track">
            <div className="dice-zone lose" />
            <div className="dice-zone win" style={{ left: `${winZone.left}%`, width: `${winZone.width}%` }} />
            <input
              type="range"
              className="dice-range"
              min={minTarget}
              max={maxTarget}
              step={0.01}
              value={target}
              disabled={busy}
              aria-label={`Roll ${dir} target`}
              onChange={(e) => setFromTarget(Number(e.target.value))}
            />
            {resultPos !== null && (
              <div
                className={'dice-marker' + (last?.win ? ' win' : ' lose') + (rolling ? ' moving' : '')}
                style={{ left: `${resultPos}%`, transitionDuration: `${animMs}ms` } as CSSProperties}
              >
                <span>{resultPos.toFixed(2)}</span>
              </div>
            )}
          </div>
          <p className="dice-caption">
            Green is {chance.toFixed(2)}% of the track: that is your exact chance. Payout {fmtMult(multiplier)} = {(RTP * 100).toFixed(0)} ÷{' '}
            {chance.toFixed(2)}.
          </p>
        </div>
      </Board>

      <div className="dice-inputs">
        <label className="dice-field">
          <span>Multiplier</span>
          <div className="dice-input">
            <input
              value={multText}
              inputMode="decimal"
              disabled={busy}
              onChange={(e) => setMultText(e.target.value)}
              onBlur={() => {
                const m = parseFloat(multText);
                if (Number.isFinite(m) && m > 1) setChance(chanceForMultiplier(m));
                else setMultText(multiplier.toFixed(4));
              }}
            />
            <b>×</b>
          </div>
        </label>
        <label className="dice-field">
          <span>Roll {dir === 'over' ? 'over' : 'under'}</span>
          <button
            type="button"
            className="dice-swap"
            disabled={busy}
            onClick={() => {
              setDir((d) => (d === 'over' ? 'under' : 'over'));
            }}
            title="Swap over / under (keeps the chance)"
          >
            <span>{target.toFixed(2)}</span>
            <b>⇄</b>
          </button>
        </label>
        <label className="dice-field">
          <span>Win chance</span>
          <div className="dice-input">
            <input
              value={chanceText}
              inputMode="decimal"
              disabled={busy}
              onChange={(e) => setChanceText(e.target.value)}
              onBlur={() => {
                const c = parseFloat(chanceText);
                if (Number.isFinite(c) && c > 0) setChance(clampChance(c));
                else setChanceText(chance.toFixed(2));
              }}
            />
            <b>%</b>
          </div>
        </label>
      </div>

      {infoOpen && (
        <InfoModal title="Dice" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>A number from 0.00 to 99.99 is rolled. Win if it lands on the green side of your target.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Drag the slider, or type a multiplier or win chance. The other two follow.</li>
              <li>Swap between roll over and roll under with ⇄; the chance stays the same.</li>
              <li>Press Bet (or Space). Use Auto to run a series of bets with your own stop rules.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>The roll is uniform, so the green share of the track is exactly your chance to win.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Payout = {(RTP * 100).toFixed(0)} ÷ win chance (in %), so every target returns {(RTP * 100).toFixed(0)}% of stakes in the long run. Chance
              runs from {MIN_CHANCE}% (9,900×) to {MAX_CHANCE}% (1.0102×).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
