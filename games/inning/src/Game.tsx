import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
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
import { useEffect, useRef, useState } from 'react';
import { Diamond, Strip, Wheel, sectorLabel, type Token } from './Board';
import { RTP, TARGETS, WHEEL, cashOut as cashAt, ending, prize, startState, step, volatilityOf, winChance, type State, type Target } from './math';

type Phase = 'idle' | 'spinning' | 'checkpoint' | 'over';
type Outcome = 'won' | 'out' | 'cashed';

interface Round {
  k: Target;
  stake: number;
  state: State;
  cash: number;
  outcome: Outcome | null;
}

const TITLE: Record<Outcome, string> = { won: 'Runs scored', out: 'Third out', cashed: 'Cashed out' };
const ABORT = new Error('aborted');

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [k, setK] = useState<Target>(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [outs, setOuts] = useState(0);
  const [runs, setRuns] = useState(0);
  const [rot, setRot] = useState(0);
  const [landed, setLanded] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [msNow, setMsNow] = useState({ spin: 700, step: 350 });

  // The open ticket's value right now, set synchronously when the stake is
  // placed and when a spin is drawn, so leaving mid-animation settles at the
  // spin's real result. The ticket reads only this ref.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);
  const busy = useRef(false);
  const rotRef = useRef(0);
  const ids = useRef(0);

  const live = phase === 'spinning' || phase === 'checkpoint';
  const manualMs = turbo.turbo ? { spin: 180, step: 90 } : { spin: 700, step: 350 };
  const autoMs = turbo.turbo ? { spin: 60, step: 40 } : { spin: 180, step: 90 };

  async function pause(ms: number) {
    if (!(await timers.wait(ms))) throw ABORT;
  }

  /** One spin: drawn now, then the wheel turns, then every runner moves a base at a time. */
  async function spinOnce(r: Round, tk: Token[], ms: { spin: number; step: number }): Promise<{ round: Round; tokens: Token[] }> {
    const idx = rng.int(WHEEL.length);
    const res = step(r.state, WHEEL[idx]);
    const won = res.kind === 'hit' && res.won;
    const over = res.kind === 'out' && res.over;
    const cash = won ? prize(r.k) : over ? 0 : cashAt(r.k, res.state);
    resolved.current = cash;

    let cur = tk.filter((t) => t.pos < 4);
    if (res.kind === 'hit') cur = [...cur, { id: ++ids.current, pos: 0 }];
    setMsNow(ms);
    setTokens(cur);
    setLanded(null);
    const target = -(idx * 30 + 15);
    rotRef.current += 720 + ((((target - rotRef.current) % 360) + 360) % 360);
    setRot(rotRef.current);
    await pause(ms.spin);
    setLanded(idx);

    if (res.kind === 'out') {
      setOuts(res.state.outs);
    } else {
      for (let i = 0; i < res.n; i++) {
        await pause(ms.step);
        const arriving = cur.filter((t) => t.pos === 3).length;
        cur = cur.map((t) => (t.pos >= 4 ? t : { ...t, pos: t.pos + 1 }));
        setTokens(cur);
        if (arriving) setRuns((x) => x + arriving);
      }
    }
    const next: Round = { ...r, state: res.state, cash, outcome: won ? 'won' : over ? 'out' : null };
    setRound(next);
    return { round: next, tokens: cur };
  }

  function clearBoard() {
    setRound(null);
    setTokens([]);
    setOuts(0);
    setRuns(0);
    setLanded(null);
    setPhase('idle');
  }

  function finish(r: Round, outcome: Outcome) {
    ticket.settle(r.cash);
    pushHistory(r.cash);
    setRound({ ...r, outcome });
    setPhase('over');
  }

  const tokensRef = useRef<Token[]>([]);
  async function advance(r: Round) {
    if (busy.current) return;
    busy.current = true;
    setPhase('spinning');
    try {
      const out = await spinOnce(r, tokensRef.current, manualMs);
      tokensRef.current = out.tokens;
      busy.current = false;
      if (out.round.outcome) return finish(out.round, out.round.outcome);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: out.round.cash, winChance: winChance(out.round.state) });
    } catch {
      busy.current = false;
    }
  }

  async function start() {
    if (live || autoBusy || busy.current || bet.blocked) return;
    busy.current = true;
    const ok = await ticket.place(bet.value);
    busy.current = false;
    if (!ok) return;
    resolved.current = RTP;
    timers.clearAll();
    clearBoard();
    tokensRef.current = [];
    const r: Round = { k, stake: bet.value, state: startState(k), cash: RTP, outcome: null };
    setRound(r);
    await advance(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    finish(round, 'cashed');
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    tokensRef.current = [];
    clearBoard();
  }

  // Auto plays a whole inning with no cash-out and resolves to the payout.
  async function playAuto(stake: number): Promise<number | null> {
    if (busy.current || !(await ticket.place(stake))) return null;
    busy.current = true;
    resolved.current = RTP;
    setAutoBusy(true);
    clearBoard();
    let r: Round = { k, stake, state: startState(k), cash: RTP, outcome: null };
    setRound(r);
    let tk: Token[] = [];
    try {
      do {
        const out = await spinOnce(r, tk, autoMs);
        r = out.round;
        tk = out.tokens;
      } while (!r.outcome);
    } catch {
      busy.current = false;
      return null;
    }
    ticket.settle(r.cash);
    pushHistory(r.cash);
    setPhase('over');
    setAutoBusy(false);
    busy.current = false;
    return r.cash;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || autoBusy || auto.running;

  useEffect(() => {
    timers.clearAll();
    tokensRef.current = [];
    clearBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => {
        if (isAuto) return auto.running ? auto.stop() : !autoBusy && !bet.blocked ? auto.start() : undefined;
        if (phase === 'checkpoint' && round) void advance(round);
        else if (!live) void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------
  const kk = round?.k ?? k;
  const state = round?.state ?? startState(kk);
  const stake = round?.stake ?? bet.value;
  const cash = round?.cash ?? RTP;
  const finished = phase === 'over' && round?.outcome;
  const result: 'won' | 'lost' | null = finished && round!.outcome !== 'cashed' ? (round!.outcome === 'out' ? 'lost' : 'won') : null;

  // The strip: every way the inning can end, indexed by total runs (the last entry is "k or more").
  const strip = new Array<number>(kk + 1).fill(0);
  if (finished && round!.outcome !== 'cashed') strip[round!.outcome === 'won' ? kk : Math.min(runs, kk)] = 1;
  else if (finished) ending(state).forEach((p, j) => (strip[kk - state.need + j] = p));
  else ending(state).forEach((p, j) => (strip[kk - state.need + j] = p));

  let status = `Ready · score ${k} ${k === 1 ? 'run' : 'runs'}`;
  if (phase === 'spinning') status = 'Spinning…';
  if (phase === 'checkpoint') status = `${runs} of ${kk} runs · ${outs} ${outs === 1 ? 'out' : 'outs'}`;
  if (finished) status = TITLE[round!.outcome!];
  if (isAuto && (auto.running || autoBusy)) status = `Auto${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
  const tone = finished ? (round!.cash > 0 ? 'won' : 'lost') : live || autoBusy ? 'live' : 'idle';

  const caption =
    landed === null
      ? phase === 'spinning' || autoBusy
        ? 'spinning…'
        : 'spin the wheel'
      : `last spin: ${sectorLabel(WHEEL[landed])}`;

  return (
    <GameLayout
      name="Inning"
      accent="#5ec4e6"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={volatilityOf(k)} />}>Runs to score</Label>
          <Chips label="Runs to score" options={TARGETS.map((v) => ({ value: v, label: v }))} value={k} disabled={locked} onChange={(v) => change(() => setK(v))} />

          {isAuto ? (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live || autoBusy} />
          ) : phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && void advance(round)}>
                Spin
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'spinning' ? 'Spinning…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(finished && round!.outcome !== 'cashed' ? (result === 'won' ? 1 : 0) : winChance(state)), tone: 'chance' },
          { label: 'Prize', value: fmtMult(prize(kk)), tone: 'prize' },
        ]}
      />

      <Board className="in-board">
        <div className="in-stage">
          <Diamond tokens={tokens} outs={outs} runs={runs} need={state.need} target={kk} stepMs={msNow.step} result={result} />
          <Wheel rot={rot} ms={msNow.spin} landed={landed} caption={caption} />
        </div>
        <Strip ending={strip} scored={0} target={kk} />
        {phase === 'over' && round?.outcome && !isAuto && (
          <RoundOver
            key={history[0]?.id}
            title={TITLE[round.outcome]}
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

      <Caption>
        Score {kk} {kk === 1 ? 'run' : 'runs'} before three outs; +1, +2 and +4 move every runner that far.
      </Caption>

      {infoOpen && (
        <InfoModal title="Inning" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Score the number of runs you chose before the third out.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many runs to score, then bet. The wheel spins once.</li>
              <li>Out: a light goes on. Three lights and the round is lost.</li>
              <li>+1, +2, +4: a new runner starts, then every runner moves that many bases. Passing the last base scores a run.</li>
              <li>After each spin, cash out or spin again (Space). Auto plays whole innings.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The wheel has 12 equal sectors: 8 Out, 2 of +1, one +2, one +4. The bar under the board shows every way the inning can end; its green part is your chance to win.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Your win chance is the average of the win chances after each of the 12 sectors, computed exactly over (runners, outs, runs needed). Because the average of the next win
              chances equals the current one, the cash-out prize × win chance is a martingale.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ the win chance at the start. Cash-out is that prize times the current win chance, so every way of playing returns{' '}
              {(RTP * 100).toFixed(0)}% in the long run.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
