// Supabase/PostgREST returns at most 1000 rows per request, silently. Any
// query that can grow past that (feeder_items across many feeders, the
// whole library...) must page through with .range(). Pass a function that
// builds the query for one page; give it a stable order (e.g. ...,"id").
const PAGE = 1000;
export async function fetchAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
