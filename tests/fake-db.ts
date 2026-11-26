// An in-memory stand-in for the Supabase client, for tests. Supports the query methods the
// app uses: select (with exact head counts), eq, in, not(col, "is", null), contains, gt, gte,
// lte, lt, order (ascending or not), limit, range, maybeSingle, single, insert (with an id
// column filled in and unique checks), update and delete. Records every query.

import type { Db } from "../src/lib/db";

type Row = Record<string, unknown>;

export interface QueryLog {
  table: string;
  filters: string[];
  head: boolean;
}

export interface FakeDbOptions {
  /** Every query on this table fails. */
  failOn?: string;
  /** Unique column sets per table, checked on insert (like a unique index). Optional `where` = partial index. */
  unique?: Record<string, { columns: string[]; where?: (r: Row) => boolean }[]>;
}

export function fakeDb(tables: Record<string, Row[]>, opts: FakeDbOptions = {}) {
  const log: QueryLog[] = [];
  const nextId: Record<string, number> = {};

  function query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const entry: QueryLog = { table, filters: [], head: false };
    let orderBy: { col: string; ascending: boolean } | null = null;
    let head = false;
    let counted = false;
    let max = Infinity;
    let write: { kind: "insert"; rows: Row[] } | { kind: "update"; values: Row } | { kind: "delete" } | null = null;
    let returning = false;
    let single: "single" | "maybe" | null = null;

    const fail = () => ({ data: null, count: null, error: { message: `${table} failed`, code: "XX000" } });

    const doWrite = () => {
      const rows = (tables[table] ??= []);
      if (!write) return null;
      if (write.kind === "insert") {
        const added: Row[] = [];
        for (const r of write.rows) {
          const row = { ...r };
          if (row.id === undefined) row.id = (nextId[table] = (nextId[table] ?? rows.length) + 1);
          for (const u of opts.unique?.[table] ?? []) {
            const clash = [...rows, ...added].some((o) =>
              (!u.where || (u.where(o) && u.where(row))) && u.columns.every((c) => o[c] === row[c]));
            if (clash) return { data: null, count: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
          }
          added.push(row);
        }
        rows.push(...added);
        return { data: returning ? added : null, count: null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (write.kind === "update") {
        for (const r of hit) Object.assign(r, write.values);
      } else {
        tables[table] = rows.filter((r) => !hit.includes(r));
      }
      return { data: returning ? hit : null, count: null, error: null };
    };

    const run = (from = 0, to = Infinity) => {
      log.push(entry);
      if (opts.failOn === table) return fail();
      let result: { data: Row[] | null; count: number | null; error: { message: string; code?: string } | null };
      const written = doWrite();
      if (written) {
        result = written;
      } else {
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (orderBy) {
          const { col, ascending } = orderBy;
          rows = [...rows].sort((a, b) =>
            (ascending ? 1 : -1) * String(a[col]).localeCompare(String(b[col]), "en", { numeric: true }));
        }
        const count = counted ? rows.length : null;
        rows = rows.slice(from, Math.min(to + 1, from + max));
        result = { data: head ? null : rows, count, error: null };
      }
      if (single && !result.error) {
        const rows = result.data ?? [];
        if (rows.length > 1 || (single === "single" && rows.length === 0)) {
          return { data: null, count: null, error: { message: `expected one row, got ${rows.length}`, code: "PGRST116" } };
        }
        return { ...result, data: (rows[0] ?? null) as unknown as Row[] };
      }
      return result;
    };

    const builder = {
      insert(rows: Row | Row[]) {
        write = { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] };
        entry.filters.push("insert");
        return builder;
      },
      update(values: Row) {
        write = { kind: "update", values };
        entry.filters.push("update");
        return builder;
      },
      delete() {
        write = { kind: "delete" };
        entry.filters.push("delete");
        return builder;
      },
      limit(n: number) {
        max = n;
        return builder;
      },
      maybeSingle() {
        single = "maybe";
        return builder;
      },
      single() {
        single = "single";
        return builder;
      },
      lt(col: string, v: number | string) {
        entry.filters.push(`${col}<${v}`);
        filters.push((r) => (r[col] as number | string) < v);
        return builder;
      },
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        if (write) {
          returning = true;
          return builder;
        }
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
      overlaps(col: string, vs: unknown[]) {
        entry.filters.push(`${col} overlaps ${vs.join(",")}`);
        filters.push((r) => vs.some((v) => ((r[col] as unknown[]) ?? []).includes(v)));
        return builder;
      },
      gte(col: string, v: number | string) {
        entry.filters.push(`${col}>=${v}`);
        filters.push((r) => (r[col] as number | string) >= v);
        return builder;
      },
      gt(col: string, v: number | string) {
        entry.filters.push(`${col}>${v}`);
        filters.push((r) => (r[col] as number | string) > v);
        return builder;
      },
      lte(col: string, v: number) {
        entry.filters.push(`${col}<=${v}`);
        filters.push((r) => (r[col] as number) <= v);
        return builder;
      },
      order(col: string, o?: { ascending?: boolean }) {
        orderBy = { col, ascending: o?.ascending ?? true };
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
