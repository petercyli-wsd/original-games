import { DRAWS, MAJORITY, tally } from '../math';

interface Props {
  blue: number;
  red: number;
  /** Highlight the next slot on each side while waiting for a draw. */
  live: boolean;
}

// The race the bet is on: 11 draw slots. Blue draws fill from the left, red
// draws from the right, and the centre slot is the finish: whoever fills it has
// 6 of the 11 draws and wins. The empty slots are the draws left, and each
// side's gap to the centre is how many more it needs.
export default function Tally({ blue, red, live }: Props) {
  const { left } = tally(blue, red);
  const centre = MAJORITY - 1;
  const slots = Array.from({ length: DRAWS }, (_, i) => {
    if (i < blue) return 'blue';
    if (i >= DRAWS - red) return 'red';
    return '';
  });
  return (
    <div className="tally">
      <div className="tally-head">
        <span className="t-blue">
          <b>{blue}</b> blue
        </span>
        <span className="t-red">
          red <b>{red}</b>
        </span>
      </div>
      <ol className="tally-row" aria-label={`Draws: ${blue} blue, ${red} red, ${left} left`}>
        {slots.map((c, i) => {
          const cls = ['tally-slot'];
          if (c) cls.push(c);
          if (i === centre) cls.push('finish');
          if (live && !c && (i === blue || i === DRAWS - red - 1)) cls.push('next');
          return (
            <li key={i + c} className={cls.join(' ')}>
              {i === centre && !c && <span className="finish-mark">{MAJORITY}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
