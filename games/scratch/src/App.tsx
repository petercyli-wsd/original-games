import { InsufficientFundsError, formatAmount, formatMultiplier, formatPercent, type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Board from './Board';
import InfoModal from './InfoModal';
import {
  MAX_CARDS,
  MIN_CARDS,
  MODE_NAMES,
  PRESETS,
  RTP,
  buyPrice,
  clampSetup,
  presetOf,
  prizeMultiplier,
  type Mode,
  type Setup,
} from './math';
import {
  buy,
  canBuy,
  canSell,
  cardsLeft,
  decline,
  hiddenCards,
  isLive,
  isOut,
  liveValue,
  scratch,
  sell,
  startRound,
  totalSpent,
  type Outcome,
  type Round,
} from './round';

type Tone = 'neutral' | 'win' | 'lose' | 'sold';

const MODE_LABEL: Record<Mode, string> = { low: 'Low', medium: 'Medium', high: 'High', extreme: 'Extreme' };

/** A percentage that never rounds a live chance to a misleading 0% or 100%. */
function pct(x: number, digits = 1) {
  const floor = 10 ** -(digits + 2);
  if (x > 0 && x < floor) return `<${formatPercent(floor, digits)}`;
  if (x < 1 && x > 1 - floor) return `>${formatPercent(1 - floor, digits)}`;
  return formatPercent(x, digits);
}

const money = (x: number) => formatAmount(x, 2);

interface HistoryItem {
  id: number;
  outcome: Outcome;
  /** Total payout ÷ total staked this round (buys included). */
  ratio: number;
}

/**
 * Compliance note: "Buy another scratch" lets the player add stake mid-round
 * (a re-buy). Each purchase is fairly priced (same RTP as the base game) and
 * is its own wallet bet, but in-round re-staking can count as a "chase"
 * mechanic in some regulated markets. It is a variant behind the panel switch
 * (BUY_VARIANT_DEFAULT) so an operator can ship with it off.
 */
const BUY_VARIANT_DEFAULT = true;

export default function App() {
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const host = useSettings();

  const [setup, setSetup] = useState<Setup>(PRESETS.medium);
  const [cardsText, setCardsText] = useState(String(PRESETS.medium.cards));
  const [goesText, setGoesText] = useState(String(PRESETS.medium.goes));
  const [betText, setBetText] = useState('1.00');
  const [buyVariant, setBuyVariant] = useState(BUY_VARIANT_DEFAULT);
  const [localTurbo, setLocalTurbo] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const [round, setRound] = useState<Round | null>(null);
  const [anim, setAnim] = useState<{ i: number; id: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: Tone }>({
    text: 'One card hides the diamond. Pick a board and place a bet.',
    tone: 'neutral',
  });

  const turbo = localTurbo || host.turbo;
  const scratchMs = turbo ? 170 : 560;

  // Latest values for timers, async wallet calls and the unmount cleanup.
  const roundRef = useRef<Round | null>(null);
  const mainTicket = useRef<BetTicket | null>(null);
  const buyTickets = useRef<BetTicket[]>([]);
  const busyRef = useRef(false);
  const lockedRef = useRef(false);
  const mounted = useRef(true);
  const animId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = (r: Round | null) => {
    roundRef.current = r;
    setRound(r);
  };
  const lock = (on: boolean) => {
    lockedRef.current = on;
    setLocked(on);
  };
  const setBusyBoth = (on: boolean) => {
    busyRef.current = on;
    setBusy(on);
  };

  /** Main ticket at the round's multiplier, every purchase at 0: total payout = bet × mult. */
  function settleAll(mult: number) {
    const main = mainTicket.current;
    const buys = buyTickets.current;
    mainTicket.current = null;
    buyTickets.current = [];
    if (main) void main.settle(mult);
    for (const t of buys) void t.settle(0);
  }

  // Leaving mid-round sells the remaining goes at their fair value (a scratch
  // already drawn counts: a found winner pays the prize).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      const r = roundRef.current;
      if (mainTicket.current && r) settleAll(liveValue(r));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(r: Round) {
    settleAll(r.mult);
    const spent = totalSpent(r);
    const paid = r.bet * r.mult;
    setHistory((h) => [{ id: (h[0]?.id ?? 0) + 1, outcome: r.outcome!, ratio: paid / spent }, ...h].slice(0, 14));
    if (r.outcome === 'win') {
      setMessage({ text: `You found the diamond! Paid ${money(paid)}.`, tone: 'win' });
    } else if (r.outcome === 'sold') {
      setMessage({ text: `Sold ${r.goesLeft} ${r.goesLeft === 1 ? 'go' : 'goes'} for ${money(paid)}. The diamond is revealed.`, tone: 'sold' });
    } else {
      setMessage({ text: 'No diamond this time. Its card is revealed.', tone: 'lose' });
    }
  }

  function checkpoint(r: Round) {
    const left = cardsLeft(r);
    if (isOut(r)) {
      const price = buyPrice(r, r.bet, left);
      setMessage({
        text:
          price > wallet.balance.get()
            ? `Out of goes. Balance too low to buy another scratch (${money(price)}).`
            : `Out of goes, ${left} cards left. Buy another scratch for ${money(price)}, or end the round.`,
        tone: 'neutral',
      });
      return;
    }
    track({ type: 'checkpoint', multiplier: liveValue(r), winChance: r.goesLeft / left });
    setMessage({
      text: `Miss. ${r.goesLeft} in ${left} now. Scratch on, or sell your goes for ${money(r.bet * liveValue(r))}.`,
      tone: 'neutral',
    });
  }

  function scratchCard(i: number) {
    const r = roundRef.current;
    if (!r || !isLive(r) || r.goesLeft <= 0 || r.board[i] !== 'hidden' || lockedRef.current || busyRef.current) return;
    const next = scratch(r, i);
    show(next);
    setAnim({ i, id: ++animId.current });
    lock(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lock(false);
      if (next.outcome) finish(next);
      else checkpoint(next);
    }, scratchMs);
  }

  const scratchRandom = () => {
    const r = roundRef.current;
    if (!r) return;
    const free = hiddenCards(r);
    if (free.length) scratchCard(free[rng.int(free.length)]);
  };

  const bet = parseFloat(betText) || 0;
  const betInvalid = !(bet > 0) || bet > balance;

  async function start() {
    if (busyRef.current || mainTicket.current || betInvalid) return;
    setBusyBoth(true);
    let ticket: BetTicket;
    try {
      ticket = await wallet.placeBet(bet);
    } catch (err) {
      setMessage({ text: err instanceof InsufficientFundsError ? 'Not enough balance.' : 'Enter a valid bet.', tone: 'lose' });
      setBusyBoth(false);
      return;
    }
    if (!mounted.current) {
      void ticket.settle(1); // left before the round began: refund
      return;
    }
    setBusyBoth(false);
    mainTicket.current = ticket;
    const s = clampSetup(setup.cards, setup.goes);
    const r = startRound(s, ticket.amount, rng.int(s.cards), buyVariant);
    setAnim(null);
    show(r);
    setMessage({ text: `${s.goes} in ${s.cards}. Scratch a card, or press Space for a random one.`, tone: 'neutral' });
  }

  const sellGoes = () => {
    const r = roundRef.current;
    if (!r || !canSell(r) || lockedRef.current || busyRef.current) return;
    const next = sell(r);
    show(next);
    finish(next);
  };

  const endRound = () => {
    const r = roundRef.current;
    if (!r || !isOut(r) || lockedRef.current || busyRef.current) return;
    const next = decline(r);
    show(next);
    finish(next);
  };

  async function buyScratch() {
    const r = roundRef.current;
    if (!r || !canBuy(r) || lockedRef.current || busyRef.current) return;
    const price = buyPrice(r, r.bet, cardsLeft(r));
    if (price > wallet.balance.get()) return;
    setBusyBoth(true);
    let ticket: BetTicket;
    try {
      ticket = await wallet.placeBet(price);
    } catch {
      setMessage({ text: 'Not enough balance for another scratch.', tone: 'lose' });
      setBusyBoth(false);
      return;
    }
    if (!mounted.current) {
      // The round was already sold at its value without this go: refund it.
      void ticket.settle(1);
      return;
    }
    setBusyBoth(false);
    buyTickets.current.push(ticket);
    const next = buy(r, price);
    show(next);
    const left = cardsLeft(next);
    track({ type: 'checkpoint', multiplier: liveValue(next), winChance: next.goesLeft / left });
    setMessage({
      text: `Bought a scratch for ${money(price)}. ${next.goesLeft} in ${left}: ${pct(next.goesLeft / left)} to win ${money(next.bet * next.prize)}.`,
      tone: 'neutral',
    });
  }

  // A settings change after a round clears the board back to a preview.
  const reset = () => {
    const r = roundRef.current;
    if (r && !isLive(r)) {
      show(null);
      setAnim(null);
    }
  };

  function applySetup(s: Setup) {
    reset();
    setSetup(s);
    setCardsText(String(s.cards));
    setGoesText(String(s.goes));
  }

  const commitCustom = (cards: string, goes: string) => applySetup(clampSetup(parseInt(cards, 10), parseInt(goes, 10)));

  const live = !!round && isLive(round);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.composedPath()[0] as HTMLElement | undefined;
      if (infoOpen || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        if (!live) void start();
        else scratchRandom();
      } else if (k === 's') {
        if (round && isOut(round)) endRound();
        else sellGoes();
      } else if (k === 'b') void buyScratch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- derived

  const shown = round ?? startRound(clampSetup(setup.cards, setup.goes), bet, -1, buyVariant);
  const stake = round ? round.bet : bet;
  const left = cardsLeft(shown);
  const g = shown.goesLeft;
  const over = !!round && !isLive(round);
  const out = !!round && isOut(round);
  const prize = shown.prize;
  const chance = over ? (round!.outcome === 'win' ? 1 : round!.outcome === 'lost' ? 0 : g / left) : g / left;
  const sellable = !!round && canSell(round) && !locked;
  const sellValue = round && canSell(round) ? round.bet * liveValue(round) : 0;
  const buyable = !!round && canBuy(round);
  const price = round && buyable ? buyPrice(round, round.bet, left) : 0;
  const cantAfford = buyable && price > balance;
  const spent = round ? totalSpent(round) : 0;
  const chanceTone = out ? 'out' : over ? undefined : 'neutral';
  const tone: Tone = over ? (round!.outcome === 'win' ? 'win' : round!.outcome === 'sold' ? 'sold' : 'lose') : 'neutral';
  const preset = presetOf(setup);
  const totalTokens = shown.goes + shown.buys.length;
  const usedTokens = totalTokens - g;
  const ghost = over && round!.outcome !== 'win' ? round!.winner : null;
  const buyReason = !round
    ? ''
    : !round.buyEnabled
      ? 'Variant off'
      : round.misses === 0
        ? 'After your first miss'
        : left <= 1
          ? 'One card left'
          : g >= left
            ? 'Your goes cover every card'
            : cantAfford
              ? 'Balance too low'
              : '';

  const chanceLabel = over
    ? round!.outcome === 'win'
      ? 'Found it'
      : round!.outcome === 'sold'
        ? `Sold at ${g} in ${left}`
        : 'Round lost'
    : `${g} in ${left}`;

  return (
    <div className="scratch" style={{ '--scratch': `${scratchMs}ms` } as CSSProperties}>
      <aside className="panel">
        <div className="field">
          <span className="label">Bet amount</span>
          <div className="bet-row">
            <input
              value={betText}
              inputMode="decimal"
              aria-label="Bet amount"
              disabled={live || busy}
              onChange={(e) => setBetText(e.target.value)}
              onBlur={() => setBetText((v) => money(parseFloat(v) || 0))}
            />
            <button disabled={live || busy} onClick={() => setBetText(money(bet / 2))}>
              ½
            </button>
            <button disabled={live || busy} onClick={() => setBetText(money(Math.min(balance, bet * 2)))}>
              2×
            </button>
          </div>
        </div>

        <div className="field">
          <span className="label">
            Volatility <em>goes of cards</em>
          </span>
          <div className="presets">
            {MODE_NAMES.map((m) => (
              <button key={m} className={m === preset ? 'on' : ''} disabled={live || busy} onClick={() => applySetup(PRESETS[m])}>
                <span>{MODE_LABEL[m]}</span>
                <b>
                  {PRESETS[m].goes}/{PRESETS[m].cards}
                </b>
                <small>{formatMultiplier(prizeMultiplier(PRESETS[m]))}</small>
              </button>
            ))}
          </div>
          <div className={'custom' + (preset ? '' : ' on')}>
            <NumberField
              label="Goes"
              value={goesText}
              disabled={live || busy}
              onText={setGoesText}
              onCommit={(v) => commitCustom(cardsText, v)}
              step={(d) => applySetup(clampSetup(setup.cards, setup.goes + d))}
            />
            <span className="of">of</span>
            <NumberField
              label="Cards"
              value={cardsText}
              disabled={live || busy}
              onText={setCardsText}
              onCommit={(v) => commitCustom(v, goesText)}
              step={(d) => applySetup(clampSetup(setup.cards + d, setup.goes))}
            />
          </div>
          <span className="hint-line">
            {pct(setup.goes / setup.cards)} to win · pays {formatMultiplier(prizeMultiplier(setup))}
            <i>{preset ? 'preset' : `custom · ${MIN_CARDS}–${MAX_CARDS} cards`}</i>
          </span>
        </div>

        <div className="toggles">
          <label className="toggle">
            <input
              type="checkbox"
              checked={buyVariant}
              disabled={live || busy}
              onChange={(e) => {
                reset();
                setBuyVariant(e.target.checked);
              }}
            />
            <i />
            <span>
              Buy extra scratches <em className="tag">variant</em>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={turbo} disabled={host.turbo} onChange={(e) => setLocalTurbo(e.target.checked)} />
            <i />
            <span>Turbo</span>
          </label>
        </div>

        <div className="actions">
          {!live ? (
            <button className="primary" disabled={betInvalid || busy} onClick={() => void start()}>
              {busy ? 'Placing bet…' : 'Bet'}
              <kbd>Space</kbd>
            </button>
          ) : out ? (
            <>
              <button className="buy strong" disabled={!buyable || cantAfford || busy || locked} onClick={() => void buyScratch()}>
                <span>
                  Buy another scratch <b>{money(price)}</b>
                </span>
                <kbd>B</kbd>
              </button>
              {buyReason && <span className="reason">{buyReason}</span>}
              <button className="secondary" disabled={locked || busy} onClick={endRound}>
                End round
                <kbd>S</kbd>
              </button>
            </>
          ) : (
            <>
              <button className="primary" disabled={locked || busy} onClick={scratchRandom}>
                Scratch random
                <kbd>Space</kbd>
              </button>
              <button className="sell" disabled={!sellable || busy} onClick={sellGoes}>
                <span>
                  Sell remaining goes <b>{sellable ? money(sellValue) : '–'}</b>
                </span>
                <kbd>S</kbd>
              </button>
              {round!.buyEnabled && (
                <>
                  <button className="buy" disabled={!buyable || cantAfford || busy || locked} onClick={() => void buyScratch()}>
                    <span>
                      Buy another scratch <b>{buyable ? money(price) : '–'}</b>
                    </span>
                    <kbd>B</kbd>
                  </button>
                  {buyReason && <span className="reason">{buyReason}</span>}
                </>
              )}
            </>
          )}
        </div>

        <dl className="stats">
          <div>
            <dt>Balance</dt>
            <dd>{money(balance)}</dd>
          </div>
          <div>
            <dt>Return to player</dt>
            <dd>{formatPercent(RTP, 0)}</dd>
          </div>
        </dl>
        <button className="link" onClick={() => setInfoOpen(true)}>
          <span className="i">i</span> How to play
        </button>
      </aside>

      <section className={'stage ' + tone}>
        <div className="readout">
          <div className={'chance ' + (chanceTone ?? tone)}>
            <span className="label">Win chance</span>
            <b>{chanceLabel}</b>
            <small>{pct(chance)}</small>
          </div>
          <div className="tile sellv">
            <span className="label">Sell value</span>
            <b>{round && canSell(round) ? money(sellValue) : over && round!.outcome === 'sold' ? money(round!.bet * round!.mult) : '–'}</b>
            <small>
              {round && canSell(round)
                ? formatMultiplier(liveValue(round))
                : over
                  ? round!.outcome === 'sold'
                    ? `sold at ${formatMultiplier(round!.mult)}`
                    : 'round over'
                  : out
                    ? 'no goes left'
                    : 'after a miss'}
            </small>
          </div>
          <div className="tile prize">
            <span className="label">Prize</span>
            <b>{money(stake * prize)}</b>
            <small>{formatMultiplier(prize)}</small>
          </div>
          <div className={'tile spent' + (round && spent > stake * prize ? ' over' : '')}>
            <span className="label">Spent this round</span>
            <b>{round ? money(spent) : '–'}</b>
            <small>
              {round
                ? round.buys.length
                  ? `bet + ${round.buys.length} ${round.buys.length === 1 ? 'buy' : 'buys'}`
                  : 'bet only'
                : `bet ${money(bet)}`}
            </small>
          </div>
        </div>

        <div className="odds">
          <div className="tokens" aria-label={`${g} of ${totalTokens} goes left`}>
            <span className="label">Goes</span>
            {totalTokens <= 24 ? (
              <span className="chips">
                {Array.from({ length: totalTokens }, (_, k) => (
                  <i key={k} className={(k < usedTokens ? 'used' : 'left') + (k >= shown.goes ? ' bought' : '')} />
                ))}
              </span>
            ) : (
              <span className="count">
                <b>{g}</b> of {totalTokens}
              </span>
            )}
          </div>
          <div className="meter" aria-hidden="true">
            {Array.from({ length: left }, (_, k) => (
              <i key={k} className={k < g ? 'lit' : ''} />
            ))}
          </div>
          <span className="cover">
            {over && round!.outcome === 'win' ? (
              'Diamond found'
            ) : (
              <>
                your goes cover <b>{Math.min(g, left)}</b> of <b>{left}</b> {left === 1 ? 'card' : 'cards'}
              </>
            )}
          </span>
        </div>

        <div className="board-wrap">
          <Board
            board={shown.board}
            ghost={ghost}
            anim={anim}
            playable={live && !out && !locked && !busy}
            preview={!round}
            over={over}
            onScratch={scratchCard}
          />
        </div>

        {out && !locked ? (
          <div className="offer" role="group" aria-label="Out of goes">
            <div className="offer-text">
              <b>Out of goes</b>
              <span>
                One more scratch: <em>1 in {left}</em> to win <em>{money(round!.bet * prize)}</em>
                {cantAfford && <> · balance too low</>}
              </span>
            </div>
            <div className="offer-actions">
              <button className="buy strong" disabled={cantAfford || busy} onClick={() => void buyScratch()}>
                Buy for {money(price)}
              </button>
              <button className="secondary" disabled={busy} onClick={endRound}>
                End round
              </button>
            </div>
          </div>
        ) : (
          <div className="outcome" aria-live="polite">
            {over && (
              <span className={'result ' + tone} key={history[0]?.id}>
                <b>{round!.outcome === 'win' ? 'Winner' : round!.outcome === 'sold' ? 'Sold' : 'Lost'}</b>
                <span>
                  {round!.bet * round!.mult - spent >= 0 ? '+' : '−'}
                  {money(Math.abs(round!.bet * round!.mult - spent))}
                </span>
              </span>
            )}
            <p className={'message ' + message.tone}>{message.text}</p>
          </div>
        )}

        <ol className="history" aria-label="Recent results">
          {history.map((h) => (
            <li key={h.id} className={h.outcome} title={h.outcome === 'sold' ? 'Sold' : h.outcome === 'win' ? 'Won' : 'Lost'}>
              {formatMultiplier(h.ratio)}
            </li>
          ))}
        </ol>
      </section>

      {infoOpen && <InfoModal rtp={RTP} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: string;
  disabled: boolean;
  onText(v: string): void;
  onCommit(v: string): void;
  step(delta: number): void;
}

function NumberField({ label, value, disabled, onText, onCommit, step }: NumberFieldProps) {
  return (
    <label className="num">
      <span>{label}</span>
      <span className="num-row">
        <button type="button" disabled={disabled} onClick={() => step(-1)} aria-label={`Fewer ${label.toLowerCase()}`}>
          −
        </button>
        <input
          value={value}
          inputMode="numeric"
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onText(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <button type="button" disabled={disabled} onClick={() => step(1)} aria-label={`More ${label.toLowerCase()}`}>
          +
        </button>
      </span>
    </label>
  );
}
