import { useHost } from "@originals/game-sdk/react";
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
  eventMs,
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
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  DIFFICULTY_VOL,
  RTP,
  ZONES,
  ZONE_NAMES,
  payout,
  throwDart,
  topPrize,
  winChance,
  zoneChance,
  TOTAL_UNITS,
  CELLS,
  type Difficulty,
} from "./math";

const ACCENT = ACCENTS.amber;

// Every chance is a whole number of 1/120,000ths: two decimals, trailing zeros dropped.
const fmtChance = (p: number) => `${parseFloat((p * 100).toFixed(2))}%`;

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
  const [flying, setFlying] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The throw is decided the moment the bet is accepted (synchronously, before the dart flies),
  // so leaving at any point before settlement (mid-flight or during the landing beat) settles
  // the open ticket at the real result. A ticket only exists between place() and settle().
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const flightMs = eventMs(turbo.turbo);
  const settleMs = eventMs(turbo.turbo, 110);

  async function playOnce(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    resolved.current = 0;
    const t = throwDart(() => rng.next(), difficulty);
    resolved.current = t.multiplier;
    showLast({
      id: ++seq.current,
      x: t.x,
      y: t.y,
      zone: t.zone,
      cell: t.cell,
      multiplier: t.multiplier,
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
    status = `${ZONE_NAMES[shown.zone]}: ${fmtMult(shown.multiplier)}`;
    tone = shown.multiplier >= 1 ? "won" : "lost";
  } else status = `${DIFFICULTY_NAMES[difficulty]} board, throw a dart`;

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

      <Readouts
        items={[
          { label: "Profit chance", value: fmtChance(winChance(difficulty)), tone: "chance" },
          { label: "Top prize", value: fmtMult(top), tone: "prize" },
        ]}
      />

      <Board className="dt-board">
        <InstantResult
          multiplier={shown ? shown.multiplier : null}
          stake={shown?.stake ?? 0}
          id={shown?.id ?? 0}
        />
        <DartBoard
          difficulty={difficulty}
          dart={last}
          flying={flying}
          flightMs={flightMs}
        />
        {last && !busy && (
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

      <Caption>The dart never misses: the zone it lands in pays its multiplier.</Caption>

      {infoOpen && (
        <InfoModal title="Darts" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Throw one dart. It never misses: it lands at a random point on the
              board, and the zone it lands in pays that zone's multiplier of
              your bet. Every zone pays something back.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>
                Set your bet and pick a difficulty: Easy, Medium, Hard or Expert
                (keys 1–4). The board and the multiplier beside each zone change
                with it.
              </li>
              <li>
                Press Bet (or Space). The dart flies in and lands as a white
                dot. The zone it hit keeps its label marked, and the result
                appears in the history.
              </li>
              <li>
                The dot stays until your next throw. Clear board (or Esc)
                removes it; changing difficulty clears it too.
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
              likely, so a zone's share of the area is exactly its chance. The
              coloured band has 18 equal cells, so each cell of a kind has the
              same chance; darker green pays more.
            </p>
            <div className="dt-info-scroll">
              <table className="dt-info-table">
                <thead>
                  <tr>
                    <th>Zone</th>
                    {DIFFICULTIES.map((d) => (
                      <th key={d}>{DIFFICULTY_NAMES[d]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...ZONES].reverse().map((z) => (
                    <tr key={z}>
                      <td>{ZONE_NAMES[z]}</td>
                      {DIFFICULTIES.map((d) => (
                        <td key={d}>
                          {fmtMult(payout(d, z))} ({fmtChance(zoneChance(d, z))})
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td>Profit chance</td>
                    {DIFFICULTIES.map((d) => (
                      <td key={d}>{fmtChance(winChance(d))}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              For a point uniform on a disc of radius R, P(distance &lt; ρ) =
              ρ²/R², so a zone's chance is its share of the area. The board is{" "}
              {TOTAL_UNITS.toLocaleString("en-US")} equal units. The dart's
              squared distance is drawn as a whole unit s from one uniform
              number, and its angle, which picks one of the {CELLS} cells, from
              another. Zones are ranges of s, so every chance is a whole number
              of units over {TOTAL_UNITS.toLocaleString("en-US")}.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The return of a difficulty is Σ chance × multiplier. Each table
              is built from whole units and whole cents, so this sum is exactly{" "}
              {(RTP * 100).toFixed(0)}% on every difficulty. Difficulty spreads
              the results: Easy pays {fmtChance(winChance("easy"))} of throws a
              profit, Expert only {fmtChance(winChance("expert"))} but up to{" "}
              {fmtMult(topPrize("expert"))}. A point exactly on a boundary
              counts as the outer zone.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
