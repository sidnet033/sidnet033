import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import { importItemRows, type ParsedItemRow } from "@/lib/item-import";

// Reads item master rows from a Google Sheet and imports them into
// item_master. The sheet's first row must be a header with description,
// plus sku and/or vendor_cat (every row needs at least one of those two).
// make / category / status / amps / ka / poles / uom / unit_cost / supplier
// / notes are optional. Columns can be in any order.
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
  const range = process.env.GOOGLE_SHEET_RANGE || "Item Master!A:M";

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
    const missing: string[] = [];
    if (!header.includes("description")) missing.push("description");
    if (!header.includes("sku") && !header.includes("vendor_cat")) missing.push("sku or vendor_cat");
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Sheet is missing required column(s): ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const colIndex = (name: string) => header.indexOf(name);

    const rows = values
      .slice(1)
      .map((row, i) => {
        const get = (name: string) => {
          const idx = colIndex(name);
          return idx >= 0 ? String(row[idx] ?? "").trim() : "";
        };
        if (row.length === 0) return null;
        const data: ParsedItemRow = {
          sku: get("sku") || null,
          vendor_cat: get("vendor_cat") || null,
          description: get("description"),
          make: get("make") || null,
          category: get("category") || null,
          status: get("status").toLowerCase() || "active",
          amps: get("amps") ? Number(get("amps")) : null,
          ka: get("ka") ? Number(get("ka")) : null,
          poles: get("poles") ? Number(get("poles")) : null,
          uom: get("uom") || "nos",
          unit_cost: Number(get("unit_cost")) || 0,
          supplier: get("supplier") || null,
          notes: get("notes") || null,
        };
        return { rowNumber: i + 2, data };
      })
      .filter((r): r is { rowNumber: number; data: ParsedItemRow } => r !== null);

    if (rows.length === 0) {
      return NextResponse.json({ error: "No data rows found in the sheet." }, { status: 400 });
    }

    const summary = await importItemRows(supabase, rows);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error contacting Google Sheets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
