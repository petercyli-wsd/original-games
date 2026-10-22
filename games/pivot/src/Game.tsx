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
import { useRef, useState } from 'react';
import Field from './Board';
import {
  COMMITTEES,
  COMMITTEE_IDS,
  RTP,
  cashValue,
  coalitionSum,
  columns,
  newRound,
  nextLoss,
  plan,
  prizeFor,
  shapley,
  tipZone,
  voterName,
  volatilityOf,
  winChance,
  zoneText,
  type CommitteeId,
  type Ending,
  type Round,
} from './math';

type Phase = 'idle' | 'joining' | 'checkpoint' | 'over';

const ACCENT = '#ffb703';

function title(r: Round, ending: Ending): string {
  const you = voterName(r.backed);
  const last = voterName(r.order[r.order.length - 1] ?? 0);
  switch (ending) {
    case 'tipped':
      return `Pivot! ${you} tipped it`;
    case 'early':
      return `${you} joined too early`;
    case 'beaten':
      return `${last} tipped it first`;
    case 'reach':
      return 'Out of reach';
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

  const [committee, setCommittee] = useState<CommitteeId>('council');
  const [backed, setBacked] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [stake, setStake] = useState(0);
  const [paid, setPaid] = useState(0);
  // The state the columns describe (the one before the join in flight), and who is joining.
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
    resolved.current = last.status === 'won' ? prizeFor(r.committee, r.backed) : last.status === 'lost' ? 0 : cashValue(last);
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
    const r = newRound(committee, backed);
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

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  const pickCommittee = (c: CommitteeId) =>
    change(() => {
      setCommittee(c);
      setBacked((b) => Math.min(b, COMMITTEES[c].weights.length - 1));
    });

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? void advance(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const shown = round ?? newRound(committee, backed);
  const cid = shown.committee;
  const { weights, quota } = COMMITTEES[cid];
  const you = `${voterName(shown.backed)}·${weights[shown.backed]}`;
  const prize = prizeFor(cid, shown.backed);
  const phi = shapley(cid, shown.backed);
  const colState = before ?? (shown.status === 'live' ? shown : null);
  const cols = colState ? columns(colState) : [];
  const chanceNow = colState ? winChance(colState) : 0;
  const p = round && round.status === 'live' ? winChance(round) : phi;
  const cash = round ? (phase === 'over' ? paid : cashValue(round)) : RTP;
  const s = coalitionSum(cid, shown.order);
  const zone = tipZone(cid, shown.backed);
  const loss = phase === 'checkpoint' && round ? nextLoss(columns(round)) : 0;
  const ending = phase === 'over' ? shown.ending : null;

  const setPhi = shapley(committee, backed);
  const vol = volatilityOf(committee, backed);

  let status = `Ready · ${COMMITTEES[cid].name}, quota ${quota}`;
  if (phase === 'joining' && pick !== null) status = `${voterName(pick)} is joining…`;
  if (phase === 'checkpoint') status = `Checkpoint · total ${s} of ${quota}`;
  if (phase === 'over' && ending) status = title(shown, ending);
  const tone = phase === 'over' ? (paid > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Pivot"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={`quota ${COMMITTEES[committee].quota} of ${COMMITTEES[committee].weights.reduce((a, b) => a + b, 0)}`}>Committee</Label>
          <Chips
            label="Committee"
            options={COMMITTEE_IDS.map((c) => ({ value: c, label: COMMITTEES[c].name, title: `weights ${COMMITTEES[c].weights.join(', ')}` }))}
            value={committee}
            disabled={live}
            onChange={pickCommittee}
          />

          <Label hint={<VolBadge level={vol} />}>Back a voter (letter·weight)</Label>
          <Chips
            label="Back a voter"
            wrap
            options={COMMITTEES[committee].weights.map((w, i) => ({ value: i, label: `${voterName(i)}·${w}` }))}
            value={backed}
            disabled={live}
            onChange={(v) => change(() => setBacked(v))}
          />
          <dl className="og-stats">
            <dt>Chance to be the pivot</dt>
            <dd>{fmtChance(setPhi)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / setPhi)}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && void advance(round)}>
                Next voter · {fmtChance(1 - loss)} keep you in
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
            label: `Chance ${voterName(shown.backed)} tips it`,
            value: phase === 'over' ? (paid > 0 && shown.ending === 'tipped' ? '100%' : shown.ending === 'cashed' ? '—' : '0%') : fmtChance(p),
            sub: live ? `total ${s} of ${quota}` : phase === 'over' ? 'round over' : 'Shapley–Shubik index',
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount((round ? stake : bet.value) * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: `if ${you} is the pivot`, tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          committee={cid}
          backed={shown.backed}
          order={shown.order}
          cols={cols}
          chance={chanceNow || (phase === 'idle' ? phi : 0)}
          pick={pick}
          ending={ending}
          live={live}
          onPick={live ? undefined : (v) => change(() => setBacked(v))}
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

      {live ? (
        <ChanceBar
          p={p}
          label={`Chance ${you} is the pivot`}
          note="The same as the green share of the columns: each is one voter who may join next, filled to your chance if it does."
        />
      ) : (
        <Caption>
          Voters join in a random order; the one whose weight takes the total to {quota} is the pivot. {you} is the pivot in {fmtChance(phi)} of orders
          (its Shapley–Shubik index), when it joins at a total of {zoneText(zone)}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Pivot" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A committee of weighted voters joins a coalition one at a time, in a random order. The voter whose weight first takes the coalition's total to
              the quota is the pivot. Back the voter you think will be the pivot.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a committee and the voter to back (on the chips or by clicking its column), then bet.</li>
              <li>Voters join one at a time. After each join you can cash out, or let the next voter join (Space).</li>
              <li>
                You win the prize when your voter joins and tips the total to the quota. You lose if it joins too early (the total stays short), if another
                voter reaches the quota first, or if too little weight is left for your voter ever to tip it.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              On the coalition bar, the <b style={{ color: 'var(--green)' }}>green tip zone</b> is the set of totals at which your voter's joining crosses the
              quota line; the dashed block shows where it would land right now.
            </p>
            <p>
              Below, each column is a voter who might join next. All are equally likely, and each column is filled to your chance if that voter joins next
              (a <b style={{ color: 'var(--red)' }}>✕</b> means the round would end against you). So the filled share of the columns is exactly your chance
              now, marked by the dashed line.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The chance that a voter is the pivot of a random order is its <b>Shapley–Shubik power index</b> φ. Power is not proportional to weight: in the
              Council (weights 5, 4, 3, 2, 1, quota 9) the indices are 11/30, 17/60, 1/5, 7/60 and 1/30.
            </p>
            <p>
              Mid-round, with the coalition at total s and m voters still out, the voters ahead of yours are a uniformly random number k of the others,
              chosen uniformly. Your voter tips it when q − w ≤ s + (their weight) ≤ q − 1, so P = Σ<sub>k</sub> N<sub>k</sub>·k!(m−1−k)!/m!, where N
              <sub>k</sub> counts k-sets of the others whose weight lands in that gap (an exact subset-sum count).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Backing a voter with index φ pays a prize of {(RTP * 100).toFixed(0)}% / φ. The cash-out is always prize × your exact chance from here. Every
              voter is equally likely to join next, so that value is the average of the values after each possible join: a fair bet at every step. The round
              is worth {(RTP * 100).toFixed(0)}% of your stake whichever voter you back and whenever you cash out. If your voter becomes certain to tip the
              quota, the remaining joins play out by themselves.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
