// PayTableSheet: the paytable, generated from the spec so it can never disagree with the maths.
// Goes inside the kit's InfoModal. Read top to bottom:
//   1. How to win: one or two short lines and a tiny picture of the win law (line, ways, cluster, pay anywhere).
//   2. Special symbols as cards: the wild, the scatter, coins and orbs, the mystery square.
//   3. The feature: its rules (generated from the config), a respin bonus, the multiplier ladders.
//   4. Symbol pays: one compact row per symbol (art, name, four exact counts; the best pay in bold), premiums first
//      and larger, the rest grouped smaller. Each row's "All pays" opens the full per-count table.
//      A pay above the max-win cap is shown at the cap with a "cap" mark.
//   5. The paylines as small pictures (folded away), then the facts: RTP with its tier, hit rate, max win, feature
//      frequency, volatility.

import { InfoSection, fmtChance } from '@originals/game-sdk/ui';
import type { CSSProperties, ReactNode } from 'react';
import type { SlotSpec } from '../engine/types';
import type { SlotCopy, SlotFacts, SlotGameConfig, SlotSymbols, SlotTheme } from './types';
import {
  featureRules,
  fmtCount,
  fmtX,
  howToWinLines,
  idsWithRole,
  ladderLines,
  ladderOf,
  maxRowsOf,
  modifierRuleLines,
  multiplierValues,
  mysterySymbol,
  payAt,
  paylinesOf,
  payRows,
  pluralOf,
  scatterLines,
  symbolMetas,
  tierCounts,
  topPay,
  valueDistribution,
  valueLines,
  wildLines,
} from './util';

const TIER_WORDS = { exact: 'exact', exact_mixture: 'exact mixture', mc: 'Monte Carlo' } as const;

/** "96.00% (exact)" or "96.02% ± 0.03% (Monte Carlo, n = 100,000,000)". */
export function rtpText(f: SlotFacts): string {
  const pct = (f.rtp * 100).toFixed(2) + '%';
  if (f.rtpTier !== 'mc') return `${pct} (${TIER_WORDS[f.rtpTier]})`;
  const se = f.rtpSe !== undefined ? ` ± ${(f.rtpSe * 100).toFixed(2)}%` : '';
  const n = f.rtpN !== undefined ? `, n = ${Math.round(f.rtpN).toLocaleString('en-US')}` : '';
  return `${pct}${se} (${TIER_WORDS.mc}${n})`;
}

export function themeVars(theme: SlotTheme): CSSProperties {
  const p = theme.palette;
  return { '--sl-bg': p.bg, '--sl-frame': p.frame, '--sl-tile': p.tile ?? p.frame, '--sl-hi': p.colors[0], '--sl-ink': p.ink ?? 'var(--text)' } as CSSProperties;
}

function PaylinePicture({ line, cols, rows }: { line: number[]; cols: number; rows: number }) {
  const w = 60;
  const h = 40;
  const pt = (c: number, r: number) => [((c + 0.5) * w) / cols, ((r + 0.5) * h) / rows] as const;
  return (
    <svg className="sl-pl" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Payline: rows ${line.map((r) => r + 1).join(', ')}`}>
      {Array.from({ length: cols }, (_, c) => Array.from({ length: rows }, (_, r) => <circle key={`${c}-${r}`} cx={pt(c, r)[0]} cy={pt(c, r)[1]} r={1.6} className="d" />))}
      <polyline points={line.map((r, c) => pt(c, r).join(',')).join(' ')} />
    </svg>
  );
}

/** A 5×3 picture of how a win looks: the lit cells are the win. Flat shapes in the site's neutral tokens. */
function WinDiagram({ kind, line }: { kind: string; line?: number[] }) {
  const lit: [number, number][] =
    kind === 'payline'
      ? [0, 1, 2].map((c) => [c, line?.[c] ?? 1] as [number, number])
      : kind === 'ways'
        ? [[0, 0], [0, 1], [1, 1], [2, 0], [2, 2]]
        : kind === 'cluster'
          ? [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2]]
          : [[0, 0], [1, 2], [2, 1], [3, 0], [4, 2], [4, 0]];
  const on = new Set(lit.map(([c, r]) => `${c},${r}`));
  const label = { payline: 'A win along a payline', ways: 'A win on neighbouring reels', cluster: 'A win of touching symbols' }[kind] ?? 'A win of matching symbols anywhere';
  return (
    <svg className="sl-wd" viewBox="0 0 70 42" role="img" aria-label={label}>
      {Array.from({ length: 5 }, (_, c) => Array.from({ length: 3 }, (_, r) => <rect key={`${c}${r}`} x={c * 14 + 1} y={r * 14 + 1} width={12} height={12} rx={2} className={on.has(`${c},${r}`) ? 'on' : ''} />))}
      {kind === 'payline' && <polyline points={lit.map(([c, r]) => `${c * 14 + 7},${r * 14 + 7}`).join(' ')} />}
    </svg>
  );
}

export function PayTableSheet({
  spec,
  featureSpecs,
  symbols,
  config,
  copy,
  facts,
  theme,
  modifierName,
}: {
  spec: SlotSpec;
  featureSpecs?: Record<string, SlotSpec>;
  symbols: SlotSymbols;
  config: SlotGameConfig;
  copy?: SlotCopy;
  facts: SlotFacts;
  theme: SlotTheme;
  modifierName?: string;
}) {
  const bet = spec.bet.coins;
  const metas = symbolMetas(spec);
  const kind = spec.evaluation.kind;
  // A pay above the declared max win can never be paid: it is shown at the cap, with a mark.
  const cap = config.maxWinStakes ?? facts.maxWinStakes;
  let anyCapped = false;
  const money = (x: number): ReactNode => {
    if (x > cap) {
      anyCapped = true;
      return (
        <>
          {fmtX(cap)}
          <i className="sl-cap" title="Capped at max win">
            cap
          </i>
        </>
      );
    }
    return fmtX(x);
  };

  // Key symbols a game wants first (`copy.paytableFirst`): first among the cards and first among the pays.
  const firstIds = copy?.paytableFirst ?? [];
  const byFirst = <T,>(id: (x: T) => number, fallback: (a: T, b: T) => number) => (a: T, b: T) => {
    const ia = firstIds.indexOf(id(a));
    const ib = firstIds.indexOf(id(b));
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    return fallback(a, b);
  };
  const hasPays = (id: number) => Object.keys(spec.pays.paytable[String(id)] ?? {}).length > 0;
  const paying = metas
    .filter((m) => m.role !== 'wild' && m.role !== 'scatter' && hasPays(m.id))
    .map((m) => ({ m, pays: spec.pays.paytable[String(m.id)] }))
    .sort(byFirst((x) => x.m.id, (a, b) => topPay(b.pays, bet) - topPay(a.pays, bet)));
  const lows = paying.filter((x) => x.m.role === 'low');
  const premiums = lows.length === paying.length ? paying : paying.filter((x) => x.m.role !== 'low');
  const lowRows = lows.length === paying.length ? [] : lows;
  const counts = tierCounts(spec, paying.map((x) => x.m.id));

  const valueSyms = metas.filter((m) => m.role !== 'wild' && m.role !== 'scatter' && !hasPays(m.id)).sort(byFirst((m) => m.id, () => 0));
  const wilds = idsWithRole(spec, 'wild');
  const scatters = idsWithRole(spec, 'scatter');
  const scatterPay = spec.pays.scatter_pay ?? {};
  const scatterWord = pluralOf(symbols[scatters[0]]?.name);
  const lines = paylinesOf(spec);
  const feature = config.feature;
  const featureName = copy?.featureName ?? 'Free spins';
  const modLines = modifierRuleLines(spec, (id) => symbols[id]?.name ?? `Symbol ${id}`, copy);
  const mults = multiplierValues(spec);
  const ladderLabel = typeof copy?.ladder === 'object' && copy.ladder.label ? copy.ladder.label : 'Step';
  const baseLadder = copy?.ladder === false ? [] : ladderOf(spec);
  const featLadder = copy?.ladder === false ? [] : ladderOf(Object.values(featureSpecs ?? {})[0] ?? spec);
  const art = (id: number, size: number) => symbols[id]?.render(size);
  const name = (id: number) => symbols[id]?.name ?? `Symbol ${id}`;
  const Tile = ({ id, size, cls = '' }: { id: number; size: number; cls?: string }) => <span className={'sl-pt-art ' + cls}>{art(id, size)}</span>;

  // 1. How to win
  const how = howToWinLines(spec, copy).filter((t) => t !== 'Line wins add up');
  if (kind === 'ways') how.push('Pays shown are per way');
  if (mults.length && copy?.multiplierReel) how.push(`Multiplier reel: ×${mults[0]} to ×${mults[mults.length - 1]}`);

  // 2. Special symbol cards
  type Card = { id: number; lines: string[]; chips?: ReactNode };
  const cards: Card[] = [
    ...wilds.map((id) => ({ id, lines: copy?.symbolText?.[id] ? [copy.symbolText[id]] : wildLines(copy) })),
    ...scatters.map((id) => {
      const rows_ = payRows(scatterPay, bet).slice().reverse();
      return {
        id,
        lines: copy?.symbolText?.[id] ? [copy.symbolText[id]] : scatterLines(spec.trigger?.scatter_min ?? 3, feature ? featureName : null, copy, scatterWord),
        chips: rows_.length ? (
          <div className="sl-pt-chips">
            {rows_.slice(0, 4).map((r) => (
              <span key={r.from}>
                {fmtCount(r)} <b>{money(r.stakes)}</b>
              </span>
            ))}
          </div>
        ) : undefined,
      };
    }),
    ...valueSyms.map((m) => {
      const d = valueDistribution(spec, m.id);
      return { id: m.id, lines: copy?.symbolText?.[m.id] ? [copy.symbolText[m.id]] : d ? valueLines(d, bet) : [m.id === mysterySymbol(spec) ? 'Opens into one symbol' : 'Carries a value'] };
    }),
  ].sort(byFirst((c) => c.id, () => 0));

  // 4. Symbol pays
  const unit = kind === 'payline' || kind === 'ways' ? 'of a kind' : 'matching symbols';
  const PayRow = ({ m, pays, big }: { m: { id: number }; pays: Record<string, number>; big: boolean }) => {
    const cells = counts.map((n) => payAt(pays, n, bet));
    const shown = cells.map((v) => (v === null ? null : Math.min(v, cap)));
    const top = Math.max(...shown.filter((v): v is number => v !== null));
    return (
      <div className={'sl-pr' + (big ? ' big' : '')} style={{ '--tiers': counts.length } as CSSProperties}>
        <Tile id={m.id} size={big ? 40 : 28} cls={big ? '' : 'small'} />
        <b className="sl-pr-name">{name(m.id)}</b>
        {cells.map((v, i) => (
          <span key={counts[i]} className={'sl-pr-v' + (shown[i] === top ? ' top' : '')}>
            {v === null ? '–' : money(v)}
          </span>
        ))}
        {copy?.symbolText?.[m.id] && <p className="sl-pt-note">{copy.symbolText[m.id]}</p>}
        <details className="sl-pr-all">
          <summary>All pays</summary>
          <ul className="sl-pr-list">
            {payRows(pays, bet).slice().reverse().map((r) => (
              <li key={r.from}>
                <span>{fmtCount(r)}</span>
                <b>{money(r.stakes)}</b>
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  };
  const head = (
    <div className="sl-pr head" style={{ '--tiers': counts.length } as CSSProperties}>
      <span />
      <span className="sl-pr-unit">{unit}</span>
      {counts.map((n) => (
        <span key={n} className="sl-pr-v">
          {n}
        </span>
      ))}
    </div>
  );

  const facts_: [string, string][] = [
    ['RTP', rtpText(facts)],
    ['Hit rate', `${fmtChance(facts.hitRate)} of spins pay (1 in ${(1 / facts.hitRate).toFixed(1)})`],
    ['Max win', fmtX(facts.maxWinStakes)],
  ];
  if (facts.featureOneIn) facts_.push([feature ? featureName : 'Feature', `1 in ${Math.round(facts.featureOneIn)} spins`]);
  if (facts.volatility) facts_.push(['Volatility', facts.volatility]);

  const paysSection = paying.length > 0 && (
    <InfoSection title="Symbol pays">
      {head}
      {premiums.map(({ m, pays }) => (
        <PayRow key={m.id} m={m} pays={pays} big />
      ))}
      {lowRows.length > 0 && <div className="sl-pr-group">Lower symbols</div>}
      {lowRows.map(({ m, pays }) => (
        <PayRow key={m.id} m={m} pays={pays} big={false} />
      ))}
      {/* Set by `money` while the rows above render: any pay over the cap was shown at the cap. */}
      {anyCapped && <p className="sl-pt-foot">Pays above the max win are capped</p>}
    </InfoSection>
  );

  return (
    <div className="sl-pt" style={themeVars(theme)}>
      <InfoSection title="How to win">
        <div className="sl-pt-how">
          <WinDiagram kind={kind} line={lines[0]} />
          <div>
            {how.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </div>
        </div>
      </InfoSection>

      {cards.length > 0 && (
        <InfoSection title="Special symbols">
          <div className="sl-pt-cards">
            {cards.map((c) => (
              <div key={c.id} className="sl-pt-card">
                <Tile id={c.id} size={44} />
                <div>
                  <b>{name(c.id)}</b>
                  {c.lines.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                  {c.chips}
                </div>
              </div>
            ))}
          </div>
        </InfoSection>
      )}

      {feature && (
        <InfoSection title={featureName}>
          {featureRules(feature, featureName, scatterWord, copy?.featureSpins, symbols[scatters[0]]?.name?.toLowerCase()).map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          {copy?.featureNotes?.map((t, i) => (
            <p key={`n${i}`}>{t}</p>
          ))}
        </InfoSection>
      )}

      {modLines.length > 0 && (
        <InfoSection title={modifierName ?? 'Bonus'}>
          {modLines.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </InfoSection>
      )}

      {baseLadder.length > 0 && (
        <InfoSection title={ladderLabel}>
          {ladderLines('Base', baseLadder).map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          {featLadder.length > 0 && JSON.stringify(featLadder) !== JSON.stringify(baseLadder) && ladderLines(featureName, featLadder).map((t, i) => <p key={`f${i}`}>{t}</p>)}
        </InfoSection>
      )}

      {paysSection}

      {lines.length > 0 && (
        <InfoSection title="Paylines">
          <details className="sl-pr-all">
            <summary>Show the {lines.length} paylines</summary>
            <div className="sl-pl-grid">
              {lines.map((l, i) => (
                <PaylinePicture key={i} line={l} cols={spec.geometry.cols} rows={maxRowsOf(spec)} />
              ))}
            </div>
          </details>
        </InfoSection>
      )}

      <InfoSection title="The numbers">
        <dl className="sl-facts">
          {facts_.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </InfoSection>
    </div>
  );
}
