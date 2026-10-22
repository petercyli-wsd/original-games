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
import { useEffect, useMemo, useRef, useState } from 'react';
import Ring, { type Move } from './Board';
import {
  BOX_COUNTS,
  RTP,
  SHARES,
  SHARE_GLYPH,
  cashValue,
  closeChance,
  fitChance,
  follow,
  lastChance,
  limitFor,
  newBoard,
  nextBox,
  open,
  openedInLoop,
  pickFor,
  prizeFor,
  remaining,
  volatilityOf,
  winChance,
  type Board as State,
  type BoxCount,
  type Share,
} from './math';

const ACCENT = '#2ec4b6';

type Phase = 'idle' | 'opening' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'won';
type Mode = 'box' | 'loop';

interface Round {
  n: BoxCount;
  limit: number;
  stake: number;
  /** The hidden permutation, drawn when the bet is placed: perm[b] is the box b points at. */
  perm: number[];
  board: State;
  cash: number;
  outcome: Outcome | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Loop too long', cashed: 'Cashed out', won: 'Every loop fits' };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [n, setN] = useState<BoxCount>(20);
  const [share, setShare] = useState<Share>('1/2');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [landed, setLanded] = useState<{ box: number; key: number } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const moveKey = useRef(0);

  // A step's result is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-step value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'opening' ? resolved.current : round ? cashValue(round.board) : 0));

  const live = phase === 'opening' || phase === 'checkpoint';
  const speed = turbo.turbo ? 0.25 : 1;
  const limitNow = limitFor(n, share);

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMove(null);
    setPhase('over');
  }

  function settle(r: Round) {
    const b = r.board;
    if (b.status === 'bust') return finish(r, 'bust', 0);
    if (b.status === 'won') return finish(r, 'won', cashValue(b));
    setRound(r);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cashValue(b), winChance: winChance(b) });
  }

  /** Draws the arrows of seq one by one, then settles. */
  function animate(r: Round, seq: State[], i: number, mode: Mode) {
    const prev = i === 0 ? r.board : seq[i - 1];
    const next = seq[i];
    const from = nextBox(prev);
    const to = next.inside[from];
    const kind = next.status === 'bust' ? 'bust' : next.chain.length === 0 ? 'close' : 'extend';
    // A single box takes its time; a followed loop speeds up as it goes.
    const draw = Math.round(speed * (mode === 'box' ? 460 : Math.max(130, 320 * 0.86 ** i)));
    const pause = Math.round(speed * (mode === 'box' || i + 1 === seq.length ? 160 : 50));
    const key = ++moveKey.current;
    setMove({ from, to, kind, ms: draw, key });
    timers.after(draw, () => {
      const cur = { ...r, board: next };
      setRound(cur);
      setMove(null);
      setLanded({ box: to, key });
      timers.after(pause, () => (i + 1 < seq.length ? animate(cur, seq, i + 1, mode) : settle(cur)));
    });
  }

  function advance(r: Round, mode: Mode) {
    if (r.board.status !== 'live') return;
    const pick = (b: State) => pickFor(b, r.perm);
    const seq = mode === 'box' ? [open(r.board, pick(r.board))] : follow(r.board, pick);
    resolved.current = cashValue(seq[seq.length - 1]);
    setPhase('opening');
    animate(r, seq, 0, mode);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const perm = rng.shuffle([...Array(n).keys()]);
    const r: Round = { n, limit: limitNow, stake: bet.value, perm, board: newBoard(n, limitNow), cash: RTP, outcome: null };
    setRound(r);
    setLanded(null);
    advance(r, 'box');
  }

  function step(mode: Mode) {
    if (phase !== 'checkpoint' || !round) return;
    advance(round, mode);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', cashValue(round.board));
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setMove(null);
    setLanded(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? step('box') : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // F follows the loop.
  const followRef = useRef(() => step('loop'));
  followRef.current = () => step('loop');
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') return;
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) followRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // What the board shows: the live or finished round, else a preview of the settings.
  const preview = useMemo(() => newBoard(n, limitNow), [n, limitNow]);
  const board = round?.board ?? preview;
  const N = board.n;
  const L = board.limit;
  const p = winChance(board);
  const prize = prizeFor(N, L);
  const cash = phase === 'over' && round ? round.cash : cashValue(board);
  const stake = round?.stake ?? bet.value;
  const R = remaining(board);
  const j = openedInLoop(board);
  const inLoop = board.chain.length > 0;
  const m = board.status === 'live' ? Math.round(1 / closeChance(board)) : 0;
  const last = board.status === 'live' && lastChance(board);
  const vol = volatilityOf(n, limitNow);
  const startChance = fitChance(n, limitNow);
  const loopNo = board.loops.length + (inLoop ? 1 : 0);

  let status = `Ready · ${n} boxes · every loop ≤ ${limitNow}`;
  if (phase === 'opening') status = inLoop ? `Following loop ${loopNo} · ${j + 1} boxes` : `Opening box ${nextBox(board) + 1}`;
  if (phase === 'checkpoint')
    status = last ? `Last chance · loop ${loopNo} must close now` : inLoop ? `Loop ${loopNo} · ${j + 1} boxes so far` : `Loop ${board.loops.length} closed · ${R} boxes left`;
  if (phase === 'over' && round?.outcome) {
    const loops = board.loops.length;
    status =
      round.outcome === 'bust'
        ? `${OUTCOME_TITLE.bust} · ${j + 1} boxes in loop ${loopNo}`
        : round.outcome === 'cashed' && inLoop
          ? `${OUTCOME_TITLE.cashed} · loop ${loopNo} at ${j + 1} boxes`
          : `${OUTCOME_TITLE[round.outcome]} · ${loops} loop${loops === 1 ? '' : 's'} closed`;
  }
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const busy = phase === 'opening';

  return (
    <GameLayout
      name="Loops"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint="more boxes, longer round">Boxes</Label>
          <Chips
            label="Number of boxes"
            options={BOX_COUNTS.map((v) => ({ value: v, label: v }))}
            value={n}
            disabled={live}
            onChange={(v) => change(() => setN(v))}
          />

          <Label hint={<VolBadge level={vol} />}>Loop limit</Label>
          <Chips
            label="Loop limit, as a share of the boxes"
            options={SHARES.map((s) => ({
              value: s,
              label: (
                <>
                  {SHARE_GLYPH[s]}
                  <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.75 }}>{limitFor(n, s)}</span>
                </>
              ),
              title: `Every loop at most ${limitFor(n, s)} boxes (${SHARE_GLYPH[s]} of ${n})`,
            }))}
            value={share}
            disabled={live}
            onChange={(v) => change(() => setShare(v))}
          />
          <dl className="og-stats">
            <dt>Every loop at most</dt>
            <dd>{limitNow} boxes</dd>
            <dt>Chance to win</dt>
            <dd>{fmtChance(startChance)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / startChance)}</dd>
          </dl>

          {live ? (
            <>
              <ActionButton kind="cash" disabled={busy} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              {last ? (
                <ActionButton kind="secondary" disabled={busy} onClick={() => step('box')}>
                  Open last box · 1 in {m} closes
                </ActionButton>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <ActionButton kind="secondary" disabled={busy} onClick={() => step('box')} title="Open the next box (Space)">
                    Open box
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={busy} onClick={() => step('loop')} title="Follow the arrows until the loop closes or reaches its last chance (F)">
                    Follow loop
                  </ActionButton>
                </div>
              )}
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
          {
            label: 'Win chance',
            value: fmtChance(p),
            sub: live && board.status === 'live' ? (last ? `last chance: 1 in ${m}` : `next box closes 1 in ${m}`) : `${N} shuffled boxes`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after the first box', tone: 'cash' },
          { label: 'Full prize', value: fmtMult(prize), sub: `all loops ≤ ${L}`, tone: 'prize' },
        ]}
      />

      <Board>
        <Ring
          board={board}
          reveal={phase === 'over' && round ? round.perm : null}
          move={move}
          landed={landed}
          showTargets={phase === 'checkpoint'}
          idle={!round}
          winChance={p}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={OUTCOME_TITLE[round.outcome]}
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
          p={p}
          label="Win chance"
          note={
            last
              ? `Last chance: only the green home box closes loop ${loopNo}. The red boxes make it too long.`
              : inLoop
                ? `The next arrow lands on one of the ${m} outlined boxes, all equally likely. Only the green home box closes the loop.`
                : `The next loop starts at the lowest box not yet seen. Its length is equally likely to be anything from 1 to ${R}.`
          }
        />
      ) : (
        <Caption>
          Follow the arrows box to box; every loop must close within {L} boxes. {N} shuffled boxes manage that {fmtChance(fitChance(N, L))} of the time
          {L * 2 === N ? ' (the 100 prisoners rule)' : ''}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Loops" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Boxes on a ring hide a shuffle: each box points at exactly one box, and every box is pointed at exactly once. Following the arrows always
              comes back to where it started, so the boxes split into loops. You win if every loop has at most the limit's number of boxes.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many boxes (round length) and the loop limit (volatility), then bet. The first box opens straight away.</li>
              <li>
                <b>Open box</b> (Space) reveals one arrow. <b>Follow loop</b> (F) keeps going until the loop closes, or until its last chance: the box
                whose arrow must point home.
              </li>
              <li>Cash out (C) at any checkpoint. A loop that grows past the limit loses the round. Once the boxes left are no more than the limit, they can't break it and the round pays the full prize.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              On the ring, the <b style={{ color: 'var(--accent)' }}>teal</b> boxes are the loop you're following. Its next arrow lands on one of the
              outlined boxes, all equally likely, and only the <b style={{ color: 'var(--green)' }}>green home box</b> closes the loop. On a last chance the
              others turn <b style={{ color: 'var(--red)' }}>red</b>: landing there makes the loop too long. Closed loops are green.
            </p>
            <p>
              The ruler below has one slot per length the loop can still end at, all equally likely. Slots past the white limit line are{' '}
              <b style={{ color: 'var(--red)' }}>red</b>. A green slot is filled up to the chance that the boxes left after it also fit, so the green share
              of the lit slots is exactly your win chance. Closed loops stack in from the right and shrink the red zone.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              This is the cycle structure of a random permutation, the maths behind the 100 prisoners puzzle. With R boxes left and j boxes of a loop opened,
              the next arrow points home with chance 1/(R−j), so the loop's final length is uniform on j+1…R. If fit(r) is the chance r boxes have no
              loop longer than L, then fit(r) = (1/r)·Σ<sub>k≤min(L,r)</sub> fit(r−k), and your live chance is (1/(R−j))·Σ<sub>k=j+1…min(L,R)</sub> fit(R−k).
            </p>
            <p>When L is at least half the boxes, at most one loop can be too long, so the chance is 1 − Σ<sub>k&gt;L</sub> 1/k, which tends to 1 − ln 2 ≈ 30.7% at L = n/2.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A full win pays {(RTP * 100).toFixed(0)}% ÷ the starting chance. Cashing out pays the prize × your live win chance, which is a martingale: on
              average no box, no loop and no stopping rule changes it. Every way of playing returns exactly {(RTP * 100).toFixed(0)}% of your stake. The
              shuffle is drawn when you bet and shown in full when the round ends.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
