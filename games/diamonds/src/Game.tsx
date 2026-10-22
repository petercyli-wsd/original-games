import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  fmtOneIn,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { GEM_STYLES, Gem, MiniGem } from './Gem';
import {
  GEMS,
  HANDS,
  HAND_COUNTS,
  HAND_NAMES,
  HAND_PATTERN,
  OUTCOMES,
  RISKS,
  RISK_NAMES,
  RISK_VOL,
  RTP,
  handChance,
  payout,
  playRound,
  returnChance,
  topPrize,
  winChance,
  type Hand,
  type Risk,
  type RoundResult,
} from './math';

const ACCENT = '#2dd4bf';
const PAY_HANDS = HANDS.filter((h) => h !== 'none');

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

  const stagger = turbo.turbo ? 35 : 130;
  const dropMs = turbo.turbo ? 120 : 420;
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
  const hitHand: Hand | null = shown ? shown.hand : null;
  const top = topPrize(risk);

  let status: string;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (dropping) {
    status = 'Dropping gems…';
    tone = 'live';
  } else if (shown) {
    status = `${HAND_NAMES[shown.hand]} · ${fmtMult(shown.multiplier)}`;
    tone = shown.multiplier >= 1 ? 'won' : 'lost';
  } else status = 'Match colours to win';

  return (
    <GameLayout
      name="Diamonds"
      accent={ACCENT}
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

          <dl className="og-stats">
            <dt>Chance to profit</dt>
            <dd>{fmtChance(winChance(risk))}</dd>
            <dt>Pays something</dt>
            <dd>{fmtChance(returnChance(risk))}</dd>
            <dt>Max win</dt>
            <dd>
              {formatAmount(bet.value * top, 2)} <span className="dm-stat-sub">({fmtMult(top)})</span>
            </dd>
          </dl>

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

      <Board className="dm-board">
        <InstantResult multiplier={shown ? shown.multiplier : null} stake={shown?.stake ?? 0} id={shown?.id ?? 0} />
        <svg viewBox={`-6 -6 ${VIEW_W + 12} ${VIEW_H + 12}`} className="dm-svg" role="img" aria-label={shown ? `${HAND_NAMES[shown.hand]}` : 'Five empty gem slots'}>
          <defs>
            <radialGradient id="dm-glow" cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>
          {Array.from({ length: GEMS }, (_, i) => {
            const gem = last ? last.gems[i] : null;
            const group = last ? last.groupSize[i] : 1;
            const matched = !!shown && group >= 2;
            const color = gem !== null ? GEM_STYLES[gem].color : undefined;
            const x = slotX(i);
            return (
              <g key={i} transform={`translate(${x},0)`}>
                <rect
                  className={'dm-slot' + (matched ? ' lit' : '')}
                  x={0}
                  y={0}
                  width={SLOT_W}
                  height={VIEW_H}
                  rx={16}
                  style={matched ? ({ '--gem': color } as CSSProperties) : undefined}
                />
                {matched && <ellipse cx={SLOT_W / 2} cy={GEM_Y} rx={46} ry={46} fill="url(#dm-glow)" />}
                {gem === null ? (
                  <g transform={`translate(${SLOT_W / 2},${GEM_Y})`} className="dm-socket">
                    <polygon points="0,-30 26,-8 0,30 -26,-8" />
                    <polyline points="-26,-8 26,-8" />
                  </g>
                ) : (
                  <g transform={`translate(${SLOT_W / 2},${GEM_Y})`}>
                    <g
                      key={last!.id}
                      className="dm-drop"
                      style={{ animationDelay: `${i * stagger}ms`, animationDuration: `${dropMs}ms` } as CSSProperties}
                    >
                      <Gem index={gem} size={34} dim={!!shown && shown.hand !== 'none' && group < 2} />
                    </g>
                  </g>
                )}
                <rect
                  className={'dm-bar' + (matched ? ' lit' : '')}
                  x={20}
                  y={VIEW_H - 26}
                  width={SLOT_W - 40}
                  height={6}
                  rx={3}
                  style={matched ? ({ '--gem': color } as CSSProperties) : undefined}
                />
              </g>
            );
          })}
        </svg>
        <div className={'dm-hand' + (shown ? (shown.multiplier >= 1 ? ' win' : shown.multiplier > 0 ? ' part' : ' lose') : '')} key={shown?.id ?? 'idle'}>
          {shown ? (
            <>
              <b>{HAND_NAMES[shown.hand]}</b>
              <span>{fmtMult(shown.multiplier)}</span>
            </>
          ) : dropping ? (
            <span>Reading the hand…</span>
          ) : (
            <span>
              Five gems, seven colours. Match them like a poker hand. <kbd>Space</kbd> to bet.
            </span>
          )}
        </div>
      </Board>

      <div className="dm-paytable" aria-label={`${RISK_NAMES[risk]} paytable`}>
        {PAY_HANDS.slice()
          .reverse()
          .map((h) => {
            const m = payout(risk, h);
            return (
              <div key={h} className={'dm-pay' + (hitHand === h ? (m >= 1 ? ' hit' : ' hit miss') : '') + (m === 0 ? ' zero' : '')}>
                <div className="dm-pattern" aria-hidden="true">
                  {HAND_PATTERN[h].flatMap((size, g) => Array.from({ length: size }, (_, k) => <MiniGem key={`${g}-${k}`} index={g} />))}
                </div>
                <span className="dm-pay-name">{HAND_NAMES[h]}</span>
                <b className="dm-pay-mult">{fmtMult(m)}</b>
                <small className="dm-pay-odds">{fmtOneIn(handChance(h))}</small>
              </div>
            );
          })}
      </div>

      {infoOpen && (
        <InfoModal title="Diamonds" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Five gems drop into five slots. Each is one of seven colours. Matching colours make a hand, and the hand pays a multiplier of your bet.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet and pick a risk table: Low, Classic or High (keys 1, 2, 3).</li>
              <li>
                Press Bet (or Space). The gems drop one by one, matched gems light up and the hand is highlighted in the table. Each colour also has its
                own cut, so matches are easy to spot.
              </li>
              <li>Use Auto to run a set number of bets, raise or reset the bet after a win or loss, and stop at a profit or loss limit.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>The table under the board lists every paying hand with its multiplier on the selected risk table and its exact odds:</p>
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
              Every gem is an independent uniform draw from 7 colours, so all 7⁵ = {OUTCOMES.toLocaleString('en-US')} rows are equally likely. Counting
              them by pattern (choose the colours, then their positions) gives the ways above; for example two pair = C(7,2) · 5 · 5!/(2!·2!·1!) = 3,150.
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
