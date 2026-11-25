// An in-memory stand-in for the Supabase client, for tests. Supports the query methods the
// app uses for reading: select (with exact head counts), eq, in, not(col, "is", null),
// contains, gte, lte, order and range. Records every query so tests can check them.

import type { Db } from "../src/lib/db";

type Row = Record<string, unknown>;

export interface QueryLog {
  table: string;
  filters: string[];
  head: boolean;
}

export function fakeDb(tables: Record<string, Row[]>, opts: { failOn?: string } = {}) {
  const log: QueryLog[] = [];

  function query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const entry: QueryLog = { table, filters: [], head: false };
    let orderBy: string | null = null;
    let head = false;
    let counted = false;

    const run = (from = 0, to = Infinity) => {
      log.push(entry);
      if (opts.failOn === table) return { data: null, count: null, error: { message: `${table} failed` } };
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (orderBy) {
        const k = orderBy;
        rows = [...rows].sort((a, b) => String(a[k]).localeCompare(String(b[k]), "en", { numeric: true }));
      }
      const count = counted ? rows.length : null;
      return { data: head ? null : rows.slice(from, to + 1), count, error: null };
    };

    const builder = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        head = !!o?.head;
        counted = o?.count === "exact";
        entry.head = head;
        return builder;
      },
      eq(col: string, v: unknown) {
        entry.filters.push(`${col}=${v}`);
        filters.push((r) => r[col] === v);
        return builder;
      },
      in(col: string, vs: unknown[]) {
        entry.filters.push(`${col} in`);
        filters.push((r) => vs.includes(r[col]));
        return builder;
      },
      not(col: string, op: string, v: unknown) {
        if (op !== "is" || v !== null) throw new Error("fakeDb only supports not(col, 'is', null)");
        entry.filters.push(`${col} not null`);
        filters.push((r) => r[col] !== null && r[col] !== undefined);
        return builder;
      },
      contains(col: string, vs: unknown[]) {
        entry.filters.push(`${col} contains ${vs.join(",")}`);
        filters.push((r) => vs.every((v) => (r[col] as unknown[]).includes(v)));
        return builder;
      },
      gte(col: string, v: number) {
        entry.filters.push(`${col}>=${v}`);
        filters.push((r) => (r[col] as number) >= v);
        return builder;
      },
      lte(col: string, v: number) {
        entry.filters.push(`${col}<=${v}`);
        filters.push((r) => (r[col] as number) <= v);
        return builder;
      },
      order(col: string) {
        orderBy = col;
        return builder;
      },
      range: async (from: number, to: number) => run(from, to),
      then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  }

  const db = { from: (table: string) => query(table) } as unknown as Pick<Db, "from">;
  return { db, log };
}
