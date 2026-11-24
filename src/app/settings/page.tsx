import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-data";
import { describeTimeControl } from "@/lib/settings";
import { SetupNotice } from "../setup-notice";
import { SettingsForm, type TimeControlOption } from "./settings-form";

export const metadata: Metadata = { title: "Settings · Blindspot" };

export default async function SettingsPage() {
  const ctx = await getAppContext();
  if (ctx.status !== "ready") {
    return (
      <>
        <h1>Settings</h1>
        <SetupNotice ctx={ctx} />
      </>
    );
  }

  // Time controls offered = the ones actually played, plus the default and current choice.
  const { data } = await ctx.db.from("games").select("time_control").eq("user_id", ctx.userId).limit(20000);
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.time_control, (counts.get(row.time_control) ?? 0) + 1);
  for (const tc of ["300", ctx.settings.focusTimeControl]) if (!counts.has(tc)) counts.set(tc, 0);
  const timeControls: TimeControlOption[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, games]) => ({ value, label: `${describeTimeControl(value)}${games ? ` (${games} games)` : ""}` }));

  return (
    <>
      <h1>Settings</h1>
      <SettingsForm settings={ctx.settings} timeControls={timeControls} />
    </>
  );
}
