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
import { useMemo, useRef, useState } from 'react';
import Field, { type Falling } from './Board';
import {
  KEY_CHOICES,
  LIMITS,
  RTP,
  bustChance,
  emptyTree,
  fullSize,
  heightAtMost,
  insert,
  landingProfile,
  prizeFor,
  sure,
  volatilityOf,
  winChance,
  type Key,
  type Limit,
  type Tree,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'full';

interface Round {
  limit: Limit;
  keys: number;
  stake: number;
  tree: Tree;
  /** Cash-out multiplier: prize × P(win | tree). */
  cash: number;
  outcome: Outcome | null;
  bustKey: Key | null;
  /** Nothing can bust any more: the rest of the keys drop by themselves. */
  autoplay: boolean;
}

const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Too deep', cashed: 'Cashed out', full: 'All keys placed' };
const ACCENT = '#9b5de5';
const EMPTY = emptyTree();

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [limit, setLimit] = useState<Limit>(4);
  const [keyIndex, setKeyIndex] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [falling, setFalling] = useState<Falling | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  const keys = KEY_CHOICES[limit][keyIndex];

  // The key in flight is decided the moment it starts, so leaving mid-fall
  // settles at its real result, never at the pre-key value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dropping' ? resolved.current : (round?.cash ?? 0)));

  const fallMs = turbo.turbo ? 170 : 680;
  const live = phase === 'dropping' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, autoplay: false });
    setFalling(null);
    setPhase('over');
  }

  function drop(r: Round) {
    const prize = prizeFor(r.keys, r.limit);
    const x = rng.next();
    const { tree, key } = insert(r.tree, x);
    const bust = key.depth > r.limit;
    const left = r.keys - tree.keys.length;
    const done = !bust && left === 0;
    const auto = !bust && !done && sure(tree.gaps, left, r.limit);
    const chance = bust ? 0 : done || auto ? 1 : winChance(tree.gaps, left, r.limit);
    const cash = bust ? 0 : done || auto ? prize : prize * chance;
    resolved.current = cash;
    setPhase('dropping');
    setFalling({ id: ++seq.current, x, depth: key.depth, bust, chance });
    const ms = r.autoplay ? Math.round(fallMs * 0.6) : fallMs;
    timers.after(ms, () => {
      if (bust) return finish({ ...r, bustKey: key }, 'bust', 0);
      const next: Round = { ...r, tree, cash, autoplay: auto };
      if (done) return finish(next, 'full', prize);
      setRound(next);
      setFalling(null);
      if (auto) {
        timers.after(turbo.turbo ? 60 : 160, () => drop(next));
        return;
      }
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: chance });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { limit, keys, stake: bet.value, tree: emptyTree(), cash: RTP, outcome: null, bustKey: null, autoplay: false };
    setRound(r);
    drop(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setFalling(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? drop(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const H = round?.limit ?? limit;
  const K = round?.keys ?? keys;
  const tree = round?.tree ?? EMPTY;
  const placed = tree.keys.length;
  const prize = prizeFor(K, H);
  const stake = round?.stake ?? bet.value;
  const startChance = heightAtMost(K, H);
  const chance = round ? round.cash / prize : startChance;
  const q = bustChance(tree.gaps, H);
  const showStrip = phase !== 'over' && !round?.autoplay && placed < K;
  const profile = useMemo(() => (showStrip ? landingProfile(tree.gaps, K - placed, H) : null), [showStrip, tree, K, placed, H]);
  const vol = volatilityOf(keys, limit);

  let status = `Ready · ${K} keys, depth ≤ ${H}`;
  if (phase === 'dropping') status = round?.autoplay ? `Nothing can bust · key ${placed + 1} of ${K}` : `Key ${placed + 1} of ${K} falling`;
  if (phase === 'checkpoint') status = `Checkpoint · ${placed} of ${K} keys`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${placed} of ${K} keys`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Deep"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Depth limit</Label>
          <Chips
            label="Depth limit"
            options={LIMITS.map((v) => ({ value: v, label: `≤ ${v}`, title: `No key deeper than ${v} (room for ${fullSize(v)} keys)` }))}
            value={limit}
            disabled={live}
            onChange={(v) => change(() => setLimit(v))}
          />

          <Label hint="pays when all of them fit">Keys to place</Label>
          <Chips
            label="Keys to place"
            options={KEY_CHOICES[limit].map((v, i) => ({ value: i, label: v }))}
            value={keyIndex}
            disabled={live}
            onChange={(v) => change(() => setKeyIndex(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(heightAtMost(keys, limit))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(keys, limit))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * (round?.cash ?? 0), 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && drop(round)}>
                Drop next key {q === 0 ? '· no red' : `· ${fmtChance(q)} red`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'dropping' ? 'Dropping…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: 'Chance to win',
            value: fmtChance(chance),
            sub:
              phase === 'idle'
                ? `${K} keys within depth ${H}`
                : round?.outcome === 'bust'
                  ? `key ${placed + 1} sank too deep`
                  : round?.outcome === 'full'
                    ? `all ${K} keys fit`
                    : round?.outcome === 'cashed'
                      ? `when you cashed out`
                      : `${K - placed} more key${K - placed === 1 ? '' : 's'} to fit`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: round ? fmtMult(round.cash) : '—',
            sub: round ? formatAmount(stake * round.cash, 2) : 'prize × chance',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: `${formatAmount(stake * prize, 2)} if all ${K} fit`, tone: 'prize' },
        ]}
      />

      <Board className="deep-board">
        <Field
          limit={H}
          keys={K}
          tree={tree}
          mode={phase === 'idle' ? 'idle' : phase === 'over' ? 'over' : 'live'}
          outcome={round?.outcome ?? null}
          profile={profile}
          chance={chance}
          q={q}
          falling={falling}
          fallMs={round?.autoplay ? Math.round(fallMs * 0.6) : fallMs}
          bustKey={round?.bustKey ?? null}
        />
        {phase === 'over' && round?.outcome && (
          <div className="deep-over">
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
          </div>
        )}
      </Board>

      <div className="deep-foot">
        {live ? (
          <ChanceBar
            p={chance}
            label={`Chance all ${K} keys fit within depth ${H}`}
            note={
              round?.autoplay
                ? 'Nothing can reach the red any more: the remaining keys drop by themselves for the full prize.'
                : 'Red on the line busts the next key. The arches show your chance after it lands; their average is this bar.'
            }
          />
        ) : (
          <Caption>
            Uniform keys build a random binary search tree. {K} keys stay within depth {H} {fmtChance(startChance)} of the time, so the prize is{' '}
            {fmtMult(prize)}. RTP {(RTP * 100).toFixed(0)}%.
          </Caption>
        )}
      </div>

      {infoOpen && (
        <InfoModal title="Deep" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Random keys between 0 and 1 drop into a binary search tree, one at a time. Place all the keys you chose without any of them sinking below the depth
              limit (the root is depth 0). Do it and you win the prize shown before you bet.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a depth limit and how many keys to place, then bet. The first key becomes the root.</li>
              <li>After each key you can cash out at the value shown, or drop the next key (Space).</li>
              <li>A key that lands on a red ledge sinks too deep and the round is lost. Place every key and the prize pays out automatically.</li>
              <li>When nothing can reach the red any more, the remaining keys drop by themselves.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              A new key is compared with the keys above it and comes to rest in the slot between its two neighbours on the number line, one level below the
              deeper of them. The board draws every empty slot as a <b style={{ color: ACCENT }}>ledge</b> spanning that stretch of the line, at the depth a key
              landing there would get. Ledges below the limit are <b style={{ color: 'var(--red)' }}>red</b>, and the red stretches of the number line add up to
              exactly the chance that the next key busts.
            </p>
            <p>
              The <b>arches</b> above the line show your chance to win after the next key, depending on where it lands: high over wide, shallow ledges (a key in
              the middle of a gap keeps the tree balanced), low near the limit, zero over red. The dashed line is your chance now. It is exactly the arches&apos;
              average height, and the parts above it (green) are where the next key raises your cash-out.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Uniform keys arrive in a uniformly random order, so the tree is a <i>random binary search tree</i> (the same shapes as quicksort&apos;s recursion).
              Its root is uniform among the n ranks and both subtrees are random BSTs again, which gives the height law
            </p>
            <p>
              h(n, c) = (1/n) · Σ<sub>r=1..n</sub> h(r−1, c−1) · h(n−r, c−1), &nbsp;h(0, c) = 1,
            </p>
            <p>
              the chance that n keys stay within depth c. Live, the keys that fall into one gap grow their own independent random subtree from that slot, and the
              m keys still to come split between the gaps in proportion to their lengths L. So the chance to win is exact:
            </p>
            <p>
              P(win) = m! · [z<sup>m</sup>] Π<sub>gaps</sub> F<sub>H−d</sub>(L z), &nbsp; F<sub>c</sub>(z) = Σ<sub>j</sub> h(j, c) z<sup>j</sup> / j!
            </p>
            <table className="deep-table">
              <thead>
                <tr>
                  <th>Depth ≤</th>
                  <th colSpan={5}>keys · chance to place them all</th>
                </tr>
              </thead>
              <tbody>
                {LIMITS.map((h) => (
                  <tr key={h}>
                    <td>{h}</td>
                    {KEY_CHOICES[h].map((k) => (
                      <td key={k}>
                        {k} · {fmtChance(heightAtMost(k, h))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is fixed when you bet: {(RTP * 100).toFixed(0)}% ÷ the chance to place every key. At any checkpoint, your cash-out is prize × your chance
              to win from there. Every key is a fair bet (the arches average to the line), so the cash-out is a martingale and the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out. All randomness comes from the host&apos;s random number generator, and
              each key&apos;s landing point is decided the moment it starts to fall.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
