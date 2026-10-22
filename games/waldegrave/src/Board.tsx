import { fmtChance } from '@originals/game-sdk/ui';
import { SEAT_NAMES, type Duel, type Side } from './math';

export interface Flip {
  champWins: boolean;
  stage: 'spin' | 'land';
}

export interface BoardProps {
  duel: Duel;
  streakToWin: number;
  seat: number;
  side: Side;
  /** Every seat's chance to take the pot, by seat index. */
  chances: number[];
  /** Your chance now, and after each result of the next duel: [champion wins, challenger wins]. */
  now: number;
  branches: [number, number] | null;
  flip: Flip | null;
  spinMs: number;
  /** The round is over: the result card covers the duel's headings. */
  over: boolean;
}

const ARENA_Y = 64;
const CHAMP_X = 108;
const CHALL_X = 292;
const BAR_TOP = 262;
const BAR_H = 100;

const roleOf = (pos: number, winner: boolean, short: boolean, done: boolean) =>
  winner ? 'pot' : pos === 0 ? 'champ' : pos === 1 ? (done ? 'lost last' : 'in duel') : short ? `q${pos - 1}` : `queue ${pos - 1}`;

export default function Board({ duel, streakToWin: k, seat, side, chances, now, branches, flip, spinMs, over }: BoardProps) {
  const n = duel.order.length;
  const [champ, chall, ...queue] = duel.order;
  const opening = duel.streak === 0;
  const done = duel.winner !== null;
  const mine = (s: number) => s === seat;
  const good = (s: number) => (side === 'back' ? s === seat : s !== seat);

  const flipWin = flip?.stage === 'land' ? (flip.champWins ? 'champ' : 'chall') : null;
  const tokenClass = (s: number, role: 'champ' | 'chall') =>
    'tok' + (mine(s) ? ' mine' : '') + (flipWin ? (flipWin === role ? ' won' : ' lost') : '') + (done && role === 'champ' ? ' pot' : '');

  const branchText = (p: number) => `you ${fmtChance(p)}`;
  const tone = (p: number) => (p > now + 1e-12 ? 'up' : p < now - 1e-12 ? 'down' : '');

  const colX = (i: number) => 200 + (i - (n - 1) / 2) * 74;
  const coinX = flipWin === 'champ' ? CHAMP_X - 200 + 48 : flipWin === 'chall' ? CHALL_X - 200 - 48 : 0;

  return (
    <svg viewBox="0 0 400 418" className="wg" role="img" aria-label={`${SEAT_NAMES[champ]} versus ${SEAT_NAMES[chall]}; your chance ${fmtChance(now)}`}>
      {/* ---------- the duel ---------- */}
      {!over && (
        <>
          <text x={CHAMP_X} y={18} className="role">
            {opening ? 'opening duel' : 'champion'}
          </text>
          <text x={CHALL_X} y={18} className="role">
            {opening ? 'opening duel' : 'challenger'}
          </text>
        </>
      )}

      <g key={`c${champ}`} className={tokenClass(champ, 'champ')} transform={`translate(${CHAMP_X} ${ARENA_Y})`}>
        <circle r={30} />
        <text y={10}>{SEAT_NAMES[champ]}</text>
      </g>
      <g key={`x${chall}`} className={tokenClass(chall, 'chall') + (done ? ' faded' : '')} transform={`translate(${CHALL_X} ${ARENA_Y})`}>
        <circle r={30} />
        <text y={10}>{SEAT_NAMES[chall]}</text>
      </g>

      <text x={200} y={ARENA_Y + 6} className="vs">
        vs
      </text>
      {flip && (
        <g style={{ transform: `translateX(${coinX}px)`, transition: `transform ${Math.round(spinMs * 0.35)}ms ease-out` }}>
          <circle
            cx={200}
            cy={ARENA_Y - 34}
            r={9}
            className={'coin' + (flip.stage === 'spin' ? ' spin' : '')}
            style={{ animationDuration: `${Math.max(80, Math.round(spinMs / 4))}ms` }}
          />
        </g>
      )}

      {/* The champion's streak: k pips, the last one takes the pot. */}
      <g transform={`translate(${CHAMP_X} ${ARENA_Y + 46})`}>
        {Array.from({ length: k }, (_, i) => (
          <circle key={i} cx={(i - (k - 1) / 2) * 18} cy={0} r={6} className={'pip' + (i < duel.streak ? ' on' : '') + (i === k - 1 ? ' last' : '')} />
        ))}
      </g>
      <text x={CHAMP_X} y={ARENA_Y + 68} className="small">
        {opening ? `${k} wins in a row takes the pot` : `streak ${duel.streak} of ${k}`}
      </text>
      <text x={CHALL_X} y={ARENA_Y + 51} className="small">
        {done ? '' : opening ? 'winner starts a streak' : 'a win starts a new streak'}
      </text>

      {branches && !done && (
        <>
          <text x={CHAMP_X} y={ARENA_Y + 90} className={'branch ' + tone(branches[0])}>
            {SEAT_NAMES[champ]} wins → {duel.streak + 1 >= k ? `pot · ${branchText(branches[0])}` : branchText(branches[0])}
          </text>
          <text x={CHALL_X} y={ARENA_Y + 90} className={'branch ' + tone(branches[1])}>
            {SEAT_NAMES[chall]} wins → {branchText(branches[1])}
          </text>
        </>
      )}

      {/* ---------- the queue ---------- */}
      <text x={14} y={192} className="lab start">
        queue
      </text>
      {queue.map((s, i) => (
        <g key={`q${s}`} className={'tok small-tok' + (mine(s) ? ' mine' : '')} transform={`translate(${86 + i * 44} 188)`}>
          <circle r={15} />
          <text y={5}>{SEAT_NAMES[s]}</text>
        </g>
      ))}
      <g transform={`translate(${86 + queue.length * 44} 188)`}>
        <circle r={15} className="slot" />
        <text x={24} y={4} className="lab start">
          ← loser joins the back
        </text>
      </g>

      <line x1={10} x2={390} y1={216} y2={216} className="rule" />

      {/* ---------- every seat's live odds ---------- */}
      <text x={14} y={238} className="lab start">
        chance to take the pot
      </text>
      <text x={386} y={238} className="lab end">
        <tspan className="key">green</tspan> = your chance {fmtChance(now)}
      </text>
      {chances.map((p, s) => {
        const x = colX(s);
        const pos = duel.order.indexOf(s);
        const h = Math.max(0, Math.min(1, p)) * BAR_H;
        return (
          <g key={s} className={'col' + (good(s) ? ' good' : ' bad') + (mine(s) ? ' mine' : '')}>
            <rect x={x - 17} y={BAR_TOP} width={34} height={BAR_H} rx={4} className="track" />
            <rect x={x - 17} y={BAR_TOP + BAR_H - h} width={34} height={h} rx={4} className="fill" />
            <text x={x} y={BAR_TOP + BAR_H - h - 6} className="pct">
              {fmtChance(p)}
            </text>
            <g className={'tok small-tok' + (mine(s) ? ' mine' : '')} transform={`translate(${x} ${BAR_TOP + BAR_H + 22})`}>
              <circle r={14} />
              <text y={5}>{SEAT_NAMES[s]}</text>
            </g>
            <text x={x} y={BAR_TOP + BAR_H + 52} className={'tag' + (mine(s) ? ' you' : '')}>
              {mine(s) ? `you · ${roleOf(pos, done && s === duel.winner, true, done)}` : roleOf(pos, done && s === duel.winner, false, done)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
