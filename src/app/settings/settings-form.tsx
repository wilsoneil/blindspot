"use client";

// The settings form. Runs in the browser so the slider label can update live;
// saving goes through the server action in actions.ts.

import { useActionState, useState } from "react";
import { HISTORY_OPTIONS, type Settings } from "@/lib/settings";
import { THEME_IDS, THEMES } from "@/lib/themes";
import { saveSettings } from "./actions";

export interface TimeControlOption {
  value: string;
  label: string;
}

function Coming({ phase }: { phase: number }) {
  return <span className="coming"> · used from Phase {phase}</span>;
}

export function SettingsForm({ settings: s, timeControls }: { settings: Settings; timeControls: TimeControlOption[] }) {
  const [result, formAction, saving] = useActionState(saveSettings, null);
  const [blend, setBlend] = useState(s.gamesWeightPct);

  return (
    <form action={formAction}>
      <fieldset>
        <legend>Your games</legend>
        <div className="field">
          <label htmlFor="chesscomUsername">chess.com username</label>
          <input id="chesscomUsername" name="chesscomUsername" type="text" autoComplete="off" autoCapitalize="none"
            spellCheck={false} defaultValue={s.chesscomUsername ?? ""} placeholder="Your chess.com username" />
        </div>
        <div className="field">
          <label htmlFor="focusTimeControl">Focus time control</label>
          <select id="focusTimeControl" name="focusTimeControl" defaultValue={s.focusTimeControl}>
            {timeControls.map((tc) => <option key={tc.value} value={tc.value}>{tc.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="historyMonths">Analysis history window</label>
          <select id="historyMonths" name="historyMonths" defaultValue={s.historyMonths ?? "all"}>
            {HISTORY_OPTIONS.map((o) => <option key={o.label} value={o.value ?? "all"}>{o.label}</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Weakness profile</legend>
        <div className="field">
          <label htmlFor="weaknessesShown">Number of weaknesses shown</label>
          <input id="weaknessesShown" name="weaknessesShown" type="number" min={3} max={8} defaultValue={s.weaknessesShown} />
          <div className="hint">3–8. Fewer are shown if fewer have enough evidence.</div>
        </div>
        <div className="field">
          <label htmlFor="gamesWeightPct">Games vs puzzles blend: {blend}% games / {100 - blend}% puzzles</label>
          <input id="gamesWeightPct" name="gamesWeightPct" type="range" min={0} max={100} step={5}
            value={blend} onChange={(e) => setBlend(Number(e.target.value))} />
          <div className="hint">Puzzle results count from Phase 3; until then the profile uses games only.</div>
        </div>
        <div className="field">
          <label htmlFor="halfLifeDays">Recency half-life (days)</label>
          <input id="halfLifeDays" name="halfLifeDays" type="number" min={14} max={365} defaultValue={s.halfLifeDays} />
          <div className="hint">A mistake this many days old counts half as much as one today. 14–365.</div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Training <Coming phase={3} /></legend>
        <div className="field">
          <label htmlFor="targetTime">Target solve time</label>
          <select id="targetTime" name="targetTime" defaultValue={s.targetTime}>
            <option value="stricter">Stricter</option>
            <option value="normal">Normal (set per puzzle difficulty)</option>
            <option value="looser">Looser</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rushMinutes">Rush length</label>
          <select id="rushMinutes" name="rushMinutes" defaultValue={s.rushMinutes}>
            <option value={3}>3 minutes</option>
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="survivalLives">Survival lives</label>
          <input id="survivalLives" name="survivalLives" type="number" min={1} max={5} defaultValue={s.survivalLives} />
        </div>
        <div className="field">
          <label className="toggle">
            <input name="engineOnBoard" type="checkbox" defaultChecked={s.engineOnBoard} />
            Engine on analysis board
          </label>
          <div className="hint">Off by default, so it never gives a puzzle away.</div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Theme</legend>
        <div className="theme-options">
          {THEME_IDS.map((id) => {
            const t = THEMES[id];
            return (
              <label key={id} className="theme-option" style={{ background: t.ui.bg, color: t.ui.text }}>
                <input type="radio" name="theme" value={id} defaultChecked={s.theme === id} />
                <div className="mini-board" aria-hidden>
                  {Array.from({ length: 16 }, (_, i) => (
                    <span key={i} style={{ background: (Math.floor(i / 4) + i) % 2 ? t.board.dark : t.board.light }} />
                  ))}
                </div>
                {t.name}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend>AI explanations <Coming phase={5} /></legend>
        <div className="field">
          <label className="toggle">
            <input name="aiEnabled" type="checkbox" defaultChecked={s.aiEnabled} />
            Allow AI explanations
          </label>
        </div>
        <div className="field">
          <label htmlFor="aiMonthlyBudgetGbp">Monthly budget (£)</label>
          <input id="aiMonthlyBudgetGbp" name="aiMonthlyBudgetGbp" type="number" min={0} step="0.5" defaultValue={s.aiMonthlyBudgetGbp} />
        </div>
        <div className="field">
          <label htmlFor="aiDailyLimit">Daily limit (explanations)</label>
          <input id="aiDailyLimit" name="aiDailyLimit" type="number" min={0} defaultValue={s.aiDailyLimit} />
        </div>
        <div className="field">
          <div className="label">Usage this month</div>
          <div className="stats">
            <div className="stat"><div className="stat-value">0</div><div className="stat-label">explanations</div></div>
            <div className="stat"><div className="stat-value">£0.00</div><div className="stat-label">estimated spend</div></div>
          </div>
        </div>
      </fieldset>

      <div className="save-bar">
        <button className="button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
        {result && (
          <span role="status" className={result.ok ? "message-ok" : "message-error"}>{result.message}</span>
        )}
      </div>
    </form>
  );
}
