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
import Venn, { type BlockResult } from './Board';
import {
  BITS,
  BLOCKS,
  NOISES,
  RTP,
  START,
  blockBars,
  blockChance,
  bitsToBlockEnd,
  cashAt,
  decided,
  encode,
  prizeFor,
  sendBit,
  winChance,
  volatilityOf,
  type Blocks,
  type Noise,
  type Settings,
  type Side,
  type State,
} from './math';

type Phase = 'idle' | 'sending' | 'checkpoint' | 'over';
type Outcome = 'decoded' | 'fooled' | 'cashed';

interface Round {
  s: Settings;
  stake: number;
  prize: number;
  st: State;
  /** Codeword of the block in the diagram, and the flips of its bits so far. */
  code: number[];
  flipped: boolean[];
  results: BlockResult[];
  outcome: Outcome | null;
  cash: number;
}

const SIDE_LABEL: Record<Side, string> = { decoded: 'Decoded', fooled: 'Fooled' };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [side, setSide] = useState<Side>('decoded');
  const [noise, setNoise] = useState<Noise>(10);
  const [blocks, setBlocks] = useState<Blocks>(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [arriving, setArriving] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // Every bit of a send is decided when the send starts, so leaving mid-way
  // settles at the real result, never at the pre-send value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'sending' ? resolved.current : round?.cash ?? 0));

  const bitMs = turbo.turbo ? 90 : 360;
  const live = phase === 'sending' || phase === 'checkpoint';

  const newCode = () => encode([0, 0, 0, 0].map(() => rng.int(2)));

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setArriving(null);
    setPhase('over');
  }

  /** Sends up to n bits (stopping early if the round is settled), animating one bit at a time. */
  function send(r0: Round, n: number) {
    const { s } = r0;
    const frames: Round[] = [];
    let r = r0;
    for (let i = 0; i < n && !decided(s, r.st); i++) {
      const fresh = r.st.sent === BITS && r.st.block + 1 < s.blocks;
      const flip = rng.next() < s.noise / 100;
      const st = sendBit(r.st, flip);
      const flipped = [...(fresh ? [] : r.flipped), flip];
      const results = [...r.results];
      if (st.flips >= 2) results.push('fail');
      else if (st.sent === BITS) results.push('ok');
      r = { ...r, st, code: fresh ? newCode() : r.code, flipped, results, cash: cashAt(s, st) };
      frames.push(r);
    }
    // A fooled block is settled; the rest of its bits still cross so you can watch the decoder get it wrong.
    if (r.st.flips >= 2) {
      let flipped = r.flipped;
      while (flipped.length < BITS) {
        flipped = [...flipped, rng.next() < s.noise / 100];
        frames.push({ ...r, flipped });
      }
      r = frames[frames.length - 1];
    }
    const done = decided(s, r.st);
    const won = done && winChance(s, r.st) > 0.5;
    const final = done ? (won ? r.prize : 0) : r.cash;
    resolved.current = final;
    setPhase('sending');

    frames.forEach((f, i) => {
      timers.after(i * bitMs, () => {
        setRound(f);
        setArriving(f.flipped.length - 1);
      });
    });
    timers.after(frames.length * bitMs + (done ? 250 : 0), () => {
      if (done) return finish(r, r.st.flips >= 2 ? 'fooled' : 'decoded', final);
      setRound(r);
      setArriving(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: r.cash, winChance: winChance(s, r.st) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const s: Settings = { side, noise, blocks };
    const r: Round = { s, stake: bet.value, prize: prizeFor(s), st: START, code: newCode(), flipped: [], results: [], outcome: null, cash: RTP };
    setRound(r);
    send(r, 1);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setArriving(null);
    setPhase('idle');
  }

  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? send(round, 1) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s: Settings = round?.s ?? { side, noise, blocks };
  const st = round?.st ?? START;
  const win = winChance(s, st);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const prize = prizeFor(s);
  const chosen: Settings = { side, noise, blocks };
  const vol = volatilityOf(chosen);
  const toEnd = bitsToBlockEnd(st);
  const block = Math.min(st.block, s.blocks - 1);
  const bars = blockBars(s, st);
  const flipWord = s.side === 'decoded' ? (st.flips === 1 && st.sent < BITS ? 'a flip loses' : 'a flip costs') : st.flips === 1 && st.sent < BITS ? 'a flip wins' : 'a flip helps';

  let status = `Ready · ${SIDE_LABEL[s.side]} · ${s.blocks} block${s.blocks > 1 ? 's' : ''} at ${s.noise}% noise`;
  if (phase === 'sending') status = `Sending block ${st.block + 1} of ${s.blocks} · bit ${st.sent} of ${BITS}`;
  if (phase === 'checkpoint') status = `Checkpoint · block ${st.block + 1}, ${st.sent} of ${BITS} bits in`;
  if (phase === 'over' && round?.outcome)
    status =
      round.outcome === 'cashed' ? `Cashed out · block ${st.block + 1}, bit ${st.sent}` : round.outcome === 'fooled' ? `Decoder fooled in block ${st.block + 1}` : 'Every block decoded';
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const overTitle =
    round?.outcome === 'cashed' ? 'Cashed out' : round?.outcome === 'fooled' ? 'Decoder fooled' : round?.outcome === 'decoded' ? 'Message decoded' : '';

  return (
    <GameLayout
      name="Hamming"
      accent="#7bdff2"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Bet on</Label>
          <Chips
            label="Bet on"
            options={[
              { value: 'decoded', label: 'Decoded', title: 'Every block decodes (at most one flip each)' },
              { value: 'fooled', label: 'Fooled', title: 'Some block takes two or more flips' },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v as Side))}
          />

          <Label hint="chance each bit flips">Channel noise</Label>
          <Chips
            label="Channel noise"
            options={NOISES.map((v) => ({ value: v, label: `${v}%` }))}
            value={noise}
            disabled={live}
            onChange={(v) => change(() => setNoise(v))}
          />

          <Label hint="7 bits each, in a series">Blocks</Label>
          <Chips
            label="Blocks"
            options={BLOCKS.map((v) => ({ value: v, label: v }))}
            value={blocks}
            disabled={live}
            onChange={(v) => change(() => setBlocks(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(winChance(chosen))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(chosen))}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => send(round, 1)}>
                Send bit · {s.noise}% flip
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => send(round, toEnd)}>
                {st.sent === BITS ? `Send block ${st.block + 2}` : `Send rest of block · ${toEnd} bit${toEnd > 1 ? 's' : ''}`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'sending' ? 'Sending…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: `${SIDE_LABEL[s.side]} chance`,
            value: fmtChance(win),
            sub: s.side === 'decoded' ? 'every block takes ≤ 1 flip' : 'some block takes 2+ flips',
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          {
            label: live ? 'If the next bit flips' : 'Prize',
            value: live ? fmtMult(decided(s, sendBit(st, true)) ? (winChance(s, sendBit(st, true)) > 0.5 ? prize : 0) : cashAt(s, sendBit(st, true))) : fmtMult(prize),
            sub: live ? `${flipWord} · clean ${fmtMult(cashAt(s, sendBit(st, false)))}` : `paid if ${SIDE_LABEL[s.side].toLowerCase()}`,
            tone: 'prize',
          },
        ]}
      />

      <Board>
        <Venn
          side={s.side}
          noise={s.noise}
          blocks={s.blocks}
          block={block}
          code={round ? round.code : null}
          flipped={round?.flipped ?? []}
          results={round?.results ?? []}
          bars={bars}
          win={win}
          arriving={arriving}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={overTitle}
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

      {live ? (
        <ChanceBar
          p={win}
          label={`${SIDE_LABEL[s.side]} chance`}
          note={s.side === 'decoded' ? 'The product of the block bars on the board.' : 'One minus the product of the block bars on the board.'}
        />
      ) : (
        <Caption>
          Hamming(7,4) absorbs one flip per block. At {s.noise}% noise a block decodes {fmtChance(blockChance(s.noise))} of the time, so{' '}
          {SIDE_LABEL[s.side]} over {s.blocks} block{s.blocks > 1 ? 's' : ''} wins {fmtChance(winChance(s))} and pays {fmtMult(prize)}. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Hamming" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A 4-bit message is protected by a Hamming(7,4) code and sent as 7 bits across a noisy channel. Bet <b>Decoded</b> (every block arrives
              readable) or <b>Fooled</b> (some block takes two or more flips and the decoder gets it wrong).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a side, the channel noise (the chance each bit flips) and how many blocks are sent in a row, then bet.</li>
              <li>Bits cross one at a time. After each one you can cash out, send the next bit (Space), or send the rest of the block in one go.</li>
              <li>The round pays the prize as soon as your side is certain, and ends at zero as soon as it is impossible.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The Venn diagram is the code: each circle is a parity check. A flipped bit glows <b style={{ color: 'var(--red)' }}>red</b> and breaks every
              circle it sits in; the broken circles spell the syndrome, which names the bit to fix. The gauge counts flips absorbed: one is fine, a second
              fools the decoder. Under the diagram, each bar's filled length is that block's exact chance to decode from here. Decoded wins with the
              product of the bars; Fooled with one minus it.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Hamming(7,4) is a perfect code: the 8 syndromes match exactly the 8 patterns "no flip" and "one flip at position i", so it corrects every single
              flip and nothing more. A block decodes with probability D = (1−p)<sup>7</sup> + 7p(1−p)<sup>6</sup>, and k blocks with D<sup>k</sup>. Mid-block,
              with f flips so far and r bits left, the block decodes with (1−p)<sup>r</sup> + r·p(1−p)<sup>r−1</sup> if f = 0, (1−p)<sup>r</sup> if f = 1, and
              0 once f ≥ 2.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% divided by your side's starting chance. Cashing out pays the prize times your side's exact chance right
              now, so each bit is a fair bet and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out, bit by bit or a
              block at a time.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
