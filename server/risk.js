// Exam risk score. A transparent weighted sum, capped at 100.
// It is a signal that tells a teacher where to look, not proof of misconduct.
const WEIGHTS = {
  tab_switch: 10,     // left the exam tab
  window_blur: 3,     // clicked into another window while the exam stayed visible
  copy: 5,
  paste: 8,
  cut: 4,
  away_per_minute: 2, // time spent away from the exam tab...
  away_cap: 20        // ...capped at this many points
};
const LEVELS = { medium: 25, high: 50 };

function assess(events) {
  const counts = { tab_switch: 0, window_blur: 0, copy: 0, paste: 0, cut: 0 };
  let awayMs = 0;
  for (const e of events) {
    if (e.type in counts) counts[e.type]++;
    if (e.type === 'tab_return') awayMs += e.duration_ms || 0;
  }
  const awayPts = Math.min(WEIGHTS.away_cap, Math.round((awayMs / 60000) * WEIGHTS.away_per_minute));
  const parts = [
    ['tab_switch', 'Switched tabs', counts.tab_switch, counts.tab_switch * WEIGHTS.tab_switch],
    ['window_blur', 'Clicked into another window', counts.window_blur, counts.window_blur * WEIGHTS.window_blur],
    ['copy', 'Copied', counts.copy, counts.copy * WEIGHTS.copy],
    ['paste', 'Pasted', counts.paste, counts.paste * WEIGHTS.paste],
    ['cut', 'Cut', counts.cut, counts.cut * WEIGHTS.cut],
    ['away', 'Time away from the exam tab', Math.round(awayMs / 1000) + ' s', awayPts]
  ];
  const score = Math.min(100, parts.reduce((s, p) => s + p[3], 0));
  const level = score >= LEVELS.high ? 'high' : score >= LEVELS.medium ? 'medium' : 'low';
  const reasons = parts.filter(p => p[3] > 0).map(([key, label, count, points]) => ({ key, label, count, points }));
  return { score, level, counts, away_ms: awayMs, reasons };
}

module.exports = { assess, WEIGHTS, LEVELS };
