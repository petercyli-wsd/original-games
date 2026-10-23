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
  Slider,
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
import { useEffect, useRef, useState } from 'react';
import Coins, { CoinIcon, turnTo } from './Board';
import {
  COINS,
  MAX_FLIPS,
  MAX_MULTIPLIER,
  RTP,
  SIDE_KEYS,
  SIDE_NAMES,
  autoCallAt,
  cashAfter,
  flip,
  flipChance,
  ladder,
  majority,
  maxFlips,
  outcomes,
  reachChance,
  volatilityOf,
  winWays,
  type AutoCall,
  type Call,
  type Flip,
} from './math';

type Phase = 'idle' | 'flipping' | 'live' | 'over';
type End = 'bust' | 'cashed' | 'max';

interface Round {
  n: number;
  need: number;
  stake: number;
  /** Winning flips so far. */
  s: number;
  cash: number;
  flips: Flip[];
  end: End | null;
}

const END_TITLE: Record<End, string> = { bust: 'Wrong call', cashed: 'Cashed out', max: 'Top of the ladder' };
const AUTO_CALLS: { value: AutoCall; label: string }[] = [
  { value: 0, label: 'Heads' },
  { value: 1, label: 'Tails' },
  { value: 'random', label: 'Random' },
  { value: 'alternate', label: 'Alternate' },
];

const CALL_KEY: Record<string, string> = { 0: SIDE_KEYS[0], 1: SIDE_KEYS[1], random: 'R', alternate: 'A' };

/** The icon on a call button: one face, both faces stacked (random) or side by side (alternate). */
function CallIcon({ c }: { c: AutoCall }) {
  if (c === 0 || c === 1) return <CoinIcon side={c} />;
  return (
    <span className={c === 'random' ? 'cf-rand' : 'cf-alt'} aria-hidden="true">
      <CoinIcon side={0} />
      <CoinIcon side={1} />
    </span>
  );
}

const callName = (c: Call) => (c === 'random' ? 'Random' : SIDE_NAMES[c]);
const needText = (n: number, need: number) => (n === 1 ? '1 coin' : `${need === n ? 'all' : `${need}+`} of ${n} coins`);
const fitRots = (rots: number[], n: number) => Array.from({ length: n }, (_, i) => rots[i] ?? (rots[0] ?? 0));

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [coins, setCoins] = useState(1);
  const [need, setNeed] = useState(1);
  const [call, setCall] = useState<Call>(0);
  const [autoCall, setAutoCall] = useState<AutoCall>(0);
  const [autoTarget, setAutoTarget] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<Flip | null>(null);
  const [rots, setRots] = useState<number[]>([0]);
  const [tossKey, setTossKey] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // The flip in the air is decided when it starts: leaving mid-animation
  // settles at its real result, never at the pre-flip value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'flipping' ? resolved.current : round?.cash ?? 0));

  const flipMs = turbo.turbo ? 260 : 1000;
  const live = phase === 'flipping' || phase === 'live';

  function finish(r: Round, end: End, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    const done = { ...r, end, cash };
    setRound(done);
    setPhase('over');
    return done;
  }

  /** Flips the coins once; resolves to the round after it (ended on a loss or the top rung), or null if cancelled. */
  async function flipOnce(r: Round, c: Call): Promise<Round | null> {
    const f = flip(r.n, r.need, c, rng);
    const s = r.s + (f.win ? 1 : 0);
    const cash = f.win ? cashAfter(r.n, r.need, s) : 0;
    resolved.current = cash;
    const turns = turbo.turbo ? 2 : 4;
    setRots((prev) => fitRots(prev, r.n).map((x, i) => turnTo(x, f.coins[i], turns + (i % 2))));
    setPending(f);
    setTossKey((k) => k + 1);
    setPhase('flipping');
    const stagger = (r.n - 1) * Math.min(60, flipMs / 12);
    if (!(await timers.wait(flipMs + stagger + 40))) return null;
    const next: Round = { ...r, s, cash, flips: [...r.flips, f] };
    setPending(null);
    if (!f.win) return finish(next, 'bust', 0);
    if (s >= maxFlips(r.n, r.need)) return finish(next, 'max', cash);
    setRound(next);
    setPhase('live');
    track({ type: 'checkpoint', multiplier: cash, winChance: flipChance(r.n, r.need) });
    return next;
  }

  const fresh = (stake: number): Round => ({ n: coins, need, stake, s: 0, cash: RTP, flips: [], end: null });

  async function start(c: Call = call) {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r = fresh(bet.value);
    setRound(r);
    void flipOnce(r, c);
  }

  function flipWith(c: Call) {
    setCall(c);
    if (phase === 'live' && round) void flipOnce(round, c);
  }

  function cashOut() {
    // Auto rounds cash out at their target; the C key must not end one early mid-run.
    if (auto.mode !== 'manual' || auto.running) return;
    if (phase !== 'live' || !round || round.s === 0) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setPending(null);
    setPhase('idle');
  }

  /** Changing a setting after a round clears the board to a preview. */
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  /** Picks the call; in a fresh preview the coins half-turn to show it. */
  function chooseCall(c: Call) {
    change(() => setCall(c));
    if (c !== 'random' && (phase === 'idle' || phase === 'over')) setRots((prev) => prev.map((x) => turnTo(x, c, 0)));
  }

  function chooseAutoCall(c: AutoCall) {
    change(() => setAutoCall(c));
    if (c === 0 || c === 1) setRots((prev) => prev.map((x) => turnTo(x, c, 0)));
  }

  function chooseCoins(n: number) {
    change(() => {
      setCoins(n);
      setNeed(majority(n));
      setAutoTarget((t) => Math.min(t, maxFlips(n, majority(n))));
    });
  }

  function chooseNeed(k: number) {
    change(() => {
      setNeed(k);
      setAutoTarget((t) => Math.min(t, maxFlips(coins, k)));
    });
  }

  async function playAuto(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    let r = fresh(stake);
    setRound(r);
    const target = Math.min(autoTarget, maxFlips(coins, need));
    for (let i = 0; ; i++) {
      const next = await flipOnce(r, autoCallAt(autoCall, i));
      if (!next) return null;
      if (next.end) return next.cash;
      if (next.s >= target) return finish(next, 'cashed', next.cash).cash;
      r = next;
      if (!(await timers.wait(turbo.turbo ? 60 : 240))) return null;
    }
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const manual = auto.mode === 'manual';
  const busy = live || auto.running;

  // Switching Manual / Auto is a settings change too.
  const mode = auto.mode;
  useEffect(() => {
    if (phase === 'over') clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // What the board shows: the live or finished round, else a preview of the settings.
  const bn = round?.n ?? coins;
  const bk = round?.need ?? need;
  useEffect(() => {
    if (rots.length !== bn) setRots((prev) => fitRots(prev, bn));
  }, [bn, rots.length]);

  const mainAction = () => {
    if (!manual || auto.running) return;
    if (phase === 'live') flipWith(call);
    else if (phase === 'idle' || phase === 'over') void start();
  };
  useHotkeys({ space: mainAction, cashOut }, !infoOpen);

  // H / T / R: pick that call, or flip with it while a round is live. In Auto, H / T / R / A pick the auto call.
  const keyRef = useRef<(c: AutoCall) => void>(() => {});
  keyRef.current = (c: AutoCall) => {
    if (auto.running) return;
    if (!manual) {
      if (!live) chooseAutoCall(c);
      return;
    }
    if (c === 'alternate' || phase === 'flipping') return;
    if (phase === 'live') flipWith(c);
    else chooseCall(c);
  };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)) return;
      if (t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
      const k = e.key.toLowerCase();
      const c: AutoCall | null = k === 'h' ? 0 : k === 't' ? 1 : k === 'r' ? 'random' : k === 'a' ? 'alternate' : null;
      if (c !== null) {
        e.preventDefault();
        keyRef.current(c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  const s = round?.s ?? 0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const p = flipChance(bn, bk);
  const ways = winWays(bn, bk);
  const total = outcomes(bn);
  const steps = ladder(bn, bk);
  const top = steps.length;
  const last = round?.flips[round.flips.length - 1] ?? null;
  const landed = !pending && last && phase !== 'idle' ? last : null;
  const nextStep = Math.min(s + 1, top);
  const vol = volatilityOf(coins, need);
  const showRoundOver = phase === 'over' && !!round?.end && manual && !auto.running;

  let status = manual ? `Call ${callName(call)} · ${needText(coins, need)}` : `Auto · cash out at ${autoTarget} ${autoTarget === 1 ? 'win' : 'wins'}`;
  if (phase === 'flipping') status = 'Flipping…';
  if (phase === 'live') status = `Streak ${s} · cash out or flip again`;
  if (phase === 'over' && round?.end) status = `${END_TITLE[round.end]} · ${s} ${s === 1 ? 'win' : 'wins'}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // The line under the coins.
  let verdict: { tone: string; word: string; sub: string };
  if (pending) verdict = { tone: 'air', word: pending.random ? `Random · ${SIDE_NAMES[pending.call]}` : `Calling ${SIDE_NAMES[pending.call]}`, sub: bn === 1 ? 'in the air…' : `need ${needText(bn, bk)}` };
  else if (landed)
    verdict = landed.win
      ? { tone: 'win', word: bn === 1 ? `${SIDE_NAMES[landed.call]} · Win` : `${landed.matches} of ${bn} ${SIDE_NAMES[landed.call]} · Win`, sub: `streak ${s} · ${fmtMult(cashAfter(bn, bk, s))}` }
      : { tone: 'lose', word: bn === 1 ? `${SIDE_NAMES[1 - landed.call]} · Loss` : `${landed.matches} of ${bn} ${SIDE_NAMES[landed.call]} · Loss`, sub: `you called ${SIDE_NAMES[landed.call]}` };
  else verdict = { tone: 'idle', word: manual ? `Your call: ${callName(call)}` : `Auto call: ${AUTO_CALLS.find((a) => a.value === autoCall)?.label}`, sub: bn === 1 ? 'call it right to double up' : `win when ${needText(bn, bk)} match` };

  // Keep the current rung of the streak row in view.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.children[Math.max(0, s - 1)] as HTMLElement | undefined;
    if (row && el) row.scrollTo({ left: Math.max(0, el.offsetLeft - row.clientWidth / 2 + el.clientWidth / 2), behavior: 'smooth' });
  }, [s, bn, bk]);

  return (
    <GameLayout
      name="Coin Flip"
      accent="#fbbf24"
      className="cf"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Coins</Label>
          <Chips label="Coins per flip" options={COINS.map((n) => ({ value: n, label: n }))} value={coins} disabled={busy} onChange={chooseCoins} />
          {coins > 1 && (
            <>
              <Label hint="must land on your call">Match</Label>
              <Chips
                label="Coins that must match"
                options={Array.from({ length: coins }, (_, i) => ({ value: i + 1, label: i + 1 === coins ? 'All' : `${i + 1}+` }))}
                value={need}
                disabled={busy}
                onChange={chooseNeed}
              />
            </>
          )}

          {manual ? (
            <>
              <dl className="og-stats">
                <dt>Flip wins</dt>
                <dd>{fmtChance(flipChance(coins, need))}</dd>
                <dt>First win pays</dt>
                <dd>{fmtMult(cashAfter(coins, need, 1))}</dd>
                <dt>Top rung</dt>
                <dd>
                  {maxFlips(coins, need)} · {fmtMult(cashAfter(coins, need, maxFlips(coins, need)))}
                </dd>
              </dl>
              <div className="cf-pick">
                <Label hint={phase === 'live' ? 'pick one to flip' : undefined}>{live ? 'Flip again' : 'Your call'}</Label>
                <div className="cf-calls" role="group" aria-label={phase === 'live' ? 'Flip with a call' : 'Choose your call'}>
                  {([0, 1, 'random'] as Call[]).map((c) => (
                    <button
                      key={String(c)}
                      type="button"
                      className={'cf-call' + (call === c ? ' on' : '') + (phase === 'live' ? ' go' : '')}
                      disabled={phase === 'flipping' || auto.running}
                      aria-pressed={call === c}
                      aria-label={phase === 'live' ? `Flip ${callName(c)}` : callName(c)}
                      onClick={() => (phase === 'live' ? flipWith(c) : chooseCall(c))}
                    >
                      <CallIcon c={c} />
                      <span>{callName(c)}</span>
                      <kbd>{CALL_KEY[String(c)]}</kbd>
                    </button>
                  ))}
                </div>
              </div>
              {live ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live' || s === 0} onClick={cashOut}>
                    {s === 0 ? 'Cash out' : <>Cash out <span>{formatAmount(stake * cash, 2)}</span></>}
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={() => flipWith(call)}>
                    {phase === 'flipping' ? 'Flipping…' : `Flip ${callName(call)} · next ${fmtMult(cashAfter(bn, bk, nextStep))}`}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live}>
              <div className="cf-pick">
                <Label hint="keys H · T · R · A">Call each flip</Label>
                <div className="cf-calls four" role="group" aria-label="Auto call each flip">
                  {AUTO_CALLS.map(({ value: c, label }) => (
                    <button
                      key={String(c)}
                      type="button"
                      className={'cf-call' + (autoCall === c ? ' on' : '')}
                      disabled={auto.running}
                      aria-pressed={autoCall === c}
                      onClick={() => chooseAutoCall(c)}
                    >
                      <CallIcon c={c} />
                      <span>{label}</span>
                      <kbd>{CALL_KEY[String(c)]}</kbd>
                    </button>
                  ))}
                </div>
              </div>
              <Label
                hint={
                  <>
                    <b className="cf-gold">{fmtMult(cashAfter(coins, need, autoTarget))}</b> · {fmtChance(reachChance(coins, need, autoTarget))}
                  </>
                }
              >
                Cash out at {autoTarget} {autoTarget === 1 ? 'win' : 'wins'}
              </Label>
              <Slider
                label="Auto cash-out streak"
                min={1}
                max={maxFlips(coins, need)}
                value={Math.min(autoTarget, maxFlips(coins, need))}
                disabled={auto.running}
                onChange={(v) => change(() => setAutoTarget(v))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && !live && <p className="cf-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Flip wins', value: fmtChance(p), sub: `${ways} of ${total} outcomes`, tone: 'chance' },
          { label: 'Cash out now', value: s > 0 || (phase === 'over' && round) ? fmtMult(cash) : '—', sub: formatAmount(stake * (s > 0 || phase === 'over' ? cash : 0), 2), tone: 'cash' },
          {
            label: phase === 'over' ? 'Streak reached' : 'Next win',
            value: phase === 'over' ? (s > 0 ? fmtMult(cashAfter(bn, bk, s)) : '—') : fmtMult(cashAfter(bn, bk, nextStep)),
            sub: phase === 'over' ? `${s} of ${top}` : `win ${nextStep} of ${top}`,
            tone: 'prize',
          },
        ]}
      />

      <Board className={'cf-board' + (showRoundOver ? ' over' : '') + (!manual ? ' auto' : '')}>
        {!manual && phase === 'over' && round && <InstantResult multiplier={round.cash} stake={round.stake} id={history[0]?.id ?? 0} />}
        <div className="cf-arena">
          <Coins rots={fitRots(rots, bn)} tossKey={tossKey} tossing={!!pending} ms={flipMs} result={landed ? { call: landed.call, coins: landed.coins, win: landed.win } : null} />
          <div key={`${tossKey}-${pending ? 'a' : 'l'}`} className={`cf-verdict ${verdict.tone}`} aria-live="polite">
            <b>{verdict.word}</b>
            <span>{verdict.sub}</span>
          </div>
        </div>
        {showRoundOver && round?.end && (
          <RoundOver
            key={history[0]?.id}
            title={END_TITLE[round.end]}
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

      <div className="cf-streak" aria-label="Streak ladder">
        <div className={'cf-strip' + (total > 8 ? ' dense' : '')} title={`${ways} of the ${total} equally likely outcomes win`}>
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < ways ? 'w' : 'l'} />
          ))}
        </div>
        <div className="cf-rungs" ref={rowRef}>
          {steps.map((m, i) => {
            const n = i + 1;
            const f = round?.flips[i];
            const state = n <= s ? 'done' : n === s + 1 && live ? 'next' : '';
            const bust = phase === 'over' && round?.end === 'bust' && n === s + 1;
            const target = !manual && n === Math.min(autoTarget, top) ? ' target' : '';
            return (
              <span key={n} className={'cf-rung ' + state + target + (bust ? ' bust' : '')}>
                <small>
                  {f && (n <= s || bust) ? <CoinIcon side={f.call} /> : null}
                  {n}
                </small>
                {fmtMult(m)}
              </span>
            );
          })}
        </div>
      </div>

      {live ? (
        <ChanceBar
          p={p}
          label="Next flip wins"
          note={bn === 1 ? 'One fair coin: your call lands exactly half the time.' : `${ways} of the ${total} equally likely ways ${bn} coins can land give ${needText(bn, bk)} on your call.`}
        />
      ) : (
        <Caption>
          Every coin is a fair 50/50 toss. {bn === 1 ? 'Call it right and your cash-out doubles' : `Win a flip when ${needText(bn, bk)} land on your call (${fmtChance(p)})`}; one wrong flip loses the stake. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Coin Flip" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Call the toss right as many times in a row as you dare, then cash out. One wrong call ends the round and takes the stake.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick Heads, Tails or Random (or press H, T or R), then press Bet (Space). The first flip goes up at once.</li>
              <li>After a win, cash out (C) or flip again: click a call, press its key, or press Space to repeat your last call.</li>
              <li>
                Reaching the top rung ({MAX_FLIPS} wins with one coin) cashes out for you. With more coins the ladder is shorter, because each win pays more.
              </li>
              <li>Auto plays whole rounds: it calls the side you choose (fixed, random or alternating) and cashes out at your target streak, with the usual stop rules.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The strip beside the ladder has one cell for each equally likely way the coins can land: <b style={{ color: 'var(--green)' }}>green</b> cells
              win the flip, <b style={{ color: 'var(--red)' }}>red</b> cells lose it. With one coin that is one of two; with five coins needing three it is 16
              of 32.
            </p>
            <ul>
              <li>Coins: how many are tossed each flip (1 to 5).</li>
              <li>Match: how many of them must show your call. Fewer is safer and pays less per win; "All" is the long shot.</li>
            </ul>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each coin is an independent fair toss, so the number landing on your call is binomial: W(n, k) = Σ<sub>j≥k</sub> C(n, j) of the 2<sup>n</sup>{' '}
              outcomes win, and a flip wins with p = W / 2<sup>n</sup>. After s wins the cash-out is {RTP} × (1/p)<sup>s</sup>, so every flip is a fair bet:
              p × (1/p) × c = c. The cash-out is a martingale and, by the optional stopping theorem, every way of playing returns exactly{' '}
              {(RTP * 100).toFixed(0)}%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The 1% edge is taken once, at the start: one coin pays 1.98× for the first win and doubles with every further win (3.96×, 7.92×, …). Your call,
              the coin settings and when you cash out change only the volatility, never the return. The largest payout is {fmtMult(MAX_MULTIPLIER)} (20
              one-coin wins); every ladder stops at or below it.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
