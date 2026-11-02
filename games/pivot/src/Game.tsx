import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  Caption,
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
import { useRef, useState } from 'react';
import Field from './Board';
import {
  LINE,
  RTP,
  SIZES,
  blockName,
  cashValue,
  columns,
  newRound,
  nextLoss,
  plan,
  prizeFor,
  startChance,
  totalOf,
  volatilityOf,
  winChance,
  type Ending,
  type Round,
} from './math';

type Phase = 'idle' | 'joining' | 'checkpoint' | 'over';

const ACCENT = '#ffb703';

function title(r: Round, ending: Ending): string {
  const you = blockName(r.backed);
  switch (ending) {
    case 'won':
      return `${you} crossed the line!`;
    case 'early':
      return `${you} landed short: too early`;
    case 'passed':
      return `${blockName(r.order[r.order.length - 1])} crossed the line first`;
    case 'cashed':
      return 'Cashed out';
  }
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [backed, setBacked] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [stake, setStake] = useState(0);
  const [paid, setPaid] = useState(0);
  // The state the waiting blocks describe (the one before the join in flight), and who is joining.
  const [before, setBefore] = useState<Round | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // An action's joins are drawn the moment it starts, so leaving mid-animation
  // settles at the real result, never at the pre-join value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'joining' ? resolved.current : round && round.status === 'live' ? cashValue(round) : 0));

  const joinMs = turbo.turbo ? 160 : 650;
  const live = phase === 'joining' || phase === 'checkpoint';

  function finish(r: Round, ending: Ending, mult: number) {
    ticket.settle(mult);
    pushHistory(mult);
    setRound({ ...r, ending });
    setPaid(mult);
    setPhase('over');
  }

  async function advance(r: Round) {
    const joins = plan(r, rng);
    const last = joins[joins.length - 1];
    resolved.current = last.status === 'won' ? prizeFor(r.backed) : last.status === 'lost' ? 0 : cashValue(last);
    setPhase('joining');
    let prev = r;
    for (const next of joins) {
      setBefore(prev);
      setPick(next.order[next.order.length - 1]);
      if (!(await timers.wait(joinMs))) return;
      setRound(next);
      prev = next;
      if (next !== last && !(await timers.wait(joinMs / 2))) return;
    }
    if (last.status !== 'live') return finish(last, last.ending!, resolved.current);
    setBefore(null);
    setPick(null);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cashValue(last), winChance: winChance(last) });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r = newRound(backed);
    setStake(bet.value);
    setRound(r);
    setPaid(0);
    void advance(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    setBefore(null);
    setPick(null);
    finish(round, 'cashed', cashValue(round));
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setBefore(null);
    setPick(null);
    setPhase('idle');
  }

  // Changing the block after a round clears the finished board to a preview.
  const pickBlock = (b: number) => {
    if (live) return;
    setBacked(b);
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? void advance(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the chosen block.
  const shown = round ?? newRound(backed);
  const you = blockName(shown.backed);
  const prize = prizeFor(shown.backed);
  const colState = before ?? (shown.status === 'live' ? shown : null);
  const cols = round && colState ? columns(colState) : [];
  const p = round && round.status === 'live' ? winChance(round) : startChance(shown.backed);
  const cash = round ? (phase === 'over' ? paid : cashValue(round)) : RTP;
  const s = totalOf(shown.order);
  const loss = phase === 'checkpoint' && round ? nextLoss(columns(round)) : 0;
  const ending = phase === 'over' ? shown.ending : null;

  let status = 'Ready · pick a block';
  if (phase === 'joining' && pick !== null) status = `${blockName(pick)} is joining…`;
  if (phase === 'checkpoint') status = `Stack ${s} · ${you} still to join`;
  if (phase === 'over' && ending) status = title(shown, ending);
  const tone = phase === 'over' ? (paid > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Pivot"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(backed)} />}>Your block</Label>
          <Chips
            label="Your block"
            wrap
            options={SIZES.map((w, i) => ({ value: i, label: `${blockName(i)} +${w}`, title: `${fmtChance(startChance(i))} to win, pays ${fmtMult(prizeFor(i))}` }))}
            value={backed}
            disabled={live}
            onChange={pickBlock}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(startChance(backed))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(backed))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && void advance(round)}>
                Next block · {fmtChance(1 - loss)} safe
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'joining' ? 'Joining…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: `Chance ${you} wins`,
            value: phase === 'over' ? (shown.ending === 'won' ? '100%' : shown.ending === 'cashed' ? '—' : '0%') : fmtChance(p),
            sub: shown.ending === 'cashed' ? 'round over' : (
              <span className="pv-meter" title="The green length is the chance">
                <i style={{ width: `${(phase === 'over' ? (shown.ending === 'won' ? 1 : 0) : p) * 100}%` }} />
              </span>
            ),
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount((round ? stake : bet.value) * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: `if ${you} crosses the line`, tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          backed={shown.backed}
          order={shown.order}
          cols={cols}
          pick={pick}
          ending={ending}
          picking={!round}
          onPick={live ? undefined : pickBlock}
        />
        {phase === 'over' && ending && (
          <RoundOver
            key={history[0]?.id}
            title={title(shown, ending)}
            multiplier={paid}
            stake={stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="bottom"
          />
        )}
      </Board>

      <Caption>
        Blocks stack up in a random order. You win if {you} is the block that takes the stack over the line at {LINE}. If {you} lands with the stack
        still short of the line, or another block crosses first, you lose.
      </Caption>

      {infoOpen && (
        <InfoModal title="Pivot" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Six blocks of sizes 7, 5, 4, 3, 2 and 1 stack up one at a time, in a random order. Back one block. You win if your block is the one whose top
              end takes the stack over the line at {LINE}.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick your block (on the chips or by clicking it on the board). Under each block is its chance to win and what it pays. Then bet.</li>
              <li>Blocks join the stack one at a time. After each join you can cash out, or let the next block join (Space).</li>
              <li>
                You lose if your block joins <b style={{ color: 'var(--red)' }}>too early</b> (its top lands short of the line), or if another block{' '}
                <b style={{ color: 'var(--red)' }}>crosses the line first</b>. Once the result is no longer in doubt, the remaining blocks join by themselves.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The blocks still waiting stand on top of the stack at full size, so you can see where each would reach if it joined next. All are equally
              likely to be next. Yours is <b style={{ color: 'var(--green)' }}>green</b> when it would cross the line and{' '}
              <b style={{ color: 'var(--red)' }}>red</b> when it would land short. Another block is <b style={{ color: 'var(--red)' }}>red ✕</b> when its
              joining next would leave you no way to win: it crosses the line first, or (a dead end) no order of the rest lets yours cross. The count of
              safe blocks is the button's "safe" share.
            </p>
            <p>The headline shows your chance to win from here, with a bar whose green length is that chance.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The chance that a block is the one to cross the line in a random order is its <b>Shapley–Shubik power index</b> φ. It is not proportional to
              size: here the six blocks have 27/60, 12/60, 9/60, 7/60, 4/60 and 1/60.
            </p>
            <p>
              Mid-round, with the stack at s and m blocks still out, the blocks ahead of yours are a uniformly random number k of the others, chosen
              uniformly. Your block (size w) crosses the line when {LINE} − w ≤ s + (their sizes) ≤ {LINE - 1}, so P = Σ<sub>k</sub> N<sub>k</sub>
              ·k!(m−1−k)!/m!, where N<sub>k</sub> counts k-sets of the others whose sizes land in that gap (an exact subset-sum count).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Backing a block with chance φ pays a prize of {(RTP * 100).toFixed(0)}% / φ. The cash-out is always prize × your exact chance from here. Every
              block is equally likely to join next, so that value is the average of the values after each possible join: a fair bet at every step. The round
              is worth {(RTP * 100).toFixed(0)}% of your stake whichever block you back and whenever you cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
