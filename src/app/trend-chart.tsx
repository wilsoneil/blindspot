"use client";

// The headline cards' small line chart with week / month / all-time tabs (SPEC.md -> "Progress
// and headline metrics"). Hand-drawn SVG in the theme's chart colour: no chart library to load.

import { useState, type ReactNode } from "react";
import { change, RANGES, type Point, type Range } from "@/lib/progress/series";

const RANGE_NAME: Record<Range, string> = { week: "Week", month: "Month", all: "All time" };
const SINCE: Record<Range, string> = { week: "this week", month: "this month", all: "in all" };

/**
 * A compact headline card: title and value on the left, a small chart on the right with
 * week / month / all-time tabs under it, and the change over the chosen period under the value.
 */
export function CompactTrend({ title, value, footnote, series, label, colour = 1, goodWhen = "up", initial = "month" }: {
  title: ReactNode;
  value: ReactNode;
  /** Small print under the card, full width. */
  footnote?: ReactNode;
  series: Record<Range, Point[]>;
  /** What the line is, for screen readers: "Blindspot rating". */
  label: string;
  colour?: number;
  /** Which way is better, for the colour of the change. */
  goodWhen?: "up" | "down";
  initial?: Range;
}) {
  const [range, setRange] = useState<Range>(initial);
  const points = series[range];
  const delta = change(points);
  const tone = delta === null || Math.round(delta) === 0 ? "muted" : (delta > 0) === (goodWhen === "up") ? "good" : "bad";

  return (
    <div className="compact-trend">
      <div className="compact-main">
        <div className="compact-left">
          <div className="headline-label">{title}</div>
          <div className="compact-value">{value}</div>
          <div className={`small ${tone}`}>
            {delta === null ? "No change yet" : `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(Math.round(delta))} ${SINCE[range]}`}
          </div>
        </div>
        <div className="compact-right">
          {points.length < 2
            ? <div className="mini-chart mini-empty small muted">No chart yet</div>
            : <MiniLine points={points} label={`${label}, ${RANGE_NAME[range].toLowerCase()}`} colour={colour} />}
          <span className="mini-tabs" role="group" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r} type="button" className={r === range ? "mini-tab active" : "mini-tab"}
                aria-pressed={r === range} aria-label={RANGE_NAME[r]} onClick={() => setRange(r)}>
                {SHORT[r]}
              </button>
            ))}
          </span>
        </div>
      </div>
      {footnote && <div className="compact-footnote">{footnote}</div>}
    </div>
  );
}

const SHORT: Record<Range, string> = { week: "W", month: "M", all: "All" };
const MW = 160;
const MH = 44;

/** The small chart: just the line and the latest point, no axes. */
function MiniLine({ points, label, colour }: { points: Point[]; label: string; colour: number }) {
  const values = points.map((p) => p.v);
  const [lo, hi] = [Math.min(...values), Math.max(...values)];
  const [t0, t1] = [points[0].t, points[points.length - 1].t];
  const x = (t: number) => 2 + ((t - t0) / (t1 - t0 || 1)) * (MW - 6);
  const y = (v: number) => (hi > lo ? 3 + (1 - (v - lo) / (hi - lo)) * (MH - 6) : MH / 2);
  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg className="mini-chart" viewBox={`0 0 ${MW} ${MH}`} role="img"
      aria-label={`${label}: from ${Math.round(points[0].v)} to ${Math.round(last.v)}, low ${Math.round(lo)}, high ${Math.round(hi)}`}>
      <polyline points={line} fill="none" stroke={`var(--chart-${colour})`} strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.t)} cy={y(last.v)} r={2.5} fill={`var(--chart-${colour})`} />
    </svg>
  );
}
