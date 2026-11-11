import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
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
import { formatAmount } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import Field, { type Outcome, type Phase } from './Board';
import {
  CELLS,
  DEFAULT_RESPINS,
  MAX_MULTIPLIER,
  RESPINS,
  RTP,
  START,
  TARGET,
  cashAfter,
  coinsOf,
  headline,
  prizeFor,
  spin,
  startGrid,
  volatilityOf,
  winChance,
  type Respins,
  type Spin,
} from './math';

const ACCENT = '#e6b450';

interface Round {
  id: number;
  L: Respins;
  stake: number;
  /** Locked at bet time: RTP / P(win). */
  prize: number;
  full: boolean[];
  respins: number;
  spins: number;
  last: { cell: number; hit: boolean } | null;
  message: [string, string];
  cash: number;
  outcome: Outcome | null;
}

const IDLE_MESSAGE: [string, string] = ['Each spin lands on one cell. An empty cell gets a coin', 'and refills your respins; a full cell costs one respin.'];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** One plain sentence pair for what a spin did and why the win chance moved. */
function explain(s: Spin, L: number): [string, string] {
  if (s.won) return [`Empty cell: coin number ${TARGET}.`, `You filled the grid: you win.`];
  if (s.lost) return ['A cell that already had a coin.', 'That was your last respin: round over.'];
  if (s.hit) return ['Empty cell: it gets a coin.', `Respins refill to ${L}, one more coin is in: chance up.`];
  return ['A cell that already had a coin.', `It costs one respin, ${plural(s.respins, 'respin')} left: chance down.`];
}

/** The first row of spotlight hops, ending on the landing cell. */
function hopsTo(target: number, rng: { int(n: number): number }, n = 5): number[] {
  const out: number[] = [];
  let prev = -1;
  for (let i = 0; i < n; i++) {
    let c = rng.int(CELLS);
    if (c === prev || c === target) c = (c + 1 + rng.int(CELLS - 1)) % CELLS;
    if (c === target) c = (c + 1) % CELLS;
    out.push(c);
    prev = c;
  }
  return out;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [L, setL] = useState<Respins>(DEFAULT_RESPINS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [spot, setSpot] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);

  // The ticket reads only this ref, set synchronously when the bet is placed
  // and when each spin is drawn (never rendered state, which lags a render).
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'spinning' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** One spin: the spotlight hops about 600 ms, lands, the board explains it, then a checkpoint or the end. */
  function shoot(r: Round) {
    if (busy.current) return;
    busy.current = true;
    const s = spin(r.full, r.respins, r.L, rng);
    const cash = cashAfter(s, r.L);
    resolved.current = cash;
    const full = s.hit ? r.full.map((f, i) => (i === s.cell ? true : f)) : r.full;
    const next: Round = {
      ...r,
      full,
      respins: s.respins,
      spins: r.spins + 1,
      last: { cell: s.cell, hit: s.hit },
      message: explain(s, r.L),
      cash,
    };

    const hops = hopsTo(s.cell, rng);
    const per = Math.round(100 * speed);
    setPhase('spinning');
    setRound({ ...r, last: null, message: ['Spinning…', ''] });
    hops.forEach((c, i) => timers.after(per * i, () => setSpot(c)));
    timers.after(per * hops.length, () => setSpot(s.cell));
    const landAt = per * (hops.length + 1);
    timers.after(landAt, () => {
      setSpot(null);
      setRound(next);
    });
    timers.after(landAt + Math.round(450 * speed), () => {
      if (s.won) return finish(next, 'won', r.prize);
      if (s.lost) return finish(next, 'lost', 0);
      busy.current = false;
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: cash / r.prize });
    });
  }

  async function start() {
    if (live || bet.blocked || auto.running) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    busy.current = false;
    const full = startGrid(rng);
    const r: Round = {
      id: ++seq.current,
      L,
      stake: bet.value,
      prize: prizeFor(L),
      full,
      respins: L,
      spins: 0,
      last: null,
      message: ['Spinning…', ''],
      cash: RTP,
      outcome: null,
    };
    setRound(r);
    shoot(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    busy.current = false;
    setRound(null);
    setSpot(null);
    setPhase('idle');
  }

  // ---------- Auto: spin every round to the end ----------

  async function playAuto(stake: number): Promise<number | null> {
    const Lr = L;
    if (!(await ticket.place(stake))) return null;
    const prize = prizeFor(Lr);
    let full = startGrid(rng);
    let respins: number = Lr;
    const id = ++seq.current;
    // The whole round is drawn up front and its final value is what leaving settles at.
    const plan: { s: Spin; full: boolean[] }[] = [];
    for (let f = full, l = respins; ; ) {
      const s = spin(f, l, Lr, rng);
      const nf = s.hit ? f.map((x, i) => (i === s.cell ? true : x)) : f;
      plan.push({ s, full: nf });
      f = nf;
      l = s.respins;
      if (s.won || s.lost) break;
    }
    const finalMult = plan[plan.length - 1].s.won ? prize : 0;
    resolved.current = finalMult;
    setPhase('spinning');
    busy.current = true;
    let spins = 0;
    setRound({ id, L: Lr, stake, prize, full, respins, spins, last: null, message: ['Spinning…', ''], cash: RTP, outcome: null });
    for (const step of plan) {
      spins++;
      full = step.full;
      respins = step.s.respins;
      setSpot(step.s.cell);
      if (!(await timers.wait(Math.round(240 * speed)))) return null;
      setSpot(null);
      setRound({
        id, L: Lr, stake, prize, full, respins, spins,
        last: { cell: step.s.cell, hit: step.s.hit },
        message: explain(step.s, Lr),
        cash: cashAfter(step.s, Lr),
        outcome: null,
      });
      if (!(await timers.wait(Math.round(200 * speed)))) return null;
    }
    busy.current = false;
    ticket.settle(finalMult);
    pushHistory(finalMult);
    setRound((r) => (r ? { ...r, outcome: finalMult > 0 ? 'won' : 'lost', cash: finalMult } : r));
    setPhase('over');
    return finalMult;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || auto.running;

  const change = (apply: () => void) => {
    if (locked) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (isAuto ? undefined : phase === 'checkpoint' && round ? shoot(round) : !live ? void start() : undefined),
      cashOut: isAuto ? undefined : cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const Lv = round?.L ?? L;
  const previewFull = Array.from({ length: CELLS }, (_, i) => i % 3 === 1 && i < START * 3);
  const full = round?.full ?? previewFull;
  const coins = coinsOf(full);
  const respins = round?.respins ?? Lv;
  const prize = round?.prize ?? prizeFor(L);
  const stake = round?.stake ?? bet.value;
  const pNow = round?.outcome === 'won' ? 1 : round?.outcome === 'lost' ? 0 : winChance(coins, respins, Lv);
  const cash = round ? (phase === 'over' ? round.cash : prize * pNow) : RTP;

  let status = `Ready · ${plural(L, 'respin')}`;
  if (phase === 'spinning') status = round && round.spins > 0 ? `Spin ${round.spins + 1}` : 'Spin 1';
  if (phase === 'checkpoint' && round) status = `Spin ${round.spins} · ${coins} of ${TARGET} coins`;
  if (phase === 'over' && round?.outcome) status = `${round.outcome === 'won' ? 'Filled' : round.outcome === 'cashed' ? 'Cashed out' : 'Out of respins'} · ${coins} of ${TARGET} coins`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';
  const title = round?.outcome === 'won' ? 'Grid filled' : round?.outcome === 'cashed' ? 'Cashed out' : 'Out of respins';

  return (
    <GameLayout
      name="Respins"
      accent={ACCENT}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={volatilityOf(L)} />}>
            Respins: <b style={{ color: 'var(--text)' }}>{L}</b>
          </Label>
          <Chips
            label="Respins"
            options={RESPINS.map((v) => ({ value: v, label: v }))}
            value={L}
            disabled={locked}
            onChange={(v) => change(() => setL(v))}
          />
          <Label hint="more respins, safer, smaller prize">
            <span style={{ fontWeight: 500 }}>
              Start with {START} coins, fill {TARGET}
            </span>
          </Label>

          <dl className="og-stats">
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(L))}</dd>
          </dl>

          {isAuto ? (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live} />
          ) : live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => shoot(round)}>
                Spin again
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(pNow), sub: `${coins} of ${TARGET} coins · ${plural(respins, 'respin')} left`, tone: 'chance' },
          { label: 'Prize · grid filled', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className={'rsp-board' + (phase === 'over' ? ' over' : '')}>
        <Field
          full={full}
          respins={respins}
          maxRespins={Lv}
          spot={spot}
          last={round?.last ?? null}
          message={round && phase !== 'idle' ? round.message : IDLE_MESSAGE}
        />
        {phase === 'over' && !isAuto && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={title}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="inline"
          />
        )}
      </Board>

      {(live || phase === 'over') && (
        <ChanceBar
          p={pNow}
          label="Chance to fill the grid"
          note={`A coin on an empty cell raises it: one coin closer and your respins refill. A full cell lowers it: one respin lost.`}
        />
      )}
      <Caption>Fill {TARGET} of {CELLS} cells: a coin refills your respins, a full cell costs one.</Caption>

      {infoOpen && (
        <InfoModal title="Respins" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A grid of {CELLS} cells starts with {START} coins in it. Fill <b style={{ color: ACCENT }}>{TARGET} cells</b> with coins before your respins run out.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose how many respins you get (2 to 5), then bet. Fewer respins pay a bigger prize.</li>
              <li>Every spin lands on one cell, each equally likely. A cell with no coin gets one, and your respins fill back up to your choice.</li>
              <li>A cell that already has a coin costs one respin. With none left, the round is lost. After every spin you can cash out (C) or spin again (Space).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The grid.</b> The next spin gets a coin with chance <b>empty cells ÷ 15</b>: the green-outlined cells. Where the coins sit does not matter, only how many.
            </p>
            <p>
              <b>The lamps.</b> Each lit lamp is a respin left. A coin refills them all, a coin cell puts one out.
            </p>
            <p>
              <b>The bar</b> is your chance to fill the grid from here. It goes up when a coin lands (one coin closer, lamps full again) and down when a lamp goes out.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With c coins and l respins left, and L the respins you chose, the chance to fill the grid is P(c, l) = (15 − c)/15 × P(c + 1, L) + c/15 × P(c, l − 1), with P = 1 at {TARGET} coins and P = 0 at 0 respins. It also equals (1 − (c/15)<sup>l</sup>) × the same factor for every coin still needed after this one, with L in place of l.
            </p>
            <p>At the start: {RESPINS.map((v) => `${v} respins ${fmtChance(headline(v))}`).join(', ')}.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (your chance to win). Cashing out pays the prize × your chance now, computed exactly, so every spin is a fair bet and, whatever you do, the round is worth {(RTP * 100).toFixed(0)}% of your stake. The largest prize on offer is {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
