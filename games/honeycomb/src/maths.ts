// The respin feature's own maths, used by the tests: an independent re-implementation of
// hold_and_spin_lock_respin on this game's spec. The board that starts it is drawn exactly from the
// per-reel coin-count distribution given entry_min or more coins (so every sample is a triggering board), then
// the respins are played as the engine plays them. The queen (orb_sum_terminal) is read off the final board:
// the queens on the cells the last respin dealt (never a held cell). Values are in stakes; `harvest` is the
// cells' total (+ the full-comb bonus), `queen` the harvest's share of the queens' multiplier (the base board's
// own line win, which the queens also multiply, is not modelled here).
import type { SlotSpec } from '@originals/slots';

const COIN = 11;
const QUEEN = 12;
function coinCountPmf(strip: number[], rows = 5): { counts: number[]; stopsByCount: number[][] } {
  const L = strip.length;
  const stopsByCount: number[][] = [];
  for (let i = 0; i < L; i++) {
    let k = 0;
    for (let r = 0; r < rows; r++) if (strip[(i + r) % L] === COIN) k++;
    while (stopsByCount.length <= k) stopsByCount.push([]);
    stopsByCount[k].push(i);
  }
  return { counts: stopsByCount.map((s) => s.length / L), stopsByCount };
}


export interface FeatureStats { nHist: number[]; pTrig: number; harvest: number; pQueen: number; queenMean: number; mean: number; m2: number; pFull: number; avgCoins: number; avgRespins: number; tail: Record<number, number>; n: number; se: number }

function xs(seed: number) { let s = (seed | 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

export function featureStats(spec: SlotSpec, n: number, seed = 1, thresholds = [100, 300, 500, 1000, 1500, 2000, 3000]): FeatureStats {
  const strips = (spec.board_law.reel_sets as { strips: number[][] }[])[0].strips;
  const mech = spec.mechanics[0].params as { value_pmf: Record<string, number>; respins: number; full_grid_bonus: number; entry_min: number };
  const orb = spec.mechanics.find((m) => m.id === 'orb_sum_terminal')?.params as { value_pmf: Record<string, number> } | undefined;
  const qv = orb ? Object.keys(orb.value_pmf).map(Number).sort((a, b) => a - b) : [1];
  const qw = orb ? qv.map((v) => orb.value_pmf[String(v)]) : [1];
  const qwt = qw.reduce((a, b) => a + b, 0);
  const qcum = qw.reduce<number[]>((a, x) => { a.push((a.at(-1) ?? 0) + x / qwt); return a; }, []);
  const vals = Object.keys(mech.value_pmf).map(Number).sort((a, b) => a - b);
  const w = vals.map((v) => mech.value_pmf[String(v)]);
  const wt = w.reduce((a, b) => a + b, 0);
  const cum = w.reduce<number[]>((a, x) => { a.push((a.at(-1) ?? 0) + x / wt); return a; }, []);
  const R = xs(seed);
  const pick = () => { const u = R(); for (let i = 0; i < cum.length; i++) if (u < cum[i]) return vals[i]; return vals[vals.length - 1]; };
  const pickQ = () => { const u = R(); for (let i = 0; i < qcum.length; i++) if (u < qcum[i]) return qv[i]; return qv[qv.length - 1]; };
  // trigger distribution
  const cc = strips.map((s) => coinCountPmf(s));
  // enumerate count combos
  const combos: { c: number[]; p: number }[] = [];
  const rec = (i: number, c: number[], p: number) => {
    if (i === 5) { if (c.reduce((a, b) => a + b, 0) >= mech.entry_min) combos.push({ c: [...c], p }); return; }
    cc[i].counts.forEach((q, k) => { if (q > 0) { c.push(k); rec(i + 1, c, p * q); c.pop(); } });
  };
  rec(0, [], 1);
  const pTrig = combos.reduce((a, b) => a + b.p, 0);
  let acc = 0; const ccum = combos.map((x) => (acc += x.p / pTrig));
  const L = strips.map((s) => s.length);
  let sum = 0, sum2 = 0, nFull = 0, coins = 0, resp = 0, hSum = 0, nQueen = 0, qSum = 0;
  const nHist = new Array(26).fill(0);
  const tail: Record<number, number> = {}; thresholds.forEach((t) => (tail[t] = 0));
  for (let it = 0; it < n; it++) {
    const u = R(); let j = 0; while (j < ccum.length - 1 && u > ccum[j]) j++;
    const cmb = combos[j].c;
    const held = new Uint8Array(25);
    let total = 0, nh = 0;
    // choose stops
    for (let c = 0; c < 5; c++) {
      const list = cc[c].stopsByCount[cmb[c]];
      const stop = list[Math.floor(R() * list.length)];
      for (let r = 0; r < 5; r++) if (strips[c][(stop + r) % L[c]] === COIN) { held[c * 5 + r] = 1; total += pick(); nh++; }
    }
    let rem = mech.respins; let played = 0; let queens = 0;
    while (rem > 0 && nh < 25) {
      played++; rem--; let landed = false; queens = 0;
      for (let c = 0; c < 5; c++) {
        const stop = Math.floor(R() * L[c]);
        for (let r = 0; r < 5; r++) {
          if (held[c * 5 + r]) continue;
          const sym = strips[c][(stop + r) % L[c]];
          if (sym === COIN) { held[c * 5 + r] = 1; total += pick(); nh++; landed = true; }
          else if (sym === QUEEN) queens++;
        }
      }
      if (landed) rem = mech.respins;
    }
    const full = nh === 25;
    if (full) { total += mech.full_grid_bonus * spec.bet.coins; nFull++; }
    const h = total / spec.bet.coins;
    let m = 0;
    for (let q = 0; q < (orb ? queens : 0); q++) m += pickQ();
    const x = m > 1 ? h * m : h;
    if (m > 0) nQueen++;
    hSum += h; qSum += x - h;
    nHist[nh]++; sum += x; sum2 += x * x; coins += nh; resp += played;
    for (const t of thresholds) if (x >= t) tail[t]++;
  }
  const mean = sum / n; const m2 = sum2 / n;
  return { nHist: nHist.map((c) => c / n), pTrig, harvest: hSum / n, pQueen: nQueen / n, queenMean: qSum / n, mean, m2, pFull: nFull / n, avgCoins: coins / n, avgRespins: resp / n, tail, n, se: Math.sqrt((m2 - mean * mean) / n) };
}
