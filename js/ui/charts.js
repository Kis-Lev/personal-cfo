// Single hand-rolled SVG chart renderer for the whole app — one function with a
// `type` switch, instead of three near-duplicate bar/line/donut modules.
const CHART_COLORS = ["#2b6cb0", "#38a169", "#d69e2e", "#e53e3e", "#805ad5", "#319795"];

function svgWrap(width, height, inner) {
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img">${inner}</svg>`;
}

function renderBarOrLine(type, series, { width = 600, height = 300, padding = 40 } = {}) {
  const max = Math.max(...series.map((p) => p.value), 1);
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const step = plotWidth / Math.max(series.length - (type === "line" ? 1 : 0), 1);

  const points = series.map((p, i) => {
    const x = padding + i * step + (type === "bar" ? step * 0.15 : 0);
    const barWidth = step * 0.7;
    const y = height - padding - (p.value / max) * plotHeight;
    return { x, y, barWidth, label: p.label, value: p.value };
  });

  const baseline = `<line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="currentColor" stroke-opacity="0.3"/>`;

  if (type === "bar") {
    const bars = points
      .map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.barWidth}" height="${height - padding - p.y}" fill="${CHART_COLORS[0]}"/>`)
      .join("");
    return svgWrap(width, height, baseline + bars);
  }

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x + (step * 0.35 || 0)},${p.y}`).join(" ");
  const line = `<path d="${path}" fill="none" stroke="${CHART_COLORS[0]}" stroke-width="2"/>`;
  return svgWrap(width, height, baseline + line);
}

function renderDonut(series, { width = 300, height = 300, innerRadiusRatio = 0.6 } = {}) {
  const total = series.reduce((sum, s) => sum + s.value, 0) || 1;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 10;
  const innerR = r * innerRadiusRatio;

  let angle = -Math.PI / 2;
  const slices = series
    .map((s, i) => {
      const sliceAngle = (s.value / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sliceAngle);
      const y2 = cy + r * Math.sin(angle + sliceAngle);
      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      const path = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`;
      angle += sliceAngle;
      return `<path d="${path}" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`;
    })
    .join("");

  return svgWrap(width, height, slices + `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="var(--card-bg, #fff)"/>`);
}

/**
 * @param {"bar"|"line"|"donut"} type
 * @param {Array<{label:string, value:number}>} series
 * @param {object} options width/height/padding overrides
 * @returns {string} an <svg>...</svg> string, ready to assign to element.innerHTML
 */
export function renderChart(type, series, options = {}) {
  if (type === "donut") return renderDonut(series, options);
  if (type === "bar" || type === "line") return renderBarOrLine(type, series, options);
  throw new Error(`Unknown chart type: ${type}`);
}
