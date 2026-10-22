import { formatAmount } from '@originals/game-sdk';
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
  InstantResult,
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
  type ReadoutItem,
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import { Progress, RoadBoard, type RoadView } from './Road';
import {
  DIFFICULTIES,
  DIFFICULTY,
  LANES,
  MAX_MULTIPLIER,
  OUT_OF,
  RTP,
  buildRoad,
  cross,
  finish as finishPrize,
  hitChance,
  laneSafe,
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

const OUTCOME_TITLE: Record<Outcome, string> = { hit: 'Hit by traffic', cashed: 'Cashed out', finish: 'Made it across' };
const PRESETS = [1, 3, 5, 10, 20];

const lanesWord = (n: number) => `${n} ${n === 1 ? 'lane' : 'lanes'}`;

/** 25 cells, the first `hits` red: the per-lane hit chance as a literal count. */
function OddsStrip({ d }: { d: Difficulty }) {
  const hits = DIFFICULTY[d].hits;
  return (
    <div className="ck-odds" aria-label={`${hits} in ${OUT_OF} lanes are hit`}>
      {Array.from({ length: OUT_OF }, (_, i) => (
        <i key={i} className={i < hits ? 'h' : ''} />
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
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'crossing' || autoBusy ? resolved.current : round && !round.outcome ? round.cash : 0));

  const hopMs = turbo.turbo ? 110 : 380;
  const slamMs = turbo.turbo ? 160 : 460;
  const autoHopMs = turbo.turbo ? 45 : 150;
  const live = phase === 'live' || phase === 'crossing';
  const spec = DIFFICULTY[difficulty];

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMoving(null);
    setPhase('over');
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    setRound({ difficulty, stake: bet.value, road: buildRoad(difficulty, (n) => rng.int(n)), pos: 0, cash: RTP, outcome: null, hit: null });
    setMoving(null);
    setPhase('live');
  }

  function go() {
    if (phase !== 'live' || !round || round.pos >= LANES) return;
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
      if (lane >= LANES) return finish(next, 'finish', cash);
      setRound(next);
      setMoving(null);
      setPhase('live');
      track({ type: 'checkpoint', multiplier: cash, winChance: laneSafe(d) });
    });
  }

  function cashOut() {
    if (phase !== 'live' || !round || round.pos === 0) return;
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
    setTarget(Math.min(LANES, Math.max(1, t)));
    setAutoView(null);
    setLast(null);
  }

  // Changing the difficulty clears a finished board.
  function changeDifficulty(d: Difficulty) {
    if (d === difficulty || live || autoLocked) return;
    setDifficulty(d);
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
  const nextLane = Math.min(LANES, pos + 1);

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

  let status = `Ready · ${spec.label}, ${spec.hits} in ${OUT_OF} lanes hit`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}`;
      tone = 'live';
    } else if (last) {
      status = last.multiplier > 0 ? `Lane ${autoView?.target ?? target} reached · ${fmtMult(last.multiplier)}` : `Hit in lane ${autoView?.hit ?? 0}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · cross to lane ${target}`;
  } else if (phase === 'crossing') {
    status = `Crossing lane ${moving ?? round?.hit ?? nextLane}…`;
    tone = 'live';
  } else if (phase === 'live') {
    status = pos === 0 ? 'Cross lane 1 to start' : `Lane ${pos} of ${LANES} · cross or cash out`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = round.outcome === 'hit' ? `Hit in lane ${round.hit}` : `${OUTCOME_TITLE[round.outcome]} · ${lanesWord(pos)}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const readouts: ReadoutItem[] = isAuto
    ? [
        { label: 'Win chance', value: fmtChance(reachChance(difficulty, target)), sub: `cross ${lanesWord(target)}`, tone: 'chance' },
        { label: 'Payout', value: fmtMult(multiplier(difficulty, target)), sub: `pays ${formatAmount(bet.value * multiplier(difficulty, target), 2)}`, tone: 'cash' },
        { label: 'Finish', value: fmtMult(finishPrize(difficulty)), sub: `${spec.label} · lane ${LANES}`, tone: 'prize' },
      ]
    : [
        {
          label: 'Next lane clear',
          value: phase === 'over' ? '—' : fmtChance(laneSafe(d)),
          sub: phase === 'over' ? `${DIFFICULTY[d].hits} in ${OUT_OF} hit` : `lane ${nextLane} · ${DIFFICULTY[d].hits} in ${OUT_OF} hit`,
          tone: 'chance',
        },
        {
          label: 'Cash out now',
          value: (live && pos > 0) || phase === 'over' ? fmtMult(cash) : '—',
          sub: (live && pos > 0) || phase === 'over' ? formatAmount(stake * cash, 2) : 'after lane 1',
          tone: 'cash',
        },
        {
          label: 'Next lane pays',
          value: phase === 'over' ? '—' : fmtMult(multiplier(d, nextLane)),
          sub: phase === 'over' ? 'round over' : `pays ${formatAmount(stake * multiplier(d, nextLane), 2)}`,
          tone: 'prize',
        },
      ];

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
            title={`${DIFFICULTY[x].hits} in ${OUT_OF} lanes hit · finish ${fmtMult(finishPrize(x))}`}
            onClick={() => changeDifficulty(x)}
          >
            <span>{DIFFICULTY[x].label}</span>
            <small>
              {DIFFICULTY[x].hits}/{OUT_OF}
            </small>
          </button>
        ))}
      </div>
      <Label hint={`${fmtChance(hitChance(difficulty))} per lane`}>Traffic</Label>
      <OddsStrip d={difficulty} />
    </>
  );

  return (
    <GameLayout
      name="Chicken"
      accent="#facc15"
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
                  <Label hint={fmtMult(pos > 0 ? cash : 0)}>Total profit</Label>
                  <div className={'ck-profit' + (pos > 0 ? ' up' : '')}>
                    {pos > 0 ? '+' : ''}
                    {formatAmount(pos > 0 ? stake * cash - stake : 0, 2)}
                  </div>
                </>
              ) : (
                <dl className="og-stats">
                  <dt>Each lane clear</dt>
                  <dd>{fmtChance(laneSafe(difficulty))}</dd>
                  <dt>Lane 1 pays</dt>
                  <dd>{fmtMult(multiplier(difficulty, 1))}</dd>
                  <dt>Finish pays</dt>
                  <dd>{fmtMult(finishPrize(difficulty))}</dd>
                  <dt>Reach the finish</dt>
                  <dd>{fmtChance(reachChance(difficulty, LANES))}</dd>
                </dl>
              )}

              {live ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live' || pos === 0} onClick={cashOut}>
                    Cash out <span>{formatAmount(pos > 0 ? stake * cash : 0, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={go}>
                    {phase === 'crossing' ? 'Crossing…' : `Cross lane ${nextLane} · ${fmtMult(multiplier(d, nextLane))}`}
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
                    <button type="button" aria-label="Raise target lane" disabled={autoLocked || target >= LANES} onClick={() => changeTarget(target + 1)}>
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
                  options={PRESETS.map((v) => ({ value: v, label: v === LANES ? 'Finish' : `${v}` }))}
                  value={PRESETS.includes(target) ? target : -1}
                  disabled={autoLocked}
                  onChange={changeTarget}
                />
              </div>
              <dl className="og-stats">
                <dt>Win chance</dt>
                <dd>{fmtChance(reachChance(difficulty, target))}</dd>
                <dt>Profit per win</dt>
                <dd>{formatAmount(bet.value * (multiplier(difficulty, target) - 1), 2)}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="ck-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
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
        <Progress pos={view.pos} hit={view.hit} target={isAuto ? autoView?.target ?? target : null} road={view.road} showAll={view.showAll} />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
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
      ) : !isAuto && live ? (
        <ChanceBar
          p={laneSafe(d)}
          label={`Lane ${nextLane} is clear`}
          note={`${OUT_OF - DIFFICULTY[d].hits} of every ${OUT_OF} lanes are clear, whichever lane you are on. Space or → crosses, C cashes out.`}
        />
      ) : (
        <Caption>
          {isAuto
            ? `Each bet crosses to lane ${target} in one go. Making it pays ${fmtMult(multiplier(difficulty, target))}; traffic on the way loses. Click a lane to set the target.`
            : `Twenty lanes; each one is hit by traffic ${spec.hits} time${spec.hits === 1 ? '' : 's'} in ${OUT_OF}. Press Bet, then cross lane by lane and cash out whenever you like. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Chicken" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Get across a {LANES}-lane road one lane at a time. Every lane you cross raises your multiplier; traffic in a lane ends the round. Cash out
              whenever you like, or make it to the far side for the finish prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose a difficulty and your bet, then press Bet.</li>
              <li>Cross the next lane with Space, →, the Cross button, or by clicking the glowing pad.</li>
              <li>After each safe lane, cash out (C) or keep going. Crossing lane {LANES} pays the finish prize automatically.</li>
              <li>When the round ends, the traffic in the lanes you didn't reach is shown, so you can see what was waiting.</li>
              <li>Auto: set a target lane (stepper, presets, or click a lane on the road), then Start autobet. Each bet crosses to the target and pays its multiplier if every lane on the way is clear.</li>
              <li>Keys: Space bets (or crosses during a round, or starts and stops Auto), → crosses, C cashes out, Esc clears a finished board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each lane is hit with the same chance, {DIFFICULTY[d].hits} in {OUT_OF} on {DIFFICULTY[d].label}: the red cells of the Traffic strip. Lanes are drawn
              independently when you bet, so no lane, streak or position is luckier than another. The bar under the road is the chance the next lane is clear,
              and every pad shows what you can cash out once you stand on it.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With hit chance h per lane, crossing k lanes has probability (1 − h)<sup>k</sup>, a product of independent lanes. The cash-out after k lanes is{' '}
              {(RTP * 100).toFixed(0)}% × 1/(1 − h)<sup>k</sup>: each lane multiplies it by 1/(1 − h), exactly the inverse of the chance you survive it. The cash-out
              is therefore a martingale, and by the optional stopping theorem no rule for when to stop can change its expected value.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Whatever you choose (difficulty, when to cash out, Auto target), the long-run return is exactly {(RTP * 100).toFixed(0)}%. The top prize is the
              Daredevil finish, {fmtMult(MAX_MULTIPLIER)}. Payouts on {DIFFICULTY[d].label} (multiplier and chance to reach):
            </p>
            <div className="ck-paytable">
              {Array.from({ length: LANES }, (_, i) => i + 1).map((k) => (
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
