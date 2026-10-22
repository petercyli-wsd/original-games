import { formatAmount } from "@originals/game-sdk";
import { useHost } from "@originals/game-sdk/react";
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
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  StageTop,
  VolBadge,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from "@originals/game-sdk/ui";
import { useEffect, useRef, useState } from "react";
import DartBoard, { type Mark } from "./Board";
import {
  AREA_UNITS,
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  DIFFICULTY_VOL,
  INNER_R,
  OUTER_R,
  RTP,
  ZONES,
  ZONE_NAMES,
  payout,
  returnChance,
  throwDart,
  tiersFor,
  topPrize,
  winChance,
  zoneChance,
  type Difficulty,
} from "./math";

const ACCENT = "#84cc16";

// Every chance on this board is a whole number of 1/10,000ths, so show it exactly
// (19.25%, not 19.3%): two decimals at most, trailing zeros dropped.
const fmtChance = (p: number) => `${parseFloat((p * 100).toFixed(2))}%`;
const MAX_MARKS = 12;

interface Last extends Mark {
  stake: number;
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficultyState] = useState<Difficulty>("medium");
  const [last, setLast] = useState<Last | null>(null);
  const lastRef = useRef<Last | null>(null);
  const showLast = (l: Last | null) => {
    lastRef.current = l;
    setLast(l);
  };
  const [marks, setMarks] = useState<Mark[]>([]);
  const [flying, setFlying] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The throw is decided the moment the bet is accepted (synchronously, before the dart flies),
  // so leaving at any point before settlement (mid-flight or during the landing beat) settles
  // the open ticket at the real result. A ticket only exists between place() and settle().
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const flightMs = turbo.turbo ? 170 : 620;
  const settleMs = turbo.turbo ? 30 : 110;

  async function playOnce(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    resolved.current = 0;
    const t = throwDart(() => rng.next(), difficulty);
    resolved.current = t.multiplier;
    // The previous dart becomes a pin on the board.
    const prev = lastRef.current;
    if (prev) setMarks((m) => [prev, ...m].slice(0, MAX_MARKS));
    showLast({
      id: ++seq.current,
      x: t.x,
      y: t.y,
      zone: t.zone,
      multiplier: t.multiplier,
      tier: tiersFor(difficulty)[t.zone],
      stake,
    });
    setFlying(true);
    await timers.wait(flightMs);
    setFlying(false);
    await timers.wait(settleMs);
    ticket.settle(t.multiplier);
    pushHistory(t.multiplier);
    return t.multiplier;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  const busy = flying || auto.running;
  const canBet = auto.mode === "manual" && !busy && !bet.blocked;

  function clearBoard() {
    if (busy) return;
    showLast(null);
    setMarks([]);
  }

  // A setting change clears the board back to an idle preview of the new rings.
  const setDifficulty = (d: Difficulty) => {
    if (busy || d === difficulty) return;
    setDifficultyState(d);
    clearBoard();
  };

  useHotkeys(
    { space: () => (canBet ? void playOnce(bet.value) : undefined) },
    !infoOpen,
  );

  // 1–4 pick the difficulty, Esc clears the darts from the board.
  const keys = useRef({ setDifficulty, clearBoard });
  keys.current = { setDifficulty, clearBoard };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) keys.current.setDifficulty(DIFFICULTIES[i]);
      else if (e.key === "Escape") keys.current.clearBoard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoOpen]);

  const shown = last && !flying ? last : null;
  const top = topPrize(difficulty);

  let status: string;
  let tone: "idle" | "live" | "won" | "lost" = "idle";
  if (flying) {
    status = "Dart in the air…";
    tone = "live";
  } else if (shown) {
    status = `${ZONE_NAMES[shown.zone]} · ${fmtMult(shown.multiplier)}`;
    tone = shown.multiplier >= 1 ? "won" : "lost";
  } else status = `${DIFFICULTY_NAMES[difficulty]} board · area is the odds`;

  return (
    <GameLayout
      name="Darts"
      accent={ACCENT}
      panel={
        <>
          <ModeTabs auto={auto} disabled={flying} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={DIFFICULTY_VOL[difficulty]} />}>
            Difficulty
          </Label>
          <Chips
            label="Difficulty"
            options={DIFFICULTIES.map((d, i) => ({
              value: d,
              label: DIFFICULTY_NAMES[d],
              title: `${DIFFICULTY_NAMES[d]} (key ${i + 1})`,
            }))}
            value={difficulty}
            onChange={setDifficulty}
            disabled={busy}
          />

          <dl className="og-stats">
            <dt>Chance to profit</dt>
            <dd>{fmtChance(winChance(difficulty))}</dd>
            <dt>Pays something</dt>
            <dd>{fmtChance(returnChance(difficulty))}</dd>
            <dt>Top prize</dt>
            <dd>{fmtMult(top)}</dd>
            <dt>Max win</dt>
            <dd>{formatAmount(bet.value * top, 2)}</dd>
          </dl>

          {auto.mode === "manual" ? (
            <ActionButton
              disabled={!canBet}
              onClick={() => void playOnce(bet.value)}
            >
              {flying ? "Throwing…" : "Bet"}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || flying} />
          )}
          {bet.blocked && <p className="dt-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Board className="dt-board">
        <InstantResult
          multiplier={shown ? shown.multiplier : null}
          stake={shown?.stake ?? 0}
          id={shown?.id ?? 0}
        />
        <DartBoard
          difficulty={difficulty}
          dart={last}
          marks={marks}
          flying={flying}
          flightMs={flightMs}
        />
        {(marks.length > 0 || last) && !busy && (
          <button
            type="button"
            className="dt-clear og-ghost"
            onClick={clearBoard}
            title="Clear darts (Esc)"
          >
            Clear board
          </button>
        )}
      </Board>

      <div
        className="dt-pays"
        aria-label={`${DIFFICULTY_NAMES[difficulty]} payouts`}
      >
        {ZONES.map((z) => {
          const m = payout(difficulty, z);
          const tier = tiersFor(difficulty)[z];
          const isHit = shown?.zone === z;
          return (
            <div
              key={z}
              className={
                `dt-pay t-${tier}` +
                (isHit ? " hit" : "") +
                (m === 0 ? " zero" : "")
              }
            >
              <i aria-hidden="true" />
              <b>{fmtMult(m)}</b>
              <span>{ZONE_NAMES[z]}</span>
              <small>{fmtChance(zoneChance(z))}</small>
            </div>
          );
        })}
      </div>

      <Caption>
        The dart lands uniformly on the board, so each ring's share of the area
        is its exact chance. Every difficulty returns {(RTP * 100).toFixed(0)}%.{" "}
        <span className="dt-keys">
          <kbd>Space</kbd> bet · <kbd>1</kbd>–<kbd>4</kbd> difficulty
        </span>
      </Caption>

      {infoOpen && (
        <InfoModal title="Darts" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Throw one dart. It lands at a random point on the board, and the
              ring it lands in pays that ring's multiplier of your bet.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>
                Set your bet and pick a difficulty: Easy, Medium, Hard or Expert
                (keys 1–4). The rings recolour to show what each pays.
              </li>
              <li>
                Press Bet (or Space). The dart flies in, the ring it hits lights
                up, and the result appears on the board and in the history.
              </li>
              <li>
                Earlier darts stay as pins. Clear board (or Esc) removes them;
                changing difficulty clears them too.
              </li>
              <li>
                Use Auto to run a series of throws with your own stop rules and
                stake changes on win or loss.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The board is drawn to scale. Every point of the board is equally
              likely, so a ring's share of the board's area is exactly its
              chance:
            </p>
            <div className="dt-info-scroll">
              <table className="dt-info-table">
                <thead>
                  <tr>
                    <th>Ring</th>
                    <th>Radii</th>
                    <th>Chance</th>
                    {DIFFICULTIES.map((d) => (
                      <th key={d}>{DIFFICULTY_NAMES[d]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ZONES.map((z) => (
                    <tr key={z}>
                      <td>{ZONE_NAMES[z]}</td>
                      <td>
                        {INNER_R[z]}–{OUTER_R[z]}
                      </td>
                      <td>{fmtChance(zoneChance(z))}</td>
                      {DIFFICULTIES.map((d) => (
                        <td key={d}>{fmtMult(payout(d, z))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              For a point uniform on a disc of radius R, P(distance &lt; ρ) =
              ρ²/R², so a ring between radii a and b is hit with chance (b² −
              a²)/R², its share of the area. The dart is placed at distance R·√u
              and angle 2π·v from two uniform numbers u and v, which is exactly
              uniform on the disc. With R = 100 every ring's area is a whole
              number of 1/10,000ths of the board: the triple band (45–50) is
              (2500 − 2025)/10,000 = {(AREA_UNITS.triple / 100).toFixed(2)}%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The return of a difficulty is Σ chance × multiplier. Each table is
              set in whole cents so this sum is exactly {(RTP * 100).toFixed(0)}
              % (for Medium: 0.25%×20 + 0.75%×8 + 19.25%×1.5 + 4.75%×4 + 39%×0.5
              + 8.25%×2.5 = 0.99). Difficulty only changes how results are
              spread: Easy pays {fmtChance(winChance("easy"))} of throws a
              profit, Expert pays {fmtChance(winChance("expert"))} but up to{" "}
              {fmtMult(topPrize("expert"))}. A point exactly on a wire counts as
              the outer ring.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
