import { useStore } from '@originals/game-sdk/react';
import { RECOMMENDATION_LABEL, evaluationSummaries } from '../lib/evaluator';
import { reviewPrefs } from '../lib/preferences';

/** A lobby tile's AI score and recommendation. Hidden while AI reviews are switched off. */
export function AiScoreChip({ gameId }: { gameId: string }) {
  const summary = useStore(evaluationSummaries)[gameId];
  const { showAi } = useStore(reviewPrefs);
  if (!showAi || !summary) return null;
  const label = RECOMMENDATION_LABEL[summary.recommendation];
  return (
    <span className={`tile-chip tile-ai ai-${summary.recommendation}`} title={`AI review: ${summary.overall.toFixed(2)} out of 5 (${label})`}>
      ✦ {summary.overall.toFixed(1)} · {label}
    </span>
  );
}
