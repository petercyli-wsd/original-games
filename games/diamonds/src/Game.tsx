import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  eventMs,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Gem } from './Gem';
import {
  GEMS,
  HANDS,
  HAND_COUNTS,
  HAND_NAMES,
  OUTCOMES,
  RISKS,
  RISK_NAMES,
  RISK_VOL,
  RTP,
  handChance,
  payout,
  playRound,
  topPrize,
  winChance,
  type Risk,
  type RoundResult,
} from './math';


interface Last extends RoundResult {
  id: number;
  stake: number;
  risk: Risk;
}

// Board geometry (SVG units).
const SLOT_W = 104;
const SLOT_GAP = 10;
const VIEW_W = GEMS * SLOT_W + (GEMS - 1) * SLOT_GAP;
const VIEW_H = 176;
const GEM_Y = 80;
const slotX = (i: number) => i * (SLOT_W + SLOT_GAP);

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [risk, setRiskState] = useState<Risk>('classic');
  const [last, setLast] = useState<Last | null>(null);
  const [dropping, setDropping] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  const resolved = useRef(0);
  // The outcome is fixed the moment the stake is accepted; leaving mid-drop
  // settles the open ticket at that outcome (resolved is reset before each bet).
  const ticket = useTicket(() => resolved.current);

  const stagger = eventMs(turbo.turbo, 100);
  const dropMs = eventMs(turbo.turbo);
  const totalMs = (GEMS - 1) * stagger + dropMs + (turbo.turbo ? 20 : 80);

  async function playOnce(stake: number): Promise<number | null> {
    resolved.current = 0;
    if (!(await ticket.place(stake))) return null;
    const r = playRound(rng.next, risk);
    resolved.current = r.multiplier;
    setDropping(true);
    setLast({ ...r, id: ++seq.current, stake, risk });
    await timers.wait(totalMs);
    ticket.settle(r.multiplier);
    pushHistory(r.multiplier);
    setDropping(false);
    return r.multiplier;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  const busy = dropping || auto.running;
  const canBet = auto.mode === 'manual' && !busy && !bet.blocked;

  // A setting change after a round clears the board back to an idle preview.
  const setRisk = (r: Risk) => {
    if (busy) return;
    setRiskState(r);
    setLast(null);
  };

  useHotkeys({ space: () => (canBet ? void playOnce(bet.value) : undefined) }, !infoOpen);

  // 1 / 2 / 3 pick the risk table.
  const setRiskRef = useRef(setRisk);
  setRiskRef.current = setRisk;
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i >= 0) setRiskRef.current(RISKS[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  const shown = last && !dropping ? last : null;
  const top = topPrize(risk);

  let status: string;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (dropping) {
    status = 'Dropping gems…';
    tone = 'live';
  } else if (shown) {
    status = `${HAND_NAMES[shown.hand]} · ${fmtMult(shown.multiplier)}`;
    tone = shown.multiplier >= 1 ? 'won' : 'lost';
  } else status = 'Match shapes to win';

  return (
    <GameLayout
      name="Diamonds"
      accent={ACCENTS.sky}
      panel={
        <>
          <ModeTabs auto={auto} disabled={dropping} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={RISK_VOL[risk]} />}>Risk</Label>
          <Chips
            label="Risk"
            options={RISKS.map((r, i) => ({ value: r, label: RISK_NAMES[r], title: `${RISK_NAMES[r]} risk (key ${i + 1})` }))}
            value={risk}
            onChange={setRisk}
            disabled={busy}
          />

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={() => void playOnce(bet.value)}>
              {dropping ? 'Dropping…' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || dropping} />
          )}
          {bet.blocked && <p className="dm-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts
        items={[
          { label: 'Chance to profit', value: fmtChance(winChance(risk)), tone: 'chance' },
          { label: 'Top prize', value: formatAmount(bet.value * top, 2), tone: 'prize' },
        ]}
      />

      <Board className="dm-board">
        <InstantResult multiplier={shown ? shown.multiplier : null} stake={shown?.stake ?? 0} id={shown?.id ?? 0} />
        <svg viewBox={`-6 -6 ${VIEW_W + 12} ${VIEW_H + 12}`} className="dm-svg" role="img" aria-label={shown ? `${HAND_NAMES[shown.hand]}` : 'Five empty gem slots'}>
          {Array.from({ length: GEMS }, (_, i) => {
            const gem = last ? last.gems[i] : null;
            const group = last ? last.groupSize[i] : 1;
            // Matched gems of a paying hand stay outlined until the next drop.
            const matched = !!shown && group >= 2 && shown.multiplier > 0;
            const x = slotX(i);
            return (
              <g key={i} transform={`translate(${x},0)`}>
                <rect className={'dm-slot' + (matched ? ' lit' : '')} x={0} y={0} width={SLOT_W} height={VIEW_H} rx={8} />
                {gem === null ? (
                  <circle className="dm-socket" cx={SLOT_W / 2} cy={GEM_Y} r={4} />
                ) : (
                  <g transform={`translate(${SLOT_W / 2},${GEM_Y})`}>
                    <g
                      key={last!.id}
                      className="dm-drop"
                      style={{ animationDelay: `${i * stagger}ms`, animationDuration: `${dropMs}ms` } as CSSProperties}
                    >
                      <Gem index={gem} size={30} dim={!!shown && shown.hand !== 'none' && group < 2} />
                    </g>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </Board>
      <Caption>Match gem shapes like a poker hand; bigger hands pay more.</Caption>

      {infoOpen && (
        <InfoModal title="Diamonds" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Five gems drop into five slots. Each is one of seven shapes. Matching shapes make a hand, and the hand pays a multiplier of your bet.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet and pick a risk table: Low, Classic or High (keys 1, 2, 3).</li>
              <li>
                Press Bet (or Space). The gems drop one by one and matched gems of a paying hand are outlined in green. The seven shapes are circle,
                square, triangle, diamond, hexagon, pentagon and cross.
              </li>
              <li>Use Auto to run a set number of bets, raise or reset the bet after a win or loss, and stop at a profit or loss limit.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>Every hand with its odds and its multiplier on each risk table:</p>
            <table className="dm-info-table">
              <thead>
                <tr>
                  <th>Hand</th>
                  <th>Ways</th>
                  <th>Chance</th>
                  {RISKS.map((r) => (
                    <th key={r}>{RISK_NAMES[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HANDS.slice()
                  .reverse()
                  .map((h) => (
                    <tr key={h}>
                      <td>{HAND_NAMES[h]}</td>
                      <td>{HAND_COUNTS[h].toLocaleString('en-US')}</td>
                      <td>{fmtChance(handChance(h))}</td>
                      {RISKS.map((r) => (
                        <td key={r}>{fmtMult(payout(r, h))}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Every gem is an independent uniform draw from 7 shapes, so all 7⁵ = {OUTCOMES.toLocaleString('en-US')} rows are equally likely. Counting
              them by pattern (choose the shapes, then their positions) gives the ways above; for example two pair = C(7,2) · 5 · 5!/(2!·2!·1!) = 3,150.
              The return of a table is Σ ways × payout ÷ 16,807.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Each table returns exactly {(RTP * 100).toFixed(0)}% (Σ ways × payout = 0.98 × 16,807 to the cent), so risk only changes how results are
              spread, never the long-run return. Classic keeps the familiar tiers (0.10×, 2×, 3×, 4×, 5×) with five of a kind at 42.98×; High pays up to{' '}
              {fmtMult(topPrize('high'))}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
