import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
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
  eventMs,
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
import { Duel, Pips, Tree } from './Board';
import { KS, MATCHES, RTP, SEEDS, counts, need, pUpset, pWin, playMatch, prizeFor, sides, startP, status, volatilityOf, type K } from './math';

type Phase = 'idle' | 'playing' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  k: K;
  prize: number;
  res: number[];
  stake: number;
  cash: number;
  outcome: Outcome | null;
}

interface Shown {
  i: number;
  res: number[];
  u: number;
  seq: number;
  ms: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { won: 'You win', lost: 'You lose', cashed: 'Cashed out' };
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<K>(3);
  const [target, setTarget] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [autoRes, setAutoRes] = useState<number[] | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);

  // A match is decided the moment it starts, so leaving mid-match settles at its real result.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'playing' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? round.cash : 0));

  const matchMs = eventMs(turbo.turbo, 1200);
  const autoMs = turbo.turbo ? 45 : 200;
  const live = phase === 'playing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
    busy.current = false;
  }

  function step(r: Round) {
    if (busy.current) return;
    busy.current = true;
    const i = r.res.length;
    const u = rng.next();
    const winner = playMatch(r.res, i, u);
    const res = [...r.res, winner];
    const s = status(res, r.k);
    const cash = r.prize * pWin(res, r.k);
    resolved.current = cash;
    setShown({ i, res: r.res, u, seq: ++seq.current, ms: matchMs });
    setRound({ ...r });
    setPhase('playing');
    timers.after(matchMs, () => {
      const next: Round = { ...r, res, cash };
      if (s === 'won') return finish(next, 'won', r.prize);
      if (s === 'lost') return finish(next, 'lost', 0);
      setRound(next);
      track({ type: 'checkpoint', multiplier: cash, winChance: pWin(res, r.k) });
      setPhase('checkpoint');
      busy.current = false;
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked || busy.current) return;
    busy.current = true;
    if (!(await ticket.place(bet.value))) {
      busy.current = false;
      return;
    }
    timers.clearAll();
    setAutoRes(null);
    setLast(null);
    resolved.current = RTP;
    const r: Round = { k, prize: prizeFor(k), res: [], stake: bet.value, cash: RTP, outcome: null };
    busy.current = false;
    step(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setShown(null);
    setRound(null);
    setAutoRes(null);
    setLast(null);
    setPhase('idle');
  }

  function change(apply: () => void) {
    if (live || autoBusy) return;
    apply();
    if (phase === 'over' || autoRes || last) clear();
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const ak = k;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    const prize = prizeFor(ak);
    const states: number[][] = [];
    let res: number[] = [];
    let mult = 0;
    for (;;) {
      res = [...res, playMatch(res, res.length, rng.next())];
      states.push(res);
      const s = status(res, ak);
      if (s === 'won') {
        mult = prize;
        break;
      }
      if (s === 'lost') break;
      const p = pWin(res, ak);
      if (tgt > 0 && prize * p >= tgt) {
        mult = prize * p;
        break;
      }
    }
    resolved.current = mult;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    for (const s of states) {
      setAutoRes(s);
      if (!(await timers.wait(autoMs))) break;
    }
    ticket.settle(mult);
    pushHistory(mult);
    setLast({ id: ++seq.current, multiplier: mult, stake });
    setAutoBusy(false);
    return mult;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const autoLocked = auto.running || autoBusy;

  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setShown(null);
    setAutoRes(null);
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
        if (phase === 'checkpoint' && round) step(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const vk: K = live || phase === 'over' ? (round?.k ?? k) : k;
  const res: number[] = isAuto ? (autoRes ?? []) : (round?.res ?? []);
  const prize = round && !isAuto ? round.prize : prizeFor(vk);
  const pNow = pWin(res, vk);
  const cash = prize * pNow;
  const { up, fav } = counts(res);
  const stake = round?.stake ?? bet.value;
  const vol = volatilityOf(startP(k));
  const played = res.length;
  const ended = status(res, vk) !== 'live';
  const n = need(res, vk);

  // The match on the bar: the one being played; the last one stays landed; before a bet, the first.
  let duel;
  if (shown && !isAuto && (live || phase === 'over')) {
    const [f, u] = sides(shown.res, shown.i);
    const nextI = phase === 'checkpoint' ? res.length : -1;
    const upNext = nextI >= 0 ? sides(res, nextI) : null;
    duel = (
      <Duel
        fav={f}
        und={u}
        pu={pUpset(shown.res, shown.i)}
        u={shown.u}
        ms={shown.ms}
        seq={shown.seq}
        title={`${phase === 'playing' ? 'Playing' : 'Played'} match ${shown.i + 1} of ${MATCHES}`}
        upNext={upNext ? `Next: seed ${upNext[1] + 1} vs seed ${upNext[0] + 1}` : null}
      />
    );
  } else if (!ended) {
    const [f, u] = sides(res, played);
    duel = <Duel fav={f} und={u} pu={pUpset(res, played)} u={null} ms={0} seq={0} title={`Match ${played + 1} of ${MATCHES}`} />;
  }

  const nextIdx = !isAuto && live && !ended ? played : null;

  // ---------- Status ----------

  let st = `Ready: need ${k} upsets`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoLocked) {
      st = `Autobet${auto.remaining !== null ? `: ${auto.remaining} left` : ': running'}`;
      tone = 'live';
    } else if (last) {
      st = last.multiplier > 0 ? `Won ${fmtMult(last.multiplier)}` : `${fav} favourite wins: you lose`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else st = `Auto: need ${k} upsets`;
  } else if (phase === 'playing') {
    st = `Match ${played + 1} of ${MATCHES}`;
    tone = 'live';
  } else if (phase === 'checkpoint' && shown) {
    const w = res[played - 1];
    const [f, u] = sides(shown.res, shown.i);
    st = w === u ? `Seed ${u + 1} upsets seed ${f + 1}` : `Seed ${f + 1} beats seed ${u + 1}`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    st =
      round.outcome === 'won'
        ? `${up} upsets: you win`
        : round.outcome === 'lost'
          ? `${fav} favourite wins: you lose`
          : `Cashed out after ${played} matches`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const needLine = ended
    ? status(res, vk) === 'won'
      ? `${up} upsets of ${vk} needed`
      : `${fav} favourite wins of ${SEEDS - vk}`
    : `Need ${n.upsets} ${played ? 'more ' : ''}upset${n.upsets > 1 ? 's' : ''}, ${n.left} matches left`;
  const lastW = played ? res[played - 1] : -1;
  const lastUp = played ? sides(res.slice(0, played - 1), played - 1)[1] === lastW : false;
  const explain = ended ? '' : played === 0 ? '' : lastUp ? 'Upset: one fewer needed' : 'Favourite won: one match fewer';

  const readouts: ReadoutItem[] = [{ label: 'Prize', value: fmtMult(prize), tone: 'prize' }];

  return (
    <GameLayout
      name="Upsets"
      accent={ACCENTS.amber}
      className="up-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />

          <Label hint={<VolBadge level={vol} />}>Upsets needed</Label>
          <Chips
            label="Upsets needed"
            options={KS.map((v) => ({ value: v, label: v, title: `${v} upset${v > 1 ? 's' : ''} before ${SEEDS - v} favourite wins` }))}
            value={vk}
            disabled={live || autoLocked}
            onChange={(v) => change(() => setK(v))}
          />

          {!isAuto ? (
            live ? (
              <>
                <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => round && step(round)}>
                  {phase === 'playing' ? 'Playing…' : 'Next match'}
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
                {phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target ? 'or play to the end' : 'win or lose'}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={AUTO_TARGETS.map((v) => ({ value: v, label: v ? `${v}×` : 'End' }))}
                value={target}
                disabled={autoLocked}
                onChange={(v) => change(() => setTarget(v))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="up-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={st} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="up-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Tree res={res} next={nextIdx} />
        {!isAuto && duel}
        <div className="up-score">
          <Pips label={`Upsets ${up} of ${vk}`} n={vk} filled={up} kind="up" />
          <Pips label={`Favourite wins ${fav} of ${SEEDS - vk}`} n={SEEDS - vk} filled={fav} kind="fav" />
        </div>
        <p className="up-note">{needLine}</p>
        {explain && <p className="up-note sub">{explain}</p>}
        <ChanceBar p={pNow} label="Win chance" />
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
      </Board>

      <Caption>{`Win if underdogs win ${vk} matches before favourites win ${SEEDS - vk}.`}</Caption>

      {infoOpen && (
        <InfoModal title="Upsets" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Eight teams play a knockout of 7 matches. In each match the underdog is the team with the bigger seed number. Pick how many upsets you need, K. You win if underdogs win K matches before favourites win 8 − K.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose K (1 to 5), then Bet. The first match plays.</li>
              <li>After every match you can cash out (C) or play the next one (Space).</li>
              <li>An upset fills a green pip. A favourite win fills a red pip. Fill all green pips to win, or all red pips to lose.</li>
              <li>The matches are in a fixed order, so every match matters.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bar shows the next match: the green part is the underdog's chance of an upset. Your win chance depends on how many upsets you still need and how many matches are left. An upset needs one fewer upset; a favourite win leaves one match fewer, so your chance falls. Winners move along the tree, so later matches change.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>Seed s has rating 1000 / s. The underdog u beats the favourite f with chance rᵤ / (rᵤ + r_f) (Bradley–Terry). The win chance is computed exactly: P(state) = p · P(after an upset) + (1 − p) · P(after a favourite win).</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>A win pays {(RTP * 100).toFixed(0)}% ÷ P(win at the start). The cash-out is prize × P(win | matches so far), a martingale, so cashing out at any moment returns exactly {(RTP * 100).toFixed(0)}% in the long run.</p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
