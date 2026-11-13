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
import { useEffect, useRef, useState } from 'react';
import {
  COLS,
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  MAX_MULTIPLIER,
  MAX_PICKS,
  RTP,
  TABLE,
  TILE_COUNT,
  WEIGHT_TOTAL,
  lossChance,
  playRound,
  profitChance,
  randomPicks,
  tileValue,
  topItem,
  type Difficulty,
} from './math';

const ACCENT = ACCENTS.sky;

/** A multiplier as a tile prints it: 2 decimals, 1 from 100×, none from 1,000×. */
export function valueLabel(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 100) return v.toFixed(1);
  return v.toFixed(2);
}
const multLabel = (m: number) => (m >= 1000 ? m.toLocaleString('en-US') : String(m)) + '×';

interface Last {
  id: number;
  stake: number;
  d: Difficulty;
  picks: number[];
  tiles: number[];
  multiplier: number;
  flipMs: number;
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [picks, setPicks] = useState<number[]>([]);
  const [randomEach, setRandomEach] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const inFlight = useRef(false);

  // Read by the ticket on leave: set when the draw is made (right after place() resolves), never from render state.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);
  const autoRef = useRef<{ running: boolean } | null>(null);

  async function playOnce(stake: number): Promise<number | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      if (!picks.length && !randomEach) return null;
      if (!(await ticket.place(stake))) return null;
      const d = difficulty;
      const chosen = randomEach ? randomPicks((k) => rng.int(k), picks.length || 3) : picks;
      const res = playRound(() => rng.next(), d, chosen);
      const flipMs = eventMs(turbo.turbo || !!autoRef.current?.running);
      resolved.current = res.multiplier;
      if (randomEach) setPicks(chosen);
      setFlipping(true);
      setLast({ id: ++seq.current, stake, d, picks: chosen, tiles: res.tiles, multiplier: res.multiplier, flipMs });
      if (!(await timers.wait(flipMs + 80))) return null;
      ticket.settle(res.multiplier);
      pushHistory(res.multiplier);
      setFlipping(false);
      return res.multiplier;
    } finally {
      inFlight.current = false;
    }
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  autoRef.current = auto;
  const busy = flipping || auto.running;
  const canBet = (picks.length > 0 || randomEach) && !bet.blocked && !busy;

  function change(apply: () => void) {
    if (busy) return;
    apply();
    setLast(null);
  }
  function toggle(t: number) {
    change(() => setPicks((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length >= MAX_PICKS ? p : [...p, t].sort((a, b) => a - b))));
  }
  const randomPick = () => change(() => setPicks(randomPicks((k) => rng.int(k), picks.length || 3)));

  useHotkeys({ space: () => auto.mode === 'manual' && canBet && void playOnce(bet.value) }, !infoOpen);

  // 1-4 pick the difficulty.
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || busy) return;
      const k = Number(e.key);
      if (k >= 1 && k <= DIFFICULTIES.length) {
        setDifficulty(DIFFICULTIES[k - 1]);
        setLast(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen, busy]);

  const shownD = last?.d ?? difficulty;
  const items = TABLE[shownD];
  const n = Math.max(1, last ? last.picks.length : picks.length);
  const shownPicks = last ? last.picks : picks;
  const top = topItem(shownD);
  const pProfit = profitChance(difficulty, n);
  const pLose = lossChance(difficulty, n);
  const done = !!last && !flipping;
  const resultKind = done ? (last.multiplier < 1 - 1e-9 ? 'lose' : last.multiplier > 1 + 1e-9 ? 'win' : 'even') : '';

  let status: string = picks.length ? `${picks.length} of ${MAX_PICKS} tiles picked` : 'Pick 1 to 5 tiles';
  if (flipping) status = 'Flipping all tiles';
  else if (last) status = `Your tiles sum to ${fmtMult(last.multiplier)}`;
  const tone = flipping ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle';

  const tiles = Array.from({ length: TILE_COUNT }, (_, t) => {
    const picked = shownPicks.includes(t);
    const item = last ? last.tiles[t] : -1;
    const it = item >= 0 ? TABLE[last!.d][item] : null;
    const tier = !it ? '' : item === TABLE[last!.d].length - 1 ? 'top' : it.mult >= 1 ? 'win' : 'lose';
    return (
      <button
        key={`${last?.id ?? 'p'}-${t}`}
        type="button"
        className={`tp-tile${picked ? ' picked' : ''}${it ? ` up ${tier}${picked ? '' : ' dim'}` : ''}${last && flipping ? ' flip' : ''}`}
        aria-pressed={picked}
        aria-label={`Tile ${t + 1}${picked ? ', picked' : ''}${it ? `, ${valueLabel(tileValue(last!.d, item, last!.picks.length))}×` : ''}`}
        disabled={busy}
        onClick={() => toggle(t)}
      >
        {it ? <span className="tp-face">{valueLabel(tileValue(last!.d, item, last!.picks.length))}</span> : <span className="tp-hidden">?</span>}
      </button>
    );
  });

  const segs = [
    { cls: 'lose', share: pLose, label: 'Below bet' },
    { cls: 'even', share: Math.max(0, 1 - pLose - pProfit), label: 'Even' },
    { cls: 'win', share: pProfit, label: 'Profit' },
  ];

  return (
    <GameLayout
      name="Tile Pick"
      accent={ACCENT}
      className="tp-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={flipping} />
          <BetField bet={bet} disabled={busy} />

          <Label hint="sets the prizes">Difficulty</Label>
          <Chips
            label="Difficulty"
            options={DIFFICULTIES.map((d, i) => ({ value: d, label: DIFFICULTY_NAMES[d], title: `${DIFFICULTY_NAMES[d]} (key ${i + 1}) · up to ${multLabel(topItem(d).mult)}` }))}
            value={difficulty}
            disabled={busy}
            onChange={(v) => change(() => setDifficulty(v))}
          />

          <Label hint="fewer picks, bigger swings">Tiles</Label>
          <div className="tp-row">
            <ActionButton kind="secondary" disabled={busy} onClick={randomPick}>
              {`Random ${picks.length || 3}`}
            </ActionButton>
            <ActionButton kind="secondary" disabled={busy || !picks.length} onClick={() => change(() => setPicks([]))}>
              Clear
            </ActionButton>
          </div>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={() => void playOnce(bet.value)}>
              Bet
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || flipping || (!picks.length && !randomEach)}>
              <Label hint="same count">New random tiles</Label>
              <Chips
                label="New random tiles each bet"
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'on', label: 'On' },
                ]}
                value={randomEach ? 'on' : 'off'}
                disabled={auto.running}
                onChange={(v) => setRandomEach(v === 'on')}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="tp-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Chance to profit', value: fmtChance(pProfit), tone: 'chance' },
          { label: 'Top prize (all picks top)', value: multLabel(top.mult), tone: 'prize' },
        ]}
      />

      <Board className="tp-board">
        <InstantResult multiplier={done ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className="tp-grid" style={{ ['--cols' as string]: COLS, ['--flip' as string]: `${last?.flipMs ?? 0}ms` }}>
          {tiles}
        </div>
        <Caption>Pick 1 to 5 tiles; you win the average of their values.</Caption>
      </Board>

      <div className="tp-oddsbar" role="img" aria-label="Whole bet: share that pays less than, equal to, or more than the stake">
        {segs.map((s) => (
          <i key={s.cls} className={`${s.cls}${resultKind === s.cls ? ' hit' : ''}`} style={{ flexGrow: s.share }}>
            {s.share >= 0.12 && s.cls !== 'even' ? s.label : ''}
          </i>
        ))}
      </div>
      <p className="tp-key">Grey: below bet. Green: profit.</p>
      <p className="tp-key">Only picked tiles add to your win.</p>

      {infoOpen && (
        <InfoModal title="Tile Pick" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Pick 1 to 5 of the 30 tiles. Every tile flips to a multiplier, and you win the sum of what is printed on your picks, up to {fmtMult(MAX_MULTIPLIER)}.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a difficulty (keys 1 to 4). Easy pays small and often; Expert is mostly small, with a 3,000× top item.</li>
              <li>Click 1 to 5 tiles, or use Random pick. Your picks stay selected between rounds until you clear them.</li>
              <li>Press Bet (or Space). All 30 tiles flip at once and only your picked tiles pay. Use Auto for a series of bets, with an option to pick new random tiles each bet.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>Each tile is one draw from the {DIFFICULTY_NAMES[shownD]} table, with its exact chance:</p>
            <ul className="tp-list">
              {items.map((it, i) => (
                <li key={i}>
                  <b>{multLabel(it.mult)}</b>
                  <span>{((it.weight / WEIGHT_TOTAL) * 100).toFixed(it.weight < 100 ? 4 : it.weight < 10000 ? 3 : 2)}%</span>
                </li>
              ))}
            </ul>
            <p>
              With n picks each tile prints its multiplier divided by n, so the sum of your picks is your payout. The bar under the board shows the whole bet: the green part is your chance to win more than your stake.
              The tiles you did not pick are real draws too, shown dimmed; they cannot change your result.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each table has integer weights out of {WEIGHT_TOTAL.toLocaleString('en-US')}, so P(item) = weight ÷ {WEIGHT_TOTAL.toLocaleString('en-US')} and RTP = Σ P(item) × multiplier = exactly {(RTP * 100).toFixed(0)}%. The tiles are
              independent, so the average of n picks has the same mean ({(RTP * 100).toFixed(0)}%) by linearity of expectation, while the swings shrink by √n. Which tiles you pick does not matter.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>Every difficulty and every number of picks returns {(RTP * 100).toFixed(0)}% of stakes in the long run. All 30 tiles are drawn the moment your bet is placed; leaving mid-flip pays the same result.</p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
