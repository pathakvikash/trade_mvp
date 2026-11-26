// Summaries of study.js output. Usage: node analyze.js <results.json>
const r = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const cells = r.cells;
const f2 = (x) => (x === null || x === undefined ? '-' : (+x).toFixed(2));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };

console.log('parity', r.parity, 'costs', r.costs);
console.log('data'); for (const d of r.data) console.log(d.sym, d.tf, d.n, d.from, d.to, 'oos', d.oosFrom, 'BH', d.bhOOS, 'BHdd', d.ddBH);
const a = r.allConfigs;
console.log(`all configs OOS: ${a.oos}, profitable ${a.oosProfitable} (${f2(a.oosProfitable / a.oos * 100)}%), beat BH ${a.oosBeatBH} (${f2(a.oosBeatBH / a.oos * 100)}%)`);
console.log(`rolling walk-forward tests: ${r.rolling.tests}, profitable ${r.rolling.profitable} (${f2(r.rolling.profitable / r.rolling.tests * 100)}%)`);

const meaningful = cells.filter((c) => c.oosTrades >= 30);
const prof = (cs) => cs.filter((c) => c.oosReturn > 0).length;
console.log(`selected cells ${cells.length}; >=30 OOS trades ${meaningful.length}; profitable OOS ${prof(cells)} (meaningful ${prof(meaningful)}); beat BH ${cells.filter((c) => c.oosReturn > c.bh).length}; beat random mean ${cells.filter((c) => c.oosReturn > c.rndMean).length}`);
const ps = meaningful.map((c) => c.p).sort((x, y) => x - y);
const m = ps.length;
let bh = 0; ps.forEach((p, i) => { if (p <= (0.05 * (i + 1)) / m) bh = i + 1; });
console.log(`p<0.05 (meaningful): ${ps.filter((p) => p < 0.05).length} of ${m} (expected by luck ~${f2(m * 0.05)}); BH-FDR 5% survivors: ${bh}; min p ${ps[0]} (floor 1/201=0.005)`);
const survive = meaningful.filter((c) => c.oosReturn > 0 && c.fees.x2 > 0 && c.p < 0.05);
console.log(`profitable at x2 fees AND p<0.05 AND >=30 trades: ${survive.length}`);
for (const c of survive) console.log('  ', c.sym, c.tf, c.fam, c.dir, JSON.stringify(c.chosen), 'n', c.oosTrades, 'ret', c.oosReturn, 'x2', f2(c.fees.x2), 'p', c.p, 'BH', c.bh);
console.log(`fee: profitable x0.5 ${cells.filter((c) => c.fees.x0_5 > 0 || c.fees['x0.5'] > 0).length}, x1 ${cells.filter((c) => c.fees.x1 > 0).length}, x2 ${cells.filter((c) => c.fees.x2 > 0).length}`);

const group = (key) => {
    const g = {};
    for (const c of cells) { const k = key(c); (g[k] = g[k] || []).push(c); }
    return g;
};
const row = (k, cs) => {
    const mn = cs.filter((c) => c.oosTrades >= 30);
    return `${k.padEnd(28)} cells ${String(cs.length).padStart(3)} | prof ${prof(cs)}/${cs.length} | medRet ${f2(med(cs.map((c) => c.oosReturn))).padStart(7)} | medBH ${f2(med(cs.map((c) => c.bh))).padStart(7)} | medRnd ${f2(med(cs.map((c) => c.rndMean))).padStart(7)} | p<.05 ${mn.filter((c) => c.p < 0.05).length}/${mn.length} | medTrades ${med(cs.map((c) => c.oosTrades))} | x2fee prof ${cs.filter((c) => c.fees.x2 > 0).length} | medAvgTrade ${f2(med(cs.filter((c) => c.avgTrade !== null).map((c) => c.avgTrade)))}`;
};
for (const [name, key] of [['family', (c) => c.fam], ['tf', (c) => c.tf], ['dir', (c) => c.dir], ['symbol', (c) => c.sym], ['family x tf', (c) => `${c.fam} ${c.tf}`]]) {
    console.log(`\n== by ${name}`);
    for (const [k, cs] of Object.entries(group(key))) console.log(row(k, cs));
}
console.log('\n== regimes (OOS trades of selected configs, mean net trade % of notional)');
const reg = {};
for (const [k, v] of Object.entries(r.regimeTrades)) { const [fam, rg] = k.split('|'); (reg[fam] = reg[fam] || {})[rg] = `${f2(v.sum / v.n)} (n=${v.n})`; }
for (const [fam, v] of Object.entries(reg)) console.log(fam.padEnd(16), JSON.stringify(v));
const tot = {}; for (const [k, v] of Object.entries(r.regimeTrades)) { const rg = k.split('|')[1]; tot[rg] = tot[rg] || { n: 0, sum: 0 }; tot[rg].n += v.n; tot[rg].sum += v.sum; }
console.log('ALL', JSON.stringify(Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, `${f2(v.sum / v.n)} (n=${v.n})`]))));

console.log('\n== drawdown: cells with OOS DD (notional %) below BH max DD', cells.filter((c) => c.oosDD < c.ddBH).length, 'of', cells.length, '; median strat DD', f2(med(cells.map((c) => c.oosDD))), 'median BH DD', f2(med(cells.map((c) => c.ddBH))));
const lb = cells.filter((c) => c.dir === 'long');
console.log('long-only: median OOS return', f2(med(lb.map((c) => c.oosReturn))), 'vs BH', f2(med(lb.map((c) => c.bh))), '; when BH<0, strat > BH in', lb.filter((c) => c.bh < 0 && c.oosReturn > c.bh).length, 'of', lb.filter((c) => c.bh < 0).length, '; when BH>0 strat > BH in', lb.filter((c) => c.bh > 0 && c.oosReturn > c.bh).length, 'of', lb.filter((c) => c.bh > 0).length);

console.log('\n== risk of ruin on margin (fixed notional; equity on margin = L x cum notional %), share of selected cells');
for (const L of [1, 2, 3, 5]) {
    const hit = (lvl) => cells.filter((c) => c.minEqNotional * L <= -lvl).length;
    console.log(`L=${L}: lost >=25% of margin ${hit(25)}, >=50% ${hit(50)}, >=100% (wiped) ${hit(100)} of ${cells.length}; worst single trade x L: ${f2(Math.min(...cells.map((c) => c.worstTrade)) * L)}%`);
}

console.log('\n== best 10 and worst 10 selected cells by OOS return (>=30 trades)');
const srt = [...meaningful].sort((x, y) => y.oosReturn - x.oosReturn);
for (const c of [...srt.slice(0, 10), ...srt.slice(-10)]) console.log(c.sym, c.tf, c.fam, c.dir, JSON.stringify(c.chosen), 'IS', c.isReturn, 'OOS', c.oosReturn, 'n', c.oosTrades, 'x2', f2(c.fees.x2), 'BH', c.bh, 'rnd', c.rndMean, 'p', c.p);
const isOos = cells.map((c) => [c.isReturn, c.oosReturn]);
const cor = (() => { const xs = isOos.map((x) => x[0]), ys = isOos.map((x) => x[1]); const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; }); return sxy / Math.sqrt(sxx * syy); })();
console.log('\ncorrelation IS return vs OOS return across selected cells:', f2(cor), '; median IS', f2(med(cells.map((c) => c.isReturn))), 'median OOS', f2(med(cells.map((c) => c.oosReturn))));

// High-resolution p (5000 random runs) for the cells whose 200-run p < 0.05; other meaningful cells keep their 200-run p
// (all >= 0.05, so they cannot pass BH at any rank that matters).
const pAll = meaningful.map((c) => ({ c, p: c.pHi !== null && c.pHi !== undefined ? c.pHi : c.p })).sort((x, y) => x.p - y.p);
let k = 0; pAll.forEach((x, i) => { if (x.p <= (0.05 * (i + 1)) / pAll.length) k = i + 1; });
const bonf = pAll.filter((x) => x.p <= 0.05 / pAll.length).length;
console.log(`\n== high-res p: BH-FDR 5% survivors ${k}, Bonferroni survivors ${bonf} of ${pAll.length}; smallest p:`);
for (const x of pAll.slice(0, 12)) console.log('  ', x.p.toFixed(5), x.c.sym, x.c.tf, x.c.fam, x.c.dir, 'n', x.c.oosTrades, 'ret', x.c.oosReturn, 'x2', f2(x.c.fees.x2), 'BH', x.c.bh);
for (const x of pAll.slice(0, k)) console.log('   BH survivor:', x.c.sym, x.c.tf, x.c.fam, x.c.dir);

console.log('\n== rolling folds (choose on previous fifth, test on next): profitable share, split by fold buy-and-hold sign');
const rows = r.rolling.rows;
const share = (rs) => `${rs.filter((x) => x.ret > 0).length}/${rs.length}`;
const by = {};
for (const x of rows) { const kk = `${x.fam} ${x.tf}`; (by[kk] = by[kk] || []).push(x); }
for (const [kk, rs] of Object.entries(by)) console.log(kk.padEnd(22), 'all', share(rs).padEnd(7), 'BH up', share(rs.filter((x) => x.bh > 0)).padEnd(7), 'BH down', share(rs.filter((x) => x.bh <= 0)).padEnd(7), 'median ret', f2(med(rs.map((x) => x.ret))));
console.log('ALL rolling', share(rows), 'BH up folds', share(rows.filter((x) => x.bh > 0)), 'BH down folds', share(rows.filter((x) => x.bh <= 0)));
for (const tf of ['15m', '1h', '4h']) { const rs = rows.filter((x) => x.tf === tf); console.log(tf, share(rs), 'BH up', share(rs.filter((x) => x.bh > 0)), 'down', share(rs.filter((x) => x.bh <= 0)), 'median', f2(med(rs.map((x) => x.ret)))); }
for (const d of ['long', 'short', 'both']) { const rs = rows.filter((x) => x.dir === d); console.log(d, share(rs), 'BH up', share(rs.filter((x) => x.bh > 0)), 'down', share(rs.filter((x) => x.bh <= 0))); }
