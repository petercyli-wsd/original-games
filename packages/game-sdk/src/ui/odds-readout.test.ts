import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChanceBar, Readouts, oddsClass } from './components';
import { kitStyles } from './styles';

describe('oddsReadout off', () => {
  it('adds the root class only when off', () => {
    expect(oddsClass('off')).toBe('og-game og-odds-off');
    expect(oddsClass('on')).toBe('og-game');
    expect(oddsClass(undefined)).toBe('og-game');
  });

  it('kit CSS hides only the chance readouts and the ChanceBar number', () => {
    const rules = kitStyles.split('\n').filter((l) => l.startsWith('.og-odds-off'));
    expect(rules.join('\n')).toContain('.og-odds-off .og-readout.chance { display: none; }');
    expect(rules.join('\n')).toContain('.og-odds-off .og-chance-head b { display: none; }');
    expect(rules).toHaveLength(2);
  });

  it('keeps the markup the CSS targets, and the picture, in place', () => {
    const readouts = renderToStaticMarkup(
      createElement(Readouts, { items: [{ label: 'Win chance', value: '49%', tone: 'chance' }, { label: 'Prize', value: '2x', tone: 'prize' }] }),
    );
    expect(readouts).toContain('og-readout chance');
    expect(readouts).toContain('og-readout prize');
    const bar = renderToStaticMarkup(createElement(ChanceBar, { p: 0.5 }));
    expect(bar).toContain('<div class="og-chance-head"><span>Win chance</span><b>');
    expect(bar).toContain('og-chance-track');
  });
});
