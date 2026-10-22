import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { formatAmount, type Volatility } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import Dial, { type MoveArc } from './Board';
import {
  DIGITS,
  FACTORS,
  LENGTHS,
  RTP,
  VOLATILITY,
  benford,
  blockReason,
  dialPosition,
  digitList,
  digitOdds,
  digitSet,
  hasDigit,
  nextLandings,
  prizeFor,
  startChance,
  toggleDigit,
  turnFor,
  volatilityOf,
  winChance,
  type DigitSet,
  type Length,
} from './math';

type Phase = 'idle' | 'spinning' | 'checkpoint' | 'over';
/** win/lose: the last factor decided it. dead/locked: no remaining path could change the result. */
type Outcome = 'win' | 'lose' | 'cashed' | 'dead' | 'locked';

interface Round {
  digits: DigitSet;
  factors: Length;
  stake: number;
  prize: number;
  chain: number[];
  product: number;
  cash: number;
  outcome: Outcome | null;
}

const LEVELS: Volatility[] = ['low', 'medium', 'high', 'extreme'];
const LEVEL_LABEL: Record<Volatility, string> = { low: 'Low', medium: 'Med', high: 'High', extreme: 'Extreme' };

function DigitPicker({ value, disabled, onToggle }: { value: DigitSet; disabled: boolean; onToggle(d: number): void }) {
  return (
    <div className="og-chips" role="group" aria-label="Leading digits to back">
      {DIGITS.map((d) => {
        const on = hasDigit(value, d);
        return (
          <button
            key={d}
            type="button"
            className={'og-chip' + (on ? ' on' : '')}
            aria-pressed={on}
            disabled={disabled}
            title={`Benford: ${(benford(d) * 100).toFixed(1)}%`}
            onClick={() => onToggle(d)}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [digits, setDigits] = useState<DigitSet>(digitSet(1));
  const [factors, setFactors] = useState<Length>(4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [spin, setSpinState] = useState(0);
  const [spinMs, setSpinMs] = useState(0);
  const [move, setMove] = useState<MoveArc | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The cursor's total rotation in turns; a ref so chained timers never read a stale value.
  const spinRef = useRef(0);
  const setSpin = (v: number) => {
    spinRef.current = v;
    setSpinState(v);
  };

  // The factor in flight is decided the moment it starts, so leaving mid-spin
  // settles at its real result, never at the pre-spin value.
  const resolved = useRef<number>(RTP);
  const ticket = useTicket(() => (phase === 'spinning' ? resolved.current : round?.cash ?? 0));

  const t = turbo.turbo;
  const spinFor = (f: number) => Math.round((t ? 70 : 280) + (t ? 150 : 620) * turnFor(f));
  const resetMs = t ? 80 : 300;
  const live = phase === 'spinning' || phase === 'checkpoint';
  const settingsBlock = blockReason(digits, factors);
  const moveSeq = useRef(0);

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function draw(r: Round) {
    const f = FACTORS[rng.int(FACTORS.length)];
    const product = r.product * f;
    const left = r.factors - r.chain.length - 1;
    const p = winChance(product, left, r.digits);
    const cash = p >= 1 ? r.prize : r.prize * p;
    resolved.current = cash;
    const ms = spinFor(f);
    setPhase('spinning');
    setMove({ from: dialPosition(r.product), turn: turnFor(f), factor: f, key: ++moveSeq.current });
    setSpinMs(ms);
    setSpin(spinRef.current + turnFor(f));
    timers.after(ms + 40, () => {
      const next: Round = { ...r, chain: [...r.chain, f], product, cash };
      if (left === 0) return finish(next, p >= 1 ? 'win' : 'lose', cash);
      if (p <= 0) return finish(next, 'dead', 0);
      if (p >= 1) return finish(next, 'locked', cash);
      setRound(next);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: p });
    });
  }

  async function start() {
    if (live || bet.blocked || settingsBlock) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      digits,
      factors,
      stake: bet.value,
      prize: prizeFor(digits, factors),
      chain: [],
      product: 1,
      cash: RTP,
      outcome: null,
    };
    resolved.current = RTP;
    setRound(r);
    setMove(null);
    setPhase('spinning');
    // Bring the cursor back to 1 (the top) first, then make the first multiplication.
    const s = spinRef.current;
    if (Math.abs(s - Math.round(s)) < 1e-9) return draw(r);
    setSpinMs(resetMs);
    setSpin(Math.ceil(s));
    timers.after(resetMs + 30, () => draw(r));
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setMove(null);
    setPhase('idle');
    const s = spinRef.current;
    if (Math.abs(s - Math.round(s)) > 1e-9) {
      setSpinMs(resetMs);
      setSpin(Math.ceil(s));
    }
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? draw(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.digits ?? digits;
  const k = round?.factors ?? factors;
  const chain = round?.chain ?? [];
  const product = round?.product ?? 1;
  const left = k - chain.length;
  const stake = round?.stake ?? bet.value;
  const p0 = startChance(s, k);
  const prize = round?.prize ?? (p0 > 0 ? RTP / p0 : 0);
  const pNow = left > 0 ? winChance(product, left, s) : round?.outcome === 'win' ? 1 : 0;
  const cash = round?.cash ?? RTP;
  const odds = left > 0 ? digitOdds(product, left) : null;
  const landings = left > 0 && !(phase === 'over' && round?.outcome === 'cashed') ? nextLandings(product, left, s) : null;
  const pick = startChance(digits, factors);
  const vol = volatilityOf(pick);
  const preset = LEVELS.find((l) => VOLATILITY[l].digits === digits && VOLATILITY[l].factors === factors) ?? '';
  const lead = Number(String(product)[0]);
  const named = digitList(s);
  const outcome = phase === 'over' ? round?.outcome ?? null : null;
  // The result card sits on the half of the dial away from the cursor, so the final sector stays in view.
  const at = dialPosition(product);
  const overTop = at > 0.25 && at < 0.75;

  const title: Record<Outcome, string> = {
    win: `Leads with ${lead} · you win`,
    lose: `Leads with ${lead}`,
    cashed: 'Cashed out',
    dead: 'Out of reach',
    locked: 'Locked in',
  };

  let status = named ? `Ready · lead with ${named} after ${k} factor${k > 1 ? 's' : ''}` : 'Ready · pick a leading digit';
  if (phase === 'spinning') status = `Multiplying · factor ${chain.length + 1} of ${k}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${chain.length} of ${k} factors`;
  if (outcome) status = `${title[outcome]} · ${chain.length} of ${k} factors`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const result = outcome ? (round && round.cash > 0 ? 'win' : 'lose') : null;
  const note = outcome === 'dead' ? 'out of reach' : outcome === 'locked' ? 'locked in' : outcome === 'cashed' ? 'cashed out' : null;

  return (
    <GameLayout
      name="Slide Rule"
      accent="#e9c46a"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Leading digits</Label>
          <DigitPicker value={digits} disabled={live} onToggle={(d) => change(() => setDigits((v) => toggleDigit(v, d)))} />

          <Label hint="each one ×2 … ×9">Factors</Label>
          <Chips
            label="Number of factors"
            options={LENGTHS.map((v) => ({ value: v, label: v }))}
            value={factors}
            disabled={live}
            onChange={(v) => change(() => setFactors(v))}
          />

          <Label hint="digit + factors">Quick picks</Label>
          <Chips
            label="Quick picks by volatility"
            options={LEVELS.map((l) => ({
              value: l,
              label: LEVEL_LABEL[l],
              title: `Lead with ${digitList(VOLATILITY[l].digits)} after ${VOLATILITY[l].factors} factors`,
            }))}
            value={preset}
            disabled={live}
            onChange={(l) => {
              const v = VOLATILITY[l as Volatility];
              if (!v) return;
              change(() => {
                setDigits(v.digits);
                setFactors(v.factors);
              });
            }}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{pick > 0 ? fmtChance(pick) : '—'}</dd>
            <dt>Prize</dt>
            <dd>{pick > 0 && pick < 1 ? fmtMult(RTP / pick) : '—'}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => draw(round)}>
                Multiply next · {left} left
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked || !!settingsBlock} onClick={() => void start()}>
              {phase === 'spinning' ? 'Multiplying…' : settingsBlock ?? (phase === 'over' ? 'Bet again' : 'Bet')}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          {
            label: 'Win chance',
            value: round ? fmtChance(pNow) : p0 > 0 ? fmtChance(p0) : '—',
            sub: named ? `final leads with ${named}` : 'no digit picked',
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: round ? fmtMult(cash) : '—',
            sub: round ? formatAmount(stake * cash, 2) : 'after each factor',
            tone: 'cash',
          },
          {
            label: 'Full win pays',
            value: prize > 0 && p0 < 1 ? fmtMult(prize) : '—',
            sub: prize > 0 && p0 < 1 ? formatAmount(stake * prize, 2) : 'pick other digits',
            tone: 'prize',
          },
        ]}
      />

      <Board>
        <Dial
          digits={s}
          chain={chain}
          product={product}
          left={left}
          spin={spin}
          spinMs={spinMs}
          spinning={phase === 'spinning' && chain.length < k}
          easeMs={t ? 90 : 320}
          odds={odds}
          landings={landings}
          move={move}
          result={result}
          note={note}
          onToggle={live ? undefined : (d) => change(() => setDigits((v) => toggleDigit(v, d)))}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={title[round.outcome]}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked ?? settingsBlock}
            onBetAgain={() => void start()}
            onClear={clear}
            placement={overTop ? 'top' : 'bottom'}
          />
        )}
      </Board>

      <div className="sr-legend" aria-hidden="true">
        <span>
          <i className="k-bar on" /> your digits' live chance
        </span>
        <span>
          <i className="k-bar" /> other digits
        </span>
        <span>
          <i className="k-benford" /> Benford's law
        </span>
        <span>
          <i className="k-dot" /> next factor (1 in 8 each), filled by your chance after it
        </span>
      </div>

      {live ? (
        <ChanceBar
          p={pNow}
          label={`Final product leads with ${named}`}
          note="The green bars round the dial add up to this. Each factor can push it up or down."
        />
      ) : (
        <Caption>
          {phase === 'over'
            ? `Multiplying by f turns the dial by log₁₀ f, so the cursor always points at the product's leading digit. Tap a sector or digit to change your bet.`
            : `${k} random factor${k > 1 ? 's' : ''} from ×2 to ×9; win if the product leads with ${named || 'your digit'}. Tap sectors to back more digits. Benford: after many factors 1 leads ${(
                benford(1) * 100
              ).toFixed(0)}% of the time, 9 only ${(benford(9) * 100).toFixed(1)}%. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Slide Rule" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Start at 1 and multiply by random factors from 2 to 9. Before you bet, choose how many factors (1 to 6) and which leading digits you back. You win
              if the final product starts with one of your digits: 3 × 7 × 4 = <b>8</b>4 leads with 8.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Tap one or more digits (on the panel or on the dial) and pick the number of factors, or use a quick pick. Then bet.</li>
              <li>Each factor turns the cursor. After every factor but the last you can cash out, or multiply the next one (Space). C cashes out.</li>
              <li>
                If no remaining factors could ever lead with your digits, the round ends early as a loss. If every remaining path wins, it pays the prize at
                once.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The dial is a slide rule: digit d owns the arc from log₁₀ d to log₁₀(d+1), so multiplying is turning and the cursor always points at the leading
              digit. The <b style={{ color: 'var(--green)' }}>green bars</b> round the outside are the live chances that the final product leads with each of
              your digits; added together they are your win chance. Grey bars are the other digits, and the gold tick across each bar is Benford's law.
            </p>
            <p>
              The 8 dots inside the scale are where the next factor can land, 1 in 8 each. Each dot is filled with your win chance if the cursor lands there,
              so your chance now is exactly the average of the 8 fills. On the last factor a dot is either full (wins) or empty (loses).
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              <b>Benford's law.</b> Leading digits of products are governed by the fractional part of log₁₀ of the product, the cursor's angle. Each factor
              adds an independent log₁₀ f, and sums of independent turns spread evenly round a circle. An evenly spread angle lands in digit d's sector with
              probability equal to its width: P(d) = log₁₀(1 + 1/d), about 30.1% for 1 down to 4.6% for 9. With six factors every digit is within 0.7 points
              of that limit; with one factor each of 2…9 is exactly 1 in 8.
            </p>
            <p>
              The game uses the exact odds, not the limit: with product c and j factors to go, P(win) = (number of the 8<sup>j</sup> equally likely factor
              sequences whose product with c leads with your digits) / 8<sup>j</sup>, counted from a small table of products.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A full win pays prize = {(RTP * 100).toFixed(0)}% ÷ P(win at the start). The cash-out at any checkpoint is prize × P(win now). Because P(win now)
              is the average of the 8 next landings, the cash-out is a martingale: on average it neither rises nor falls with each factor. So whenever and
              however you cash out, the game is worth exactly {(RTP * 100).toFixed(0)}% of your stake. The biggest prize is 0.99 × 64 = 63.36× (leading 9
              after two factors: only 3 × 3).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
