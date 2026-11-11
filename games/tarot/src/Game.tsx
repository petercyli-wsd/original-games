import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  StageTop,
  VolBadge,
  eventMs,
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

const POSITIONS = ['Past', 'Present', 'Future'];

interface Round extends Reading {
  id: number;
  stake: number;
  risk: Risk;
}

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
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The fair value on unmount is the drawn reading itself, read from a ref (not
  // render state), so leaving at any instant after the bet settles the true result.
  // Before the cards are drawn it is the stake's fair value, RTP (a stake that
  // never got accepted is refunded by the ticket itself).
  const resolved = useRef(RTP);
  const ticket = useTicket(() => resolved.current);

  const t = turbo.turbo;
  const flipMs = eventMs(t);
  const dealMs = eventMs(t, 300);
  const gapMs = eventMs(t, 540);
  const suspenseMs = eventMs(t, 480);

  async function playOnce(stake: number): Promise<number | null> {
    resolved.current = RTP;
    if (!(await ticket.place(stake))) return null;
    const r = playRound(rng.next, risk);
    resolved.current = r.multiplier;
    setRevealing(true);
    setShown(0);
    setRound({ ...r, id: ++seq.current, stake, risk });

    let ok = await timers.wait(dealMs);
    for (let i = 0; ok && i < CARDS_PER_ROUND; i++) {
      const sofar = productOf(r.values.slice(0, i));
      // The last card builds suspense when the reading is already paying.
      if (i === CARDS_PER_ROUND - 1 && sofar >= 1) {
        ok = await timers.wait(suspenseMs);
        if (!ok) break;
      }
      setShown(i + 1);
      if (r.values[i] === 0) {
        // The Tower ends the reading: the rest turn together, already dimmed.
        ok = await timers.wait(flipMs + eventMs(t, 280));
        if (ok) setShown(CARDS_PER_ROUND);
        break;
      }
      ok = await timers.wait(i === CARDS_PER_ROUND - 1 ? flipMs : gapMs);
    }
    if (ok) await timers.wait(eventMs(t, 160));
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

  const top = topPrize(risk);

  // Deck strip: every card value in the deck with a bar sized by its chance per draw.
  const stripRisk = round?.risk ?? risk;
  const deck = DECKS[stripRisk];
  const maxP = Math.max(...deck.map((c) => c.p));
  const drawn = new Set<number>();
  if (round) for (let i = 0; i < shown; i++) drawn.add(round.cards[i]);

  // Chance to profit given the cards already turned (display only, from the deck's own probabilities).
  const profitGiven = (start: number, left: number): number => {
    if (left === 0) return start > 1 + 1e-9 ? 1 : 0;
    return deck.reduce((a, c) => a + c.p * profitGiven(start * c.value, left - 1), 0);
  };
  const liveChance =
    revealing && round && shown > 0 ? profitGiven(running ?? 1, CARDS_PER_ROUND - Math.min(shown, CARDS_PER_ROUND)) : profitChance(risk);

  return (
    <GameLayout
      name="Tarot"
      accent={ACCENTS.violet}
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

      <Readouts
        items={[
          { label: 'Chance to profit', value: fmtChance(liveChance), tone: 'chance' },
          { label: 'Top prize', value: fmtMult(top), tone: 'prize' },
        ]}
      />

      <Board className="tr-board">
        <InstantResult multiplier={done && round ? round.multiplier : null} stake={round?.stake ?? 0} id={round?.id ?? 0} />

        <div className="tr-spread" style={{ '--flip': `${flipMs}ms` } as CSSProperties}>
          {POSITIONS.map((pos, i) => {
            const card: Card | null = round ? DECKS[round.risk][round.cards[i]] : null;
            const up = !!round && shown > i;
            const dimmed = up && ruinAt >= 0 && i !== ruinAt;
            const cls = 'tr-card' + (up ? ' up' : '') + (card && up && card.value === 0 ? ' ruin' : '') + (dimmed ? ' dim' : '');
            return (
              <div key={`${round?.id ?? 'idle'}-${i}`} className="tr-slot">
                <div className="tr-pos">{pos}</div>
                <div className={cls} aria-label={up && card ? `${ARCANA_NAMES[card.arcana]}, ${faceMult(card.value)}` : 'Face-down card'}>
                  <div className="tr-inner">
                    <div className="tr-face tr-back" />
                    <div className="tr-face tr-front">
                      {card && (
                        <>
                          <span className="tr-num">{ARCANA_NUMERALS[card.arcana]}</span>
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
                <span className={'tr-term' + (v === 0 ? ' ruin' : '')}>{v !== null ? faceMult(v) : '?'}</span>
              </span>
            );
          })}
          <i className="tr-op">=</i>
          <b className="tr-total" key={`${round?.id ?? 0}-${shown}`}>
            {round && shown > 0 ? (shown >= CARDS_PER_ROUND || ruinAt >= 0 ? fmtMult(round.multiplier) : fmtMult(running ?? 1)) : '?'}
          </b>
        </div>
      </Board>

      <div className="tr-deck" role="img" aria-label={`${RISK_NAMES[stripRisk]} deck: card multipliers, bar length is the chance per draw`}>
        {deck.map((c, idx) => (
          <div key={c.arcana} className={'tr-pip' + (c.value >= 1 ? ' win' : ' lose') + (drawn.has(idx) ? ' hit' : '')} title={ARCANA_NAMES[c.arcana]}>
            <b>{faceMult(c.value)}</b>
            <i className="tr-pip-bar" style={{ width: `${Math.max(4, (c.p / maxP) * 100)}%` }} />
          </div>
        ))}
      </div>

      <Caption>Win when the three card multipliers multiply to more than 1×.</Caption>

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
              Each of the three cards is an independent draw from the same deck, so a card can come up more than once.
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
