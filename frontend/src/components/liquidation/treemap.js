// Squarified treemap. items: [{value, ...}] -> [{item, x, y, w, h}] filling W x H.
export function squarify(items, W, H) {
  const nodes = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = nodes.reduce((s, i) => s + i.value, 0);
  if (!total) return [];
  const k = (W * H) / total;
  const out = [];
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;
  let row = [];
  const sum = (r) => r.reduce((s, n) => s + n.value * k, 0);
  const worst = (r, side) => {
    const s = sum(r);
    const areas = r.map((n) => n.value * k);
    return Math.max((side * side * Math.max(...areas)) / (s * s), (s * s) / (side * side * Math.min(...areas)));
  };
  const flush = () => {
    const s = sum(row);
    if (w >= h) {
      const rw = s / h;
      let cy = y;
      row.forEach((n) => { const rh = (n.value * k) / rw; out.push({ item: n, x, y: cy, w: rw, h: rh }); cy += rh; });
      x += rw;
      w -= rw;
    } else {
      const rh = s / w;
      let cx = x;
      row.forEach((n) => { const rw = (n.value * k) / rh; out.push({ item: n, x: cx, y, w: rw, h: rh }); cx += rw; });
      y += rh;
      h -= rh;
    }
    row = [];
  };
  nodes.forEach((n) => {
    const side = Math.min(w, h);
    if (row.length && worst([...row, n], side) > worst(row, side)) flush();
    row.push(n);
  });
  if (row.length) flush();
  return out;
}
