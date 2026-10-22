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
  fmtOneIn,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTurbo,
} from '@originals/game-sdk/ui';
import { formatAmount } from '@originals/game-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import Ring, { type Outcome } from './Board';
import {
  PICK_COUNTS,
  RINGS,
  RTP,
  bustRisk,
  cashValue,
  defaultPicks,
  exposed as isExposed,
  litCount,
  nextRisk,
  prize,
  startChance,
  startWalk,
  volatilityOf,
  walkSegment,
  winChance,
  yourSlots,
  type PickCount,
  type Ring as RingSize,
  type Walk,
} from './math';

type Phase = 'idle' | 'walking' | 'checkpoint' | 'over';

interface Round {
  n: RingSize;
  picks: number[];
  stake: number;
  /** The walk at the last checkpoint (or where it ended). */
  walk: Walk;
  cash: number;
  outcome: Outcome | null;
}

/** A walk being animated: the path, the light at every step, and how far along it the walker is (in steps). */
interface Motion {
  xs: number[];
  los: number[];
  his: number[];
  t: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { won: 'Last light is yours', lost: 'Lit too soon', cashed: 'Cashed out' };

/** requestAnimationFrame driver with a timeout fallback, cancelled on clear and unmount. */
function useFrames() {
  const raf = useRef<number | null>(null);
  const timeout = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (timeout.current !== null) clearTimeout(timeout.current);
    raf.current = null;
    timeout.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const run = useCallback(
    (ms: number, frame: (t: number) => void, done: () => void) => {
      stop();
      const t0 = performance.now();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        stop();
        frame(1);
        done();
      };
      const tick = (now: number) => {
        const t = (now - t0) / ms;
        if (t >= 1) return finish();
        frame(Math.max(0, t));
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      timeout.current = window.setTimeout(finish, ms + 150);
    },
    [stop],
  );
  return { run, stop };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const frames = useFrames();
  const [history, pushHistory] = useHistory();

  const [n, setN] = useState<RingSize>(16);
  const [s, setS] = useState<PickCount>(1);
  const [picks, setPicks] = useState<number[]>(() => defaultPicks(16, 1));
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [motion, setMotion] = useState<Motion | null>(null);
  const [roundKey, setRoundKey] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // Each walk is decided the moment it starts, so leaving mid-walk settles at
  // its real result, never at the value before it.
  const resolved = useRef(0);
  // Set synchronously while a walk animates, so a double press can't act twice.
  const stepping = useRef(false);
  const ticket = useTicket(() => (phase === 'walking' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'walking' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    stepping.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMotion(null);
    setPhase('over');
  }

  function walkOn(r: Round) {
    if (stepping.current) return;
    stepping.current = true;
    const seg = walkSegment(r.walk, r.picks, rng.next);
    const cash = seg.result === 'won' ? prize(r.n, r.picks.length) : seg.result === 'lost' ? 0 : cashValue(seg.end, r.picks);
    resolved.current = cash;

    const los: number[] = [];
    const his: number[] = [];
    let lo = r.walk.lo;
    let hi = r.walk.hi;
    for (const x of seg.xs) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      los.push(lo);
      his.push(hi);
    }
    // Short walks step at a readable pace; long ones are squeezed into a couple of seconds,
    // a little longer when one of your lamps is on the line.
    const steps = seg.steps;
    const cap = isExposed(r.walk, r.picks) ? 2400 : 1500;
    const total = Math.min(cap, Math.max(340, steps * 115)) * speed;
    setPhase('walking');
    setMotion({ xs: seg.xs, los, his, t: 0 });
    frames.run(
      total,
      (t) => setMotion((m) => m && { ...m, t: Math.min(steps, t * steps) }),
      () => {
        const next: Round = { ...r, walk: seg.end, cash };
        if (seg.result === 'won') return finish(next, 'won', cash);
        if (seg.result === 'lost') return finish(next, 'lost', 0);
        stepping.current = false;
        setRound(next);
        setMotion(null);
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cash, winChance: winChance(seg.end, r.picks) });
      },
    );
  }

  async function start() {
    if (live || bet.blocked || stepping.current) return;
    if (!(await ticket.place(bet.value))) return;
    frames.stop();
    const r: Round = { n, picks: [...picks], stake: bet.value, walk: startWalk(n), cash: RTP, outcome: null };
    setRoundKey((k) => k + 1);
    setRound(r);
    walkOn(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || stepping.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    frames.stop();
    stepping.current = false;
    setRound(null);
    setMotion(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  const pickLamp = (j: number) =>
    change(() => setPicks((p) => (p.includes(j) ? p : [...p.slice(1), j])));

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? walkOn(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the walk in motion, the round, or a preview of the settings.
  const ringN = round?.n ?? n;
  const shownPicks = round?.picks ?? picks;
  const count = shownPicks.length;
  // While walking, the light and the odds are those of the last lamp reached; the walker glides between lamps.
  const k = motion ? Math.min(motion.xs.length - 1, Math.floor(motion.t)) : 0;
  const walk: Walk = motion ? { n: ringN, lo: motion.los[k], hi: motion.his[k], x: motion.xs[k] } : round?.walk ?? startWalk(ringN);
  const walkerX = motion && k < motion.xs.length - 1 ? motion.xs[k] + (motion.xs[k + 1] - motion.xs[k]) * (motion.t - k) : walk.x;
  const mine = yourSlots(walk, shownPicks);
  const chance = winChance(walk, shownPicks);
  const cashNow = cashValue(walk, shownPicks);
  const exposed = isExposed(walk, shownPicks);
  const risk = nextRisk(walk, shownPicks);
  const bust = bustRisk(walk, shownPicks);
  const prizeX = prize(ringN, count);
  const stake = round?.stake ?? bet.value;
  const vol = volatilityOf(n, s);
  const p0 = startChance(n, s);

  let status = `Ready · back ${s} of ${n - 1} lamps`;
  if (phase === 'walking') status = `Walking · ${litCount(walk)} of ${ringN} lit`;
  if (phase === 'checkpoint') status = `Checkpoint · ${litCount(walk)} of ${ringN} lit`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${litCount(walk)} of ${ringN} lit`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const over = phase === 'over' && round?.outcome ? round.outcome : null;
  const finalChance = over === 'won' ? 1 : over === 'lost' ? 0 : chance;

  return (
    <GameLayout
      name="Last Light"
      accent="#fee440"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Lamps on the ring</Label>
          <Chips
            label="Lamps on the ring"
            options={RINGS.map((v) => ({ value: v, label: v }))}
            value={n}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setN(v);
                setPicks(defaultPicks(v, s));
              })
            }
          />

          <Label hint="tap the ring to move them">Lamps you back</Label>
          <Chips
            label="Lamps you back"
            options={PICK_COUNTS.map((v) => ({ value: v, label: v }))}
            value={s}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setS(v);
                setPicks(defaultPicks(n, v));
              })
            }
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>
              {s}/{n - 1} · {fmtChance(p0)}
            </dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(n, s))}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * round.cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => walkOn(round)}>
                Walk on {!exposed ? '· free' : bust > 0 ? `· ${fmtChance(1 - bust)} safe` : "· can't bust"}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={phase === 'walking' || !!bet.blocked} onClick={() => void start()}>
              {phase === 'walking' ? 'Walking…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(over ? finalChance : chance),
            sub: over === 'won' ? 'yours lit last' : over === 'lost' ? 'all yours lit' : `${mine} of ${ringN - 1} slots`,
            tone: 'chance',
          },
          {
            label: over ? 'Paid' : 'Cash out now',
            value: live || over ? fmtMult(over ? round!.cash : cashNow) : '—',
            sub: live || over ? formatAmount(stake * (over ? round!.cash : cashNow), 2) : `${fmtMult(RTP / count)} per slot`,
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prizeX), sub: 'if yours lights last', tone: 'prize' },
        ]}
      />

      <Board className="ll-board">
        <Ring
          key={`ring-${roundKey}`}
          walk={walk}
          walkerX={walkerX}
          picks={shownPicks}
          live={live}
          outcome={over}
          popMs={450 * speed}
          editable={!live}
          onPick={pickLamp}
          risk={risk}
          bust={bust}
          exposed={exposed}
        />
        {over && round && (
          <RoundOver
            key={history[0]?.id}
            title={OUTCOME_TITLE[over]}
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

      {over ? null : live ? (
        <ChanceBar
          p={chance}
          label="Chance one of your lamps lights last"
          note={`Your slots ÷ ${ringN - 1}. Lit lamps' slots flow to the dark end on their side of the walker, so the further it walks from your lamp, the more slots point at it.`}
        />
      ) : (
        <Caption>
          The last lamp to light is uniform: each of the {n - 1} lamps besides the start owns one slot. Back {s} and you win {s}/{n - 1} ={' '}
          {fmtChance(p0)} ({fmtOneIn(p0)}), whichever lamps you pick. Prize {fmtMult(prize(n, s))}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Last Light" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A walker starts on the top lamp of a ring and steps one lamp left or right at random, lighting every lamp it reaches. Back one or more lamps:
              if the <b>last lamp to light</b> is one of yours, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose the ring size and how many lamps to back, then tap lamps on the ring to choose which ones. Bet.</li>
              <li>
                The walker walks until something matters for you: one of your lamps is next in line to light, or one of them has just lit. Lamps lit before
                that can&apos;t change your odds, so it walks straight past them.
              </li>
              <li>At every stop you can cash out (C) or walk on (Space). You win the moment only your lamps are still dark; you lose when all of them are lit.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The outer band has one <b>slot</b> for every lamp except the walker&apos;s, {ringN - 1} in all. A dark lamp owns its own slot. A lit lamp&apos;s
              slot flows (the chevrons) to the dark lamp at the end of the light on its side of the walker. Your chance is exactly{' '}
              <b style={{ color: 'var(--green)' }}>your green slots</b> ÷ {ringN - 1}.
            </p>
            <p>
              Every step moves one slot from the end the walker steps towards to the end it walks away from. So when one of your lamps is next in line, the
              further the walker roams from it, the better your chance. But the nearer end is also the likelier to light next. The figure in the middle is
              the chance the next lamp to light is one of yours: <b style={{ color: 'var(--red)' }}>red</b> when that would end the round,{' '}
              <b style={{ color: 'var(--gold)' }}>gold</b> when you would still hold another lamp. The Walk button shows the chance the round survives
              the walk.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              <b>Cover time of a cycle.</b> For a simple random walk on a ring of n vertices, the last vertex to be visited is uniformly distributed over the
              n − 1 vertices other than the start (Lovász). So backing s lamps wins with probability s/(n − 1): the start&apos;s neighbour is as likely to
              be last as the lamp opposite it.
            </p>
            <p>
              Why: a dark lamp is last exactly when the walker reaches both of its neighbours before it. Unwrap the ring onto a line and apply gambler&apos;s
              ruin. A dark lamp with dark neighbours on both sides is last with chance 1/(n − 1). The dark lamp at an end of the light, d steps from the
              walker, is last with chance d/(n − 1). That is the slot count on the band.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% × (n − 1)/s, and cashing out pays prize × your chance = {(RTP * 100).toFixed(0)}% × your slots ÷ s. A
              step moves your slot count up or down by one with equal chance (or leaves it alone), so the cash-out is a martingale: the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake whenever you cash out and whichever lamps you back. The largest payout is one lamp on a ring of{' '}
              {RINGS[RINGS.length - 1]}: {fmtMult(prize(RINGS[RINGS.length - 1], 1))}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
