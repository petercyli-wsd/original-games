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
  type ReadoutItem,
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Tray from './Board';
import { RULE } from './manifest';
import {
  BOXES,
  MAX_WIN,
  RTP,
  closes,
  fullBox,
  nextRoll,
  oneDie,
  playableChance,
  relock,
  rollDice,
  startPrize,
  tileSum,
  tilesOf,
  volatilityOf,
  winChance,
  type Box,
  type Close,
  type Mask,
} from './math';

type Phase = 'idle' | 'rolling' | 'choose' | 'closing' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'won';

interface Round {
  n: Box;
  stake: number;
  prize: number;
  /** Open tiles now. */
  mask: Mask;
  /** Open tiles before the roll on show (the strip refers to them). */
  before: Mask;
  dice: number[] | null;
  /** The roll on show (null at a checkpoint, before the next roll). */
  total: number | null;
  /** Tiles the last close shut (for the flash). */
  closed: Mask;
  /** Open tiles before the last roll (for the "chance moved" note and the one-die switch). */
  prev: Mask;
  /** Tiles the last close shut (kept through the checkpoint). */
  lastClose: Mask;
  /** The prize before the last close (it differs if a riskier close relocked it). */
  prizeBefore: number;
  rolls: number;
  outcome: Outcome | null;
  paid: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const TITLE: Record<Outcome, string> = { bust: 'No tiles add up', cashed: 'Cashed out', won: 'Box shut' };
const label = (tiles: Mask) => tilesOf(tiles).reverse().join(' + ');

const fresh = (n: Box, stake: number): Round => ({
  n,
  stake,
  prize: startPrize(n),
  mask: fullBox(n),
  before: fullBox(n),
  dice: null,
  total: null,
  closed: 0,
  prev: fullBox(n),
  lastClose: 0,
  prizeBefore: startPrize(n),
  rolls: 0,
  outcome: null,
  paid: 0,
});

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [n, setN] = useState<Box>(8);
  const [target, setTarget] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [hover, setHover] = useState<Mask | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A roll is decided the moment it starts, so leaving mid-roll settles at its
  // real result (the best close, or 0), never at the pre-roll value.
  const resolved = useRef(0);
  const ticket = useTicket(() => {
    if (phase === 'rolling' || phase === 'closing' || autoBusy) return resolved.current;
    if (!round) return 0;
    if (phase === 'choose') return valueOf(round);
    if (phase === 'checkpoint') return round.prize * winChance(round.mask);
    return 0;
  });

  const isAutoRef = useRef(false);
  const k = turbo.turbo ? 0.25 : 1;
  const ms = (manual: number, auto: number) => Math.round((isAutoRef.current ? auto : manual) * k);
  const live = phase === 'rolling' || phase === 'choose' || phase === 'closing' || phase === 'checkpoint';

  /** Value of a round whose roll is on show: the prize times the best close's chance (0 if none). */
  function valueOf(r: Round) {
    if (r.total === null) return r.prize * winChance(r.mask);
    const [best] = closes(r.before, r.total);
    return best ? r.prize * best.win : 0;
  }

  function finish(r: Round, outcome: Outcome, paid: number) {
    ticket.settle(paid);
    pushHistory(paid);
    setHover(null);
    setRound({ ...r, outcome, paid });
    setPhase('over');
  }

  /** Closes the chosen tiles (prize relocked if it isn't the best close), then pauses at a checkpoint or ends. */
  async function close(r: Round, pick: Close) {
    if (r.total === null) return;
    const options = closes(r.before, r.total);
    const prize = relock(r.prize, options[0].win, pick);
    if (prize === null) {
      setNote(`Closing ${label(pick.tiles)} would relock the prize above ${MAX_WIN.toLocaleString('en-US')}× (the max win), so it is not allowed.`);
      return;
    }
    const cash = prize * pick.win;
    resolved.current = cash;
    setNote(null);
    const next: Round = { ...r, prize, prizeBefore: r.prize, mask: pick.after, closed: pick.tiles, lastClose: pick.tiles };
    setHover(null);
    setRound(next);
    setPhase('closing');
    if (!(await timers.wait(ms(380, 160)))) return;
    if (pick.after === 0) return finish(next, 'won', prize);
    setRound({ ...next, before: pick.after, total: null, closed: 0 });
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cash, winChance: pick.win });
  }

  async function roll(r: Round) {
    const { dice, total } = rollDice(r.mask, (m) => rng.int(m));
    const options = closes(r.mask, total);
    resolved.current = options.length ? r.prize * options[0].win : 0;
    const rolled: Round = { ...r, before: r.mask, prev: r.mask, dice, total, closed: 0, rolls: r.rolls + 1 };
    setNote(null);
    setHover(null);
    setRound({ ...rolled, dice: null });
    setPhase('rolling');
    if (!(await timers.wait(ms(700, 420)))) return;
    setRound(rolled);
    if (options.length === 0) {
      setPhase('closing');
      if (!(await timers.wait(ms(250, 120)))) return;
      return finish(rolled, 'bust', 0);
    }
    if (options.length === 1) {
      // Only one way to spend the roll: show it, then close it.
      setHover(options[0].tiles);
      setPhase('closing');
      if (!(await timers.wait(ms(450, 200)))) return;
      return close(rolled, options[0]);
    }
    setPhase('choose');
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    const r = fresh(n, bet.value);
    setRound(r);
    void roll(r);
  }

  function cashOut() {
    if (!round || (phase !== 'checkpoint' && phase !== 'choose')) return;
    finish(round, 'cashed', valueOf(round));
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setHover(null);
    setNote(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto: always the best close, cash out at the target ----------

  async function playAuto(stake: number): Promise<number | null> {
    const box = n;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setLast(null);
    setNote(null);
    let r = fresh(box, stake);
    resolved.current = r.prize * winChance(r.mask);
    setRound(r);
    let outcome: Outcome = 'bust';
    let paid = 0;
    for (;;) {
      const { dice, total } = rollDice(r.mask, (m) => rng.int(m));
      const options = closes(r.mask, total);
      const best = options[0];
      resolved.current = best ? r.prize * best.win : 0;
      r = { ...r, before: r.mask, prev: r.mask, dice, total, closed: 0, rolls: r.rolls + 1 };
      setRound({ ...r, dice: null });
      setPhase('rolling');
      if (!(await timers.wait(ms(700, 420)))) return null;
      setRound(r);
      setPhase('closing');
      if (!best) {
        if (!(await timers.wait(ms(250, 260)))) return null;
        break;
      }
      setHover(best.tiles);
      if (!(await timers.wait(ms(380, 180)))) return null;
      r = { ...r, mask: best.after, closed: best.tiles, lastClose: best.tiles, prizeBefore: r.prize };
      setHover(null);
      setRound(r);
      setPhase('closing');
      if (!(await timers.wait(ms(380, 160)))) return null;
      const cash = r.prize * best.win;
      if (best.after === 0) {
        outcome = 'won';
        paid = r.prize;
        break;
      }
      r = { ...r, before: r.mask, total: null, closed: 0 };
      setRound(r);
      if (tgt > 0 && cash >= tgt - 1e-12) {
        outcome = 'cashed';
        paid = cash;
        break;
      }
    }
    ticket.settle(paid);
    pushHistory(paid);
    setRound({ ...r, outcome, paid });
    setPhase('over');
    setLast({ id: ++seq.current, multiplier: paid, stake });
    setAutoBusy(false);
    return paid;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  isAutoRef.current = isAuto;
  const busy = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setHover(null);
    setNote(null);
    setLast(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (busy) return;
    apply();
    if (phase === 'over') clear();
  };

  const options = phase === 'choose' && round && round.total !== null ? closes(round.before, round.total) : [];

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) void roll(round);
        else if (phase === 'choose' && round && options.length) void close(round, options[0]);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const r = round ?? fresh(n, bet.value);
  const outcome = phase === 'over' ? r.outcome : null;
  // While a roll is on show the band is that roll's band; otherwise the next roll's.
  const showRoll = r.total !== null;
  const stripMask = showRoll ? r.before : r.mask;
  const strip = nextRoll(stripMask);
  const p0 = winChance(fullBox(n));
  const prize0 = RTP / p0;
  const vol = volatilityOf(n);
  const best = options[0];
  const landed = round !== null && r.total !== null && phase !== 'rolling';
  const rollOptions = landed && r.total !== null ? closes(r.before, r.total) : [];
  const rollBest = rollOptions[0];
  let winNow = round ? winChance(r.mask) : p0;
  if (outcome === 'won') winNow = 1;
  else if (outcome === 'bust') winNow = 0;
  else if (outcome === 'cashed') winNow = r.paid / r.prize;
  else if (landed) winNow = r.closed ? winChance(r.mask) : rollBest?.win ?? 0;
  const cash = phase === 'over' ? r.paid : r.prize * winNow;
  const stake = r.stake;
  const playNext = playableChance(r.mask);
  const preview = hover ?? (phase === 'choose' && best ? best.tiles : 0);
  const tumbling = phase === 'rolling';
  // The dice just dropped to one: the last close took the open tiles to 6 or less.
  const switched = round !== null && r.lastClose !== 0 && r.mask !== 0 && oneDie(r.mask) && !oneDie(r.prev);

  let status = `Ready · box of ${n}`;
  let tone: StatusTone = 'idle';
  if (phase === 'rolling') {
    status = isAuto ? `Autobet · roll ${r.rolls}` : `Rolling ${oneDie(r.before) ? 'one die' : 'two dice'}…`;
    tone = 'live';
  } else if (phase === 'choose' || phase === 'closing') {
    status = r.total !== null && options.length > 1 ? `Rolled ${r.total} · pick tiles that make ${r.total}` : `Rolled ${r.total}`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `${tilesOf(r.mask).length} tiles open · roll or cash out`;
    tone = 'live';
  } else if (phase === 'over' && outcome) {
    status = outcome === 'bust' ? `Rolled ${r.total}: no open tiles make ${r.total}` : outcome === 'won' ? `Box shut in ${r.rolls} roll${r.rolls === 1 ? '' : 's'}` : `Cashed out with ${tilesOf(r.mask).length} tiles open`;
    tone = r.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  const showCash = live || phase === 'over';
  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: fmtChance(winNow), sub: phase === 'over' ? 'round over' : landed && !r.closed ? 'after the best close' : 'best play from here', tone: 'chance' },
    {
      label: phase === 'over' ? 'Paid' : isAuto && !round ? 'Auto cashes at' : 'Cash out now',
      value: phase === 'over' ? fmtMult(r.paid) : showCash ? fmtMult(cash) : isAuto ? (target > 0 ? fmtMult(target) : 'the end') : '—',
      sub: phase === 'over' || showCash ? formatAmount(stake * cash, 2) : 'after the first roll',
      tone: 'cash',
    },
    { label: 'Prize', value: fmtMult(r.prize), sub: `pays ${formatAmount(stake * r.prize, 2)}`, tone: 'prize' },
  ];

  // ---------- The message line under the board ----------

  // Short lines only: each says one thing (the blind-play sandbox hides prose of 9+ words).
  const hovered = phase === 'choose' && hover !== null ? options.find((o) => o.tiles === hover) : undefined;
  let choiceLines: string[] = [];
  if (phase === 'choose' && round && best) {
    if (hovered && hovered !== best) {
      const p = relock(round.prize, best.win, hovered);
      choiceLines =
        p === null
          ? [`${label(hovered.tiles)} would pass the ${MAX_WIN.toLocaleString('en-US')}× max win.`]
          : [`${label(hovered.tiles)}: prize rises to ${fmtMult(p)}.`, `Cash-out stays ${fmtMult(cash)}.`];
    } else if (hovered) {
      choiceLines = [`${label(hovered.tiles)}: best odds, prize stays ${fmtMult(round.prize)}.`];
    } else {
      choiceLines = [`Same ${fmtMult(cash)} cash-out whichever you pick.`, 'A riskier pick raises the prize to match.'];
    }
  }

  let message: ReactNode = null;
  if (!round) {
    message = (
      <ol className="shut-rules" aria-label="Rules">
        <li>Close tiles adding up to the dice total.</li>
        <li>Open tiles total ≤ 6: roll one die.</li>
        <li>No open tiles add up? Round lost.</li>
        <li>Shut every tile to win the prize.</li>
      </ol>
    );
  } else if (!isAuto && phase === 'choose' && options.length > 1) {
    message = (
      <>
        <p>
          Pick tiles adding up to <b>{r.total}</b>. <span className="muted">Chance to shut after each:</span>
        </p>
        <div className="shut-options" role="group" aria-label={`Close tiles adding up to ${r.total}`}>
          {options.map((o, i) => {
            const prize = relock(round.prize, best.win, o);
            return (
              <button
                key={o.tiles}
                type="button"
                className={'shut-opt' + (i === 0 ? ' best' : '')}
                disabled={prize === null}
                onMouseEnter={() => setHover(o.tiles)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(o.tiles)}
                onBlur={() => setHover(null)}
                onClick={() => void close(round, o)}
              >
                <b>{label(o.tiles)}</b>
                <span>{o.after === 0 ? 'shuts the box' : `→ ${fmtChance(o.win)}`}</span>
                {i === 0 && <small>best odds</small>}
              </button>
            );
          })}
        </div>
        <p className="muted">
          {choiceLines.map((t, i) => (
            <span key={i}>{t} </span>
          ))}
        </p>
      </>
    );
  } else if (phase === 'closing' && landed && r.total !== null && !r.closed && rollOptions.length === 1) {
    message = (
      <p>
        Only <b>{label(rollOptions[0].tiles)}</b> makes {r.total}: it closes by itself.
      </p>
    );
  } else if (phase === 'checkpoint' || (phase === 'closing' && r.closed)) {
    const relocked = Math.abs(r.prize - r.prizeBefore) > 1e-9;
    message = (
      <>
        <p>
          Closed <b>{label(r.lastClose)}</b>: chance to shut {fmtChance(winChance(r.prev))} → <b>{fmtChance(winChance(r.mask))}</b>
        </p>
        {relocked && <p className="muted">Prize raised to {fmtMult(r.prize)}; cash-out kept.</p>}
        {switched && (
          <p className="switch">
            Open tiles total {tileSum(r.mask)}, 6 or less: <b>now you roll one die</b>
          </p>
        )}
      </>
    );
  }

  return (
    <GameLayout
      name="Shut"
      accent="#7aa2ff"
      className="shut-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Box</Label>
          <Chips
            label="Box size"
            options={BOXES.map((v) => ({ value: v, label: `1–${v}`, title: `${fmtChance(winChance(fullBox(v)))} to shut` }))}
            value={n}
            disabled={busy}
            onChange={(v) => change(() => setN(v))}
          />

          {!isAuto ? (
            <>
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(p0)}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(prize0)}</dd>
              </dl>
              {(phase === 'checkpoint' || phase === 'choose') && round ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  {phase === 'checkpoint' ? (
                    <ActionButton kind="secondary" onClick={() => void roll(round)}>
                      Roll {oneDie(round.mask) ? 'one die' : 'two dice'} · {fmtChance(playNext)} playable
                    </ActionButton>
                  ) : (
                    <ActionButton kind="secondary" disabled={!best} onClick={() => best && void close(round, best)}>
                      Close {best ? label(best.tiles) : ''} · best odds
                    </ActionButton>
                  )}
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'rolling' || phase === 'closing' ? 'Rolling…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target > 0 && target >= prize0 ? 'above the prize: plays to the end' : 'always the best close'}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={AUTO_TARGETS.map((t) => ({ value: t, label: t === 0 ? 'End' : `${t}×` }))}
                value={target}
                disabled={busy}
                onChange={(t) => {
                  setTarget(t);
                  if (phase === 'over' && !busy) clear();
                }}
              />
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(p0)}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(prize0)}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="shut-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="shut-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <div className="shut-wrap">
          <Tray
            n={r.n}
            mask={r.mask}
            preview={preview}
            justClosed={phase === 'closing' ? r.closed : 0}
            dice={showRoll ? r.dice : null}
            diceCount={oneDie(stripMask) ? 1 : 2}
            tumbling={tumbling}
            total={showRoll && phase !== 'rolling' ? r.total : null}
            strip={strip}
            openSum={tileSum(stripMask)}
            busted={outcome === 'bust'}
            won={outcome === 'won'}
          />
          <div className="shut-msg" aria-live="polite">
            {message}
          </div>
        </div>
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={TITLE[round.outcome]}
          multiplier={round.paid}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      ) : !isAuto && live ? (
        <ChanceBar
          p={winNow}
          label="Chance to shut the box"
          note={
            note ??
            (phase === 'choose' && options.length > 1
              ? 'Shown for the best-odds pick.'
              : phase === 'checkpoint'
                ? `Cash out ${fmtMult(cash)} now, or roll for ${fmtMult(r.prize)}.`
                : undefined)
          }
        />
      ) : isAuto && round && (autoBusy || auto.running) ? (
        <ChanceBar
          p={winNow}
          label="Chance to shut the box"
          note={
            target > 0 && target < r.prize ? `Worth ${fmtMult(cash)} now · cashes at ${fmtMult(target)}` : `Worth ${fmtMult(cash)} now · plays to the end`
          }
        />
      ) : (
        <Caption>
          {isAuto
            ? `Each bet plays a whole round with the best close every roll${target > 0 ? `, cashing out once it is worth ${fmtMult(target)}` : ', to the end'}. RTP ${(RTP * 100).toFixed(0)}%.`
            : `Box 1–${n}: best play shuts it ${fmtChance(p0)} of the time for ${fmtMult(prize0)}. You can cash out after any roll. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Shut" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} Tiles 1 to n start open (you pick n). If no open tiles add up to a roll, the round is lost.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the box size, then Bet. The first roll happens at once.</li>
              <li>Close open tiles that add up exactly to the roll: 9 can be 9, 8 + 1, 5 + 4, 4 + 3 + 2… If only one set works it closes by itself.</li>
              <li>Once the open tiles total 6 or less, only one die is rolled (otherwise the last small tiles could never close). The board tells you when it happens.</li>
              <li>After each roll you can cash out (C) or roll again (Space). While choosing tiles, Space closes the best-odds set.</li>
              <li>Close every tile to win the prize. Auto plays whole rounds with the best close and cashes out at your target.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The band under the dice has one cell per dice total, as wide as that total's chance of being rolled (7 is six times as wide as 2). <b style={{ color: 'var(--green)' }}>Green</b> totals
              can be made from your open tiles; <b style={{ color: 'var(--red)' }}>red</b> ones end the round. So the green share of the band is the chance your next roll can be played, and the
              Roll button repeats it.
            </p>
            <p>
              The Chance to shut the box bar is your chance of closing every tile from here, playing the best tiles each roll. It moves after every close: closing big tiles early usually raises it,
              because small totals are easy to make later. When a roll offers several sets of tiles, each choice shows the chance it leaves you.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Backward induction (Bellman's principle) over every set S of open tiles: V(∅) = 1 and V(S) = Σ<sub>t</sub> P(t) · max V(S \ C), the max over the sets C of open
              tiles adding up to t (a total with no such C counts 0). P(t) = (6 − |t − 7|)/36 for two dice, 1/6 for one. The table covers all 2<sup>12</sup> = 4,096 sets and
              is exact; no simulation is used. Best play shuts the classic 9-box {fmtChance(winChance(fullBox(9)))} of the time.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. Averaged over the next roll (closing the best tiles), your chance
              stays the same, so any cash-out rule returns {(RTP * 100).toFixed(0)}% in the long run. Picking a set with a lower chance than the best keeps your cash-out the same and
              raises the prize to cash-out ÷ your new chance, so it changes risk, never value. No prize may exceed {MAX_WIN.toLocaleString('en-US')}× (picks that would are refused).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
