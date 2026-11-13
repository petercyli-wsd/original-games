import { CARDS, type Card } from './math';
import { fmtMult } from '@originals/game-sdk/ui';

export interface PackProps {
  /** Cards drawn so far (the newest may still be flipping). */
  cards: Card[];
  /** How many of them are face up. */
  shown: number;
  /** A card is flipping right now. */
  opening: boolean;
  ms: number;
  /** The round is over: the last result stays marked. */
  done: boolean;
}

export default function Pack({ cards, shown, opening, ms, done }: PackProps) {
  return (
    <div className="pack" style={{ ['--flip' as string]: `${ms}ms` }}>
      {Array.from({ length: CARDS }, (_, i) => {
        const card = cards[i];
        const up = !!card && i < shown;
        const flipping = !!card && !up && opening;
        const newest = up && i === cards.length - 1 && !done;
        const cls = 'pack-card' + (up ? ' up' : '') + (flipping ? ' flip' : '') + (up && card.cents >= 100 ? ' pays' : '') + (newest ? ' newest' : '');
        return (
          <div key={i} className={cls} aria-label={up ? `Card ${i + 1}: ${fmtMult(card.mult)} ${card.tier}` : `Card ${i + 1}: face down`}>
            {up ? (
              <>
                <b>{fmtMult(card.mult).replace('.00×', '×')}</b>
                <span>{card.tier}</span>
              </>
            ) : (
              <b className="back">{i + 1}</b>
            )}
          </div>
        );
      })}
    </div>
  );
}
