# LV Switchboard Quoting Tool

A simple internal web app to build LV switchboard quotes: keep an item
master, build reusable feeder templates, lay out a GA (general
arrangement) by dragging feeders into verticals, and see a rolled-up
BOM with cost, margin and sell price.

## How it's built (plain-English overview)

- **Next.js** — the web app framework (both the pages you see and the
  small bits of server code live in one project).
- **Supabase** — a hosted Postgres database plus login/user accounts.
  This is where all your data lives (item master, feeders, projects,
  quotes).
- **Vercel** — hosts the Next.js app itself, free for this scale of use.
- **Tailwind CSS** — styling, nothing you need to touch.

You don't need to run any servers yourself — Vercel and Supabase are
both managed cloud services with free tiers that comfortably cover a
small sales team's usage.

## What's in the app

- **Item Master** (`/item-master`) — every component and its cost.
  Admins can add/edit rows directly, upload a `.xlsx` file, or sync
  from a Google Sheet. Everyone else can view it.
- **Feeder Library** (`/feeders`) — reusable feeder templates, each
  built from item master lines with quantities. Only admins edit these;
  they're the building blocks everyone drags onto the GA canvas.
- **Projects** (`/`) — one project per quote. Each has a GA canvas and
  a costing summary.
- **GA Canvas** (`/projects/[id]/ga`) — add verticals (columns), drag
  feeders from the library onto a vertical, adjust quantities, reorder.
- **Costing** (`/projects/[id]/costing`) — the whole switchboard's BOM
  rolled up item-by-item, cost by vertical, and an editable margin %
  that gives you the sell price.

Two user roles: **admin** (can edit item master and feeder library) and
**sales** (builds GA layouts and quotes). Everyone can see everything;
only admins can change the master data so pricing stays trustworthy.

---

## 1. One-time setup (about 20–30 minutes)

### 1a. Create a Supabase project (free)

1. Go to [supabase.com](https://supabase.com), sign up, and create a
   new project (pick any name/region, save the database password
   somewhere safe).
2. Once it's ready, open **SQL Editor** in the Supabase dashboard,
   paste in the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   from this repo, and run it. This creates all the tables and the
   security rules (row-level security) that keep item master/feeder
   edits admin-only.
3. Go to **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key

### 1b. Deploy to Vercel (free)

1. Go to [vercel.com](https://vercel.com), sign up (you can sign in
   with your GitHub account), and click **Add New → Project**.
2. Import this GitHub repo.
3. Before deploying, add these Environment Variables (from step 1a):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Click **Deploy**. In a couple of minutes you'll have a live URL
   like `https://your-app.vercel.app`.

From now on, every time this code is updated and pushed to the `main`
branch, Vercel automatically redeploys — nothing manual to do.

### 1c. Create your team's logins

Supabase Auth handles logins, but there's no public "sign up" page in
this app on purpose (you don't want strangers creating accounts).
Instead, as the admin:

1. In the Supabase dashboard, go to **Authentication → Users → Add
   user** (use "Invite" if you want them to set their own password by
   email, or "Create user" to set one directly).
2. The first time a user is created, the app automatically gives them
   the `sales` role. To make someone an **admin**, go to **Table
   Editor → profiles** in Supabase, find their row, and change `role`
   to `admin`. Do this for yourself first.

That's it — anyone you add can now sign in at your Vercel URL.

### 1d. (Optional) Google Sheet sync for the item master

If you'd rather maintain your item master in a Google Sheet than
upload `.xlsx` files:

1. In Google Cloud Console, create a project (or use an existing one),
   enable the **Google Sheets API**, and create a **Service Account**.
2. Create a JSON key for that service account and note its
   `client_email` and `private_key`.
3. Open your Google Sheet, click **Share**, and share it with that
   service account's email address (Viewer access is enough).
4. In Vercel → Project Settings → Environment Variables, add:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (paste the key including the
     `BEGIN/END PRIVATE KEY` lines)
   - `GOOGLE_SHEET_ID` (the long ID in the sheet's URL)
   - `GOOGLE_SHEET_RANGE` (defaults to `Item Master!A:P` — change the
     tab name if yours differs)
5. Redeploy. A "Sync Google Sheet" button will now work on the Item
   Master page for admins.

If you skip this, the `.xlsx` upload still works with no setup at all
— just export your sheet as `.xlsx` and upload it.

**Sheet/xlsx column format** (header row, any order): `sku`,
`vendor_cat`, `description`, `make`, `category`, `source`, `status`,
`amps`, `ka`, `poles`, `uom`, `unit_cost`, `list_price`, `discount_pct`,
`supplier`, `notes`. Every row needs a `sku` or a `vendor_cat` (or
both), a `description`, and a `source` of exactly `Design` or
`Estimation` — everything else is optional. Uploading/syncing updates
existing items (matched by `sku` first, then `vendor_cat`) and adds new
ones — it never deletes rows you've removed from the sheet.

---

## 2. Running it on your own computer (optional, for making changes)

You don't need this for day-to-day use — it's only for when you (or
Claude) want to change the app's code.

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase URL/key
npm run dev
```

Open http://localhost:3000.

## 3. Making future changes

The easiest way: open a Claude Code session pointed at this repo and
describe what you want changed (e.g. "add a PDF export of the costing
summary", "show images on feeder cards"). Claude can edit the code,
commit, and push — Vercel picks up the change automatically.

A few things worth knowing as the app grows:

- **Backups**: Supabase takes automatic daily backups on paid plans;
  on the free plan, periodically export your data (Table Editor → each
  table → Export CSV) if you want extra peace of mind.
- **Costs**: both Supabase and Vercel free tiers comfortably cover a
  small sales team. If usage grows a lot, Supabase's next tier is
  about $25/month and Vercel's is about $20/month — you'd get a clear
  warning in your dashboard before hitting any limit.
- **The GA canvas today** places feeders as labeled blocks (not a
  scaled drawing) — reordering within a vertical is done with the
  ↑/↓ buttons rather than free dragging, to keep the first version
  reliable. A to-scale drawing view can be added later without
  changing the underlying data model.
- **Multiple quote revisions**: right now each project is one BOM/GA.
  If you want quote versioning (e.g. Rev A vs Rev B of the same
  customer's panel), that's a natural next feature to ask for.

## Project structure (for reference)

```
supabase/migrations/0001_init.sql   database schema + security rules
src/app/(app)/                      the logged-in pages (nav + all screens)
src/app/login/                      sign-in page
src/app/api/sync-sheet/             Google Sheet sync endpoint
src/components/                     UI building blocks
src/lib/supabase/                   Supabase connection helpers
src/lib/feeder-cost.ts              shared feeder-cost calculation
src/types/database.ts               data shapes used across the app
```
