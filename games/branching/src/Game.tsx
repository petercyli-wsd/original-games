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
import Field from './Board';
import { fmtRisk, fmtSafe } from './format';
import {
  FAMILIES,
  FAMILY_NAME,
  GENERATIONS,
  OFFSPRING,
  POP_CAP,
  RTP,
  cashValue,
  dieOutChance,
  lineSurvives,
  meanChildren,
  prize,
  sampleChildren,
  volatilityOf,
  winChance,
  type Family,
  type Gens,
} from './math';
import { growTree, seedTree, type Tree } from './tree';

type Phase = 'idle' | 'growing' | 'checkpoint' | 'over';
type Outcome = 'extinct' | 'cashed' | 'survived' | 'secured';

interface Round {
  family: Family;
  gens: Gens;
  stake: number;
  tree: Tree;
  cash: number;
  outcome: Outcome | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  extinct: 'Extinct',
  cashed: 'Cashed out',
  survived: 'The family survived',
  secured: 'Family secured',
};

const lines = (z: number) => (z === 1 ? '1 line' : `${z} lines`);
const sup = (n: number) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [family, setFamily] = useState<Family>('steady');
  const [gens, setGens] = useState<Gens>(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [growing, setGrowing] = useState<Tree | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A generation's children are drawn the moment it starts growing, so leaving
  // mid-animation settles at its real result, never at the pre-growth value.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => (phase === 'growing' ? resolved.current : round?.cash ?? 0));

  const growMs = turbo.turbo ? 190 : 760;
  const easeMs = turbo.turbo ? 90 : 360;
  const live = phase === 'growing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setGrowing(null);
    setPhase('over');
  }

  function grow(r: Round) {
    const frontier = r.tree[r.tree.length - 1];
    const kids = frontier.map(() => sampleChildren(r.family, rng.next()));
    const z = kids.reduce((a, b) => a + b, 0);
    const g = r.tree.length;
    const tree = growTree(r.tree, kids, r.gens);
    const cash = cashValue(r.family, r.gens, g, z);
    resolved.current = cash;
    setPhase('growing');
    setGrowing(tree);
    timers.after(growMs, () => {
      const next = { ...r, tree, cash };
      if (z === 0) return finish(next, 'extinct', 0);
      if (g >= r.gens) return finish(next, 'survived', cash);
      if (z > POP_CAP) return finish(next, 'secured', cash);
      setRound(next);
      setGrowing(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(r.family, r.gens, g, z) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { family, gens, stake: bet.value, tree: seedTree(), cash: RTP, outcome: null };
    setRound(r);
    grow(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setGrowing(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? grow(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const fam = round?.family ?? family;
  const G = round?.gens ?? gens;
  const tree = round?.tree ?? seedTree();
  const reached = tree.length - 1;
  const z = tree[reached].length;
  const chance = winChance(fam, G, reached, z);
  const risk = dieOutChance(fam, G, reached, z);
  const s = lineSurvives(fam, G - reached);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const full = prize(fam, G);
  const p0 = winChance(family, gens, 0, 1);
  const vol = volatilityOf(family, gens);

  let status = `Ready · survive ${G} generations`;
  if (phase === 'growing') status = `Growing generation ${reached + 1} of ${G}`;
  if (phase === 'checkpoint') status = `Checkpoint · generation ${reached} of ${G} · ${lines(z)} alive`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · generation ${reached}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let chanceSub = `${FAMILY_NAME[fam].toLowerCase()} seed, ${G} generations`;
  if (live) chanceSub = `${lines(z)} × ${fmtChance(s)} each`;
  if (phase === 'over') chanceSub = round?.outcome === 'extinct' ? 'every line died out' : round?.outcome === 'cashed' ? 'when you cashed out' : `${lines(z)} alive`;

  return (
    <GameLayout
      name="Branching"
      accent="#06d6a0"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Family</Label>
          <Chips
            label="Family"
            options={FAMILIES.map((v) => ({ value: v, label: FAMILY_NAME[v], title: `${meanChildren(v).toFixed(2)} children per node on average` }))}
            value={family}
            disabled={live}
            onChange={(v) => change(() => setFamily(v))}
          />

          <Label hint="the outer ring is the goal">Generations</Label>
          <Chips
            label="Generations to survive"
            options={GENERATIONS.map((v) => ({ value: v, label: v }))}
            value={gens}
            disabled={live}
            onChange={(v) => change(() => setGens(v))}
          />
          <dl className="og-stats">
            <dt>Children (0/1/2/3)</dt>
            <dd>{OFFSPRING[family].map((x) => Math.round(x * 100)).join('/')}%</dd>
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / p0)}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && grow(round)}>
                Grow generation {reached + 1}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'growing' ? 'Growing…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Family survives', value: fmtSafe(chance), sub: chanceSub, tone: 'chance' },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(full), sub: `alive at generation ${G}`, tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          family={fam}
          gens={G}
          tree={growing ?? tree}
          animating={growing !== null}
          chance={chance}
          risk={risk}
          s={s}
          z={z}
          reached={reached}
          live={live}
          idle={phase === 'idle'}
          outcome={round?.outcome ?? null}
          growMs={growMs}
          easeMs={easeMs}
        />
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
            placement="bottom"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={chance}
          label={`Family alive at generation ${G}`}
          note={
            z === 1
              ? `Your one line survives to the goal ${fmtChance(s)} of the time. More children mean more lines, and better odds.`
              : `Each of the ${z} lines survives ${fmtChance(s)} on its own; all ${z} die out with chance (1 − s)${sup(z)} ${risk < 1e-4 ? fmtRisk(risk) : `= ${fmtRisk(risk)}`}.`
          }
        />
      ) : (
        <Caption>
          One seed; every node has 0–3 children. A {FAMILY_NAME[fam].toLowerCase()} family is still alive after {G} generations{' '}
          {fmtChance(winChance(fam, G, 0, 1))} of the time, so the prize is {fmtMult(full)}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Branching" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A family tree grows from one seed at the centre. Each generation is a ring further out. Win if anyone in the family is still alive on the
              outer ring, generation {G}.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a family (how many children each node tends to have) and how many generations it must survive, then bet.</li>
              <li>
                Every node has 0, 1, 2 or 3 children at random (the bar chart, bottom left). Nodes with no children end their line. After each generation
                you can cash out, or grow the next one (Space).
              </li>
              <li>
                If every line dies out, the round is lost. Reach the outer ring and the prize pays automatically. If more than {POP_CAP} lines are alive,
                the board is full: survival is all but certain, and the round cashes out at its fair value.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b style={{ color: 'var(--green)' }}>green share of the goal ring</b> is your chance to reach it, and the{' '}
              <b style={{ color: 'var(--red)' }}>red share</b> is the chance the whole family dies out first.
            </p>
            <p>
              Every living node wears a small pie: the chance that its own line survives to the goal, s. Lines are independent, so the ring is lit one
              slice per line: the first line lights s of the ring, each next line lights s of whatever is still red. What stays red is (1 − s)
              <sup>z</sup>, the chance that all z lines fail. More lines push the odds up; lost lines pull them down.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              This is a Galton–Watson branching process. With f(x) = p<sub>0</sub> + p<sub>1</sub>x + p<sub>2</sub>x² + p<sub>3</sub>x³ (the offspring
              generating function), one line dies out within t generations with chance q<sub>t</sub> = f(f(…f(0)…)), f applied t times. With z nodes
              alive and t generations to go, the family survives with chance 1 − q<sub>t</sub>
              <sup>z</sup>. Families with more than one child on average can survive for ever, with chance 1 − q, where q is the smallest root of f(q) = q.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ P(win from the seed), and the cash-out at any checkpoint is prize × (1 − q<sub>t</sub>
              <sup>z</sup>). Because the next generation has E[x<sup>Z′</sup>] = f(x)<sup>z</sup>, the expected cash-out after a generation equals the
              cash-out before it. Every generation is a fair bet, so the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you
              cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
