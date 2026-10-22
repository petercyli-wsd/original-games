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
import { formatAmount } from '@originals/game-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import Field, { Glyph, type CutLine } from './Board';
import {
  LINE_COUNTS,
  RTP,
  SHAPES,
  SHAPE_IDS,
  aimedCutChance,
  cutChance,
  direction,
  lineHits,
  offset,
  volatilityOf,
  winChance,
  winChanceAimed,
  winChanceLeft,
  type Lines,
  type ShapeId,
  type Side,
} from './math';

type Phase = 'idle' | 'aiming' | 'checkpoint' | 'cutting' | 'over';
type Outcome = 'cut' | 'missed' | 'spared' | 'touched' | 'cashed';

interface Round {
  shape: ShapeId;
  side: Side;
  lines: Lines;
  stake: number;
  prize: number;
  /** Earlier lines, all of which missed. */
  done: CutLine[];
  /** The current line's direction, once aimed. */
  phi: number | null;
  /** The cash-out value now: prize × P(win | what's on the board). */
  cash: number;
  outcome: Outcome | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  cut: 'Cut!',
  missed: 'Every line missed',
  spared: 'Spared',
  touched: 'Cut through',
  cashed: 'Cashed out',
};
const titleOf = (o: Outcome, lines: number) => (o === 'missed' && lines === 1 ? 'Missed' : OUTCOME_TITLE[o]);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** requestAnimationFrame tweens whose completion is guaranteed by a timer, so a hidden tab can't stall a round. */
function useAnim() {
  const raf = useRef(0);
  const timer = useRef(0);
  const cancel = useCallback(() => {
    cancelAnimationFrame(raf.current);
    clearTimeout(timer.current);
    raf.current = 0;
    timer.current = 0;
  }, []);
  useEffect(() => cancel, [cancel]);
  const run = useCallback(
    (ms: number, frame: (t: number) => void, done: () => void) => {
      cancel();
      const t0 = performance.now();
      const tick = (now: number) => {
        frame(Math.min(1, (now - t0) / ms));
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      timer.current = window.setTimeout(() => {
        cancel();
        frame(1);
        done();
      }, ms);
    },
    [cancel],
  );
  return { run, cancel };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const anim = useAnim();
  const [history, pushHistory] = useHistory();

  const [shape, setShape] = useState<ShapeId>('rod');
  const [side, setSide] = useState<Side>('hit');
  const [lines, setLines] = useState<Lines>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [angle, setAngle] = useState<number | null>(null);
  const [cutAt, setCutAt] = useState<number | null>(null);
  const [landed, setLanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const shownAngle = useRef(0);
  /** True while a reveal animates, so a stale click or key can't start another. */
  const stepping = useRef(false);

  // Each reveal is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-reveal value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'aiming' || phase === 'cutting' ? resolved.current : round?.cash ?? 0));

  const spinMs = turbo.turbo ? 200 : 780;
  const cutMs = turbo.turbo ? 260 : 1000;
  const live = phase === 'aiming' || phase === 'checkpoint' || phase === 'cutting';

  function finish(r: Round, outcome: Outcome, cash: number) {
    stepping.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Stage 1: the ruler spins to the next line's direction and the shadow appears. */
  function aim(r: Round) {
    const phi = direction(rng.next());
    const s = SHAPES[r.shape];
    const left = r.lines - r.done.length;
    const cash = r.prize * winChanceAimed(r.side, left, aimedCutChance(s, phi), cutChance(s));
    resolved.current = cash;
    stepping.current = true;
    setRound(r);
    setCutAt(null);
    setLanded(false);
    setPhase('aiming');
    const a0 = shownAngle.current;
    let d = mod(phi - a0, 2 * Math.PI);
    if (d < Math.PI) d += 2 * Math.PI;
    anim.run(
      spinMs,
      (t) => setAngle(a0 + d * easeOut(t)),
      () => {
        shownAngle.current = a0 + d;
        stepping.current = false;
        setRound({ ...r, phi, cash });
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cash, winChance: cash / r.prize });
      },
    );
  }

  /** Stage 2: the line sweeps along the ruler and lands at a uniform offset. */
  function cut(r: Round) {
    if (r.phi === null || stepping.current) return;
    stepping.current = true;
    const s = SHAPES[r.shape];
    const p = offset(rng.next());
    const hit = lineHits(s, r.phi, p);
    const left = r.lines - r.done.length;
    let outcome: Outcome | null = null;
    let cash: number;
    if (hit) {
      outcome = r.side === 'hit' ? 'cut' : 'touched';
      cash = r.side === 'hit' ? r.prize : 0;
    } else if (left === 1) {
      outcome = r.side === 'hit' ? 'missed' : 'spared';
      cash = r.side === 'hit' ? 0 : r.prize;
    } else {
      cash = r.prize * winChanceLeft(r.side, left - 1, cutChance(s));
    }
    resolved.current = cash;
    setLanded(false);
    setPhase('cutting');
    // Sweep from −1 up to +1, then back down to p.
    const travel = 2 + (1 - p);
    anim.run(
      cutMs,
      (t) => {
        const x = travel * easeOut(t);
        setCutAt(x <= 2 ? -1 + x : 1 - (x - 2));
      },
      () => {
        setCutAt(p);
        setLanded(true);
        if (outcome) return finish(r, outcome, cash);
        // A miss with lines to go: let it register, then aim the next line.
        const next: Round = { ...r, done: [...r.done, { phi: r.phi!, p, hit }], phi: null, cash };
        timers.after(turbo.turbo ? 80 : 320, () => aim(next));
      },
    );
  }

  async function start() {
    if (live || stepping.current || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    anim.cancel();
    const r: Round = {
      shape,
      side,
      lines,
      stake: bet.value,
      prize: RTP / winChance(shape, side, lines),
      done: [],
      phi: null,
      cash: RTP,
      outcome: null,
    };
    aim(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || stepping.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    anim.cancel();
    setRound(null);
    setAngle(null);
    setCutAt(null);
    setLanded(false);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? cut(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const sh = SHAPES[round?.shape ?? shape];
  const sd = round?.side ?? side;
  const n = round?.lines ?? lines;
  const c = cutChance(sh);
  const p0 = winChance(sh.id, sd, n);
  const prize = round?.prize ?? RTP / p0;
  const cash = round?.cash ?? RTP;
  const pNow = round ? cash / prize : p0;
  const stake = round?.stake ?? bet.value;
  const lineNo = (round?.done.length ?? 0) + 1;
  const linesLeft = n - lineNo;
  const aimedShare = round?.phi != null ? aimedCutChance(sh, round.phi) : null;
  const target = sh.name.toLowerCase();
  const backing = sd === 'hit' ? `cut the ${target}` : `miss the ${target}`;

  let status = `Ready · ${n === 1 ? 'one line' : plural(n, 'line')} must ${backing}`;
  if (sd === 'hit' && n > 1) status = `Ready · one of ${n} lines must cut the ${target}`;
  if (sd === 'miss' && n > 1) status = `Ready · all ${n} lines must miss the ${target}`;
  if (phase === 'aiming') status = `Aiming line ${lineNo} of ${n}`;
  if (phase === 'checkpoint') status = `Checkpoint · line ${lineNo} of ${n} aimed`;
  if (phase === 'cutting') status = `Dropping line ${lineNo} of ${n}`;
  if (phase === 'over' && round?.outcome) status = titleOf(round.outcome, n) + (n > 1 ? ` · line ${lineNo} of ${n}` : '');
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';
  const result =
    phase === 'over' && round?.outcome && round.outcome !== 'cashed' ? (round.cash > 0 ? 'win' : 'lose') : null;

  // After this line, what remains: for the ChanceBar note.
  const restNote =
    linesLeft > 0 ? ` Then ${plural(linesLeft, 'more line')} at ${fmtChance(c)} each.` : ' This is the last line.';

  const vol = volatilityOf(winChance(shape, side, lines));
  const chanceFor = (id: ShapeId) => cutChance(SHAPES[id]);

  return (
    <GameLayout
      name="Line Cut"
      accent="#80ed99"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Shape</Label>
          <Chips
            label="Shape"
            options={SHAPE_IDS.map((id) => ({
              value: id,
              title: `${SHAPES[id].name}: one line cuts it ${fmtChance(chanceFor(id))} of the time`,
              label: (
                <span className="lc-chip">
                  <Glyph id={id} />
                  <small>{Math.round(chanceFor(id) * 100)}%</small>
                </span>
              ),
            }))}
            value={shape}
            disabled={live}
            onChange={(v) => change(() => setShape(v))}
          />

          <Label hint={side === 'hit' ? 'win if a line cuts it' : 'win if no line touches it'}>Back</Label>
          <Chips
            label="Back"
            options={[
              { value: 'hit' as Side, label: 'Hit' },
              { value: 'miss' as Side, label: 'Miss' },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          <Label hint="a checkpoint before each">Lines</Label>
          <Chips
            label="Lines"
            options={LINE_COUNTS.map((v) => ({ value: v, label: v }))}
            value={lines}
            disabled={live}
            onChange={(v) => change(() => setLines(v))}
          />

          <dl className="og-stats">
            <dt>Cut chance per line</dt>
            <dd>{fmtChance(cutChance(SHAPES[shape]))}</dd>
            <dt>Chance to win</dt>
            <dd>{fmtChance(winChance(shape, side, lines))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / winChance(shape, side, lines))}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => cut(round)}>
                Drop line {lineNo} · {fmtChance(aimedShare ?? 0)} to cut
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'aiming' ? 'Aiming…' : phase === 'cutting' ? 'Dropping…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(pNow),
            sub: sd === 'hit' ? `a line cuts the ${target}` : `no line cuts the ${target}`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'from the first checkpoint',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          shape={sh.id}
          side={sd}
          lines={n}
          mode={phase === 'idle' ? 'idle' : phase === 'over' ? 'over' : 'live'}
          angle={angle}
          p={cutAt}
          settled={landed}
          past={round?.done ?? []}
          result={result}
          spinning={phase === 'aiming'}
          onPick={live ? undefined : (id) => change(() => setShape(id))}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={titleOf(round.outcome, round.lines)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="bottom"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label="Win chance"
          note={
            phase === 'checkpoint' || phase === 'cutting'
              ? `This line cuts the ${target} ${fmtChance(aimedShare ?? 0)} of the time: the shadow's share of the ruler.${restNote}`
              : `Each line cuts the ${target} ${fmtChance(c)} of the time: its outline's share of the rim.`
          }
        />
      ) : (
        <Caption>
          Crofton: a random line cuts a convex shape with chance outline ÷ rim. The rod's outline (both sides) is as long as the circle's, so both are cut{' '}
          30% of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Line Cut" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Random straight lines cut across a round arena holding five shapes. Pick a shape and back <b>Hit</b> (at least one line cuts it) or{' '}
              <b>Miss</b> (no line touches it).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a shape (on the board or in the panel), Hit or Miss, and how many lines will fall. Then bet.</li>
              <li>Each line comes in two steps. First the ruler spins to the line's direction and the shape's shadow appears on it: a checkpoint.</li>
              <li>Cash out (C), or drop the line (Space). It lands at a random spot along the ruler, square to it.</li>
              <li>Hit pays as soon as a line cuts your shape. Miss pays when the last line has missed.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The line will cross the ruler at a uniformly random spot. It cuts your shape exactly when it crosses inside the shape's <b>shadow</b> on the ruler, so the
              shadow's share of the ruler is the chance this line cuts. The flat ruler under the arena shows the same shadow, with its percentage. Green is
              where a line wins for you and red where it loses; grey means "on to the next line".
            </p>
            <p>Before a line is aimed, its chance is the shape's outline length divided by the arena's rim: the arc drawn on the rim.</p>
            <p>
              A circle's shadow is its diameter whichever way the ruler points, so its odds never move at the checkpoint. The rod's shadow swings from
              nothing (end-on) to its full length: the same 30% on average, a much wilder ride.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Cauchy–Crofton: a random line through a disc of radius 1 (uniform direction, uniform offset) cuts a convex shape K with probability perimeter(K) / 2π.
              For a fixed direction the chance is K's width in that direction ÷ 2 (the shadow), and Cauchy's formula says the average width is perimeter / π.
            </p>
            <p>
              Only the outline matters. A rod of length L has perimeter 2L (both sides count), so a rod of length 0.3π is cut exactly as often as a disc of
              radius 0.3: 30% per line. With c per line and N lines, Hit wins with chance 1 − (1 − c)<sup>N</sup> and Miss with (1 − c)<sup>N</sup>.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays RTP ÷ P(win) for your settings. At every checkpoint the cash-out is that prize × your exact chance of winning from there:
              1 − (1 − s)(1 − c)<sup>k−1</sup> for Hit or (1 − s)(1 − c)<sup>k−1</sup> for Miss, with s the shadow share and k lines to go. That value is a fair
              bet at every step, so every shape, side, line count and cash-out rule returns exactly {(RTP * 100).toFixed(0)}%. A line that only grazes the
              shape counts as a cut. The largest prize is {fmtMult(RTP / winChance('dot', 'hit', 1))} (hit the dot with one line).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
