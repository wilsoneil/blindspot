"use client";

// A small line chart with week / month / all-time tabs (SPEC.md -> "Progress and headline
// metrics"). Hand-drawn SVG in the theme's chart colour: no chart library to load.

import { useState } from "react";
import { change, RANGES, type Point, type Range } from "@/lib/progress/series";

const W = 320;
const H = 120;
const PAD = { left: 38, right: 6, top: 8, bottom: 18 };
const RANGE_NAME: Record<Range, string> = { week: "Week", month: "Month", all: "All time" };
const SINCE: Record<Range, string> = { week: "this week", month: "this month", all: "in all" };

const shortDate = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** A tidy step for the value axis: 10, 25, 50, 100, ... */
function niceStep(span: number): number {
  for (const s of [10, 25, 50, 100, 200, 250, 500, 1000]) if (span / s <= 4) return s;
  return 2000;
}

export function TrendChart({ series, label, colour = 1, goodWhen = "up", initial = "month" }: {
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

  return (
    <div className="trend">
      <div className="trend-head">
        <span className={`small ${delta === null || Math.round(delta) === 0 ? "muted" : (delta > 0) === (goodWhen === "up") ? "good" : "bad"}`}>
          {delta === null ? "No change yet" : `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(Math.round(delta))} ${SINCE[range]}`}
        </span>
        <span className="trend-tabs" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r} type="button" className={r === range ? "trend-tab active" : "trend-tab"}
              aria-pressed={r === range} onClick={() => setRange(r)}>
              {RANGE_NAME[r]}
            </button>
          ))}
        </span>
      </div>
      {points.length < 2 ? (
        <p className="small muted trend-empty">Not enough points for a chart yet.</p>
      ) : (
        <Line points={points} label={`${label}, ${RANGE_NAME[range].toLowerCase()}`} colour={colour} />
      )}
    </div>
  );
}

function Line({ points, label, colour }: { points: Point[]; label: string; colour: number }) {
  const values = points.map((p) => p.v);
  const step = niceStep(Math.max(...values) - Math.min(...values) || 1);
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.max(Math.ceil(Math.max(...values) / step) * step, lo + step);
  const [t0, t1] = [points[0].t, points[points.length - 1].t];
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const first = points[0].v;
  const last = points[points.length - 1].v;

  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${label}: from ${Math.round(first)} to ${Math.round(last)}`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="trend-grid" />
          <text x={PAD.left - 5} y={y(v) + 3.5} textAnchor="end" className="trend-axis">{v}</text>
        </g>
      ))}
      <polyline points={line} fill="none" stroke={`var(--chart-${colour})`} strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(t1)} cy={y(last)} r={3} fill={`var(--chart-${colour})`} />
      <text x={PAD.left} y={H - 4} className="trend-axis">{shortDate(t0)}</text>
      <text x={W - PAD.right} y={H - 4} textAnchor="end" className="trend-axis">{shortDate(t1)}</text>
    </svg>
  );
}
