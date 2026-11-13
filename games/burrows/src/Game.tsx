import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
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
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
  Slider,
  StageTop,
  VolBadge,
  eventMs,
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
import { useEffect, useRef, useState } from 'react';
import Field from './Board';
import { BURROWS, CRITTERS, MAX_WIN, RTP, autoClimb, findChance, floor2, maxFinds, reachChance, tap as drawTap, value, volatilityOf, type Tap } from './math';

type Phase = 'idle' | 'live' | 'digging' | 'over';
type Outcome = 'empty' | 'cashed' | 'max';

interface Round {
  m: number;
  stake: number;
  finds: number;
  cash: number;
  outcome: Outcome | null;
  last: Tap | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = { empty: 'Empty burrow', cashed: 'Cashed out', max: 'Max win reached' };
const shown = (x: number) => fmtMult(floor2(x));

interface AutoView {
  m: number;
  target: number;
  last: Tap | null;
  finds: number;
  done: boolean;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [m, setM] = useState(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // Auto: a planned burrow list; its length is the number of finds after which the round cashes out.
  const [target, setTarget] = useState(3);
  const [plan, setPlan] = useState<number[]>(() => Array.from({ length: 100 }, (_, i) => i % BURROWS));
  const [autoView, setAutoView] = useState<AutoView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<{ id: number; multiplier: number; stake: number } | null>(null);
  const seq = useRef(0);

  // What the open bet is worth if the game unmounts. Set synchronously the moment it
  // changes (stake placed, tap drawn, auto result drawn); the ticket reads only this ref.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);
  // Double-press guard for taps (state would lag a render).
  const digging = useRef(false);

  const digMs = eventMs(turbo.turbo);
  const autoStepMs = turbo.turbo ? 35 : 120;
  const live = phase === 'live' || phase === 'digging';
  const shuffle = <T,>(xs: readonly T[]) => rng.shuffle(xs);

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, cash: number, lastTap: Tap | null) {
    fair.current = 0;
    digging.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, last: lastTap });
    setPending(null);
    setPhase('over');
  }

  async function start() {
    if (live || autoBusy || bet.blocked || digging.current) return;
    digging.current = true;
    if (!(await ticket.place(bet.value))) {
      digging.current = false;
      return;
    }
    digging.current = false;
    fair.current = RTP;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    setRound({ m, stake: bet.value, finds: 0, cash: RTP, outcome: null, last: null });
    setPending(null);
    setPhase('live');
  }

  function tapBurrow(b: number) {
    if (phase !== 'live' || !round || digging.current || b < 0 || b >= BURROWS) return;
    digging.current = true;
    // Drawn now, after the bet was placed: the critters are hidden afresh for this tap only.
    const t = drawTap(round.m, b, shuffle);
    const finds = round.finds + (t.hit ? 1 : 0);
    const cash = t.hit ? value(round.m, finds) : 0;
    fair.current = cash;
    setPending(b);
    setPhase('digging');
    timers.after(digMs, () => {
      digging.current = false;
      const next = { ...round, finds, last: t };
      if (!t.hit) return finish(next, 'empty', 0, t);
      next.cash = cash;
      // The next find would pass the max win: cash out instead (a stopping rule).
      if (finds >= maxFinds(round.m)) return finish(next, 'max', cash, t);
      setRound(next);
      setPending(null);
      setPhase('live');
      track({ type: 'checkpoint', multiplier: cash, winChance: findChance(round.m) });
    });
  }

  function randomBurrow() {
    tapBurrow(rng.int(BURROWS));
  }

  function cashOut() {
    if (phase !== 'live' || !round || round.finds === 0 || digging.current || !ticket.active()) return;
    finish(round, 'cashed', round.cash, round.last);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setAutoView(null);
    setPending(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const mm = m;
    const k = Math.min(target, maxFinds(mm));
    if (!(await ticket.place(stake))) return null;
    const res = autoClimb(mm, plan.slice(0, k), shuffle);
    fair.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    for (let i = 0; i < res.taps.length; i++) {
      setAutoView({ m: mm, target: k, last: res.taps[i], finds: res.taps.slice(0, i + 1).filter((t) => t.hit).length, done: false });
      await timers.wait(autoStepMs);
    }
    setAutoView({ m: mm, target: k, last: res.taps[res.taps.length - 1], finds: res.finds, done: true });
    fair.current = 0;
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setLast({ id: ++seq.current, multiplier: res.multiplier, stake });
    setAutoBusy(false);
    return res.multiplier;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const autoLocked = auto.running || autoBusy;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setAutoView(null);
    setLast(null);
    setPending(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  const cap = maxFinds(m);
  const k = Math.min(target, cap);

  function editAuto(apply: () => void) {
    if (autoLocked) return;
    apply();
    setAutoView(null);
    setLast(null);
  }

  function changeM(v: number) {
    if (live || autoLocked) return;
    setM(v);
    setTarget((t) => Math.min(t, maxFinds(v)));
    if (phase === 'over' || autoView || last) clear();
  }

  // Auto: tapping a burrow adds it to the plan (one more find to reach).
  function planTap(b: number) {
    editAuto(() => {
      if (k >= cap) return;
      setPlan((p) => p.map((x, i) => (i === k ? b : x)));
      setTarget(k + 1);
    });
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'live') randomBurrow();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // 1 to 7 tap that burrow.
  const tapRef = useRef(tapBurrow);
  tapRef.current = tapBurrow;
  useEffect(() => {
    if (infoOpen || isAuto) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= BURROWS) tapRef.current(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen, isAuto]);

  // ---------- What the board shows ----------

  const mm = isAuto ? autoView?.m ?? m : round?.m ?? m;
  const stake = round?.stake ?? bet.value;
  const finds = round?.finds ?? 0;
  const vol = volatilityOf(m);
  const boardLast = isAuto ? autoView?.last ?? null : round?.last ?? null;

  const counts = isAuto ? Array.from({ length: BURROWS }, (_, b) => plan.slice(0, autoView?.target ?? k).filter((x) => x === b).length) : null;

  let status = 'Press Bet to start';
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}`;
      tone = 'live';
    } else if (last && autoView) {
      status = last.multiplier > 0 ? `${autoView.target} of ${autoView.target} found` : `Empty burrow · ${autoView.finds} found`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · find ${k} to cash out`;
  } else if (phase === 'digging') {
    status = 'Digging…';
    tone = 'live';
  } else if (phase === 'live') {
    status = finds === 0 ? 'Dig a burrow' : `Found ${finds} · dig or cash out`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = `${OUTCOME_TITLE[round.outcome]} · ${finds} found`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const nextPays = value(mm, Math.min(finds + 1, maxFinds(mm)));

  return (
    <GameLayout
      name="Burrows"
      accent={ACCENTS.sand}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />

          <Label hint={<VolBadge level={vol} />}>Critters</Label>
          <Chips
            label="Critters hidden"
            options={CRITTERS.map((v) => ({ value: v, label: v }))}
            value={m}
            disabled={live || autoLocked}
            onChange={changeM}
          />

          {!isAuto ? (
            live ? (
              <>
                <ActionButton kind="cash" disabled={phase !== 'live' || finds === 0} onClick={cashOut}>
                  Cash out <span>{formatAmount(finds > 0 ? Math.floor(stake * (round?.cash ?? RTP) * 100 + 1e-9) / 100 : 0, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={randomBurrow}>
                  Random burrow
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
                {phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={`${k} of ${cap} max`}>Finds to cash out</Label>
              <Slider label="Finds to cash out" value={k} min={1} max={cap} disabled={autoLocked} onChange={(v) => editAuto(() => setTarget(v))} />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="bu-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <ChanceBar
        p={isAuto ? reachChance(m, k) : reachChance(mm, Math.min(finds + 1, maxFinds(mm)))}
        label={isAuto ? `Chance of all ${k} finds` : (finds === 0 ? 'Chance of the first find' : `Chance of ${Math.min(finds + 1, maxFinds(mm))} finds in a row`)}
      />
      <Readouts
        items={[
          isAuto
            ? { label: `Pays if all ${k} found`, value: shown(value(m, k)), tone: 'prize' }
            : { label: 'Next find pays', value: phase === 'over' ? '—' : shown(nextPays), tone: 'prize' },
        ]}
      />

      <Board>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          m={mm}
          last={boardLast}
          pending={pending}
          clickable={isAuto ? !autoLocked && k < cap : phase === 'live'}
          onPick={isAuto ? planTap : tapBurrow}
          counts={counts}
          finds={isAuto ? autoView?.finds ?? 0 : finds}
          steps={isAuto ? autoView?.target ?? k : maxFinds(mm)}
          lost={isAuto ? !!autoView?.done && !!last && last.multiplier === 0 : round?.outcome === 'empty'}
        />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome && (
        <RoundOver
          key={history[0]?.id}
          title={OUTCOME_TITLE[round.outcome]}
          multiplier={round.cash}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>Dig a burrow: finding a critter raises your cash-out, an empty one loses.</Caption>

      {infoOpen && (
        <InfoModal title="Burrows" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Critters hide among seven burrows. Each tap that finds one raises your multiplier; an empty burrow ends the round and loses the bet. Cash out
              after any find, or keep tapping.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose how many critters hide (1 to 6) and your bet, then press Bet. The count is fixed for the round.</li>
              <li>Tap a burrow (click, keys 1 to 7, or Random burrow / Space).</li>
              <li>After each find, cash out (C) or tap again. A find multiplies your cash-out by 7 divided by the critter count.</li>
              <li>Auto: set the finds to cash out and tap burrows on the board to plan them in order, then Start autobet. Each bet needs every planned find. Use stop on profit, stop on loss and on win / loss changes to the bet.</li>
              <li>Keys: Space bets or taps at random (or starts and stops Auto), C cashes out, Esc clears a finished board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The critters are hidden again before every tap, so each tap finds one with the same chance, critters ÷ 7, whichever burrow you tap and whatever
              came before. The bar above the board is the chance of making that many finds in a row from the start of the bet: critters ÷ 7 multiplied once per find. The boxes show your finds so far and what each find pays; a found critter disappears on the next dig because they are hidden again, like a fresh coin flip. The dots under the board show how many of the 7 hold a critter. No burrow, streak or pattern is luckier than another.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A find has probability p = m/7. The cash-out after n finds is {(RTP * 100).toFixed(0)}% × (7/m)<sup>n</sup>: each find multiplies it by 7/m, exactly the
              inverse of the chance of making it. So the cash-out is a martingale, and by the optional stopping theorem no rule for when to stop or which burrow to
              tap changes its expected value. Reaching n finds has probability (m/7)<sup>n</sup>, so every fixed target returns exactly {(RTP * 100).toFixed(0)}%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The multiplier after n finds is 0.98 × (7/m)<sup>n</sup>, for example 1 critter: 6.86×, 48.02×, 336.14× …; 3 critters: 2.28×, 5.33×, 12.45× …; 6 critters:
              1.14×, 1.33×, 1.55× … Shown values are rounded down to 2 places. The top prize is {fmtMult(MAX_WIN)}, reached after 8, 12, 18, 27, 46 or 100 finds
              with 1 to 6 critters; the round cashes out there, before a find that would pass it. Long-run return: {(RTP * 100).toFixed(0)}%.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
