// Retries a step that talks to the database, for brief outages (e.g. Supabase answering
// "Internal server error" once in a long run).

export async function withRetry<T>(
  step: () => Promise<T>,
  o: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const delays = o.delaysMs ?? [2_000, 10_000, 30_000];
  const attempts = o.attempts ?? delays.length + 1;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await step();
    } catch (e) {
      if (i >= attempts) throw e;
      await sleep(delays[Math.min(i - 1, delays.length - 1)]);
    }
  }
}
