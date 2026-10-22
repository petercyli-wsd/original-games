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
import BayesBoard, { fmtP, type CoinView } from './Board';
import {
  COIN_NAME,
  FLIPS,
  HEADS_GOLD,
  PRIORS,
  RTP,
  SEPARATIONS,
  SEP_LABEL,
  cashOut,
  evidence,
  likelihood,
  oddsText,
  posteriorGold,
  priorOf,
  prize,
  ratio,
  volatilityOf,
  winChance,
  type Coin,
  type Face,
  type Flips,
  type Prior,
  type Separation,
  type Settings,
} from './math';

type Phase = 'idle' | 'flipping' | 'checkpoint' | 'revealing' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';
/** spin → cut (columns trimmed to the likelihoods) → norm (stretched back): one flip. spin → settle: the reveal. */
type Stage = 'spin' | 'cut' | 'norm' | 'settle';

interface Round {
  s: Settings;
  stake: number;
  /** Drawn at the bet, shown at the reveal. */
  coin: Coin;
  faces: Face[];
  cash: number;
  outcome: Outcome | null;
}

/** Animation times in ms (turbo runs them at a quarter). */
const MS = { spin: 420, cut: 560, norm: 460, reveal: 620, settle: 560, rest: 320 };

const pctLabel = (p: number) => `${Math.round(p * 100)}%`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [side, setSide] = useState<Coin>('gold');
  const [prior, setPrior] = useState<Prior>(0.25);
  const [sep, setSep] = useState<Separation>('clear');
  const [flips, setFlips] = useState<Flips>(10);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [pending, setPending] = useState<Face | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // The open bet's fair value. Each flip and the reveal are decided the moment
  // they start, so this jumps to the resolved value straight away: leaving
  // mid-animation settles at the real result, never at the pre-step value.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);

  const live = phase === 'flipping' || phase === 'checkpoint' || phase === 'revealing';
  const dur = (ms: number) => Math.round(turbo.turbo ? ms * 0.25 : ms);

  function finish(r: Round, outcome: Outcome, cash: number) {
    fair.current = cash;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setStage(null);
    setPending(null);
    setPhase('over');
  }

  function flip(r: Round) {
    const face: Face = rng.next() < likelihood('H', r.coin, r.s.sep) ? 'H' : 'T';
    const faces = [...r.faces, face];
    const pGold = posteriorGold(r.s.prior, r.s.sep, evidence(faces));
    const cash = cashOut(r.s.side, r.s.prior, pGold);
    fair.current = cash;
    setPhase('flipping');
    setPending(face);
    setStage('spin');
    setSpinKey((k) => k + 1);
    const t1 = dur(MS.spin);
    const t2 = t1 + dur(MS.cut);
    const t3 = t2 + dur(MS.norm);
    timers.after(t1, () => setStage('cut'));
    timers.after(t2, () => setStage('norm'));
    timers.after(t3, () => {
      const next = { ...r, faces, cash };
      setRound(next);
      setPending(null);
      setStage(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(r.s.side, pGold) });
    });
  }

  function reveal(r: Round) {
    const won = r.coin === r.s.side;
    const pay = won ? prize(r.s.side, r.s.prior) : 0;
    fair.current = pay;
    setPhase('revealing');
    setStage('spin');
    setSpinKey((k) => k + 1);
    const t1 = dur(MS.reveal);
    timers.after(t1, () => setStage('settle'));
    timers.after(t1 + dur(MS.settle), () => finish(r, won ? 'won' : 'lost', pay));
  }

  async function start() {
    if (live || bet.blocked) return;
    fair.current = RTP;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const s: Settings = { side, prior, sep, flips };
    const coin: Coin = rng.next() < s.prior ? 'gold' : 'silver';
    const r: Round = { s, stake: bet.value, coin, faces: [], cash: RTP, outcome: null };
    setRound(r);
    flip(r);
  }

  function cashOutNow() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function step() {
    if (phase !== 'checkpoint' || !round) return;
    if (round.faces.length < round.s.flips) flip(round);
    else reveal(round);
  }

  function revealNow() {
    if (phase !== 'checkpoint' || !round) return;
    reveal(round);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setStage(null);
    setPending(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys({ space: () => (phase === 'checkpoint' ? step() : !live ? void start() : undefined), cashOut: cashOutNow }, !infoOpen);

  // What the board shows: the live or finished round, else a preview of the settings.
  const s: Settings = round?.s ?? { side, prior, sep, flips };
  const faces = round?.faces ?? [];
  const dNow = evidence(faces);
  const pNow = posteriorGold(s.prior, s.sep, dNow);
  const truth = round && (phase === 'over' || (phase === 'revealing' && stage === 'settle')) ? round.coin : null;

  let pBox = pNow;
  let cut: Face | null = null;
  let tape = faces;
  let coinView: CoinView = { kind: 'hidden' };
  let ms = dur(MS.rest);
  if (faces.length) coinView = { kind: 'face', face: faces[faces.length - 1] };
  if (phase === 'flipping' && pending) {
    if (stage === 'spin') {
      coinView = { kind: 'spinning' };
      ms = dur(MS.spin);
    } else {
      tape = [...faces, pending];
      coinView = { kind: 'face', face: pending };
      if (stage === 'cut') {
        cut = pending;
        // Trim quickly, then hold the cut so it can be read.
        ms = dur(MS.cut * 0.55);
      } else {
        pBox = posteriorGold(s.prior, s.sep, evidence(tape));
        ms = dur(MS.norm * 0.85);
      }
    }
  }
  if (phase === 'revealing' && stage === 'spin') {
    coinView = { kind: 'spinning' };
    ms = dur(MS.reveal);
  }
  if (truth) {
    coinView = { kind: 'truth', coin: truth };
    ms = dur(MS.settle);
    // A reveal settles the box onto the truth; a cash-out keeps the odds it was taken at.
    if (round?.outcome !== 'cashed') pBox = truth === 'gold' ? 1 : 0;
  }

  const pWin = winChance(s.side, pBox);
  const full = prize(s.side, s.prior);
  const stake = round?.stake ?? bet.value;
  const cashShown = round?.outcome ? round.cash : round ? full * pWin : RTP;
  const vol = volatilityOf(side, prior);
  const name = COIN_NAME[s.side];
  const p = HEADS_GOLD[s.sep];
  const r = ratio(s.sep);
  // Only a reveal wins or loses; a cash-out has no verdict on the coin.
  const won = round?.outcome && round.outcome !== 'cashed' && truth ? truth === s.side : null;

  const atCheckpoint = phase === 'checkpoint' && !!round;
  const flipsLeft = s.flips - faces.length;
  const next = atCheckpoint && flipsLeft > 0 ? { h: posteriorGold(s.prior, s.sep, evidence(faces) + 1), t: posteriorGold(s.prior, s.sep, evidence(faces) - 1) } : null;

  const shownCount = tape.length;
  let status = `Ready · ${name} at ${pctLabel(priorOf(s.side, s.prior))} · ${s.flips} flips`;
  if (phase === 'flipping') status = `Flip ${shownCount + (stage === 'spin' ? 1 : 0)} of ${s.flips}`;
  if (phase === 'checkpoint') status = flipsLeft > 0 ? `Checkpoint · ${faces.length} of ${s.flips} flips` : `All ${s.flips} flips in · reveal or cash out`;
  if (phase === 'revealing') status = 'Revealing the coin';
  let title = 'Cashed out';
  if (round?.outcome === 'won') title = `${COIN_NAME[round.coin]} it is`;
  if (round?.outcome === 'lost') title = `It was ${COIN_NAME[round.coin]}`;
  if (phase === 'over' && round) status = round.outcome === 'cashed' ? `Cashed out · it was ${COIN_NAME[round.coin]}` : title;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // After a round: what the flips had said, and what the other choice would have paid.
  let overNote = '';
  if (phase === 'over' && round) {
    const h = faces.filter((f) => f === 'H').length;
    const said = `${faces.length} flip${faces.length === 1 ? '' : 's'} (${h}H ${faces.length - h}T) had put ${name} at ${fmtP(winChance(s.side, pNow))}`;
    const truthName = COIN_NAME[round.coin];
    overNote =
      round.outcome === 'cashed'
        ? `It was ${truthName}. ${said}; holding to the reveal would have paid ${fmtMult(round.coin === s.side ? full : 0)}.`
        : `It was ${truthName}. ${said} before the reveal.`;
  }

  const pH = next ? winChance(s.side, next.h) : 0;
  const pT = next ? winChance(s.side, next.t) : 0;

  return (
    <GameLayout
      name="Bayes"
      accent="#fdffb6"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Back</Label>
          <Chips
            label="Back Gold or Silver"
            options={[
              { value: 'gold', label: 'Gold', title: 'Win if the hidden coin is Gold' },
              { value: 'silver', label: 'Silver', title: 'Win if the hidden coin is Silver' },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v as Coin))}
          />

          <Label hint="the prior">Gold is drawn</Label>
          <Chips
            label="Prior chance the coin is Gold"
            options={PRIORS.map((v) => ({ value: v, label: pctLabel(v), title: `Gold ${pctLabel(v)}, Silver ${pctLabel(1 - v)}` }))}
            value={prior}
            disabled={live}
            onChange={(v) => change(() => setPrior(v as Prior))}
          />

          <Label hint={`heads ${pctLabel(HEADS_GOLD[sep])} vs ${pctLabel(1 - HEADS_GOLD[sep])}`}>Coins</Label>
          <Chips
            label="How different the coins are"
            options={SEPARATIONS.map((v) => ({
              value: v,
              label: SEP_LABEL[v],
              title: `Gold lands heads ${pctLabel(HEADS_GOLD[v])}, Silver ${pctLabel(1 - HEADS_GOLD[v])}`,
            }))}
            value={sep}
            disabled={live}
            onChange={(v) => change(() => setSep(v as Separation))}
          />

          <Label hint="then the reveal">Flips</Label>
          <Chips
            label="Flips before the reveal"
            options={FLIPS.map((v) => ({ value: v, label: v }))}
            value={flips}
            disabled={live}
            onChange={(v) => change(() => setFlips(v as Flips))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(priorOf(side, prior))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(side, prior))}</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={!atCheckpoint} onClick={cashOutNow}>
                Cash out <span>{formatAmount(stake * cashShown, 2)}</span>
              </ActionButton>
              {phase === 'revealing' ? (
                <ActionButton kind="secondary" disabled>
                  Revealing…
                </ActionButton>
              ) : flipsLeft > 0 || phase === 'flipping' ? (
                <>
                  <ActionButton kind="secondary" disabled={!atCheckpoint} onClick={step}>
                    {phase === 'flipping' ? 'Flipping…' : `Flip next · ${flipsLeft} left`}
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={!atCheckpoint} onClick={revealNow}>
                    Reveal now · {fmtP(pWin)} {name}
                  </ActionButton>
                </>
              ) : (
                <ActionButton kind="secondary" disabled={!atCheckpoint} onClick={step}>
                  Reveal the coin · {fmtP(pWin)} {name}
                </ActionButton>
              )}
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
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
          {
            label: 'Win chance',
            value: fmtP(pWin),
            sub: !round ? 'the prior, before any flip' : truth && round.outcome !== 'cashed' ? `the coin is ${COIN_NAME[truth]}` : `${name}'s width in the box`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: round ? fmtMult(cashShown) : '—', sub: round ? formatAmount(stake * cashShown, 2) : `opens at ${fmtMult(RTP)}`, tone: 'cash' },
          { label: 'Prize', value: fmtMult(full), sub: `if it is ${name}`, tone: 'prize' },
        ]}
      />

      <Board className="bayes-stage">
        <BayesBoard side={s.side} sep={s.sep} flips={s.flips} faces={tape} pGold={pBox} cut={cut} next={next} coin={coinView} ms={ms} spinKey={spinKey} won={won} />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={title}
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

      {live ? (
        <ChanceBar
          p={pWin}
          label={`Chance the coin is ${name}`}
          note={
            truth ? (
              <>The coin is {COIN_NAME[truth]}.</>
            ) : (
              <>
                Odds Gold : Silver = {oddsText(s.prior)} × {r.toFixed(2)}
                <sup>{dNow < 0 ? `−${-dNow}` : dNow}</sup> = {oddsText(pNow)}.{' '}
                {next ? `Next flip: heads → ${fmtP(pH)}, tails → ${fmtP(pT)}.` : phase === 'checkpoint' ? 'No flips left: reveal or cash out.' : ''}
              </>
            )
          }
        />
      ) : phase === 'over' && round ? (
        <Caption>{overNote}</Caption>
      ) : (
        <Caption>
          The hidden coin is Gold {pctLabel(s.prior)} of the time, else Silver. Gold lands heads {pctLabel(p)}, Silver {pctLabel(1 - p)}, so each head
          multiplies the odds on Gold by {r.toFixed(2)} and each tail divides them. Back {name}: hold to the reveal and you win{' '}
          {fmtChance(priorOf(s.side, s.prior))} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Bayes" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A coin is drawn in secret: <b>Gold</b> or <b>Silver</b>. Back the one you think it is. Watch it being flipped, and decide when you have seen
              enough. If the coin is revealed as yours, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick your coin, how often Gold is drawn (the prior), how different the two coins are, and how many flips you get to watch. Then bet.</li>
              <li>The coin is flipped straight away. After every flip you can cash out (C), flip again (Space), or reveal the coin now.</li>
              <li>After the last flip, cash out or reveal. A reveal pays the full prize if it is your coin and nothing if it is not.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b>Bayes box</b> shows the chances as widths. The Gold column is as wide as P(Gold) and the Silver column as P(Silver). The bar under
              your coin (<b style={{ color: 'var(--green)' }}>green</b>) is your chance to win; the <b style={{ color: 'var(--red)' }}>red</b> part is
              the chance it is the other coin.
            </p>
            <p>
              When a flip lands, each column keeps only the part of its height that would have shown that face: on heads Gold keeps {pctLabel(p)} and
              Silver {pctLabel(1 - p)}. The hatched rest is ruled out. Stretch what is left back to full height and the widths are the new chances. The
              two markers above the box show where the divider moves if the next flip is heads or tails.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Bayes' theorem. With prior π for Gold, Gold landing heads with chance p and Silver with 1 − p, after h heads and t tails:
            </p>
            <p>
              P(Gold | flips) = π·p<sup>h</sup>(1−p)<sup>t</sup> / (π·p<sup>h</sup>(1−p)<sup>t</sup> + (1−π)·(1−p)<sup>h</sup>p<sup>t</sup>).
            </p>
            <p>
              In odds: each head multiplies the odds on Gold by the likelihood ratio r = p/(1−p) ({r.toFixed(2)} here) and each tail divides them by r,
              so only heads − tails matters. The posterior is a martingale: averaged over the next flip it stays where it is, which is why the divider
              always sits between its two possible next positions, at their probability-weighted mean.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Backing a coin whose prior chance is π pays {(RTP * 100).toFixed(0)}% ÷ π if it is revealed: from {fmtMult(prize('silver', 0.02))} for
              Silver at 98% to {fmtMult(prize('gold', 0.02))} for Gold at 2%. Cashing out pays that prize × your coin's current chance. Every flip and
              every reveal is a fair bet at that price, so the round is worth {(RTP * 100).toFixed(0)}% of your stake whenever you cash out, reveal or
              keep watching.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
