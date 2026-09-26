"use client";

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

function mm(n: number | null) {
  return n == null ? "—" : `${n}mm`;
}

export function DimensionsMaster() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-on-surface">Dimensions Master</h1>
        <p className="mt-1 max-w-3xl text-sm text-secondary">
          Reference data from ArTuK&rsquo;s standard feeder and bay sizing catalog. On any switchboard set to the{" "}
          <span className="font-medium">ArTuK</span> standard, GA Builder&rsquo;s <span className="font-medium">Auto-generate GA</span> reads this
          exact data to propose bay sizes automatically from the BOM&rsquo;s feeders — this page explains why it proposes what it proposes. Every
          proposed bay&rsquo;s width/depth can still be adjusted by hand afterward in GA Builder.
        </p>
      </div>

      <Section title="ACB (Emax2)" note="Device's own breaker-face footprint. Bay dimensions come from the ArTuK bay assemblies below, not this table.">
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

      <Section title="MCCB">
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

      <Section title="DOL / RDOL">
        <MotorTable sizes={DOL_RDOL_SIZES} />
      </Section>

      <Section title="Star-Delta">
        <MotorTable sizes={STAR_DELTA_SIZES} />
      </Section>

      <Section title="VFD & Soft Starter" note="VFD and Soft Starter share one table in the ArTuK catalog.">
        <MotorTable sizes={VFD_SOFT_STARTER_SIZES} />
      </Section>

      <Section title="Outgoing bay module" note="Every non-ACB device above stacks by height into this shared bay -- not sized per device.">
        <p className="text-sm text-on-surface">
          {mm(OUTGOING_MCC_BAY.widthMm)} wide &times; {mm(OUTGOING_MCC_BAY.depthMm)} deep — ArTuK&rsquo;s standard rear-access MCC vertical (used by
          default). A front-access alternative exists — see the templates below.
        </p>
      </Section>

      <Section title="ArTuK bay assemblies (ACB incomer / outgoing / bus coupler)">
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

      <Section title="Wider alternates" note="Not chosen automatically -- available by widening the generated bay in GA Builder.">
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

      <Section title="Manual-only templates" note="Available as one-click GA Builder buttons, never chosen automatically.">
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
    </div>
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

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-5 shadow-xs">
      <h2 className="font-display text-base font-semibold text-on-surface">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-secondary">{note}</p>}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}
