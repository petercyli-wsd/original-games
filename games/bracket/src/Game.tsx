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
import { useEffect, useRef, useState } from 'react';
import BracketBoard, { Duel } from './Board';
import {
  FIELDS,
  MAX_PRIZE,
  PRESETS,
  PRESET_LABEL,
  PRESET_NOTE,
  ROUND_NAMES,
  RTP,
  emptyResults,
  makeBracket,
  nextMatch,
  outcomes,
  playMatch,
  playedCount,
  players,
  prizeFor,
  startOdds,
  switchPrize,
  titleOdds,
  volatilityOf,
  withResult,
  type Field,
  type MatchRef,
  type Preset,
  type Results,
} from './math';

type Phase = 'idle' | 'playing' | 'checkpoint' | 'over';
type Outcome = 'champion' | 'out' | 'cashed';

interface Round {
  n: Field;
  preset: Preset;
  held: number;
  prize: number;
  res: Results;
  stake: number;
  cash: number;
  outcome: Outcome | null;
  /** Who knocked the held seed out. */
  by: number | null;
}

interface Play {
  ref: MatchRef;
  u: number;
  seq: number;
  /** The held seed plays in this match. */
  mine: boolean;
  /** Played as part of "Skip to your match". */
  skip: boolean;
}

interface AutoView {
  n: Field;
  preset: Preset;
  held: number;
  prize: number;
  res: Results;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { champion: 'Champions', out: 'Knocked out', cashed: 'Cashed out' };
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const RULE = 'Back a seed to win the knockout.';

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [n, setN] = useState<Field>(8);
  const [preset, setPreset] = useState<Preset>('underdog');
  const [seed, setSeed] = useState(2);
  const [target, setTarget] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [play, setPlay] = useState<Play | null>(null);
  const [autoView, setAutoView] = useState<AutoView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A match is decided the moment it starts, so leaving mid-match settles at
  // its real result, never at the value from before it.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'playing' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? round.cash : 0));

  // Other seeds' matches are quick; your own match gets a longer, tenser sweep.
  const playMs = turbo.turbo ? 220 : 650;
  const mineMs = turbo.turbo ? 420 : 1400;
  const skipMs = turbo.turbo ? 110 : 380;
  const autoMs = turbo.turbo ? 45 : 170;
  const live = phase === 'playing' || phase === 'checkpoint';

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPlay(null);
    setPhase('over');
  }

  function step(r: Round, toMine: boolean) {
    const b = makeBracket(r.n, r.preset);
    const ref = nextMatch(b, r.res, r.held);
    if (!ref) return;
    const u = rng.next();
    const winner = playMatch(b, r.res, ref, u);
    const res = withResult(r.res, ref, winner);
    const odds = titleOdds(b, res);
    const cash = r.prize * odds[r.held];
    resolved.current = cash;
    const mine = players(b, r.res, ref.k, ref.m).includes(r.held);
    setPlay({ ref, u, seq: ++seq.current, mine, skip: toMine });
    setPhase('playing');
    timers.after(mine ? mineMs : toMine ? skipMs : playMs, () => {
      const next: Round = { ...r, res, cash };
      if (odds[r.held] === 0) return finish({ ...next, by: winner }, 'out', 0);
      const after = nextMatch(b, res, r.held);
      if (!after) return finish(next, 'champion', r.prize);
      setRound(next);
      track({ type: 'checkpoint', multiplier: cash, winChance: odds[r.held] });
      if (toMine && !mine && !players(b, res, after.k, after.m).includes(r.held)) return step(next, true);
      setPlay(null);
      setPhase('checkpoint');
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    const b = makeBracket(n, preset);
    const prize = prizeFor(n, preset, seed);
    const r: Round = { n, preset, held: seed, prize, res: emptyResults(b), stake: bet.value, cash: RTP, outcome: null, by: null };
    setRound(r);
    step(r, false);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setPlay(null);
    setAutoView(null);
    setLast(null);
    setPhase('idle');
  }

  /** Changing any setting clears a finished board to a preview of the new one. */
  function change(apply: () => void) {
    if (live || autoBusy) return;
    apply();
    if (phase === 'over' || autoView || last) clear();
  }

  function pickSeed(s: number) {
    if (phase === 'checkpoint' && round) {
      const b = makeBracket(round.n, round.preset);
      const np = switchPrize(round.cash, titleOdds(b, round.res)[s]);
      if (np === null || s === round.held) return;
      setRound({ ...round, held: s, prize: np });
      setSeed(s);
      return;
    }
    change(() => setSeed(s));
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const an = n;
    const ap = preset;
    const held = seed;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    const b = makeBracket(an, ap);
    const prize = prizeFor(an, ap, held);
    // The whole round is decided first, then animated.
    const states: Results[] = [];
    let res = emptyResults(b);
    let mult = 0;
    for (;;) {
      const ref = nextMatch(b, res, held)!;
      res = withResult(res, ref, playMatch(b, res, ref, rng.next()));
      states.push(res);
      const p = titleOdds(b, res)[held];
      if (p === 0) break;
      if (!nextMatch(b, res, held)) {
        mult = prize;
        break;
      }
      if (tgt > 0 && prize * p >= tgt) {
        mult = prize * p;
        break;
      }
    }
    resolved.current = mult;
    setAutoBusy(true);
    setRound(null);
    setPlay(null);
    setPhase('idle');
    setLast(null);
    for (const s of states) {
      setAutoView({ n: an, preset: ap, held, prize, res: s });
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

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setPlay(null);
    setAutoView(null);
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
        if (phase === 'checkpoint' && round) step(round, false);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const view = isAuto
    ? autoView ?? { n, preset, held: seed, prize: prizeFor(n, preset, seed), res: emptyResults(makeBracket(n, preset)) }
    : round ?? { n, preset, held: seed, prize: prizeFor(n, preset, seed), res: emptyResults(makeBracket(n, preset)) };
  const b = makeBracket(view.n, view.preset);
  const odds = titleOdds(b, view.res);
  const held = view.held;
  const pNow = odds[held];
  const cash = view.prize * pNow;
  const finalW = view.res[b.rounds - 1][0];
  const champion = finalW >= 0 ? finalW : null;
  const stake = round?.stake ?? bet.value;
  const p0 = startOdds(n, preset)[seed];
  const vol = volatilityOf(p0);
  const played = playedCount(view.res);
  const total = b.n - 1;

  // The match on the board: the one being played, else the next one.
  const nextRef = !isAuto && live ? (play?.ref ?? nextMatch(b, view.res, held)) : null;
  const roundName = (k: number) => ROUND_NAMES[b.rounds][k];

  let duel = null;
  if (nextRef) {
    const [x, y] = players(b, view.res, nextRef.k, nextRef.m);
    const [ox, oy] = outcomes(b, view.res, nextRef, held);
    const mine = x === held || y === held;
    duel = (
      <Duel
        b={b}
        x={x}
        y={y}
        px={ox.p}
        ax={ox.after}
        ay={oy.after}
        now={pNow}
        held={held}
        title={`${phase === 'playing' ? 'Playing' : 'Next'} · ${roundName(nextRef.k)}${mine ? ' · your seed' : ''}`}
        landing={phase === 'playing' && play ? play.u : null}
        ms={play ? (play.mine ? mineMs : play.skip ? skipMs : playMs) : 0}
        mine={mine}
        seq={play?.seq ?? 0}
      />
    );
  }

  function canPick(s: number) {
    if (isAuto) return !autoLocked && s !== seed;
    if (phase === 'checkpoint' && round) return s !== round.held && switchPrize(round.cash, odds[s]) !== null;
    return phase === 'idle' || phase === 'over' ? s !== seed : false;
  }
  function pickTitle(s: number) {
    const base = `Seed ${s + 1} · rating ${b.ratings[s]} · title ${fmtChance(odds[s])}`;
    if (phase === 'checkpoint' && round && s !== round.held) {
      if (odds[s] === 0) return `${base} · knocked out`;
      const np = switchPrize(round.cash, odds[s]);
      return np === null ? `${base} · switch would pass the ${fmtMult(MAX_PRIZE)} max win` : `${base} · switch: prize ${fmtMult(np)}`;
    }
    if (s === held) return `${base} · your seed`;
    return (phase === 'idle' || phase === 'over' || isAuto) && !autoLocked ? `${base} · click to back · prize ${fmtMult(RTP / startOdds(view.n, view.preset)[s])}` : base;
  }

  // ---------- Status, readouts ----------

  let status = `Ready · back seed ${seed + 1} of ${n}`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoLocked) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}`;
      tone = 'live';
    } else if (last) {
      status = last.multiplier > 0 ? (champion === held ? `Seed ${held + 1} won the title` : `Cashed out · ${fmtMult(last.multiplier)}`) : `Seed ${held + 1} knocked out`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · seed ${seed + 1}, ${target ? `cash out at ${fmtMult(target)}` : 'play to the end'}`;
  } else if (phase === 'playing' && nextRef) {
    status = `${roundName(nextRef.k)} · match ${played + 1} of ${total}`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `Checkpoint · ${played} of ${total} matches played`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status =
      round.outcome === 'out'
        ? `Seed ${round.held + 1} knocked out by seed ${(round.by ?? 0) + 1}`
        : round.outcome === 'champion'
          ? `Seed ${round.held + 1} wins the title`
          : `Cashed out · ${played} of ${total} played`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const showLive = live || phase === 'over';
  const readouts: ReadoutItem[] = [
    {
      label: 'Title chance',
      value: fmtChance(pNow),
      sub: `seed ${held + 1} · rating ${b.ratings[held]}`,
      tone: 'chance',
    },
    phase === 'over' && round?.outcome === 'out'
      ? { label: 'Cash out now', value: 'Out', sub: `beaten by seed ${(round.by ?? 0) + 1}`, tone: 'lose' }
      : isAuto
      ? { label: 'Cash out at', value: target ? fmtMult(target) : 'End', sub: target ? 'or the title' : 'play every match', tone: 'cash' }
      : {
          label: 'Cash out now',
          value: showLive ? fmtMult(phase === 'over' && round ? round.cash : cash) : '—',
          sub: showLive ? formatAmount(stake * (phase === 'over' && round ? round.cash : cash), 2) : 'after every match',
          tone: 'cash',
        },
    {
      label: 'Prize',
      value: fmtMult(view.prize),
      sub: `if seed ${held + 1} wins`,
      tone: 'prize',
    },
  ];

  const nextIsMine = nextRef ? players(b, view.res, nextRef.k, nextRef.m).includes(held) : false;

  return (
    <GameLayout
      name="Bracket"
      accent="#8338ec"
      className="bk-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />

          <Label hint={<VolBadge level={vol} />}>Field</Label>
          <Chips
            label="Field size"
            options={FIELDS.map((v) => ({ value: v, label: `${v} seeds` }))}
            value={n}
            disabled={live || autoLocked}
            onChange={(v) =>
              change(() => {
                setN(v);
                if (seed >= v) setSeed(v - 1);
              })
            }
          />
          <Label hint={PRESET_NOTE[preset]}>Ratings</Label>
          <Chips
            label="Ratings preset"
            options={PRESETS.map((v) => ({ value: v, label: PRESET_LABEL[v] }))}
            value={preset}
            disabled={live || autoLocked}
            onChange={(v) => change(() => setPreset(v))}
          />
          <Label hint={live ? 'click a seed to switch' : 'or click the board'}>Back seed</Label>
          <div className={'bk-seeds' + (n === 16 ? ' sixteen' : '')}>
            <Chips
              label="Seed to back"
              wrap
              options={Array.from({ length: n }, (_, i) => ({ value: i, label: i + 1, title: `Seed ${i + 1}: title ${fmtChance(startOdds(n, preset)[i])}` }))}
              value={live && round ? round.held : seed}
              disabled={live || autoLocked}
              onChange={pickSeed}
            />
          </div>

          {!isAuto ? (
            <>
              <dl className="og-stats">
                <dt>Title chance</dt>
                <dd>{fmtChance(p0)}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(RTP / p0)}</dd>
              </dl>
              {live ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => round && step(round, false)}>
                    {phase === 'playing' ? 'Playing…' : nextIsMine ? 'Play your match' : 'Next match'}
                  </ActionButton>
                  <ActionButton kind="secondary" className="bk-skip" disabled={phase !== 'checkpoint' || nextIsMine} onClick={() => round && step(round, true)}>
                    Skip to your match
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target ? 'or win the title' : 'title or bust'}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={AUTO_TARGETS.map((v) => ({ value: v, label: v ? `${v}×` : 'End' }))}
                value={target}
                disabled={autoLocked}
                onChange={(v) => change(() => setTarget(v))}
              />
              <dl className="og-stats">
                <dt>Title chance</dt>
                <dd>{fmtChance(p0)}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(RTP / p0)}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="bk-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className={'bk-board' + (isAuto ? ' auto' : '')}>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <div className="bk-field">
          {(['wide', 'tall'] as const).map((o) => (
            <BracketBoard
              key={`${o}-${b.n}`}
              b={b}
              res={view.res}
              held={held}
              odds={odds}
              orient={o}
              next={nextRef}
              playing={phase === 'playing'}
              champion={champion}
              canPick={canPick}
              pickTitle={pickTitle}
              onPick={pickSeed}
              live={showLive || !!autoView}
              playingMine={phase === 'playing' && !!play?.mine}
            />
          ))}
        </div>
        {!isAuto && live && duel}
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

      {!isAuto && live ? (
        <ChanceBar
          p={pNow}
          label={`Seed ${held + 1} wins the title`}
          note="Your purple slice of the centre ring is this chance. Click any live seed to switch: the cash-out stays, the prize relocks."
        />
      ) : (
        <Caption>
          <b className="bk-rule">{RULE}</b> Cash out or switch seeds after any match. Each match is won with chance rating ÷ (both ratings). Seed {seed + 1} takes the title {fmtChance(p0)} of the time
          for {fmtMult(RTP / p0)}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Bracket" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} A knockout of 8 or 16 seeds is played one match at a time; if your seed lifts the title you win its prize.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the field size, a ratings preset and the seed you back (chips, or click a seed on the board), then Bet.</li>
              <li>Matches are played one by one, round by round. Your seed's match is always the last of its round, so you see who you'd meet next first.</li>
              <li>After every match you can cash out (C), play the next match (Space), or skip ahead to your own match.</li>
              <li>Click any live seed to switch your backing to it. The cash-out stays the same; the prize relocks at cash-out ÷ that seed's title chance.</li>
              <li>Auto plays whole tournaments: it backs your seed and cashes out once the cash-out reaches your target (End = title or bust).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every seed's ring and percentage is its exact chance to win the title from here. The centre ring splits 100% between the seeds still in; your
              seed's <b style={{ color: 'var(--accent)' }}>purple slice</b> is your chance. The next match's node is split by its odds, and the bar under the bracket
              shows both results with the title chance each would leave you: weighted by the match odds they average to your chance now.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Bradley–Terry: seed i beats seed j with probability rᵢ / (rᵢ + rⱼ). The bracket DP gives every match's winner distribution from its two feeders:
              W(i) = A(i) · Σⱼ B(j) · rᵢ/(rᵢ + rⱼ). Played matches become certainties, and the root of the tree is the title chance of every seed, exactly.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Backing seed s pays {(RTP * 100).toFixed(0)}% ÷ P(s wins the title). The cash-out is prize × P(s wins | results so far), a martingale, so cashing out,
              skipping or switching at any moment returns exactly {(RTP * 100).toFixed(0)}% in the long run. Switches are offered while the new prize stays within
              the {fmtMult(MAX_PRIZE)} max win.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
