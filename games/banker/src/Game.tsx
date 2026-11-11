import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  ACCENTS,
  Board,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  PanelFoot,
  RoundOver,
  StageTop,
  VolBadge,
  eventMs,
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
import { BOARDS, BOARD_NAME, CASES, PRIZES, RTP, deal, pays, profitCount, sealedOthers, sealedPrizes, shuffle, type BoardId } from './math';

type Phase = 'idle' | 'opening' | 'settling' | 'checkpoint' | 'over';
type Outcome = 'deal' | 'full';

interface Round {
  board: BoardId;
  stake: number;
  /** Case i holds cases[i]; case 0 is yours. */
  cases: number[];
  opened: number[];
  cash: number;
  outcome: Outcome | null;
  note: string;
}

const OUTCOME_TITLE: Record<Outcome, string> = { deal: 'Deal taken', full: 'Your case paid' };
const IDLE_NOTE = 'Deal: average of lit bars, less 1%';

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [board, setBoard] = useState<BoardId>('classic');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [scan, setScan] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The value of the open ticket right now, set synchronously when the bet is
  // placed and when each case is drawn (never read from rendered state), so
  // leaving mid-opening settles at the true result.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => resolved.current);
  const busy = useRef(false);

  const ms = eventMs(turbo.turbo);
  const live = phase === 'opening' || phase === 'settling' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number, note: string) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, note });
    setScan(null);
    setPhase('over');
    busy.current = false;
  }

  function openNext(r: Round) {
    if (busy.current) return;
    busy.current = true;
    const left = sealedOthers(r.opened);
    const k = rng.int(left.length);
    const c = left[k];
    const prize = r.cases[c];
    const opened = [...r.opened, c];
    const sealed = sealedPrizes(r.cases, opened);
    const final = opened.length >= CASES - 1;
    const cash = final ? pays(r.cases[0]) : deal(sealed);
    const v = pays(prize);
    let note: string;
    if (final) note = `Last other case: yours is ${fmtMult(cash)}`;
    else if (Math.abs(v - r.cash) < 1e-9) note = 'Prize on Deal line: Deal same';
    else if (v < r.cash) note = `Prize below Deal line: Deal up ${(cash - r.cash).toFixed(2)}×`;
    else note = `Prize above Deal line: Deal down ${(r.cash - cash).toFixed(2)}×`;
    resolved.current = cash;
    setPhase('opening');
    // A marker passes over the sealed cases and lands on the drawn one.
    for (let j = 1; j <= 3; j++) timers.after((ms * j) / 4, () => setScan(left[(k + 4 - j + left.length * 4) % left.length]));
    timers.after(ms, () => {
      const next = { ...r, opened, cash, note };
      setRound(next);
      setScan(null);
      setPhase('settling');
      // The line then takes a moment to move to its new height.
      timers.after(ms, () => {
        if (final) return finish(next, 'full', cash, note);
        setPhase('checkpoint');
        busy.current = false;
        track({ type: 'checkpoint', multiplier: cash, winChance: profitCount(sealed) / sealed.length });
      });
    });
  }

  async function start() {
    if (live || busy.current || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    const r: Round = { board, stake: bet.value, cases: shuffle(PRIZES[board], (n) => rng.int(n)), opened: [], cash: RTP, outcome: null, note: IDLE_NOTE };
    setRound(r);
    openNext(r);
  }

  function takeDeal() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    finish(round, 'deal', round.cash, `Deal taken at ${fmtMult(round.cash)}`);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setScan(null);
    setPhase('idle');
  }

  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? openNext(round) : !live ? void start() : undefined),
      cashOut: takeDeal,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the setting.
  const b = round?.board ?? board;
  const prizes = PRIZES[b];
  const cases = round?.cases ?? null;
  const opened = round?.opened ?? [];
  const sealed = cases ? sealedPrizes(cases, opened) : prizes;
  const full = round?.outcome === 'full';
  const lastCase = opened.length ? opened[opened.length - 1] : null;
  const lastPrize = cases && lastCase !== null ? cases[lastCase] : null;
  const struckPrizes = cases ? opened.map((c) => cases[c]) : [];
  const offer = round ? round.cash : deal(prizes);
  const stake = round?.stake ?? bet.value;
  const above = profitCount(sealed);
  const chance = sealed.length ? above / sealed.length : 0;
  const casesLeft = CASES - 1 - opened.length;

  let status = 'Take Deal, or open every case';
  if (phase === 'opening') status = 'Opening a case';
  if (phase === 'settling' || phase === 'checkpoint') status = lastPrize !== null && lastCase !== null && !full ? `Case ${lastCase + 1} held ${fmtMult(pays(lastPrize))}` : status;
  if (phase === 'over' && round?.outcome === 'deal') status = `Deal taken: ${fmtMult(round.cash)}`;
  if (phase === 'over' && full) status = `Your case held ${fmtMult(round!.cash)}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const lineName = phase === 'over' ? (full ? 'Yours' : 'Took') : 'Deal';

  return (
    <GameLayout
      name="Banker"
      accent={ACCENTS.sky}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={board === 'flat' ? 'low' : 'high'} />}>Prize board</Label>
          <Chips
            label="Prize board"
            options={BOARDS.map((v) => ({ value: v, label: BOARD_NAME[v] }))}
            value={board}
            disabled={live}
            onChange={(v) => change(() => setBoard(v))}
          />

          {phase === 'checkpoint' || (phase === 'settling' && round) ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={takeDeal}>
                Take Deal <span>{formatAmount(stake * (round?.cash ?? RTP), 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => round && openNext(round)}>
                Open next case
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'opening' ? 'Opening…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <ChanceBar p={chance} label="Chance your case beats your bet" />

      <Board>
        <Field
          prizes={prizes}
          struck={struckPrizes.map((p) => prizes.indexOf(p))}
          lastBar={lastPrize !== null ? prizes.indexOf(lastPrize) : null}
          mineBar={full && cases ? prizes.indexOf(cases[0]) : null}
          opened={opened}
          scan={scan}
          lastCase={lastCase}
          offer={offer}
          moveMs={ms}
          above={above}
          lit={sealed.length}
          casesLeft={casesLeft}
          note={round ? round.note : IDLE_NOTE}
          lastLabel={lastPrize !== null ? fmtMult(pays(lastPrize)) : null}
          mineLabel={full && cases ? `Yours ${fmtMult(pays(cases[0]))}` : null}
          lineName={lineName}
        />
      </Board>

      {phase === 'over' && round?.outcome && (
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
      <Caption>Cases open one by one: take the Deal, or win the prize in yours.</Caption>

      {infoOpen && (
        <InfoModal title="Banker" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Sixteen sealed cases hold sixteen known prizes, one each. Yours (the outlined case) holds one of them. Take the Deal, or keep going and win what is in your case.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a prize board and bet. One of the other cases opens and its bar is struck off.</li>
              <li>After each case you can take the Deal, or open the next (Space).</li>
              <li>Open the last other case and your own prize is paid, since it is the only one left.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each bar is a prize still sealed, drawn as what it pays. Your case holds any lit bar with equal chance. The solid line is the Deal, the average of
              the lit bars. The dashed line is your bet, and the green bars above it are the ones that profit, so the chance bar is the count of green bars out of
              the lit ones. Strike a prize below the Deal line and the line rises; strike one above it and the line falls.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The prizes are shuffled, so your case is equally likely to hold each one still sealed, and the average of the lit bars is the expected prize in
              your case. Opening a uniformly random other case leaves that average unchanged in expectation (a martingale), so the Deal is a fair price at
              every step. Flat spreads prizes evenly around the bet; Classic has many small prizes and a few large ones.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every board averages exactly 1× the bet. The Deal is {(RTP * 100).toFixed(0)}% of the lit bars' average, and playing to the end pays{' '}
              {(RTP * 100).toFixed(0)}% of your prize. Taking the Deal at any point, or never, returns {(RTP * 100).toFixed(0)}% of the bet on average.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
