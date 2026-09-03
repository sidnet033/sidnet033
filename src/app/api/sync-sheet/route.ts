import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";

// Reads item master rows from a Google Sheet and upserts them into
// item_master. The sheet's first row must be a header with (at least)
// item_code and description; category / uom / unit_cost / supplier / notes
// are optional. Columns can be in any order.
const REQUIRED_COLUMNS = ["item_code", "description"];

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_SHEET_ID } =
    process.env;
  const range = process.env.GOOGLE_SHEET_RANGE || "Item Master!A:G";

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    return NextResponse.json(
      {
        error:
          "Google Sheet sync isn't configured yet. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and GOOGLE_SHEET_ID in your environment (see README).",
      },
      { status: 400 }
    );
  }

  try {
    const auth = new google.auth.JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range,
    });

    const values = data.values ?? [];
    if (values.length < 2) {
      return NextResponse.json({ error: "Sheet has no data rows." }, { status: 400 });
    }

    const header = values[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, "_"));
    const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Sheet is missing required column(s): ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const colIndex = (name: string) => header.indexOf(name);

    const rows = values
      .slice(1)
      .map((row) => {
        const get = (name: string) => {
          const idx = colIndex(name);
          return idx >= 0 ? String(row[idx] ?? "").trim() : "";
        };
        const itemCode = get("item_code");
        if (!itemCode) return null;
        return {
          item_code: itemCode,
          description: get("description"),
          category: get("category") || null,
          uom: get("uom") || "nos",
          unit_cost: Number(get("unit_cost")) || 0,
          supplier: get("supplier") || null,
          notes: get("notes") || null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid rows found in the sheet." }, { status: 400 });
    }

    const { error } = await supabase.from("item_master").upsert(rows, { onConflict: "item_code" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ count: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error contacting Google Sheets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
