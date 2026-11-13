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
  CORE_MEAN,
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  DIFFICULTY_VOL,
  RTP,
  SIDE_MEAN,
  TABLES,
  chancesGiven,
  partChance,
  playRound,
  productOf,
  profitChance,
  returnChance,
  stdDevOf,
  topPrize,
  type Difficulty,
  type Face,
  type Reading,
} from './math';

/** Board order is left, core, right; `rev` is the position in the reveal order (core, left, right). */
const SLOTS = [
  { name: 'Left', rev: 1, core: false },
  { name: 'Core', rev: 0, core: true },
  { name: 'Right', rev: 2, core: false },
];

interface Round extends Reading {
  id: number;
  stake: number;
  difficulty: Difficulty;
}

const resultTone = (m: number) => (m > 1 ? 'win' : m === 1 ? 'even' : m > 0 ? 'part' : 'lose');

/** Face values print without trailing zeros: 0.4x, 1.1x, 50x. */
const faceMult = (v: number) => `${Number(v.toFixed(2))}×`;

function Strip({ title, faces, hit }: { title: string; faces: Face[]; hit: number | null }) {
  const maxP = Math.max(...faces.map((c) => c.p));
  return (
    <div className="tr-strip" role="img" aria-label={`${title} cards: multiplier, bar length is the chance`}>
      <span className="tr-strip-title">{title}</span>
      {faces.map((c, i) => (
        <div key={c.value} className={'tr-pip ' + (c.value === 0 ? 'lose' : c.value >= 1 ? 'win' : 'part') + (hit === i ? ' hit' : '')}>
          <b>{faceMult(c.value)}</b>
          <i className="tr-pip-bar" style={{ width: `${Math.max(4, (c.p / maxP) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficultyState] = useState<Difficulty>('medium');
  const [round, setRound] = useState<Round | null>(null);
  /** Cards turned face up in reveal order (0 to 3). */
  const [shown, setShown] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The fair value on unmount is the drawn result, read from a ref (not render
  // state), so leaving at any instant after the bet settles the true payout.
  // Before the cards are drawn it is RTP (a stake that never got accepted is
  // refunded by the ticket itself).
  const resolved = useRef(RTP);
  const ticket = useTicket(() => resolved.current);
  const busyRef = useRef(false);

  const t = turbo.turbo;
  const flipMs = eventMs(t);
  const dealMs = eventMs(t, 300);
  const gapMs = eventMs(t, 540);

  async function playOnce(stake: number): Promise<number | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    try {
      resolved.current = RTP;
      if (!(await ticket.place(stake))) return null;
      const r = playRound(rng.next, difficulty);
      resolved.current = r.multiplier;
      setRevealing(true);
      setShown(0);
      setRound({ ...r, id: ++seq.current, stake, difficulty });

      let ok = await timers.wait(dealMs);
      // Core first, then left, then right; a 0x side card stops the round.
      for (let i = 0; ok && i < 3; i++) {
        setShown(i + 1);
        if (i > 0 && r.values[i] === 0) {
          ok = await timers.wait(flipMs);
          break;
        }
        ok = await timers.wait(i === 2 ? flipMs : gapMs);
      }
      if (ok) await timers.wait(eventMs(t, 160));
      ticket.settle(r.multiplier);
      pushHistory(r.multiplier);
      setRevealing(false);
      return r.multiplier;
    } finally {
      busyRef.current = false;
    }
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: t });
  const busy = revealing || auto.running;
  const canBet = auto.mode === 'manual' && !busy && !bet.blocked;

  // A setting change after a round clears the board back to an idle preview.
  const setDifficulty = (d: Difficulty) => {
    if (busy) return;
    setDifficultyState(d);
    setRound(null);
    setShown(0);
  };

  useHotkeys({ space: () => (canBet ? void playOnce(bet.value) : undefined) }, !infoOpen);

  // 1-4 pick the difficulty.
  const setRef = useRef(setDifficulty);
  setRef.current = setDifficulty;
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.composedPath()[0] as HTMLElement | undefined;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i >= 0) setRef.current(DIFFICULTIES[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  const done = !!round && !revealing;
  const vals = round ? round.values : null;
  const revealed = vals ? vals.slice(0, shown) : [];
  /** Reveal position of the 0x side card that stopped the round, if it is face up. */
  const stopAt = vals ? [1, 2].find((i) => i < shown && vals[i] === 0) ?? -1 : -1;
  const running = vals && shown > 0 ? productOf(revealed) : null;

  let status: string;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (revealing && vals) {
    tone = 'live';
    status = shown === 0 ? 'Dealing three cards' : stopAt >= 0 ? `${SLOTS.find((s) => s.rev === stopAt)?.name} side is 0×` : `${['Core', 'Left', 'Right'][shown - 1]} card ${faceMult(vals[shown - 1])}`;
  } else if (done && round) {
    tone = round.multiplier >= 1 ? 'won' : 'lost';
    status = stopAt >= 0 ? 'Side card 0×. No payout' : `Pays ${fmtMult(round.multiplier)}`;
  } else status = 'Pick a difficulty, then bet';

  const stripD = round?.difficulty ?? difficulty;
  const { core: coreTable, side: sideTable } = TABLES[stripD];
  const shownIdx = (rev: number): number | null => {
    if (!round || shown <= rev) return null;
    return rev === 0 ? round.core : rev === 1 ? round.left : round.right;
  };

  // The whole-bet chance, updated from the cards already turned.
  const live = chancesGiven(stripD, revealed);
  const winP = live.profit;
  const loseP = live.zero;
  const partP = Math.max(0, 1 - winP - loseP);

  return (
    <GameLayout
      name="Tarot"
      accent={ACCENTS.violet}
      panel={
        <>
          <ModeTabs auto={auto} disabled={revealing} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={DIFFICULTY_VOL[difficulty]} />}>Difficulty</Label>
          <Chips
            label="Difficulty"
            wrap
            options={DIFFICULTIES.map((d, i) => ({ value: d, label: DIFFICULTY_NAMES[d], title: `${DIFFICULTY_NAMES[d]} (key ${i + 1})` }))}
            value={difficulty}
            onChange={setDifficulty}
            disabled={busy}
          />

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={() => void playOnce(bet.value)}>
              {revealing ? 'Revealing…' : done ? 'Bet again' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || revealing}>
              <p className="tr-auto-note">
                Each auto bet plays a full spread on <b>{DIFFICULTY_NAMES[difficulty]}</b>.
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
          { label: 'Chance to profit', value: fmtChance(winP), tone: 'chance' },
          { label: 'Top prize', value: fmtMult(topPrize(difficulty)), tone: 'prize' },
        ]}
      />

      <Board className="tr-board">
        <InstantResult multiplier={done && round ? round.multiplier : null} stake={round?.stake ?? 0} id={round?.id ?? 0} />

        <div className="tr-split" role="img" aria-label="Chance to profit (green), part back (grey), nothing back (red)">
          <i className="tr-split-win" style={{ flexGrow: winP }} />
          <i className="tr-split-part" style={{ flexGrow: partP }} />
          <i className="tr-split-lose" style={{ flexGrow: loseP }} />
        </div>
        <p className="tr-key">Bar: green profit, red pays nothing</p>

        <div className="tr-spread" style={{ '--flip': `${flipMs}ms` } as CSSProperties}>
          {SLOTS.map((s) => {
            const idx = shownIdx(s.rev);
            const face = idx !== null ? (s.core ? coreTable : sideTable)[idx] : null;
            const up = face !== null;
            const skipped = !!round && stopAt === 1 && s.rev === 2 && shown >= 2;
            const cls =
              'tr-card' + (s.core ? ' core' : '') + (up ? ' up' : '') + (face && face.value === 0 ? ' ruin' : '') + (skipped ? ' dim' : '');
            return (
              <div key={`${round?.id ?? 'idle'}-${s.name}`} className={'tr-slot' + (s.core ? ' core' : '')}>
                <div className="tr-pos">{s.name}</div>
                <div className={cls} aria-label={face ? `${s.name} card, ${faceMult(face.value)}` : 'Face-down card'}>
                  <div className="tr-inner">
                    <div className="tr-face tr-back" />
                    <div className="tr-face tr-front">{face && <span className="tr-mult">{faceMult(face.value)}</span>}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className={'tr-equation' + (done && round ? ` r-${resultTone(round.multiplier)}` : '')} aria-label="Payout">
          {SLOTS.map((s, i) => {
            const v = vals && shown > s.rev ? vals[s.rev] : null;
            const skipped = !!vals && stopAt === 1 && s.rev === 2;
            return (
              <span key={s.name} className="tr-eq-group">
                {i > 0 && <i className="tr-op">×</i>}
                <span className={'tr-term' + (v === 0 ? ' ruin' : '')}>{v !== null ? faceMult(v) : skipped ? '–' : '?'}</span>
              </span>
            );
          })}
          <i className="tr-op">=</i>
          <b className="tr-total" key={`${round?.id ?? 0}-${shown}`}>
            {round && shown > 0 ? (shown >= 3 || stopAt >= 0 ? fmtMult(round.multiplier) : fmtMult(running ?? 1)) : '?'}
          </b>
        </div>

        <div className="tr-strips">
          <Strip title="Core" faces={coreTable} hit={shownIdx(0)} />
          <Strip title="Side" faces={sideTable} hit={null} />
        </div>
        <p className="tr-key">Bar length: chance per card</p>
      </Board>

      <Caption>Core, left and right multiply together; a 0× side card pays nothing.</Caption>

      {infoOpen && (
        <InfoModal title="Tarot" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Three cards are dealt face down. The middle core card is never below 1×. The left and right side cards can be 0×. Your payout is core × left ×
              right.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet and pick a difficulty: Easy, Medium, Hard or Expert (keys 1 to 4).</li>
              <li>Press Bet (or Space). The core card turns first, then left, then right.</li>
              <li>If a side card shows 0×, the round ends at once and pays nothing. The right card stays face down.</li>
              <li>Use Auto to run a series of bets with your own stake and stop rules. Turbo speeds up the reveal.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>Each card is drawn on its own: the core from the core table, both sides from the same side table.</p>
            <table className="tr-info-table">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Profit</th>
                  <th>Part back</th>
                  <th>Any return</th>
                  <th>Top</th>
                  <th>Std dev</th>
                </tr>
              </thead>
              <tbody>
                {DIFFICULTIES.map((d) => (
                  <tr key={d}>
                    <td>{DIFFICULTY_NAMES[d]}</td>
                    <td>{fmtChance(profitChance(d))}</td>
                    <td>{fmtChance(partChance(d))}</td>
                    <td>{fmtChance(returnChance(d))}</td>
                    <td>{fmtMult(topPrize(d))}</td>
                    <td>{stdDevOf(d).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {DIFFICULTIES.map((d) => (
              <p key={d}>
                <b>{DIFFICULTY_NAMES[d]}.</b> Core: {TABLES[d].core.map((c) => `${faceMult(c.value)} ${fmtChance(c.p)}`).join(', ')}. Side:{' '}
                {TABLES[d].side.map((c) => `${faceMult(c.value)} ${fmtChance(c.p)}`).join(', ')}.
              </p>
            ))}
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The cards are independent, so E[core × left × right] = E[core] × E[side] × E[side]. On every difficulty the core table averages{' '}
              {CORE_MEAN.toFixed(2)}× and the side table {SIDE_MEAN.toFixed(2)}×, so the return is {CORE_MEAN} × {SIDE_MEAN}² = {(RTP * 100).toFixed(0)}% exactly,
              confirmed by enumerating all 125 card triples per difficulty.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every difficulty returns {(RTP * 100).toFixed(0)}%; difficulty only reshapes the tables. The top prize is the top core times the top side card
              twice: {DIFFICULTIES.map((d) => `${DIFFICULTY_NAMES[d]} ${fmtMult(topPrize(d))}`).join(', ')}. All three cards are drawn the moment you bet,
              so leaving mid-reveal settles the true result.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
