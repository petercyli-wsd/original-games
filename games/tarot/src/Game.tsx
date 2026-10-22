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
  fmtChance,
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
import { CardBack, Glyph } from './Glyph';
import {
  ARCANA_NAMES,
  ARCANA_NUMERALS,
  CARDS_PER_ROUND,
  CARD_MEAN,
  DECKS,
  RISKS,
  RISK_NAMES,
  RISK_VOL,
  RTP,
  chanceAtLeast,
  playRound,
  productOf,
  profitChance,
  returnChance,
  stdDevOf,
  topPrize,
  type Card,
  type Reading,
  type Risk,
} from './math';

const ACCENT = '#c084fc';
const POSITIONS = ['Past', 'Present', 'Future'];
const NUMERALS = ['I', 'II', 'III'];

interface Round extends Reading {
  id: number;
  stake: number;
  risk: Risk;
}

type Tone = 'ruin' | 'low' | 'even' | 'up' | 'gold';
const toneOf = (v: number): Tone => (v === 0 ? 'ruin' : v < 1 ? 'low' : v === 1 ? 'even' : v < 5 ? 'up' : 'gold');
const resultTone = (m: number) => (m > 1 ? 'win' : m === 1 ? 'even' : m > 0 ? 'part' : 'lose');

/** Card face values print without trailing zeros: 0.4×, 1.25×, 30×. */
const faceMult = (v: number) => `${Number(v.toFixed(2))}×`;

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [risk, setRiskState] = useState<Risk>('medium');
  const [round, setRound] = useState<Round | null>(null);
  /** Cards turned face up in the current round (0–3). */
  const [shown, setShown] = useState(0);
  const [revealing, setRevealing] = useState(false);
  /** The card about to turn is "charged" when the reading so far is in profit. */
  const [charged, setCharged] = useState(-1);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The fair value on unmount is the drawn reading itself, read from a ref (not
  // render state), so leaving at any instant after the bet settles the true result.
  // Before the cards are drawn it is a refund.
  const resolved = useRef(1);
  const ticket = useTicket(() => resolved.current);

  const t = turbo.turbo;
  const flipMs = t ? 150 : 520;
  const dealMs = t ? 90 : 300;
  const gapMs = t ? 170 : 540;
  const suspenseMs = t ? 90 : 480;

  async function playOnce(stake: number): Promise<number | null> {
    resolved.current = 1;
    if (!(await ticket.place(stake))) return null;
    const r = playRound(rng.next, risk);
    resolved.current = r.multiplier;
    setRevealing(true);
    setShown(0);
    setCharged(-1);
    setRound({ ...r, id: ++seq.current, stake, risk });

    let ok = await timers.wait(dealMs);
    for (let i = 0; ok && i < CARDS_PER_ROUND; i++) {
      const sofar = productOf(r.values.slice(0, i));
      // The last card builds suspense when the reading is already paying.
      if (i === CARDS_PER_ROUND - 1 && sofar >= 1) {
        setCharged(i);
        ok = await timers.wait(suspenseMs);
        if (!ok) break;
      }
      setCharged(-1);
      setShown(i + 1);
      if (r.values[i] === 0) {
        // The Tower ends the reading: the rest turn together, already dimmed.
        ok = await timers.wait(flipMs + (t ? 60 : 280));
        if (ok) setShown(CARDS_PER_ROUND);
        break;
      }
      ok = await timers.wait(i === CARDS_PER_ROUND - 1 ? flipMs : gapMs);
    }
    if (ok) await timers.wait(t ? 40 : 160);
    ticket.settle(r.multiplier);
    pushHistory(r.multiplier);
    setRevealing(false);
    return r.multiplier;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: t });
  const busy = revealing || auto.running;
  const canBet = auto.mode === 'manual' && !busy && !bet.blocked;

  // A setting change after a round clears the board back to an idle preview.
  const setRisk = (r: Risk) => {
    if (busy) return;
    setRiskState(r);
    setRound(null);
    setShown(0);
  };

  useHotkeys({ space: () => (canBet ? void playOnce(bet.value) : undefined) }, !infoOpen);

  // 1–4 pick the deck.
  const setRiskRef = useRef(setRisk);
  setRiskRef.current = setRisk;
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.composedPath()[0] as HTMLElement | undefined;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i >= 0) setRiskRef.current(RISKS[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  const deck = DECKS[round?.risk ?? risk];
  const done = !!round && !revealing;
  const ruinAt = round ? round.values.findIndex((v, i) => v === 0 && i < shown) : -1;
  const running = round && shown > 0 ? productOf(round.values.slice(0, shown)) : null;

  let status: string;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (revealing && round) {
    tone = 'live';
    status = shown === 0 ? 'Shuffling…' : ruinAt >= 0 ? 'The Tower falls…' : `Card ${shown} of 3 · ${fmtMult(running ?? 1)}`;
  } else if (done && round) {
    tone = round.multiplier >= 1 ? 'won' : 'lost';
    status = ruinAt >= 0 ? 'The Tower · 0.00×' : `Reading pays ${fmtMult(round.multiplier)}`;
  } else status = 'Draw three cards';

  // How many of each card the reading turned (for the deck strip).
  const drawnCount = new Map<number, number>();
  if (round) for (let i = 0; i < shown; i++) drawnCount.set(round.cards[i], (drawnCount.get(round.cards[i]) ?? 0) + 1);

  const top = topPrize(risk);

  return (
    <GameLayout
      name="Tarot"
      accent={ACCENT}
      panel={
        <>
          <ModeTabs auto={auto} disabled={revealing} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={RISK_VOL[risk]} />}>Risk</Label>
          <Chips
            label="Risk"
            wrap
            options={RISKS.map((r, i) => ({ value: r, label: RISK_NAMES[r], title: `${RISK_NAMES[r]} deck (key ${i + 1})` }))}
            value={risk}
            onChange={setRisk}
            disabled={busy}
          />

          <dl className="og-stats">
            <dt>Chance to profit</dt>
            <dd>{fmtChance(profitChance(risk))}</dd>
            <dt>Pays something</dt>
            <dd>{fmtChance(returnChance(risk))}</dd>
            <dt>10× or more</dt>
            <dd>{fmtChance(chanceAtLeast(risk, 10))}</dd>
            <dt>Top prize</dt>
            <dd>{fmtMult(top)}</dd>
            <dt>Max win</dt>
            <dd>{(bet.value * top).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={() => void playOnce(bet.value)}>
              {revealing ? 'Reading…' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || revealing}>
              <p className="tr-auto-note">
                Each auto bet turns a full three-card reading from the <b>{RISK_NAMES[risk]}</b> deck.
              </p>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="tr-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Board className="tr-board">
        <InstantResult multiplier={done && round ? round.multiplier : null} stake={round?.stake ?? 0} id={round?.id ?? 0} />

        <div className="tr-spread" style={{ '--flip': `${flipMs}ms`, '--deal': `${dealMs}ms` } as CSSProperties}>
          {POSITIONS.map((pos, i) => {
            const card: Card | null = round ? DECKS[round.risk][round.cards[i]] : null;
            const up = !!round && shown > i;
            const dimmed = up && ruinAt >= 0 && i !== ruinAt;
            const next = revealing && shown === i && ruinAt < 0;
            const cls =
              'tr-card' +
              (up ? ' up' : '') +
              (card && up ? ` t-${toneOf(card.value)}` : '') +
              (dimmed ? ' dim' : '') +
              (next ? ' next' : '') +
              (charged === i ? ' charged' : '') +
              (done && round && round.multiplier > 1 && !dimmed ? ' glow' : '');
            return (
              <div key={`${round?.id ?? 'idle'}-${i}`} className="tr-slot" style={{ '--i': i } as CSSProperties}>
                <div className="tr-pos">
                  <b>{NUMERALS[i]}</b> {pos}
                </div>
                <div className={cls + (round ? ' dealt' : '')} aria-label={up && card ? `${ARCANA_NAMES[card.arcana]}, ${faceMult(card.value)}` : 'Face-down card'}>
                  <div className="tr-inner">
                    <div className="tr-face tr-back">
                      <CardBack />
                    </div>
                    <div className="tr-face tr-front">
                      {card && (
                        <>
                          <span className="tr-num">{ARCANA_NUMERALS[card.arcana]}</span>
                          <Glyph arcana={card.arcana} />
                          <span className="tr-name">{ARCANA_NAMES[card.arcana]}</span>
                          <span className="tr-mult">{faceMult(card.value)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className={'tr-equation' + (done && round ? ` r-${resultTone(round.multiplier)}` : '')} aria-label="Reading">
          {POSITIONS.map((_, i) => {
            const v = round && shown > i ? round.values[i] : null;
            return (
              <span key={i} className="tr-eq-group">
                {i > 0 && <i className="tr-op">×</i>}
                <span className={'tr-term' + (v !== null ? ` t-${toneOf(v)}` : '')}>{v !== null ? faceMult(v) : '?'}</span>
              </span>
            );
          })}
          <i className="tr-op">=</i>
          <b className="tr-total" key={`${round?.id ?? 0}-${shown}`}>
            {round && shown > 0 ? (shown >= CARDS_PER_ROUND || ruinAt >= 0 ? fmtMult(round.multiplier) : fmtMult(running ?? 1)) : '?'}
          </b>
        </div>
      </Board>

      <div className="tr-deck" aria-label={`${RISK_NAMES[round?.risk ?? risk]} deck`}>
        <div className="tr-deck-head">
          <span>
            {RISK_NAMES[round?.risk ?? risk]} deck · {deck.length} cards
          </span>
          <span className="tr-deck-mean">
            mean card {CARD_MEAN.toFixed(4)}× · cubed = {(RTP * 100).toFixed(0)}%
          </span>
        </div>
        <div className="tr-deck-grid">
          {deck.map((c, idx) => {
            const n = drawnCount.get(idx) ?? 0;
            return (
              <div key={c.arcana} className={`tr-pip t-${toneOf(c.value)}` + (n ? ' hit' : '')} title={`${ARCANA_NAMES[c.arcana]}: ${faceMult(c.value)}, ${fmtChance(c.p)} per card`}>
                {n > 1 && <em className="tr-pip-count">×{n}</em>}
                <Glyph arcana={c.arcana} />
                <b>{faceMult(c.value)}</b>
                <small>{fmtChance(c.p)}</small>
                <i className="tr-pip-bar" style={{ width: `${Math.max(3, Math.sqrt(c.p) * 100)}%` }} />
              </div>
            );
          })}
        </div>
      </div>

      {infoOpen && (
        <InfoModal title="Tarot" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Three cards are drawn for your Past, Present and Future and turned one at a time. Every card shows a multiplier, and the reading pays the
              three multiplied together. One Tower (0×) and the reading pays nothing.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet and pick a deck: Low, Medium, High or Extreme (keys 1–4).</li>
              <li>Press Bet (or Space). The cards turn left to right and the running product builds under them.</li>
              <li>Use Auto to run a series of readings with your own stake and stop rules. Turbo speeds up the reveal.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The strip under the board lists every card in the selected deck with its exact chance per draw; the bar under each card grows with that
              chance. Each of the three cards is an independent draw from the same deck, so a card can come up more than once.
            </p>
            <table className="tr-info-table">
              <thead>
                <tr>
                  <th>Deck</th>
                  <th>Profit</th>
                  <th>Pays</th>
                  <th>Top</th>
                  <th>Std dev</th>
                </tr>
              </thead>
              <tbody>
                {RISKS.map((r) => (
                  <tr key={r}>
                    <td>{RISK_NAMES[r]}</td>
                    <td>{fmtChance(profitChance(r))}</td>
                    <td>{fmtChance(returnChance(r))}</td>
                    <td>{fmtMult(topPrize(r))}</td>
                    <td>{stdDevOf(r).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              For independent cards the mean of a product is the product of the means: E[X₁X₂X₃] = E[X]³. Every deck is built so that its mean card is
              exactly <sup>3</sup>√0.99 = {CARD_MEAN.toFixed(6)}×: the cards above the lowest get probabilities pᵢ = s·wᵢ with s = (<sup>3</sup>√0.99 − v₀) ÷ Σ wᵢ(vᵢ − v₀), and
              the lowest card takes the rest. The return is then (<sup>3</sup>√0.99)³ = 99% exactly, which the tests confirm by enumerating every one of the n³ card
              triples.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every deck returns exactly {(RTP * 100).toFixed(0)}%; risk only reshapes the deck (more Towers, bigger top cards). The top prize is the top
              card three times: {RISKS.map((r) => `${RISK_NAMES[r]} ${fmtMult(topPrize(r))}`).join(', ')}. The cards are drawn the moment you bet, so
              leaving mid-reveal settles the true result.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
