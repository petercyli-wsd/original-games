import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board as Stage,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
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
} from '@originals/game-sdk/ui';
import { formatAmount } from '@originals/game-sdk';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Board, { type Outcome, type Phase } from './Board';
import { KS, MAX_MULTIPLIER, RTP, SEVEN_WAYS, advance, greenCells, headline, popcount, prizeFor, volatilityOf, winChance, type K, type Roll } from './math';

const ACCENT = '#5ec4e6';

interface Round {
  id: number;
  k: K;
  stake: number;
  /** Locked at bet time: RTP / P(win). */
  prize: number;
  /** Every roll so far, repeats included, in order. */
  rolls: Roll[];
  /** The lit set after each roll. */
  masks: number[];
  /** The resolved cash-out after the latest step. */
  cash: number;
  outcome: Outcome | null;
}

const TITLE: Record<Outcome, string> = { won: 'All made', lost: 'Seven out', cashed: 'Cashed out' };

/** Narrow boards get the result card inline, below the board, so it never covers it. */
function useNarrow(threshold: number) {
  const [el, setEl] = useState<SVGSVGElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < threshold));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, threshold]);
  return [narrow, setEl] as const;
}

const maskAt = (r: Round | null, n: number) => (r && n > 0 ? r.masks[n - 1] : 0);

/** The one plain sentence for a landed roll. */
function sentence(k: number, before: number, roll: Roll, after: number, repeatNext: boolean): { text: ReactNode; tone: string } {
  const j = popcount(after);
  const left = k - j;
  if (roll.kind === 'seven')
    return { tone: 'lost', text: <><b>7</b> is one of the {SEVEN_WAYS} red cells. The round is over.</> };
  if (roll.kind === 'repeat')
    return { tone: 'same', text: <>{roll.t} was already made, so nothing changes.{repeatNext ? ' Rolling again.' : ''}</> };
  if (left === 0) return { tone: 'won', text: <><b>{roll.t}</b> is new: all {k} totals are made.</> };
  const g = greenCells(after);
  return {
    tone: 'new',
    text: (
      <>
        <b>{roll.t}</b> is new. {left} to go instead of {left + 1}, and {g} green cells are left against {SEVEN_WAYS} red (was {greenCells(before)}).
      </>
    ),
  };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();
  const [narrow, svgRef] = useNarrow(460);

  const [k, setK] = useState<K>(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(0);
  const [tumble, setTumble] = useState<{ a: number; b: number } | null>(null);
  const [say, setSay] = useState<{ text: ReactNode; tone: string } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);

  // The open ticket's value right now, set synchronously when the stake is
  // placed and when each step is drawn. The ticket reads only this ref, so
  // leaving mid-animation settles at the step's real result.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'rolling' || phase === 'checkpoint';

  /** Draws one step (rolls until a new total or a 7) and plays it out roll by roll. Resolves null if cleared mid-way. */
  async function runStep(r: Round, pace: number): Promise<Round | null> {
    const base = r.rolls.length;
    const before = maskAt(r, base);
    const { rolls, mask } = advance(before, rng);
    const lastRoll = rolls[rolls.length - 1];
    const sevened = lastRoll.kind === 'seven';
    const masks = [...r.masks];
    // Only the last roll of a step can light a total, so every earlier roll sees the old set.
    for (const ro of rolls) masks.push(ro.kind === 'new' ? mask : before);
    const cash = sevened ? 0 : popcount(mask) >= r.k ? r.prize : r.prize * winChance(r.k, mask);
    resolved.current = cash;
    const next: Round = { ...r, rolls: [...r.rolls, ...rolls], masks, cash };
    setRound(next);
    setPhase('rolling');

    for (let i = 0; i < rolls.length; i++) {
      const ro = rolls[i];
      const rep = ro.kind === 'repeat';
      const spin = Math.round((rep ? 300 : 360) * speed * pace);
      const hold = Math.round((rep ? 380 : 240) * speed * pace);
      setSay(null);
      for (let f = 0; f < 4; f++) {
        setTumble({ a: ((i * 3 + f * 2) % 6) + 1, b: ((i * 5 + f * 3 + 1) % 6) + 1 });
        if (!(await timers.wait(spin / 4))) return null;
      }
      setTumble(null);
      setShown(base + i + 1);
      setSay(sentence(r.k, maskAt(next, base + i), ro, maskAt(next, base + i + 1), i < rolls.length - 1));
      if (!(await timers.wait(hold))) return null;
    }
    return next;
  }

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setShown(r.rolls.length);
    setPhase('over');
    if (outcome === 'cashed') setSay({ tone: 'same', text: <>You cashed out with {popcount(maskAt(r, r.rolls.length))} of {r.k} totals made.</> });
  }

  function newRound(stake: number): Round {
    return { id: ++seq.current, k, stake, prize: prizeFor(k), rolls: [], masks: [], cash: RTP, outcome: null };
  }

  async function advanceRound(r: Round, pace: number) {
    const next = await runStep(r, pace);
    if (!next) return null;
    const mask = next.masks[next.masks.length - 1];
    const lastRoll = next.rolls[next.rolls.length - 1];
    if (lastRoll.kind === 'seven') finish(next, 'lost', 0);
    else if (popcount(mask) >= next.k) finish(next, 'won', next.prize);
    else return next;
    return next;
  }

  async function start() {
    if (live || busy.current || bet.blocked || auto.mode === 'auto') return;
    busy.current = true;
    if (!(await ticket.place(bet.value))) {
      busy.current = false;
      return;
    }
    resolved.current = RTP;
    timers.clearAll();
    setShown(0);
    setTumble(null);
    const r = newRound(bet.value);
    const next = await advanceRound(r, 1);
    if (next && next.outcome === null && popcount(next.masks[next.masks.length - 1]) < next.k && next.rolls[next.rolls.length - 1].kind !== 'seven') {
      busy.current = false;
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: next.cash, winChance: next.cash / next.prize });
    }
  }

  async function roll() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    busy.current = true;
    const next = await advanceRound(round, 1);
    if (next && next.rolls[next.rolls.length - 1].kind === 'new' && popcount(next.masks[next.masks.length - 1]) < next.k) {
      busy.current = false;
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: next.cash, winChance: next.cash / next.prize });
    }
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    finish(round, 'cashed', round.cash);
  }

  /** Auto: one whole round, played to the end with no cash-out. */
  async function playAuto(stake: number): Promise<number | null> {
    if (busy.current) return null;
    if (!(await ticket.place(stake))) return null;
    busy.current = true;
    setAutoBusy(true);
    resolved.current = RTP;
    timers.clearAll();
    setShown(0);
    setTumble(null);
    let r: Round | null = newRound(stake);
    for (;;) {
      const next: Round | null = await runStep(r, 0.6);
      if (!next) break;
      r = next;
      const mask = next.masks[next.masks.length - 1];
      if (next.rolls[next.rolls.length - 1].kind === 'seven') {
        finish(next, 'lost', 0);
        setAutoBusy(false);
        return 0;
      }
      if (popcount(mask) >= next.k) {
        finish(next, 'won', next.prize);
        setAutoBusy(false);
        return next.prize;
      }
    }
    busy.current = false;
    setAutoBusy(false);
    return null;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || autoBusy || auto.running;

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    busy.current = false;
    setRound(null);
    setShown(0);
    setTumble(null);
    setSay(null);
    setPhase('idle');
  }

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    if (!live && !autoBusy) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  const change = (apply: () => void) => {
    if (locked) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => {
        if (isAuto) return auto.running ? auto.stop() : !autoBusy && !bet.blocked ? auto.start() : undefined;
        return phase === 'checkpoint' ? void roll() : !locked ? void start() : undefined;
      },
      cashOut: () => (isAuto ? undefined : cashOut()),
    },
    !infoOpen,
  );

  // What the board shows: the round as far as it has landed, else a preview of the settings.
  const kk = round?.k ?? k;
  const n = round ? (phase === 'over' ? round.rolls.length : shown) : 0;
  const mask = maskAt(round, n);
  const lastRoll = round && n > 0 ? round.rolls[n - 1] : null;
  const made = round ? round.rolls.slice(0, n).filter((x) => x.kind === 'new').map((x) => x.t) : [];
  const j = popcount(mask);
  const left = kk - j;
  const prize = round?.prize ?? prizeFor(k);
  const stake = round?.stake ?? bet.value;
  const pNow = round?.outcome === 'won' ? 1 : round?.outcome === 'lost' ? 0 : winChance(kk, mask);
  const cash = phase === 'over' && round ? round.cash : round ? prize * pNow : RTP;
  const g = greenCells(mask);

  let status = `Ready · make ${k} totals`;
  if (phase === 'rolling') status = 'Rolling…';
  if (phase === 'checkpoint') status = `${j} of ${kk} made`;
  if (phase === 'over' && round?.outcome) status = `${TITLE[round.outcome]} · ${j} of ${kk} made`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live || autoBusy ? 'live' : 'idle';

  const idleSay = `Press Bet. A new total turns grey, a repeat changes nothing, a 7 ends the round.`;
  const sayNode = say ?? { tone: 'new', text: phase === 'idle' ? idleSay : 'Rolling…' };

  return (
    <GameLayout
      name="Seven Out"
      accent={ACCENT}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={volatilityOf(k)} />}>
            Totals to make: <b style={{ color: 'var(--text)' }}>{k}</b>
          </Label>
          <Chips label="Totals to make" options={KS.map((v) => ({ value: v, label: v }))} value={k} disabled={locked} onChange={(v) => change(() => setK(v))} />

          {isAuto ? (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live || autoBusy} />
          ) : live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => void roll()}>
                Roll again
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked || locked} onClick={() => void start()}>
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
          { label: 'Win chance', value: fmtChance(pNow), tone: 'chance' },
          { label: 'Prize', value: fmtMult(prize), tone: 'prize' },
        ]}
      />

      <Stage className={'so-board' + (phase === 'over' ? ' over' : '')}>
        <div className="so-main">
          <Board
            svgRef={svgRef}
            narrow={narrow}
            k={kk}
            mask={mask}
            last={lastRoll}
            tumble={tumble}
            phase={phase}
            outcome={round?.outcome ?? null}
            made={made}
          />
          <p className={'so-say ' + sayNode.tone} aria-live="polite">
            {sayNode.text}
          </p>
        </div>
        {phase === 'over' && round?.outcome && !autoBusy && (
          <RoundOver
            key={history[0]?.id}
            title={TITLE[round.outcome]}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => (isAuto ? undefined : void start())}
            onClear={clear}
            placement="inline"
          />
        )}
      </Stage>

      {live && (
        <ChanceBar
          p={pNow}
          label="Chance to make every total"
          note={
            left === 1
              ? `One total left: ${g} green cells out of ${g + SEVEN_WAYS} live cells is the win chance.`
              : `The next roll that counts is new on ${g} of ${g + SEVEN_WAYS} cells. ${left} totals are still to make.`
          }
        />
      )}
      <Caption>
        Win by making {k} different totals before a 7 is rolled.
      </Caption>

      {infoOpen && (
        <InfoModal title="Seven Out" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Roll two dice. Make {k} different totals before a 7 is rolled.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many different totals you need (3 to 10) and bet. The first roll comes with the bet.</li>
              <li>A total that has not been rolled yet is made: its cells turn grey and it fills a slot. A repeat of a made total changes nothing and the dice roll again by themselves.</li>
              <li>A 7 ends the round and you lose. After each new total you can cash out (C) or roll again (Space).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The grid has one cell for each of the 36 ways two dice can land. The 6 red cells make a 7. The green cells are the totals you have not made. Grey
              cells are totals already made: rolling one is a repeat, so only green and red cells count.
            </p>
            <p>
              The next roll that counts is a new total on <b>green cells out of green + red</b>. When one total is left, that is exactly your win chance. With
              more to make, the win chance is the chance of making all of them in a row, and it rises every time a total is made.
            </p>
            <p>A rare total (2 or 12, one cell each) turns few cells grey, so many green cells stay in play. That helps more than a common total such as 6 or 8.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With G green cells, a roll that counts is total t with chance w<sub>t</sub> / (G + 6) and a 7 with chance 6 / (G + 6). The win chance W is computed
              exactly over every set of made totals: W = Σ w<sub>t</sub> / (G + 6) · W(with t made), and W = G / (G + 6) when one is left. From the start it is{' '}
              {fmtChance(headline(k))} for {k} totals.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked at the bet: {(RTP * 100).toFixed(0)}% ÷ the start chance. Cashing out pays prize × your win chance now, computed exactly, so every
              roll is a fair bet and any way of playing returns {(RTP * 100).toFixed(0)}% in the long run. The biggest prize on offer is {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
