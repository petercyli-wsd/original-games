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
  Slider,
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
import { useRef, useState } from 'react';
import QuadrantBoard, { Glyph, PointStrip, fmtNum, useTween, type Anim, type PointPill, type Stage } from './Board';
import {
  POINTS,
  RTP,
  SLICES,
  TARGET_LABEL,
  cashOut,
  drawX,
  drawY,
  greenSlices,
  inTarget,
  pLandGivenX,
  pPoint,
  pWin,
  pWin0,
  prize,
  rhoOf,
  settles,
  volatilityOf,
  type Points,
  type Pt,
  type Settings,
  type State,
  type Target,
} from './math';

type Phase = 'idle' | 'revealing' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  s: Settings;
  stake: number;
  /** Points already landed in the target. */
  landed: Pt[];
  /** The point being revealed (null between points). */
  cur: { x: number; y: number | null } | null;
  cash: number;
  outcome: Outcome | null;
  /** The last x settled its point on its own (y was shown just for the picture). */
  early: boolean;
}

/** Reveal times in ms (turbo runs them at a quarter). */
const MS = { x: 1000, y: 950, hold: 420 };

const fmtRho = (theta: number) => {
  const r = rhoOf(theta);
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(2);
};
const sliderOf = (theta: number) => (90 - theta) / 10;
const thetaOf = (v: number) => 90 - 10 * v;

const stateOf = (r: Round): State => ({ landed: r.landed.length, x: r.cur && r.cur.y === null ? r.cur.x : null });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [target, setTarget] = useState<Target>('corner');
  const [theta, setTheta] = useState(50);
  const [points, setPoints] = useState<Points>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [anim, setAnim] = useState<Anim>({ from: 0, to: 0, key: 0, ms: 0 });
  const [infoOpen, setInfoOpen] = useState(false);

  // The open bet's fair value. A reveal is decided the moment it starts, so
  // this jumps to the revealed result straight away: leaving mid-animation
  // settles at the real outcome, never at the pre-reveal value.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);

  const live = phase === 'revealing' || phase === 'checkpoint';
  const speed = turbo.turbo ? 0.25 : 1;
  const dur = (ms: number) => Math.round(ms * speed);
  const settings: Settings = { target, theta, points };

  function animate(from: Stage, to: Stage, ms: number) {
    setAnim((a) => ({ from, to, ms, key: a.key + 1 }));
  }

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function checkpoint(r: Round) {
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: r.cash, winChance: pWin(r.s, stateOf(r)) });
  }

  /** Reveals the current point's y. `early` when its x already settled it. */
  function revealY(r: Round, early = false) {
    if (!r.cur) return;
    const { x } = r.cur;
    const y = drawY(x, r.s.theta, rng);
    const hit = inTarget(r.s.target, x, y);
    const landed = r.landed.length + (hit ? 1 : 0);
    const last = !hit || landed === r.s.points;
    const cash = !hit ? 0 : landed === r.s.points ? prize(r.s) : cashOut(r.s, { landed, x: null });
    fair.current = cash;
    const next: Round = { ...r, cur: { x, y }, cash, early };
    setRound(next);
    setPhase('revealing');
    const ms = dur(early ? MS.y * 0.7 : MS.y);
    animate(1, 2, ms);
    timers.after(ms + dur(MS.hold), () => {
      if (last) return finish(next, hit ? 'won' : 'lost', cash);
      // Landed with more to go: it joins the landed points and the next one waits.
      const after: Round = { ...next, landed: [...r.landed, [x, y]], cur: null, early: false };
      setRound(after);
      animate(0, 0, 0);
      checkpoint(after);
    });
  }

  /** Reveals the current point's x, then pauses at a checkpoint unless x settled the point. */
  function revealX(r: Round) {
    if (!r.cur) return;
    setRound(r);
    setPhase('revealing');
    const ms = dur(MS.x);
    animate(0, 1, ms);
    const p = pLandGivenX(r.s.target, r.s.theta, r.cur.x);
    timers.after(ms + 40, () => (settles(p) ? revealY(r, true) : checkpoint(r)));
  }

  async function start() {
    if (live || bet.blocked) return;
    // The first x is drawn first; the bet then opens already worth its post-reveal value.
    const x = drawX(rng);
    const cash = cashOut(settings, { landed: 0, x });
    fair.current = cash;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    revealX({ s: settings, stake: bet.value, landed: [], cur: { x, y: null }, cash, outcome: null, early: false });
  }

  function next() {
    if (phase !== 'checkpoint' || !round) return;
    if (round.cur) return revealY(round);
    const x = drawX(rng);
    const cash = cashOut(round.s, { landed: round.landed.length, x });
    fair.current = cash;
    revealX({ ...round, cur: { x, y: null }, cash });
  }

  function cashOutNow() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setPhase('idle');
    animate(0, 0, 0);
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys({ space: () => (phase === 'checkpoint' ? next() : !live ? void start() : undefined), cashOut: cashOutNow }, !infoOpen);

  // ---------- what the board and readouts show ----------
  const s = round?.s ?? settings;
  const stake = round?.stake ?? bet.value;
  const p1 = pPoint(s.target, s.theta);
  const k = greenSlices(s.target, s.theta);
  const full = prize(s);
  const drawTheta = useTween(s.theta, dur(280));
  const cur = round?.cur ?? null;
  // Mid-reveal, the numbers still describe the state before the reveal.
  const curStage: Stage = cur ? (phase === 'revealing' ? anim.from : anim.to) : 0;
  const landedCount = round?.landed.length ?? 0;
  const shownState: State = { landed: landedCount, x: cur && curStage === 1 ? cur.x : null };
  const hit = cur && cur.y !== null ? inTarget(s.target, cur.x, cur.y) : null;

  let pNow = pWin(s, shownState);
  let cashNow = round && phase !== 'revealing' ? round.cash : full * pNow;
  if (phase === 'over' && round) {
    if (round.outcome === 'cashed') pNow = pWin(s, stateOf(round));
    else pNow = round.outcome === 'won' ? 1 : 0;
    cashNow = round.cash;
  }
  const pThis = cur && curStage === 1 ? pLandGivenX(s.target, s.theta, cur.x) : p1;
  const toGo = s.points - landedCount - (cur && curStage === 1 ? 1 : 0);
  const vol = volatilityOf(settings);
  const word = TARGET_LABEL[s.target].toLowerCase();

  // The per-point strip.
  const pills: PointPill[] = Array.from({ length: s.points }, (_, i) => {
    if (i < landedCount) {
      const [lx, ly] = round!.landed[i];
      return { state: 'in', value: '✓ in', note: `(${fmtNum(lx)}, ${fmtNum(ly)})` };
    }
    if (i === landedCount && cur && round) {
      if (cur.y !== null && phase === 'over') {
        return hit
          ? { state: 'in', value: '✓ in', note: `(${fmtNum(cur.x)}, ${fmtNum(cur.y)})` }
          : { state: 'out', value: '✗ out', note: `(${fmtNum(cur.x)}, ${fmtNum(cur.y)})` };
      }
      if (curStage >= 1) return { state: 'now', value: fmtChance(pThis), note: `x = ${fmtNum(cur.x)} · bell` };
      return { state: 'now', value: fmtChance(p1), note: 'revealing x' };
    }
    if (i === landedCount && round && phase === 'checkpoint') return { state: 'now', value: fmtChance(p1), note: 'next · cloud' };
    return { state: 'todo', value: fmtChance(p1), note: `${k} of ${SLICES} slices` };
  });

  // Status and titles.
  const pointNo = Math.min(s.points, landedCount + 1);
  const pointLabel = s.points > 1 && round ? `Point ${pointNo} of ${s.points}` : null;
  let status = `Ready · ${s.points > 1 ? `${s.points} points · ` : ''}${TARGET_LABEL[s.target]} · ρ ${fmtRho(s.theta)}`;
  if (phase === 'revealing') status = `${pointLabel ? pointLabel + ' · ' : ''}Revealing ${anim.from === 0 ? 'x' : 'y'}`;
  if (phase === 'checkpoint')
    status = cur ? `Checkpoint · ${pointLabel ? pointLabel + ', ' : ''}x = ${fmtNum(cur.x)}` : `Checkpoint · ${landedCount} of ${s.points} landed`;
  let title = 'Cashed out';
  if (round?.outcome === 'won') title = s.points > 1 ? `All ${s.points} points landed` : s.target === 'corner' ? 'Top-right!' : 'Same sign!';
  if (round?.outcome === 'lost') title = round.early ? 'Missed · settled by x' : s.target === 'corner' ? 'Missed the corner' : 'Opposite signs';
  if (phase === 'over') status = title;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // Readout notes.
  let chanceSub = s.points > 1 ? `${fmtChance(p1)} per point` : 'green share of the cloud';
  if (live && cur && curStage === 1) chanceSub = toGo > 0 ? `bell ${fmtChance(pThis)} × ${fmtChance(p1)}${toGo > 1 ? (toGo === 2 ? '²' : '³') : ''}` : 'green share of the bell';
  else if (live && toGo < s.points) chanceSub = `${fmtChance(p1)} × ${plural(toGo, 'point')} to go`;
  if (phase === 'over' && round?.outcome !== 'cashed') chanceSub = round?.outcome === 'won' ? 'landed' : 'missed';

  let barNote = 'The green share of the cloud: each of the 36 slices holds 1/36 of the chance.';
  if (cur && curStage === 1) barNote = 'The green share of the bell on the slice through x is this point’s chance.';
  if (s.points > 1) barNote += ` All ${s.points} points must land.`;

  const sheppardText =
    s.target === 'corner' ? (
      <>
        P(top-right) = ¼ + arcsin(ρ)/2π = {k}/{SLICES}
      </>
    ) : (
      <>
        P(same sign) = ½ + arcsin(ρ)/π = {k}/{SLICES}
      </>
    );

  return (
    <GameLayout
      name="Quadrant"
      accent="#a8dadc"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Target</Label>
          <Chips
            label="Target"
            options={[
              {
                value: 'corner',
                label: (
                  <span className="quad-chip">
                    <Glyph target="corner" /> Top-right
                  </span>
                ),
                title: 'x > 0 and y > 0',
              },
              {
                value: 'same',
                label: (
                  <span className="quad-chip">
                    <Glyph target="same" /> Same sign
                  </span>
                ),
                title: 'x and y both positive, or both negative',
              },
            ]}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v as Target))}
          />

          <Label
            hint={
              <>
                ρ = <b>{fmtRho(theta)}</b>
              </>
            }
          >
            Correlation
          </Label>
          <Slider
            label="Correlation"
            value={sliderOf(theta)}
            min={-8}
            max={8}
            step={1}
            risk
            disabled={live}
            onChange={(v) => change(() => setTheta(thetaOf(v)))}
          />
          <div className="quad-scale" aria-hidden="true">
            <span>−0.98 · opposite</span>
            <span>0</span>
            <span>together · +0.98</span>
          </div>

          <Label hint="every one must land">Points</Label>
          <Chips
            label="Points to land"
            options={POINTS.map((v) => ({ value: v, label: v, title: `${plural(v, 'point')} must all land in the target` }))}
            value={points}
            disabled={live}
            onChange={(v) => change(() => setPoints(v as Points))}
          />

          <dl className="og-stats">
            <dt>Per point</dt>
            <dd>
              {greenSlices(target, theta)}/{SLICES} = {fmtChance(pPoint(target, theta))}
            </dd>
            <dt>Chance to win</dt>
            <dd>{fmtChance(pWin0(settings))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(settings))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOutNow}>
                Cash out <span>{formatAmount(stake * cashNow, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                {cur ? `Reveal y · ${fmtChance(pThis)} to land` : `Next point · ${fmtChance(p1)} to land`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'revealing' ? `Revealing ${anim.from === 0 ? 'x' : 'y'}…` : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(pNow), sub: chanceSub, tone: 'chance' },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cashNow) : '—', sub: formatAmount(stake * cashNow, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(full), sub: s.points > 1 ? `if all ${s.points} land ${word}` : `if it lands ${word}`, tone: 'prize' },
        ]}
      />

      <Board className="quad-stage">
        <QuadrantBoard
          target={s.target}
          theta={drawTheta}
          thetaExact={s.theta}
          landed={round?.landed ?? []}
          cur={cur}
          anim={anim}
          hit={hit}
          speed={speed}
          pointLabel={pointLabel}
        />
        {phase === 'over' && round?.outcome ? (
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
        ) : (
          <PointStrip pills={pills} />
        )}
      </Board>

      {live ? (
        <ChanceBar p={pNow} label="Chance to win" note={barNote} />
      ) : (
        <Caption>
          Sheppard: {sheppardText} = {fmtChance(p1)} at ρ = {fmtRho(s.theta)}
          {s.points > 1 ? `; all ${s.points} points land ${fmtChance(pWin0(s))} of the time` : ''}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Quadrant" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A point lands at random in a cloud of correlated pairs (x, y). Back <b>Top-right</b> (x and y both positive) or <b>Same sign</b> (both
              positive or both negative). With 2 or 3 points, every one of them must land in your target.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the target, the correlation ρ and how many points must land, then bet.</li>
              <li>x is revealed straight away: a vertical slice through the cloud. Checkpoint: cash out, or reveal y.</li>
              <li>y lands on the slice and the point is in or out. With more points to go you reach another checkpoint: cash out, or reveal the next x.</li>
              <li>If x already decides a point (Top-right with x &lt; 0), there is no checkpoint and y is shown at once.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Before x, the cloud is cut into 36 slices from its centre. They look different sizes, but each holds exactly 1/36 of the chance (and 1/36 of
              the ellipse's area). The <b style={{ color: 'var(--green)' }}>green slices</b> lie in your target, so their share is your chance; the corner
              labels give each quadrant's share.
            </p>
            <p>
              Once x is known the point must be on the vertical slice through x, and y lands according to the bell drawn on it. The{' '}
              <b style={{ color: 'var(--green)' }}>green share of the bell</b> is your chance and the <b style={{ color: 'var(--red)' }}>red share</b> is the
              risk. Higher ρ tilts the cloud towards the diagonal: x and y tend to share a sign.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Sheppard's formula: for a standard bivariate normal with correlation ρ, P(x &gt; 0, y &gt; 0) = ¼ + arcsin(ρ)/2π, and P(same sign) = ½ +
              arcsin(ρ)/π.
            </p>
            <p>
              Why: un-squash the cloud into a round one. The axes become two lines through the centre at angle θ = arccos ρ, and the top-right quadrant
              becomes a wedge of 180° − θ. A round cloud points every way equally often, so P = (180° − θ)/360°. Here θ is a whole number of 10° steps, so
              the chance is a whole number of the 36 slices.
            </p>
            <p>Once x is known, y = ρx + √(1 − ρ²)·z with z standard normal, so P(y &gt; 0 | x) = Φ(ρx/√(1 − ρ²)).</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ P(win) (from {fmtMult(prize({ target: 'same', theta: 10, points: 1 }))} up to{' '}
              {fmtMult(prize({ target: 'corner', theta: 170, points: 3 }))}). Cashing out pays that prize × your chance right now. Each reveal leaves the
              expected chance unchanged, so every cash-out is a fair price and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and
              whenever you cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
