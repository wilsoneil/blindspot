// Small helpers for database reads. No imports, so code that also runs in the browser can
// use them without pulling in the database client.

const PAGE = 1000;

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/**
 * Reads every row of a query, a page at a time (the API returns at most 1,000 rows per
 * request). The query must be ordered so pages don't overlap. `what` words the error:
 * "Could not <what>: ..."; without it the database's message is thrown as it is.
 */
export async function readAll<T>(query: (from: number, to: number) => Page, what?: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(what ? `Could not ${what}: ${error.message}` : error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** Throws "Could not <what>: ..." if a query failed. */
export function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Could not ${what}: ${error.message}`);
}
