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
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Field, { type Shot } from './Board';
import {
  CASH_AT,
  EMPTY,
  MATCHUPS,
  MATCHUP_IDS,
  MAX_PRIZE,
  PICKS,
  PICK_NAME,
  RTP,
  TEAM_NAME,
  addKick,
  autoRound,
  canSwitch,
  chanceOf,
  forecast,
  goalsOf,
  isGoal,
  kickChance,
  kicker,
  odds as oddsOf,
  prizeFor,
  settled,
  suddenDeath,
  switchPrize,
  volatilityOf,
  winner,
  type CashAt,
  type Kicks,
  type MatchupId,
  type Pick,
} from './math';

type Phase = 'idle' | 'kicking' | 'checkpoint' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  matchup: MatchupId;
  pick: Pick;
  prize: number;
  stake: number;
  s: Kicks;
  cash: number;
  outcome: Outcome | null;
}

interface AutoView {
  matchup: MatchupId;
  pick: Pick;
  s: Kicks;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Five penalties each, then sudden death; back a team.';

function overTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  const w = winner(r.s);
  if (r.pick === 'SD') return r.outcome === 'win' ? 'Level: sudden death' : `${TEAM_NAME[w ?? 'A']} win it in five`;
  return `${TEAM_NAME[w ?? 'A']} win the shootout`;
}

/** Whether the next kick settles `pick` whichever way it goes. */
function decisiveKick(s: Kicks, m: (typeof MATCHUPS)[MatchupId], pick: Pick) {
  const f = forecast(s, m, pick);
  return [f.ifGoal, f.ifMiss].some((v) => v <= 1e-12 || v >= 1 - 1e-12);
}

const score = (s: Kicks) => `${goalsOf(s.a)}–${goalsOf(s.b)}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [matchup, setMatchup] = useState<MatchupId>('even');
  const [pick, setPick] = useState<Pick>('A');
  const [cashAt, setCashAt] = useState<CashAt>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const [autoView, setAutoView] = useState<AutoView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);

  // A kick is decided the moment it is taken, so leaving mid-flight settles
  // at its real result, never at the pre-kick value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'kicking' || autoBusy ? resolved.current : round && !round.outcome ? round.cash : 0));

  const kickMs = turbo.turbo ? 200 : 760;
  const autoKickMs = turbo.turbo ? 70 : 240;
  const live = phase === 'kicking' || phase === 'checkpoint';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function kick(r: Round) {
    const m = MATCHUPS[r.matchup];
    const team = kicker(r.s);
    const u = rng.next();
    const goal = isGoal(u, kickChance(m, team));
    const s = addKick(r.s, goal);
    const res = settled(s, r.pick);
    const cash = res ? (res === 'win' ? r.prize : 0) : r.prize * chanceOf(s, m, r.pick);
    resolved.current = cash;
    const id = ++seq.current;
    const decisive = decisiveKick(r.s, m, r.pick);
    setShot({ id, team, u, goal, ms: kickMs * 0.7, landed: false, decisive });
    setPhase('kicking');
    timers.after(kickMs * 0.7, () => setShot({ id, team, u, goal, ms: kickMs * 0.7, landed: true, decisive }));
    timers.after(kickMs, () => {
      const next = { ...r, s, cash };
      if (res) return finish(next, res, cash);
      setRound(next);
      setPhase('checkpoint');
      track({
        type: 'checkpoint',
        multiplier: cash,
        winChance: chanceOf(s, m, r.pick),
      });
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    const r: Round = {
      matchup,
      pick,
      prize: prizeFor(MATCHUPS[matchup], pick),
      stake: bet.value,
      s: EMPTY,
      cash: RTP,
      outcome: null,
    };
    setRound(r);
    kick(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setShot(null);
    setAutoView(null);
    setLast(null);
    setPhase('idle');
  }

  /** Idle: back this outcome. At a checkpoint: switch to it, keeping the cash-out. */
  function choose(p: Pick) {
    if (phase === 'checkpoint' && round) {
      const m = MATCHUPS[round.matchup];
      if (!canSwitch(round.cash, round.s, m, round.pick, p)) return;
      setRound({
        ...round,
        pick: p,
        prize: switchPrize(round.cash, round.s, m, p),
      });
      setPick(p);
      return;
    }
    if (live || autoBusy || auto.running) return;
    change(() => setPick(p));
  }

  // Changing a setting after a round clears the finished board to a preview.
  function change(apply: () => void) {
    apply();
    if (phase === 'over' || autoView || last) clear();
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const id = matchup;
    const p = pick;
    const m = MATCHUPS[id];
    if (!(await ticket.place(stake))) return null;
    const us: number[] = [];
    const res = autoRound(m, p, cashAt, () => {
      const u = rng.next();
      us.push(u);
      return u;
    });
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    let prev: Kicks = EMPTY;
    setAutoView({ matchup: id, pick: p, s: EMPTY });
    for (let i = 0; i < res.states.length; i++) {
      const team = kicker(prev);
      const sid = ++seq.current;
      const goal = isGoal(us[i], kickChance(m, team));
      setShot({
        id: sid,
        team,
        u: us[i],
        goal,
        ms: autoKickMs * 0.7,
        landed: false,
        decisive: decisiveKick(prev, m, p),
      });
      if (!(await timers.wait(autoKickMs * 0.7))) break;
      setShot({
        id: sid,
        team,
        u: us[i],
        goal,
        ms: autoKickMs * 0.7,
        landed: true,
      });
      setAutoView({ matchup: id, pick: p, s: res.states[i] });
      prev = res.states[i];
      if (!(await timers.wait(autoKickMs * 0.45))) break;
    }
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setLast({ id: ++seq.current, multiplier: res.multiplier, stake });
    setAutoBusy(false);
    return res.multiplier;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setAutoView(null);
    setShot(null);
    setLast(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) kick(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shownId = isAuto ? (autoView?.matchup ?? matchup) : (round?.matchup ?? matchup);
  const m = MATCHUPS[shownId];
  const shownPick = isAuto ? (autoView?.pick ?? pick) : (round?.pick ?? pick);
  const s = isAuto ? (autoView?.s ?? EMPTY) : (round?.s ?? EMPTY);
  const o = oddsOf(s, m);
  const chance = o[shownPick];
  const prize = round?.prize ?? prizeFor(MATCHUPS[matchup], pick);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const over = isAuto ? !!last && !autoBusy : phase === 'over';
  const done = settled(s, shownPick) !== null || over;
  const next = done || (phase === 'kicking' && !isAuto) ? null : forecast(s, m, shownPick);
  // During a kick, the board keeps the kicker's goal; otherwise it shows the next kicker's.
  const goalFor = shot && (phase === 'kicking' || autoBusy) ? shot.team : next ? next.team : (shot?.team ?? 'A');
  const vol = volatilityOf(MATCHUPS[matchup], pick);
  const openChance = chanceOf(EMPTY, MATCHUPS[matchup], pick);

  let status = `Ready · ${m.label}: Teal ${fmtChance(m.pA)}, Orange ${fmtChance(m.pB)} per kick`;
  let tone: StatusTone = 'idle';
  const kicksTaken = s.a.length + s.b.length;
  if (isAuto) {
    if (autoBusy || auto.running) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''} · Teal ${score(s)} Orange`;
      tone = 'live';
    } else if (last) {
      status = `${last.multiplier > 0 ? 'Won' : 'Lost'} ${fmtMult(last.multiplier)} · Teal ${score(s)} Orange`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · back ${PICK_NAME[pick]}, ${cashAt === null ? 'play to the end' : `cash out at ${fmtMult(cashAt)}`}`;
  } else if (phase === 'kicking' && shot) {
    status = `${TEAM_NAME[shot.team]} shoots…`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    const decides = !!next && decisiveKick(s, m, shownPick);
    status = `Checkpoint · Teal ${score(s)} Orange · ${decides ? 'next kick decides your bet' : `${kicksTaken} kick${kicksTaken === 1 ? '' : 's'}`}`;
    tone = 'live';
  } else if (phase === 'over' && round) {
    status = `${overTitle(round)} · Teal ${score(s)} Orange`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const pickButtons = (
    <div className="sh-picks" role="radiogroup" aria-label="Outcome to back">
      {PICKS.map((p) => {
        const atCheckpoint = phase === 'checkpoint' && round;
        const pr = atCheckpoint ? chanceOf(round.s, MATCHUPS[round.matchup], p) : chanceOf(EMPTY, MATCHUPS[matchup], p);
        const on = (atCheckpoint ? round.pick : pick) === p;
        const allowed = atCheckpoint ? on || canSwitch(round.cash, round.s, MATCHUPS[round.matchup], round.pick, p) : !locked;
        const pays = atCheckpoint ? (on ? round.prize : pr > 0 ? round.cash / pr : 0) : prizeFor(MATCHUPS[matchup], p);
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            className={`sh-pick ${p.toLowerCase()}` + (on ? ' on' : '')}
            disabled={!allowed}
            title={atCheckpoint && !on ? (pays > MAX_PRIZE ? 'over the max prize' : `switch: keeps your cash-out, prize becomes ${fmtMult(pays)}`) : undefined}
            onClick={() => choose(p)}
          >
            <span className="n">{p === 'SD' ? 'Sudden death' : PICK_NAME[p]}</span>
            <b>{fmtChance(pr)}</b>
            <small>{pr > 0 && pr < 1 ? fmtMult(pays) : pr >= 1 ? 'certain' : '—'}</small>
          </button>
        );
      })}
    </div>
  );

  return (
    <GameLayout
      name="Shootout"
      accent="#06d6a0"
      className="sh-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Matchup</Label>
          <Chips
            label="Matchup"
            options={MATCHUP_IDS.map((id) => ({
              value: id,
              label: MATCHUPS[id].label,
              title: `Teal ${fmtChance(MATCHUPS[id].pA)} · Orange ${fmtChance(MATCHUPS[id].pB)} per kick`,
            }))}
            value={matchup}
            disabled={locked}
            onChange={(v) => change(() => setMatchup(v))}
          />
          <div className="sh-rates">
            <span className="a">
              <i /> Teal scores {fmtChance(MATCHUPS[matchup].pA)}
            </span>
            <span className="b">
              <i /> Orange {fmtChance(MATCHUPS[matchup].pB)}
            </span>
          </div>

          <Label hint={phase === 'checkpoint' ? 'switch keeps your cash-out' : 'chance · prize'}>{phase === 'checkpoint' ? 'Backing · switch' : 'Back'}</Label>
          {pickButtons}

          {!isAuto ? (
            <>
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(live ? chance : openChance)}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(live ? prize : prizeFor(MATCHUPS[matchup], pick))}</dd>
              </dl>
              {phase === 'checkpoint' ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => round && kick(round)}>
                    {next ? `Next kick · ${TEAM_NAME[next.team]} ${fmtChance(next.p)}` : 'Next kick'}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'kicking' ? 'Shooting…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={cashAt === null ? 'until your bet settles' : `if it gets to ${fmtMult(cashAt)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={CASH_AT.map((v) => ({
                  value: v ?? 0,
                  label: v === null ? 'End' : `${v}×`,
                }))}
                value={cashAt ?? 0}
                disabled={autoBusy || auto.running}
                onChange={(v) => change(() => setCashAt(v === 0 ? null : (v as CashAt)))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="sh-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          {
            label: `${PICK_NAME[shownPick]}${shownPick === 'SD' ? '' : ' wins'}`,
            value: fmtChance(chance),
            sub: live || isAuto ? 'your chance now' : 'your chance',
            tone: 'chance',
          },
          isAuto
            ? {
                label: 'Auto cash-out',
                value: cashAt === null ? 'End' : fmtMult(cashAt),
                sub: cashAt === null ? 'plays every shootout out' : 'banks once it gets there',
                tone: 'cash',
              }
            : {
                label: 'Cash out now',
                value: phase === 'checkpoint' || phase === 'over' ? fmtMult(cash) : '—',
                sub: phase === 'checkpoint' || phase === 'over' ? formatAmount(stake * cash, 2) : 'after the first kick',
                tone: 'cash',
              },
          {
            label: 'Prize',
            value: fmtMult(isAuto ? prizeFor(m, shownPick) : prize),
            sub: `pays ${formatAmount((isAuto ? bet.value : stake) * (isAuto ? prizeFor(m, shownPick) : prize), 2)}`,
            tone: 'prize',
          },
        ]}
      />

      <Board className="sh-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          s={s}
          pA={m.pA}
          pB={m.pB}
          pick={shownPick}
          odds={o}
          next={next}
          shot={!isAuto && phase === 'checkpoint' ? null : shot}
          live={live || autoBusy}
          goalFor={goalFor}
        />
        {!isAuto && phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={overTitle(round)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="center"
          />
        )}
      </Board>

      {!isAuto && live ? (
        <ChanceBar
          p={chance}
          label={`Your chance: ${PICK_NAME[shownPick]}${shownPick === 'SD' ? '' : ' wins'}`}
          note="Space takes the next kick, C cashes out. Cash-out = prize × your chance, so every kick is a fair bet."
        />
      ) : (
        <Caption>
          <b className="sh-rule">{RULE}</b>{' '}
          {isAuto
            ? `Auto plays whole shootouts${cashAt === null ? ' to the end' : `, cashing out at ${fmtMult(cashAt)}`}.`
            : `The green corners of the goal are the chance to score; the bar is every outcome's exact chance. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Shootout" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              {RULE} Teal and Orange take five penalties each, in turn, Teal first. Whoever has more goals wins; if it is level, sudden death pairs follow until
              one side scores and the other misses. Back Teal, Orange, or the shootout going to sudden death.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose a matchup (how often each side scores) and what to back, then press Bet. The first kick is taken straight away.</li>
              <li>
                After every kick you can cash out (C), take the next kick (Space), or switch what you back. A switch keeps your cash-out and re-prices the
                prize.
              </li>
              <li>Your bet settles as soon as its outcome is certain: when a side can no longer be caught, or when it is level after five each.</li>
              <li>
                Auto plays whole shootouts with the bet and stop rules you set, cashing out when the cash-out reaches your target (or playing to the end).
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The keeper covers exactly the miss chance of the goal mouth; the shot lands at a uniformly random point, so the green corners are the kicker's
              chance to score. Beside the goal you see what each result of the next kick would do to your odds. The bar at the bottom splits 100% into Teal and
              Orange; its hatched middle is the share decided in sudden death, which is also the chance it goes there.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              In regulation the final goal difference is today's difference plus Bin(Teal kicks left, p<sub>T</sub>) − Bin(Orange kicks left, p<sub>O</sub>), a
              convolution of two binomials, computed exactly. A level score goes to sudden death, which Teal wins with the geometric-tail chance p<sub>T</sub>(1
              − p<sub>O</sub>) / (p
              <sub>T</sub>(1 − p<sub>O</sub>) + p<sub>O</sub>(1 − p<sub>T</sub>
              )) = {fmtChance(suddenDeath(m).A)} in this matchup.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Backing an outcome with chance P pays {(RTP * 100).toFixed(0)}% ÷ P. The cash-out is the prize × your chance now, a martingale, so cashing out at
              any point, switching, or playing to the end all return exactly {(RTP * 100).toFixed(0)}% in the long run. Switches are offered while the new prize
              stays within {fmtMult(MAX_PRIZE)}, so no payout can exceed that.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
