import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  ACCENTS,
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
  type ReadoutItem,
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import { Progress, RoadBoard, type RoadView } from './Road';
import {
  DIFFICULTIES,
  DIFFICULTY,
  MAX_MULTIPLIER,
  RTP,
  SLOTS,
  buildRoad,
  cross,
  finish as finishPrize,
  finishChance,
  hazardChance,
  lanesOf,
  multiplier,
  reachChance,
  volatilityOf,
  type Difficulty,
  type Road,
} from './math';

type Phase = 'idle' | 'live' | 'crossing' | 'over';
type Outcome = 'hit' | 'cashed' | 'finish';

interface Round {
  difficulty: Difficulty;
  stake: number;
  road: Road;
  pos: number;
  cash: number;
  outcome: Outcome | null;
  hit: number | null;
}

interface AutoView {
  difficulty: Difficulty;
  road: Road;
  pos: number;
  hit: number | null;
  showAll: boolean;
  target: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { hit: 'Hit a hazard', cashed: 'Cashed out', finish: 'Made it across' };
const PRESETS = [1, 3, 5, 10];

const lanesWord = (n: number) => `${n} ${n === 1 ? 'lane' : 'lanes'}`;

/** 20 cells: crossed slots are spent, the slots ahead hold the hazards (the last `hazards` cells are red: a count, not positions). */
function OddsStrip({ d, pos }: { d: Difficulty; pos: number }) {
  const hazards = DIFFICULTY[d].hazards;
  const ahead = SLOTS - pos;
  return (
    <div className="ck-odds" aria-label={`${hazards} hazards in ${ahead} slots ahead`}>
      {Array.from({ length: SLOTS }, (_, i) => (
        <i key={i} className={i < pos ? 's' : i >= SLOTS - hazards ? 'h' : ''} />
      ))}
    </div>
  );
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const [target, setTarget] = useState(5);
  const [autoView, setAutoView] = useState<AutoView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);

  // A crossing is decided the moment it starts (the road was drawn at bet
  // time), so leaving mid-hop settles at its real result.
  // `resolved` is the open ticket's value right now, set synchronously at every
  // transition (stake placed, step drawn). The ticket reads only this ref: a
  // value derived from rendered state can be one render stale, e.g. the last
  // round's cash-out just after Bet again, if the game unmounts before the
  // next render.
  const resolved = useRef(0);
  const busy = useRef(false);
  const ticket = useTicket(() => resolved.current);

  // Manual: the token slides into the lane over a readable 600 ms; a hazard then drops in over 450 ms (docs/STYLE.md).
  const hopMs = eventMs(turbo.turbo);
  const slamMs = eventMs(turbo.turbo, 450);
  const autoHopMs = turbo.turbo ? 40 : 120;
  const live = phase === 'live' || phase === 'crossing';
  const spec = DIFFICULTY[difficulty];
  const lanes = lanesOf(difficulty);

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMoving(null);
    setPhase('over');
  }

  async function start() {
    if (live || autoBusy || bet.blocked || busy.current) return;
    busy.current = true;
    if (!(await ticket.place(bet.value))) {
      busy.current = false;
      return;
    }
    resolved.current = RTP;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    setRound({ difficulty, stake: bet.value, road: buildRoad(difficulty, (n) => rng.int(n)), pos: 0, cash: RTP, outcome: null, hit: null });
    setMoving(null);
    setPhase('live');
    busy.current = false;
  }

  function go() {
    if (phase !== 'live' || !round || round.pos >= lanes || busy.current) return;
    busy.current = true;
    const lane = round.pos + 1;
    const d = round.difficulty;
    const isHit = round.road[lane - 1];
    const cash = isHit ? 0 : multiplier(d, lane);
    resolved.current = cash;
    setMoving(lane);
    setPhase('crossing');
    timers.after(hopMs, () => {
      if (isHit) {
        const hitRound = { ...round, hit: lane };
        setRound(hitRound);
        setMoving(null);
        timers.after(slamMs, () => finish(hitRound, 'hit', 0));
        return;
      }
      const next = { ...round, pos: lane, cash };
      if (lane >= lanes) return finish(next, 'finish', cash);
      setRound(next);
      setMoving(null);
      setPhase('live');
      busy.current = false;
      track({ type: 'checkpoint', multiplier: cash, winChance: 1 - hazardChance(d, lane - 1) });
    });
  }

  function cashOut() {
    if (phase !== 'live' || !round || round.pos === 0 || busy.current) return;
    busy.current = true;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setAutoView(null);
    setMoving(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const d = difficulty;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    const road = buildRoad(d, (n) => rng.int(n));
    const res = cross(road, d, tgt);
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    const view: AutoView = { difficulty: d, road, pos: 0, hit: null, showAll: false, target: tgt };
    setAutoView({ ...view });
    await timers.wait(40);
    for (let lane = 1; lane <= res.lanes; lane++) {
      if (lane === res.hit) view.hit = lane;
      else view.pos = lane;
      setAutoView({ ...view });
      await timers.wait(autoHopMs + (lane === res.hit ? slamMs : 0));
    }
    view.showAll = true;
    setAutoView({ ...view });
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
    setMoving(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  function changeTarget(t: number) {
    if (autoLocked) return;
    setTarget(Math.min(lanes, Math.max(1, t)));
    setAutoView(null);
    setLast(null);
  }

  // Changing the difficulty clears a finished board.
  function changeDifficulty(d: Difficulty) {
    if (d === difficulty || live || autoLocked) return;
    setDifficulty(d);
    setTarget((t) => Math.min(lanesOf(d), t));
    if (phase === 'over' || autoView || last) clear();
  }

  function onLane(lane: number) {
    if (isAuto) changeTarget(lane);
    else if (phase === 'live' && round && lane === round.pos + 1) go();
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'live') go();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // → crosses the next lane, like Space.
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (infoOpen || isAuto) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen, isAuto]);

  // ---------- What the board shows ----------

  const d = isAuto ? autoView?.difficulty ?? difficulty : round?.difficulty ?? difficulty;
  const pos = round?.pos ?? 0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const vol = volatilityOf(difficulty);
  const nextLane = Math.min(lanes, pos + 1);

  const view: RoadView = isAuto
    ? autoView
      ? {
          difficulty: autoView.difficulty,
          road: autoView.road,
          pos: autoView.pos,
          moving: null,
          hit: autoView.hit,
          showAll: autoView.showAll,
          won: autoView.showAll && autoView.hit === null,
          live: false,
        }
      : { difficulty, road: null, pos: 0, moving: null, hit: null, showAll: false, won: false, live: false }
    : {
        difficulty: d,
        road: round?.road ?? null,
        pos,
        moving,
        hit: round?.hit ?? null,
        showAll: phase === 'over',
        won: phase === 'over' && cash > 0,
        live: phase === 'live',
      };

  let status = `${spec.label}: ${spec.hazards} hazards, ${SLOTS} slots`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = auto.remaining !== null ? `Autobet: ${auto.remaining} left` : 'Autobet running';
      tone = 'live';
    } else if (last) {
      status = last.multiplier > 0 ? `Lane ${autoView?.target ?? target} reached` : `Hazard in lane ${autoView?.hit ?? 0}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto: hop to lane ${target}`;
  } else if (phase === 'crossing' && round?.hit) {
    status = `Hazard in lane ${round.hit}`;
    tone = 'lost';
  } else if (phase === 'crossing') {
    status = `Hopping lane ${moving ?? nextLane}`;
    tone = 'live';
  } else if (phase === 'live') {
    status = pos === 0 ? 'Hop lane 1 to start' : `Lane ${pos} of ${lanes}: hop or cash out`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = round.outcome === 'hit' ? `Hazard in lane ${round.hit}` : `${OUTCOME_TITLE[round.outcome]}: ${lanesWord(pos)}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  // Whole-bet chance (docs/STYLE.md §6): the ChanceBar under the stage top. Manual: crossing every
  // remaining lane to the finish, which rises as lanes are crossed. Auto: reaching the target lane.
  const barP = isAuto ? reachChance(difficulty, target) : round?.hit != null ? 0 : finishChance(d, pos);
  const barLabel = isAuto ? `Chance to reach lane ${target}` : pos === 0 && phase !== 'over' ? 'Chance to cross all lanes' : 'Chance to cross the rest';
  // The bar carries the one chance; Readouts keeps the prize.
  const readouts: ReadoutItem[] = isAuto
    ? [{ label: `Lane ${target} pays`, value: fmtMult(multiplier(difficulty, target)), tone: 'prize' }]
    : // The bar is the chance of crossing every lane, so the prize beside it is what the far side pays
      // (each lane's own payout is labelled on the road).
      [{ label: `Lane ${lanesOf(d)} pays`, value: fmtMult(finishPrize(d)), tone: 'prize' }];

  const difficultyPicker = (
    <>
      <Label hint={<VolBadge level={vol} />}>Difficulty</Label>
      <div className="ck-diff" role="radiogroup" aria-label="Difficulty">
        {DIFFICULTIES.map((x) => (
          <button
            key={x}
            type="button"
            role="radio"
            aria-checked={x === difficulty}
            className={'ck-diff-opt' + (x === difficulty ? ' on' : '')}
            disabled={live || autoLocked}
            title={`${DIFFICULTY[x].hazards} hazards in ${SLOTS} slots, finish ${fmtMult(finishPrize(x))}`}
            onClick={() => changeDifficulty(x)}
          >
            <span>{DIFFICULTY[x].label}</span>
            <small>
              {DIFFICULTY[x].hazards}/{SLOTS}
            </small>
          </button>
        ))}
      </div>
      <Label hint={`${DIFFICULTY[difficulty].hazards} in ${SLOTS - (round && !isAuto ? round.pos : 0)} ahead`}>Hazards</Label>
      <OddsStrip d={difficulty} pos={!isAuto && round ? round.pos : 0} />
    </>
  );

  return (
    <GameLayout
      name="Chicken"
      accent={ACCENTS.amber}
      className="ck-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />
          {difficultyPicker}

          {!isAuto ? (
            <>
              {live ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live' || pos === 0} onClick={cashOut}>
                    Cash out <span>{formatAmount(pos > 0 ? stake * cash : 0, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={go}>
                    {phase === 'crossing' ? 'Hopping…' : `Hop lane ${nextLane}: ${fmtMult(multiplier(d, nextLane))}`}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <div className="ck-auto-pair">
                <div>
                  <Label>Target lane</Label>
                  <div className="ck-stepper">
                    <button type="button" aria-label="Lower target lane" disabled={autoLocked || target <= 1} onClick={() => changeTarget(target - 1)}>
                      −
                    </button>
                    <span>{target}</span>
                    <button type="button" aria-label="Raise target lane" disabled={autoLocked || target >= lanes} onClick={() => changeTarget(target + 1)}>
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <Label>Pays</Label>
                  <div className="ck-pays">{fmtMult(multiplier(difficulty, target))}</div>
                </div>
              </div>
              <div className="ck-presets">
                <Chips
                  label="Target lane presets"
                  options={[...PRESETS.filter((v) => v < lanes), lanes].map((v) => ({ value: v, label: v === lanes ? 'Finish' : `${v}` }))}
                  value={PRESETS.includes(target) ? target : -1}
                  disabled={autoLocked}
                  onChange={changeTarget}
                />
              </div>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="ck-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <ChanceBar p={barP} label={barLabel} />
      <Readouts items={readouts} />

      <Board className={'ck-board' + (isAuto ? ' auto' : '')}>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <RoadBoard
          view={view}
          target={isAuto ? autoView?.target ?? target : null}
          onLane={onLane}
          clickable={isAuto ? !autoLocked : phase === 'live'}
          hopMs={isAuto ? autoHopMs : hopMs}
          slamMs={slamMs}
        />
        <Progress lanes={lanesOf(view.difficulty)} pos={view.pos} hit={view.hit} target={isAuto ? autoView?.target ?? target : null} road={view.road} showAll={view.showAll} />
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
      <Caption>Hop lanes to raise the payout; a hidden hazard ends the round.</Caption>

      {infoOpen && (
        <InfoModal title="Chicken" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Hop along a road of {SLOTS} slots, one lane at a time. Hazards are hidden among the slots; every safe lane raises your multiplier and a
              hazard ends the round. Cash out whenever you like, or clear every lane for the finish prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose a difficulty (Easy 1 hazard, Medium 3, Hard 5, Expert 10) and your bet, then press Bet.</li>
              <li>Hop the next lane with Space, the right arrow, the Hop button, or by clicking the outlined pad.</li>
              <li>After each safe lane, cash out (C) or keep going. Clearing the last lane pays the finish prize automatically.</li>
              <li>When the round ends, the hazards in the lanes you did not reach are shown.</li>
              <li>Auto: set a target lane, then Start autobet. Each bet hops to the target and pays its multiplier if every lane on the way is clear.</li>
              <li>Keys: Space bets (or hops, or starts and stops Auto), C cashes out, Esc clears a finished board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The hazards are placed among the {SLOTS} slots without replacement when you bet, so each hop you clear makes the next one riskier: after k
              clear hops, the next slot is a hazard with chance {DIFFICULTY[d].hazards}/({SLOTS} − k). The bar is the chance of clearing every lane still
              ahead (it rises as you hop), and every pad shows the cash-out once you stand on it. The strip counts the hazards among the slots still ahead.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With m hazards, k clear hops have probability C({SLOTS} − m, k) / C({SLOTS}, k). The cash-out after k hops is {(RTP * 100).toFixed(0)}% × C({SLOTS}, k) / C({SLOTS} − m, k):
              each hop multiplies it by exactly 1 over the chance of surviving it. The cash-out is a martingale, and by the optional stopping theorem no rule for
              when to stop can change its expected value.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Whatever you choose (difficulty, when to cash out, Auto target), the long-run return is exactly {(RTP * 100).toFixed(0)}%. The top prize is the
              Expert finish, {fmtMult(MAX_MULTIPLIER)}. Payouts on {DIFFICULTY[d].label} (multiplier and chance to reach):
            </p>
            <div className="ck-paytable">
              {Array.from({ length: lanesOf(d) }, (_, i) => i + 1).map((k) => (
                <div key={k}>
                  <span>Lane {k}</span>
                  <b>{fmtMult(multiplier(d, k))}</b>
                  <small>{fmtChance(reachChance(d, k))}</small>
                </div>
              ))}
            </div>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
