// PayTableSheet: the paytable, generated from the spec so it can never disagree with the maths.
// Goes inside the kit's InfoModal. Sections: how to win, the symbols with their pays (merged into
// count ranges, in stakes), the wild and scatter rules, the feature, the paylines as small pictures,
// and the measured facts (RTP with its tier, hit rate, max win, feature frequency, volatility).

import { InfoSection, fmtChance } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';
import type { SlotSpec } from '../engine/types';
import type { SlotCopy, SlotFacts, SlotGameConfig, SlotSymbols, SlotTheme } from './types';
import { featureRules, fmtCount, fmtX, howToWinLines, idsWithRole, maxRowsOf, paylinesOf, payRows, scatterLines, symbolMetas, topPay, wildLines } from './util';

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

export function PayTableSheet({ spec, symbols, config, copy, facts, theme }: { spec: SlotSpec; symbols: SlotSymbols; config: SlotGameConfig; copy?: SlotCopy; facts: SlotFacts; theme: SlotTheme }) {
  const bet = spec.bet.coins;
  const metas = symbolMetas(spec);
  const paying = metas
    .filter((m) => m.role !== 'wild' && m.role !== 'scatter')
    .map((m) => ({ m, pays: spec.pays.paytable[String(m.id)] }))
    .sort((a, b) => topPay(b.pays, bet) - topPay(a.pays, bet));
  const wilds = idsWithRole(spec, 'wild');
  const scatters = idsWithRole(spec, 'scatter');
  const scatterPay = spec.pays.scatter_pay ?? {};
  const lines = paylinesOf(spec);
  const cols = spec.geometry.cols;
  const rows = maxRowsOf(spec);
  const feature = config.feature;
  const featureName = copy?.featureName ?? 'Free spins';
  const art = (id: number, size: number) => symbols[id]?.render(size);
  const name = (id: number) => symbols[id]?.name ?? `Symbol ${id}`;

  const how = howToWinLines(spec, copy);

  const facts_: [string, string][] = [
    ['RTP', rtpText(facts)],
    ['Hit rate', `${fmtChance(facts.hitRate)} of spins pay (1 in ${(1 / facts.hitRate).toFixed(1)})`],
    ['Max win', fmtX(facts.maxWinStakes)],
  ];
  if (facts.featureOneIn) facts_.push([feature ? featureName : 'Feature', `1 in ${Math.round(facts.featureOneIn)} spins`]);
  if (facts.volatility) facts_.push(['Volatility', facts.volatility]);

  const Tile = ({ id, size }: { id: number; size: number }) => <span className="sl-pt-art">{art(id, size)}</span>;

  return (
    <div className="sl-pt" style={themeVars(theme)}>
      <InfoSection title="How to win">
        {how.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </InfoSection>

      <InfoSection title="Symbols">
        <div className="sl-pt-grid">
          {paying.map(({ m, pays }) => (
            <div key={m.id} className="sl-pt-sym">
              <Tile id={m.id} size={44} />
              <div>
                <b>{name(m.id)}</b>
                <ul className="sl-pays">
                  {payRows(pays ?? {}, bet).map((r) => (
                    <li key={r.from}>
                      <span>{fmtCount(r)}</span>
                      <b>{fmtX(r.stakes)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </InfoSection>

      {(wilds.length > 0 || scatters.length > 0) && (
        <InfoSection title="Special symbols">
          {wilds.map((id) => (
            <div key={id} className="sl-pt-special">
              <Tile id={id} size={44} />
              <div>
                <b>{name(id)}</b>
                {wildLines(copy).map((t, i) => (
                  <p key={i}>{t}</p>
                ))}
              </div>
            </div>
          ))}
          {scatters.map((id) => {
            const rows_ = payRows(scatterPay, bet);
            return (
              <div key={id} className="sl-pt-special">
                <Tile id={id} size={44} />
                <div>
                  <b>{name(id)}</b>
                  {scatterLines(spec.trigger?.scatter_min ?? 3, feature ? featureName : null, copy).map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                  {rows_.length > 0 && (
                    <ul className="sl-pays inline">
                      {rows_.map((r) => (
                        <li key={r.from}>
                          <span>{fmtCount(r)}</span>
                          <b>{fmtX(r.stakes)}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </InfoSection>
      )}

      {feature && (
        <InfoSection title={featureName}>
          {featureRules(feature, featureName).map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </InfoSection>
      )}

      {lines.length > 0 && (
        <InfoSection title="Paylines">
          <div className="sl-pl-grid">
            {lines.map((l, i) => (
              <PaylinePicture key={i} line={l} cols={cols} rows={rows} />
            ))}
          </div>
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
