"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import {
  ACB_2TIER_OUTGOING_E12,
  ACB_BAY_ALTERNATES,
  ACB_BAY_SPECS,
  ACB_SIZES,
  DOL_RDOL_SIZES,
  MCC_FRONT_ACCESS_PAIR,
  MCCB_SIZES,
  OUTGOING_MCC_BAY,
  STAR_DELTA_SIZES,
  VFD_SOFT_STARTER_SIZES,
} from "@/lib/artuk-sizing";
import { BAR_SIZES, MATERIAL_DENSITY, barArea, type BusbarMaterial } from "@/lib/busbar-plan";

// Reference capacity uses the project defaults; each project can set its own
// current density in Project Detail.
const DEFAULT_DENSITY: Record<BusbarMaterial, number> = { Cu: 1.6, Al: 1.0 };

function mm(n: number | null) {
  return n == null ? "—" : `${n}mm`;
}

type NavItem = { id: string; label: string; children?: { id: string; label: string }[] };

const NAV: NavItem[] = [
  { id: "workflow", label: "Workflow at a glance" },
  { id: "masters", label: "1. Item & Feeder Masters" },
  { id: "projects", label: "2. Projects & revisions" },
  { id: "project-detail", label: "3. Project Detail & switchboards" },
  { id: "bom", label: "4. BOM Builder & discounts" },
  { id: "ga", label: "5. GA Builder" },
  { id: "busbars", label: "6. Busbar routing & sizing" },
  { id: "costing", label: "7. Costing" },
  { id: "checks", label: "Checks & alerts" },
  { id: "colors", label: "What the colors mean" },
  {
    id: "dimensions",
    label: "Dimensions & sizing data",
    children: [
      { id: "dim-busbars", label: "Busbar sizes" },
      { id: "dim-acb", label: "ACB" },
      { id: "dim-mccb", label: "MCCB" },
      { id: "dim-dol", label: "DOL / RDOL" },
      { id: "dim-star-delta", label: "Star-Delta" },
      { id: "dim-vfd", label: "VFD & Soft Starter" },
      { id: "dim-outgoing", label: "Outgoing bay module" },
      { id: "dim-artuk-bays", label: "ArTuK bay assemblies" },
      { id: "dim-alternates", label: "Wider alternates" },
      { id: "dim-templates", label: "Manual-only templates" },
    ],
  },
];

const ALL_IDS = NAV.flatMap((n) => [n.id, ...(n.children ?? []).map((c) => c.id)]);

// Highlights the menu entry for whichever section is currently near the
// top of the scrolling content pane.
function useActiveSection(): string {
  const [active, setActive] = useState(ALL_IDS[0]);
  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        const first = ALL_IDS.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "0px 0px -70% 0px" }
    );
    for (const id of ALL_IDS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return active;
}

export function HowItWorks() {
  const active = useActiveSection();

  function go(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  }

  const link = (id: string, label: string, sub = false) => (
    <button
      key={id}
      onClick={() => go(id)}
      className={`block w-full rounded px-2 py-1 text-left transition-colors ${sub ? "pl-5 text-xs" : "text-sm"} ${
        active === id ? "bg-primary/10 font-semibold text-primary" : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex max-w-7xl gap-6 p-6">
      <aside className="hidden w-60 shrink-0 lg:block">
        <nav className="sticky top-4 max-h-[calc(100vh-2rem)] space-y-0.5 overflow-y-auto rounded-xl border border-surface-container-high bg-surface-container-lowest p-2 shadow-xs">
          <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-secondary">On this page</p>
          {NAV.map((n) => (
            <div key={n.id}>
              {link(n.id, n.label)}
              {n.children?.map((c) => link(c.id, c.label, true))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-8">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-on-surface">How it works</h1>
          <p className="mt-1 max-w-3xl text-sm text-secondary">
            A guide to estimating an LV switchboard in this app — from the item price list to a costed quote with a GA and busbar plan — plus what
            the colors mean and the sizing data the app uses.
          </p>
          {/* small screens: the menu as a jump list */}
          <select
            className="mt-3 w-full rounded border border-surface-container-high bg-surface-container-lowest px-2 py-1.5 text-sm lg:hidden"
            value=""
            onChange={(e) => e.target.value && go(e.target.value)}
          >
            <option value="">Jump to section…</option>
            {NAV.flatMap((n) => [n, ...(n.children ?? [])]).map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </div>

        <Section id="workflow" title="Workflow at a glance">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["inventory_2", "Masters", "Keep item prices and standard feeders up to date."],
              ["create_new_folder", "Project", "Create the project, set currency and busbar rules."],
              ["dashboard_customize", "Switchboards", "Add each board with its rating, standard and material."],
              ["list_alt", "BOM", "Add feeders, adjust quantities and discounts."],
              ["view_quilt", "GA", "Place feeders into bays; Update GA sizes them."],
              ["cable", "Busbars", "Auto-routed and sized; adjust where needed."],
              ["payments", "Costing", "Labor, profit and logistics give the final price."],
              ["history", "Revise", "New revision for every resubmission; archive old ones."],
            ].map(([icon, title, text], i) => (
              <li key={title} className="rounded-lg border border-surface-container-high p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-on-primary">{i + 1}</span>
                  <Icon name={icon} size={16} className="text-primary" /> {title}
                </div>
                <p className="mt-1 text-xs text-secondary">{text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-secondary">
            Every editing screen works the same way: changes are drafts until you click <b>Save Changes</b> (or press <b>Ctrl+S</b> / <b>Cmd+S</b>).
            &ldquo;Unsaved changes&rdquo; shows until you do; Cancel throws the draft away.
          </p>
        </Section>

        <Section id="masters" title="1. Item & Feeder Masters" note="Shared master data used by every project.">
          <Steps
            items={[
              <>
                <b>Item Master</b> is the price list. Each item has a list price and a discount; the <b>net cost</b> is worked out automatically (list
                price less discount). Import or update in bulk from an Excel file or the linked Google Sheet — the import log shows what was created,
                updated or rejected.
              </>,
              <>
                Breakers (ACB / MCCB / MCB) must have Amps, Poles and kA. Mark items whose price is only an estimate with Source = <b>Estimation</b>{" "}
                (they show in pink everywhere so they get double-checked). Discontinued items show greyed out.
              </>,
              <>
                <b>Feeder Master</b> holds standard feeders — a named group of items (breaker, CTs, meters, cabling…) that you reuse. Give each feeder
                a <b>Device Type</b> and <b>rating</b> (Amps, or kW for motor starters): GA Builder needs these to size bays.
              </>,
            ]}
          />
        </Section>

        <Section id="projects" title="2. Projects & revisions">
          <Steps
            items={[
              <>
                On the <b>Dashboard</b>, click <b>+ New Project</b>. Projects are grouped by customer; each one starts with <b>Rev 1</b>.
              </>,
              <>
                Each resubmission to the customer should be a <b>new revision</b>: it copies every switchboard, BOM, GA and busbar change so the old
                quote stays exactly as sent.
              </>,
              <>
                <b>Archive</b> a revision to freeze it — it becomes read-only for everyone until it&apos;s un-archived. Archived revisions are left out
                of the project checks.
              </>,
            ]}
          />
        </Section>

        <Section id="project-detail" title="3. Project Detail & switchboards">
          <Steps
            items={[
              <>
                Fill in the project information: customer, consultant, sales exec, CRM enquiry, site country and <b>stage</b> (New → WIP → Quoted →
                Won/Lost…).
              </>,
              <>
                <b>Currency & exchange rate</b>: INR is the base currency — all costs are kept in INR, and an INR project&apos;s rate is fixed at 1.
                For another currency, enter how many INR make 1 unit of it; totals then show in INR with the converted amount alongside, everywhere
                in the project.
              </>,
              <>
                <b>Busbar current density</b> (A/mm², Cu and Al) sets how large busbars are made. <b>Busbar rate</b> (INR/kg, Cu and Al) prices the
                busbar weight in the BOM — leave it at 0 and the BOM will remind you to set it.
              </>,
              <>
                Add switchboards and set each one&apos;s <b>Std</b> (ArTuK / 61439 / 60439), Form, <b>Amps</b>, IP, <b>kA</b>, cable entry/exit,
                busbar material (Cu/Al), neutral size (100% or 50%) and qty.
              </>,
              <>
                To work on a switchboard, click its <b>Lock &amp; open</b> button (lock icon on its row). Only one person can edit a switchboard at a time; release it when you&apos;re
                done so others can edit it.
              </>,
              <>
                When a change affects other things (e.g. a new current density resizes busbars), Save first shows a <b>Review changes</b> list — tick
                what to apply. See <i>Checks &amp; alerts</i> below.
              </>,
            ]}
          />
        </Section>

        <Section id="bom" title="4. BOM Builder & discounts">
          <Steps
            items={[
              <>
                <b>Add from library</b> to bring in a standard feeder, or build a <b>custom feeder</b> just for this switchboard. Adding the same
                library feeder again simply increases its quantity.
              </>,
              <>
                Each feeder card shows its items. Change quantities, add items from the Item Master (or create a new item on the spot), and set the
                feeder&apos;s Device Type and rating. Editing a library feeder here makes a switchboard-only copy — the library stays untouched.
              </>,
              <>
                <b>Discounts</b>: every item line can override its list price or discount % for this BOM only. To discount a whole category at once
                (e.g. all MCCBs at 42%), use <b>Bulk Discount — Category</b> at the top.
              </>,
              <>
                <b>Busbars</b>: the &ldquo;Auto&rdquo; lines come straight from the GA busbar plan — one line per bar size, in kg, priced at the
                project&apos;s busbar rate. Add your own lines underneath for supports, sleeves, etc. <b>Enclosure</b> lines are entered by hand.
              </>,
              <>
                Set labor (wiring, assembly, testing) as a % of materials in the cost breakdown card.
              </>,
              <>
                The BOM <b>can&apos;t be saved</b> while any feeder is rated above the switchboard&apos;s Amps — raise the switchboard rating in Project
                Detail or lower/replace the feeder. Items rated below the switchboard&apos;s kA show as a <b>warning</b> — you can still save.
              </>,
            ]}
          />
        </Section>

        <Section id="ga" title="5. GA Builder">
          <Steps
            items={[
              <>
                Feeders added in the BOM first appear in the <b>Unassigned</b> bucket. Add bays (incomer, outgoing, bus coupler, cable alley, busbar
                alley…) and drag feeders into them; reorder them inside a bay to set the top-to-bottom order.
              </>,
              <>
                On ArTuK switchboards, <b>Update GA</b> sizes every bay&apos;s width, depth and compartment heights from its feeders, using the tables
                under <i>Dimensions</i>. It never adds, deletes or moves bays or feeders.
              </>,
              <>
                Click a bay to rename it, change its type or size it by hand. Click the busbar chamber to set its height; panel and plinth heights are
                in the switchboard properties panel. Unused height becomes a &ldquo;dummy&rdquo; blank space you can move.
              </>,
              <>Front and side views, dimensions and the &ldquo;Sizing Logic&rdquo; panel explain how each size was reached.</>,
            ]}
          />
        </Section>

        <Section id="busbars" title="6. Busbar routing & sizing">
          <Steps
            items={[
              <>
                Turn on the <b>Busbars</b> layer in GA Builder. The app draws the route automatically: the <b>incomer cable link</b> (75% of panel
                depth, for the customer&apos;s incoming cables) → <b>incomer riser</b> → <b>main busbar</b> along the chamber → a <b>dropper</b> down
                each busbar alley → <b>feeder links</b> to each outgoing feeder (ACBs get an ACB link straight from the main bar).
              </>,
              <>
                Each bar is sized from the current it carries ÷ the project&apos;s current density, using only the stocked sizes (see{" "}
                <i>Busbar sizes</i>). Above the biggest bar it runs bars in parallel. Neutral follows the switchboard&apos;s 100% / 50% setting.
              </>,
              <>
                To change a bar, click it in the drawing (or a row in the <b>Busbar Schedule</b>) and pick a size, runs per phase or
                length — or drag the square handles at its ends to stretch or shorten it. Use the schedule&apos;s bulk edit for several bars
                at once, and <b>Reset to auto</b> to go back to the automatic size. <b>Esc</b> clears any selection.
              </>,
              <>
                Click a bay in the front view and the <b>Side View</b> (panel front on the right) shows that bay: its devices, their rear
                terminals and every bar serving them (riser, dropper, feeder links, main bar end-on), each drawn as phases × runs with its size
                and current. With no bay selected, the side view shows no busbars.
              </>,
              <>Bar sizes and lengths flow into the BOM&apos;s busbar lines and the costing once the GA is saved.</>,
            ]}
          />
        </Section>

        <Section id="costing" title="7. Costing">
          <Steps
            items={[
              <>
                Each switchboard&apos;s cost = <b>Electrical</b> (feeder items) + <b>Busbars</b> + <b>Enclosure</b>, plus labor % on top = MFG cost.
              </>,
              <>
                The <b>Costing</b> tab lays all switchboards side by side × their quantity. Set the profit margin per switchboard, and add freight,
                installation and commissioning to reach the <b>final price</b>.
              </>,
              <>Totals show in INR and, if the project uses another currency, converted at the project&apos;s exchange rate.</>,
            ]}
          />
        </Section>

        <Section id="checks" title="Checks & alerts" note="The app guards against the mistakes that are expensive to find late.">
          <Steps
            items={[
              <>
                <b>Review on Save</b> (Project Detail): changing busbar density, or a switchboard&apos;s Amps, material, neutral, cable entry, Std,
                kA, IP or Form, checks every switchboard in the project. Bars that would change size and new issues are listed with checkboxes —{" "}
                <b>ticked</b> applies the change, <b>unticked</b> keeps things as they are. Approve is disabled while an alert would be left
                behind.
              </>,
              <>
                <b>Alerts &amp; Warnings</b> (top of Project Detail). <span className="font-semibold text-error">Alerts</span> are real conflicts
                and <b>block saving</b> the revision they&apos;re in until fixed: feeders rated above the switchboard Amps, an incomer rated below it,
                undersized busbars, a main busbar with no rating. <span className="font-semibold text-amber-700">Warnings</span> are worth checking
                but <b>don&apos;t stop you saving</b>: items or breakers rated below the switchboard kA, ArTuK bays below the switchboard IP or at a
                non-standard size, hand-set bars that differ from the rules. Tick fixable lines and click <b>Apply selected fixes</b>; the rest say
                where to fix them.
              </>,
              <>
                <b>Amps guard</b>: a switchboard&apos;s Amps can&apos;t be saved below its highest-rated feeder, and a BOM can&apos;t be saved with a
                feeder above the switchboard rating. The error shows the fix (e.g. &ldquo;Set to 2500A&rdquo;).
              </>,
            ]}
          />
        </Section>

        <Section id="colors" title="What the colors mean">
          <div className="grid gap-5 md:grid-cols-2">
            <ColorGroup
              title="Everywhere"
              rows={[
                [<Chip key="1" className="bg-primary text-on-primary">Save</Chip>, "Main actions, links and the selected item."],
                [<Txt key="2" className="text-amber-600">Unsaved changes</Txt>, "You have edits that aren't saved yet."],
                [<Txt key="3" className="text-tertiary">Saved</Txt>, "Everything on the page is saved. Also used for margin / profit figures."],
                [<Chip key="4" className="border border-amber-200/60 bg-amber-50 text-amber-700">🔒 Name</Chip>, "Switchboard locked by someone else — read only for you."],
                [<Chip key="5" className="bg-tertiary-container/15 text-tertiary">Locked by you</Chip>, "You hold the lock and can edit."],
                [<Chip key="6" className="border border-error/30 bg-error-container text-error">Archived</Chip>, "Archived revision — read only."],
                [<Chip key="7" className="border border-error/40 bg-error/5 text-error">Error</Chip>, "Something blocks saving; the message says how to fix it."],
              ]}
            />
            <ColorGroup
              title="Items & BOM"
              rows={[
                [<Txt key="1" className="text-[#c2185b]">Pink text</Txt>, "Item priced from an estimate (Source = Estimation) — double-check the cost."],
                [<Txt key="2" className="text-[#9aa3ad]">Grey text</Txt>, "Discontinued item — avoid using it."],
                [<Chip key="3" className="border border-amber-100 bg-amber-50 text-on-surface">Feeder</Chip>, "Amber header: a standard library feeder."],
                [<Chip key="4" className="border border-emerald-100 bg-emerald-50 text-on-surface">Feeder</Chip>, "Green header: a custom feeder for this switchboard only."],
                [<Chip key="5" className="border border-error text-error ring-2 ring-error/40">Feeder</Chip>, "Red outline: feeder rated above the switchboard's Amps."],
                [<Chip key="6" className="bg-primary/10 text-primary">AUTO</Chip>, "Busbar line calculated from the GA busbar plan."],
                [<Chip key="7" className="border border-amber-300/70 bg-amber-50/70 text-amber-800">Warning</Chip>, "Amber box: a warning (e.g. item kA below the switchboard's) — you can still save."],
              ]}
            />
            <ColorGroup
              title="Alerts & review"
              rows={[
                [<Dot key="1" className="bg-error" />, "Alert — conflicts with the project/switchboard settings; blocks saving until fixed."],
                [<Dot key="2" className="bg-amber-500" />, "Warning — worth checking (e.g. kA below the switchboard's); saving is allowed."],
                [<Dot key="3" className="bg-primary" />, "A change your Save will make (review list only)."],
              ]}
            />
            <ColorGroup
              title="GA drawing & busbars"
              rows={[
                [<Chip key="1" className="bg-red-600 text-white">ARTUK</Chip>, "Red strip: switchboard built to the ArTuK standard."],
                [<Chip key="2" className="border border-surface-container-high bg-white text-on-surface">Feeder</Chip>, "White compartment: a feeder unit."],
                [<Chip key="3" className="bg-surface-container-low text-on-surface-variant">DUMMY</Chip>, "Grey compartment: blank space / alley."],
                [<Bar key="4" color="#b45309" />, "Copper main bar, risers and droppers."],
                [<Bar key="5" color="#ea580c" />, "Copper feeder / ACB links."],
                [<Bar key="6" color="#475569" />, "Aluminium main bar, risers and droppers."],
                [<Bar key="7" color="#64748b" />, "Aluminium feeder / ACB links."],
                [<Bar key="8" color="#dc2626" />, "Side view: phase R (Y yellow, B blue, N black) — one line per bar run."],
                [<Bar key="9" color="#dc2626" />, "Undersized bar — too small for its current."],
                [<Bar key="10" color="#006194" />, "The bar you've selected."],
              ]}
            />
          </div>
        </Section>

        <div id="dimensions" className="scroll-mt-4 space-y-8">
          <div>
            <h2 className="font-display text-xl font-semibold text-on-surface">Dimensions & sizing data</h2>
            <p className="mt-1 max-w-3xl text-sm text-secondary">
              Reference data from ArTuK&rsquo;s standard feeder and bay sizing catalog. On any switchboard set to the{" "}
              <span className="font-medium">ArTuK</span> standard, GA Builder&rsquo;s <span className="font-medium">Update GA</span> reads this
              exact data to propose bay sizes from the BOM&rsquo;s feeders — this section explains why it proposes what it proposes. Every bay&rsquo;s
              width/depth can still be adjusted by hand afterward in GA Builder.
            </p>
          </div>
          <DimensionsReference />
        </div>
      </div>
    </div>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2 text-sm text-on-surface">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-container text-[11px] font-semibold text-on-surface-variant">
            {i + 1}
          </span>
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function ColorGroup({ title, rows }: { title: string; rows: [React.ReactNode, string][] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-secondary">{title}</p>
      <ul className="space-y-2">
        {rows.map(([sample, text], i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="flex w-32 shrink-0 items-center">{sample}</span>
            <span className="text-on-surface">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

function Txt({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`text-sm font-medium ${className}`}>{children}</span>;
}

function Dot({ className }: { className: string }) {
  return <span className={`ml-2 h-2.5 w-2.5 rounded-full ${className}`} />;
}

function Bar({ color }: { color: string }) {
  return <span className="h-1.5 w-20 rounded-sm" style={{ backgroundColor: color }} />;
}

function DimensionsReference() {
  return (
    <>
      <Section
        id="dim-busbars" title="Busbar sizes (stocked)"
        note="The only flats we buy. GA Builder's busbar plan sizes every bar from these, and they're the only sizes offered when a bar is changed by hand."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          {(["Cu", "Al"] as const).map((material) => (
            <div key={material}>
              <p className="mb-1 text-sm font-semibold text-on-surface">{material === "Cu" ? "Copper (Cu)" : "Aluminium (Al)"}</p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-surface-container-high text-xs uppercase tracking-wide text-on-surface-variant">
                    <th className="py-2 pr-3">Size (W × T)</th>
                    <th className="py-2 pr-3 text-right">Area</th>
                    <th className="py-2 pr-3 text-right">Capacity @ {DEFAULT_DENSITY[material]} A/mm²</th>
                    <th className="py-2 pr-3 text-right">kg / m</th>
                  </tr>
                </thead>
                <tbody>
                  {BAR_SIZES[material].map((b) => (
                    <tr key={`${b.widthMm}x${b.thicknessMm}`} className="border-b border-surface-container-high/60">
                      <td className="py-1.5 pr-3 font-medium">
                        {b.widthMm} × {b.thicknessMm}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{barArea(b)} mm²</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{Math.round(barArea(b) * DEFAULT_DENSITY[material])} A</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{(barArea(b) * 1000 * MATERIAL_DENSITY[material]).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-secondary">
          Capacity is per bar at the default current density; each project can set its own Cu/Al density in Project Detail. Above the largest bar,
          the plan runs bars in parallel per phase.
        </p>
      </Section>

      <Section id="dim-acb" title="ACB (Emax2)" note="Device's own breaker-face footprint. Bay dimensions come from the ArTuK bay assemblies below, not this table.">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-container-high text-xs uppercase tracking-wide text-on-surface-variant">
              <th className="py-2 pr-3">Upto</th>
              <th className="py-2 pr-3">Frame</th>
              <th className="py-2 pr-3">Height</th>
              <th className="py-2 pr-3">Width (3P)</th>
              <th className="py-2 pr-3">Width (4P, 50% Ne)</th>
              <th className="py-2 pr-3">Width (4P, 100% Ne)</th>
            </tr>
          </thead>
          <tbody>
            {ACB_SIZES.map((b, i) => (
              <tr key={i} className="border-b border-surface-container-high/60">
                <td className="py-1.5 pr-3">{b.uptoAmps === Infinity ? "5000A & above" : `${b.uptoAmps}A`}</td>
                <td className="py-1.5 pr-3 font-medium">{b.frame}</td>
                <td className="py-1.5 pr-3">{mm(b.height)}</td>
                <td className="py-1.5 pr-3">{mm(b.width3P)}</td>
                <td className="py-1.5 pr-3">{mm(b.width4P50)}</td>
                <td className="py-1.5 pr-3">{mm(b.width4P100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-secondary">
          Default policy: 4P bays use the more conservative <span className="font-medium">100% Ne</span> width. ACBs should also be considered per
          fault level (kA) — GA Builder&rsquo;s frame suggestion is by rated current only, so review the frame for high fault-level boards.
        </p>
      </Section>

      <Section id="dim-mccb" title="MCCB">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-container-high text-xs uppercase tracking-wide text-on-surface-variant">
              <th className="py-2 pr-3">Upto</th>
              <th className="py-2 pr-3">Frame</th>
              <th className="py-2 pr-3">Height</th>
              <th className="py-2 pr-3">Rear Width</th>
            </tr>
          </thead>
          <tbody>
            {MCCB_SIZES.map((b, i) => (
              <tr key={i} className="border-b border-surface-container-high/60">
                <td className="py-1.5 pr-3">{b.uptoAmps}A</td>
                <td className="py-1.5 pr-3 font-medium">{b.frame}</td>
                <td className="py-1.5 pr-3">{mm(b.height)}</td>
                <td className="py-1.5 pr-3">{mm(b.rearWidth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-secondary">
          MCB isn&rsquo;t tabulated separately by ArTuK — Auto-generate GA reuses the smallest MCCB bracket above (Upto 100A) for MCB, since MCBs
          are always smaller in practice.
        </p>
      </Section>

      <Section id="dim-dol" title="DOL / RDOL">
        <MotorTable sizes={DOL_RDOL_SIZES} />
      </Section>

      <Section id="dim-star-delta" title="Star-Delta">
        <MotorTable sizes={STAR_DELTA_SIZES} />
      </Section>

      <Section id="dim-vfd" title="VFD & Soft Starter" note="VFD and Soft Starter share one table in the ArTuK catalog.">
        <MotorTable sizes={VFD_SOFT_STARTER_SIZES} />
      </Section>

      <Section id="dim-outgoing" title="Outgoing bay module" note="Every non-ACB device above stacks by height into this shared bay -- not sized per device.">
        <p className="text-sm text-on-surface">
          {mm(OUTGOING_MCC_BAY.widthMm)} wide &times; {mm(OUTGOING_MCC_BAY.depthMm)} deep — ArTuK&rsquo;s standard rear-access MCC vertical (used by
          default). A front-access alternative exists — see the templates below.
        </p>
      </Section>

      <Section id="dim-artuk-bays" title="ArTuK bay assemblies (ACB incomer / outgoing / bus coupler)">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-container-high text-xs uppercase tracking-wide text-on-surface-variant">
              <th className="py-2 pr-3">Frame</th>
              <th className="py-2 pr-3">Function</th>
              <th className="py-2 pr-3">Width</th>
              <th className="py-2 pr-3">Height</th>
              <th className="py-2 pr-3">Depth</th>
              <th className="py-2 pr-3">IP</th>
              <th className="py-2 pr-3">Form</th>
            </tr>
          </thead>
          <tbody>
            {ACB_BAY_SPECS.map((s, i) => (
              <tr key={i} className="border-b border-surface-container-high/60 align-top">
                <td className="py-1.5 pr-3 font-medium">{s.frame}</td>
                <td className="py-1.5 pr-3 capitalize">{s.function.replace("_", " ")}</td>
                <td className="py-1.5 pr-3">
                  {mm(s.widthMm)}
                  {s.pairedWith && <span className="text-secondary"> + {mm(s.pairedWith.widthMm)} ({s.pairedWith.name ?? s.pairedWith.bayType})</span>}
                </td>
                <td className="py-1.5 pr-3">{mm(s.heightMm)}</td>
                <td className="py-1.5 pr-3">{mm(s.depthMm)}</td>
                <td className="py-1.5 pr-3">IP{s.ipRating}</td>
                <td className="py-1.5 pr-3">{s.form}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-3 space-y-1.5 text-xs text-secondary">
          <li>
            <span className="font-medium text-on-surface">E6.2 incomer</span> is deeper than standard (1467mm total) — a 1030mm front section plus
            a 437mm rear extension, folded into one depth since GA bays only track a single depth value.
          </li>
          <li>
            <span className="font-medium text-on-surface">E2.2 bus coupler</span> always pairs its 920mm coupler bay with an attached 420mm Cable
            Chamber bay — created together automatically.
          </li>
          <li>
            <span className="font-medium text-on-surface">Two E1.2 outgoing ACBs</span> share the more space-efficient 2-tier combo (920mm + 720mm,
            1467mm deep) instead of two full single bays — Auto-generate GA pairs them up two at a time automatically; a leftover odd unit gets a
            plain single bay.
          </li>
          <li>
            <span className="font-medium text-on-surface">E4.2 / E6.2 bus coupler</span> have no dedicated row in ArTuK&rsquo;s sample data — Auto
            -generate GA falls back to that frame&rsquo;s generic device dimensions with a standard 1037mm depth.
          </li>
        </ul>
      </Section>

      <Section id="dim-alternates" title="Wider alternates" note="Not chosen automatically -- available by widening the generated bay in GA Builder.">
        <ul className="space-y-1.5 text-sm text-on-surface">
          {ACB_BAY_ALTERNATES.map((a, i) => (
            <li key={i}>
              <span className="font-medium">
                {a.frame} {a.function.replace("_", " ")} @ {mm(a.widthMm)}
              </span>
              <span className="text-secondary"> — {a.note}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="dim-templates" title="Manual-only templates" note="Available as one-click GA Builder buttons, never chosen automatically.">
        <ul className="space-y-2 text-sm text-on-surface">
          <li>
            <span className="font-medium">{MCC_FRONT_ACCESS_PAIR.label}</span> — {mm(MCC_FRONT_ACCESS_PAIR.primary.widthMm)} +{" "}
            {mm(MCC_FRONT_ACCESS_PAIR.paired.widthMm)}, {mm(MCC_FRONT_ACCESS_PAIR.primary.depthMm)} deep.
            <span className="text-secondary"> {MCC_FRONT_ACCESS_PAIR.note}</span>
          </li>
          <li>
            <span className="font-medium">{ACB_2TIER_OUTGOING_E12.label}</span> — {mm(ACB_2TIER_OUTGOING_E12.primary.widthMm)} +{" "}
            {mm(ACB_2TIER_OUTGOING_E12.paired.widthMm)}, {mm(ACB_2TIER_OUTGOING_E12.primary.depthMm)} deep.
            <span className="text-secondary"> Same combo Auto-generate GA uses automatically for pairs of E1.2 outgoing ACBs — add it directly if you want one standalone.</span>
          </li>
        </ul>
      </Section>
    </>
  );
}

function MotorTable({ sizes }: { sizes: { uptoKw: number; height: number | null; standalone?: boolean }[] }) {
  return (
    <>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-surface-container-high text-xs uppercase tracking-wide text-on-surface-variant">
            <th className="py-2 pr-3">Upto</th>
            <th className="py-2 pr-3">Height</th>
            <th className="py-2 pr-3">Width</th>
          </tr>
        </thead>
        <tbody>
          {sizes.map((b, i) => (
            <tr key={i} className="border-b border-surface-container-high/60">
              <td className="py-1.5 pr-3">{b.uptoKw === Infinity ? "above" : `${b.uptoKw}kW`}</td>
              <td className="py-1.5 pr-3">{b.height == null ? "no data — needs review" : mm(b.height)}</td>
              <td className="py-1.5 pr-3">{b.height == null ? "—" : `${mm(OUTGOING_MCC_BAY.widthMm)} module`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-secondary">Height uses the 920mm front-width standard (default policy). Width is always the standard outgoing bay module, not a per-device figure.</p>
    </>
  );
}

function Section({ id, title, note, children }: { id?: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-xl border border-surface-container-high bg-surface-container-lowest p-5 shadow-xs">
      <h2 className="font-display text-base font-semibold text-on-surface">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-secondary">{note}</p>}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}
