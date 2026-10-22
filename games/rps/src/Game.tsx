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
import Duel, { HandIcon } from './Board';
import {
  HAND_KEYS,
  HAND_NAMES,
  MAX_MULTIPLIER,
  RISKS,
  RISK_ORDER,
  RTP,
  cashAfter,
  ladder,
  oddsStrip,
  pickHand,
  playThrow,
  reachChance,
  type Effect,
  type Hand,
  type Pick,
  type Risk,
  type Throw,
} from './math';

type Phase = 'idle' | 'throwing' | 'live' | 'over';
type End = 'bust' | 'cashed' | 'max';

interface Round {
  risk: Risk;
  stake: number;
  /** Streak steps so far. */
  k: number;
  cash: number;
  throws: Throw[];
  end: End | null;
}

const END_TITLE: Record<End, string> = { bust: 'Busted', cashed: 'Cashed out', max: 'Max streak' };
const HANDS: Hand[] = [0, 1, 2];

function verdict(t: Throw, risk: Risk, k: number): { word: string; sub: string } {
  const word = t.outcome === 'win' ? 'WIN' : t.outcome === 'draw' ? 'DRAW' : 'LOSS';
  const e: Effect = t.effect;
  if (e === 'advance') return { word, sub: t.outcome === 'draw' ? `counts · ${fmtMult(cashAfter(risk, k))}` : `streak ${k} · ${fmtMult(cashAfter(risk, k))}` };
  if (e === 'replay') return { word, sub: 'throw again' };
  return { word, sub: t.outcome === 'draw' ? 'draws bust' : 'streak lost' };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [risk, setRisk] = useState<Risk>('classic');
  const [hand, setHand] = useState<Hand>(0);
  const [autoPick, setAutoPick] = useState<Pick>(0);
  const [autoTarget, setAutoTarget] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<Throw | null>(null);
  const [face, setFace] = useState<Hand>(0);
  const [seq, setSeq] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // The throw in flight is decided when it starts: leaving mid-animation
  // settles at its real result, never at the pre-throw value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'throwing' ? resolved.current : round?.cash ?? 0));

  const throwMs = turbo.turbo ? 260 : 900;
  const live = phase === 'throwing' || phase === 'live';

  function finish(r: Round, end: End, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    const done = { ...r, end, cash };
    setRound(done);
    setPhase('over');
    return done;
  }

  /** Throws one hand; resolves to the round after it (ended when it busts or tops out), or null if cancelled. */
  async function throwOnce(r: Round, h: Hand): Promise<Round | null> {
    const th = playThrow(r.risk, h, rng);
    const k = r.k + (th.effect === 'advance' ? 1 : 0);
    const cash = th.effect === 'bust' ? 0 : cashAfter(r.risk, k);
    resolved.current = cash;
    setPending(th);
    setSeq((s) => s + 1);
    setPhase('throwing');
    if (!(await timers.wait(throwMs))) return null;
    const next: Round = { ...r, k, cash, throws: [...r.throws, th] };
    setPending(null);
    setSeq((s) => s + 1);
    if (th.effect === 'bust') return finish(next, 'bust', 0);
    if (k >= RISKS[r.risk].maxSteps) return finish(next, 'max', cash);
    setRound(next);
    setPhase('live');
    if (k > 0) track({ type: 'checkpoint', multiplier: cash, winChance: RISKS[r.risk].p });
    return next;
  }

  const fresh = (stake: number): Round => ({ risk, stake, k: 0, cash: RTP, throws: [], end: null });

  async function start(h: Hand = hand) {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r = fresh(bet.value);
    setRound(r);
    void throwOnce(r, h);
  }

  function throwHand(h: Hand) {
    setHand(h);
    if (phase === 'live' && round) void throwOnce(round, h);
  }

  function cashOut() {
    if (phase !== 'live' || !round || round.k === 0) return;
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

  async function playAuto(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    let r = fresh(stake);
    setRound(r);
    for (;;) {
      const next = await throwOnce(r, pickHand(autoPick, rng));
      if (!next) return null;
      if (next.end) return next.cash;
      if (next.k >= autoTarget) return finish(next, 'cashed', next.cash).cash;
      r = next;
      if (!(await timers.wait(turbo.turbo ? 60 : 220))) return null;
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

  // The house hand flickers through the three shapes while a throw is in the air.
  useEffect(() => {
    if (phase !== 'throwing') return;
    const id = window.setInterval(() => setFace((f) => ((f + 1) % 3) as Hand), turbo.turbo ? 45 : 90);
    return () => window.clearInterval(id);
  }, [phase, turbo.turbo]);

  const mainAction = () => {
    if (!manual || auto.running) return;
    if (phase === 'live') throwHand(hand);
    else if (phase === 'idle' || phase === 'over') void start();
  };
  useHotkeys({ space: mainAction, cashOut }, !infoOpen);

  // R / P / S (or 1 / 2 / 3): pick that hand, or throw it while a round is live.
  const keyRef = useRef<(h: Hand) => void>(() => {});
  keyRef.current = (h: Hand) => {
    if (!manual || auto.running || phase === 'throwing') return;
    if (phase === 'live') throwHand(h);
    else change(() => setHand(h));
  };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)) return;
      if (t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
      const i = ['r', 'p', 's'].indexOf(e.key.toLowerCase());
      const j = ['1', '2', '3'].indexOf(e.key);
      const h = i >= 0 ? i : j;
      if (h >= 0) {
        e.preventDefault();
        keyRef.current(h as Hand);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // What the board shows: the live or finished round, else a preview of the settings.
  const rk = round?.risk ?? risk;
  const spec = RISKS[rk];
  const k = round?.k ?? 0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const last = round?.throws[round.throws.length - 1] ?? null;
  const steps = ladder(rk);
  const strip = oddsStrip(rk);

  const shownPlayer: Hand = pending ? pending.player : last && phase !== 'idle' ? last.player : manual ? hand : autoPick === 'random' ? hand : autoPick;
  const shownHouse: Hand | null = pending ? face : last ? last.house : null;
  const centre = !pending && last && round ? verdict(last, rk, k) : null;

  let status = manual ? `Pick a hand · ${spec.label}` : `Auto · cash out at ${autoTarget} ${autoTarget === 1 ? 'win' : 'wins'}`;
  if (phase === 'throwing') status = 'Throwing…';
  if (phase === 'live') status = k === 0 ? 'Draw · throw again' : `Streak ${k} · cash out or throw`;
  if (phase === 'over' && round?.end) status = `${END_TITLE[round.end]} · streak ${k}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // Keep the current rung of the streak row in view.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.children[Math.max(0, k - 1)] as HTMLElement | undefined;
    if (row && el) row.scrollTo({ left: Math.max(0, el.offsetLeft - row.clientWidth / 2 + el.clientWidth / 2), behavior: 'smooth' });
  }, [k, rk]);

  const nextStep = Math.min(k + 1, spec.maxSteps);
  const autoChance = reachChance(risk, autoTarget);
  const showRoundOver = phase === 'over' && round?.end && manual && !auto.running;

  return (
    <GameLayout
      name="Rock Paper Scissors"
      accent="#e879f9"
      className="rps"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={RISKS[risk].vol} />}>Draw rule</Label>
          <Chips
            label="Draw rule"
            options={RISK_ORDER.map((r) => ({ value: r, label: RISKS[r].label, title: RISKS[r].blurb }))}
            value={risk}
            disabled={busy}
            onChange={(v) => change(() => setRisk(v))}
          />
          <p className="rps-blurb">{RISKS[risk].blurb}</p>

          {manual ? (
            <>
              <dl className="og-stats">
                <dt>Win before a loss</dt>
                <dd>{fmtChance(RISKS[risk].p)}</dd>
                <dt>First win pays</dt>
                <dd>{fmtMult(cashAfter(risk, 1))}</dd>
                <dt>Max streak</dt>
                <dd>
                  {RISKS[risk].maxSteps} · {fmtMult(cashAfter(risk, RISKS[risk].maxSteps))}
                </dd>
              </dl>
              {phase === 'live' || phase === 'throwing' ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live' || k === 0} onClick={cashOut}>
                    {k === 0 ? 'Win once to cash out' : <>Cash out <span>{formatAmount(stake * cash, 2)}</span></>}
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={() => throwHand(hand)}>
                    {phase === 'throwing' ? 'Throwing…' : `Throw ${HAND_NAMES[hand]} · next ${fmtMult(cashAfter(rk, nextStep))}`}
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
              <Label hint="each throw">Hand</Label>
              <Chips
                label="Auto hand"
                options={[
                  ...HANDS.map((h) => ({ value: h as Pick, label: HAND_NAMES[h] })),
                  { value: 'random' as Pick, label: 'Random' },
                ]}
                value={autoPick}
                disabled={auto.running}
                onChange={(v) => change(() => setAutoPick(v))}
              />
              <Label hint={<b>{fmtMult(cashAfter(risk, autoTarget))}</b>}>
                Cash out at {autoTarget} {autoTarget === 1 ? 'win' : 'wins'}
              </Label>
              <Slider
                label="Auto cash-out streak"
                min={1}
                max={RISKS[risk].maxSteps}
                value={Math.min(autoTarget, RISKS[risk].maxSteps)}
                disabled={auto.running}
                onChange={(v) => change(() => setAutoTarget(v))}
              />
              <dl className="og-stats">
                <dt>Chance to reach</dt>
                <dd>{fmtChance(autoChance)}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && !live && <p className="rps-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win before a loss', value: fmtChance(spec.p), sub: spec.draw === 'replay' ? 'draws replay' : spec.draw === 'advance' ? 'draws win too' : 'draws bust', tone: 'chance' },
          { label: 'Cash out now', value: k > 0 || (phase === 'over' && round) ? fmtMult(cash) : '—', sub: formatAmount(stake * (k > 0 || phase === 'over' ? cash : 0), 2), tone: 'cash' },
          {
            label: phase === 'over' ? 'Streak reached' : 'Next win',
            value: phase === 'over' ? (k > 0 ? fmtMult(cashAfter(rk, k)) : '—') : fmtMult(cashAfter(rk, nextStep)),
            sub: phase === 'over' ? `${k} of ${spec.maxSteps}` : `win ${nextStep} of ${spec.maxSteps}`,
            tone: 'prize',
          },
        ]}
      />

      <Board className={'rps-board' + (showRoundOver ? ' over' : '') + (!manual ? ' auto' : '')}>
        {!manual && phase === 'over' && round && <InstantResult multiplier={round.cash} stake={round.stake} id={history[0]?.id ?? 0} />}
        <Duel player={shownPlayer} house={shownHouse} throwing={!!pending} last={pending ? null : phase === 'idle' ? null : last} centre={centre} seq={seq} shakeMs={throwMs} away={!!showRoundOver} />
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
            placement="center"
          />
        )}
      </Board>

      {manual && (
        <div className="rps-hands" role="group" aria-label={phase === 'live' ? 'Throw a hand' : 'Choose your hand'}>
          {HANDS.map((h) => (
            <button
              key={h}
              type="button"
              className={'rps-hand' + (hand === h ? ' on' : '') + (phase === 'live' ? ' throw' : '')}
              disabled={phase === 'throwing' || auto.running}
              aria-pressed={hand === h}
              onClick={() => (phase === 'live' ? throwHand(h) : change(() => setHand(h)))}
            >
              <HandIcon hand={h} />
              <span>{HAND_NAMES[h]}</span>
              <kbd>{HAND_KEYS[h]}</kbd>
            </button>
          ))}
        </div>
      )}

      <div className="rps-streak" aria-label="Streak ladder">
        <div className="rps-strip" title="The three equally likely house hands">
          {(['advance', 'replay', 'bust'] as Effect[]).flatMap((e) =>
            Array.from({ length: strip[e] }, (_, i) => <i key={e + i} className={e} />),
          )}
        </div>
        <div className="rps-rungs" ref={rowRef}>
          {steps.map((m, i) => {
            const n = i + 1;
            const state = n <= k ? 'done' : n === k + 1 && phase !== 'over' && phase !== 'idle' ? 'next' : '';
            const target = !manual && n === autoTarget ? ' target' : '';
            return (
              <span key={n} className={'rps-rung ' + state + target + (phase === 'over' && round?.end === 'bust' && n === k + 1 ? ' bust' : '')}>
                <small>{n}</small>
                {fmtMult(m)}
              </span>
            );
          })}
        </div>
      </div>

      {phase === 'live' || phase === 'throwing' ? (
        <ChanceBar
          p={spec.p}
          label="Next win before a loss"
          note={`Of the 3 equally likely house hands, ${strip.advance} ${strip.advance === 1 ? 'advances' : 'advance'} you${strip.replay ? ', 1 replays' : ''} and ${strip.bust} ${strip.bust === 1 ? 'busts' : 'bust'}.`}
        />
      ) : (
        <Caption>
          The house picks rock, paper or scissors at random, so each throw wins, draws or loses one time in three. {spec.blurb}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Rock Paper Scissors" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Beat the house hand as many times in a row as you dare, then cash out. A loss ends the round and takes the stake.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose a draw rule and a hand (click it, or press R, P or S), then press Bet (Space). Your hand is thrown at once.</li>
              <li>
                Paper covers rock, rock blunts scissors, scissors cut paper. After a win, cash out (C) or throw again: click a hand, press its key, or press
                Space to repeat the last one.
              </li>
              <li>Reaching the top of the ladder ({RISKS[risk].maxSteps} steps on {RISKS[risk].label}) cashes out for you.</li>
              <li>Auto plays whole rounds: it throws the hand you choose (or a random one) and cashes out at your target streak, with the usual stop rules.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The coloured strip by the ladder is the three house hands for any hand you pick: <b style={{ color: 'var(--green)' }}>green</b> advances your
              streak, <b style={{ color: 'var(--gold)' }}>gold</b> replays the throw and <b style={{ color: 'var(--red)' }}>red</b> busts. Each is exactly one
              chance in three, whatever you throw.
            </p>
            <ul>
              <li>Easy: draws count as wins. Each throw advances 2 times in 3 and pays ×1.5.</li>
              <li>Classic: draws are replayed. You win before you lose half the time and each win pays ×2.</li>
              <li>Hard: draws bust. Each throw advances 1 time in 3 and pays ×3.</li>
            </ul>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The house hand is uniform and independent of yours, so P(win) = P(draw) = P(loss) = 1/3. In Classic, draws repeat, so the chance of a win
              before a loss is the geometric series (1/3)(1 + 1/3 + 1/9 + …) = 1/2. After k steps the cash-out is {RTP} × f<sup>k</sup> with f = 1 / P(step),
              and each throw is a fair bet: E[cash-out after] = cash-out now. By the optional stopping theorem every strategy returns exactly{' '}
              {(RTP * 100).toFixed(0)}%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The 1% edge is taken once, at the start: the first Classic win pays 1.98× and every further win doubles (3.96×, 7.92×, …). Your hand choice and
              when you cash out change only the volatility, never the return. The largest payout is {fmtMult(MAX_MULTIPLIER)} (20 Classic wins).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
