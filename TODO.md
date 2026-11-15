# TrueQuote LV — to-do list

Cable alleys stay 420mm in the app; widen one by hand (e.g. to 720mm)
in GA Builder when a customer wants it.

Open items for the switchboard estimation app. Newest at the top.

## Waiting on data from Siddharth

- [ ] **ArTu-K bay configs missing from the bay selector** (seen on the
      Thermax / Vedanta Calciner 2500A double-front MCC panel, GA sheet
      2500/LT/1/26-27_R6, 15-Nov-2026). Siddharth to collate drawings +
      parts lists for each; then add them to the bay selector, the
      workbook parts lists (artuk_bay_templates) and the enclosure BOM:
  - [ ] 920mm MCC vertical, **double front at 1237mm depth** (2500A) —
        feeder modules (~600mm) beside an **internal vertical busbar
        chamber** in the same bay (bays 1F, 3F, 8F, 11F).
  - [ ] 920mm MCC vertical, double front 1237mm, with an **internal cable
        alley** instead of the busbar chamber (bays 2F, 10F).
  - [ ] 920mm **Emax 2 E2.2 2500A ACB incomer, double front 1237mm, top
        busduct entry through a 437mm rear busduct chamber** (only the
        incomer bays are 1237+437 deep; the rest of the line-up stays
        1237) — Incomer-1 / Incomer-2.
  - [ ] 920mm E2.2 2500A **bus coupler, double front 1237mm**, with the
        420mm external busbar chamber to Bus-B (the 1037mm version exists:
        "...920+420 E2.2 w ACB BC With External Busbar Chamber").
  - [ ] Double-front **ACB bays** in general (no double-front ACB parts list
        in the workbook today; they're priced as rear-access bays).

## App changes these will need

- [ ] **Different depths for certain bays**: let a bay be deeper than the
      rest of the line-up (e.g. incomer 1237+437 with a rear busduct
      chamber, the rest at 1237). Today every bay takes the deepest bay's
      depth.
- [x] **Build the rear side of a double-front panel** — first version
      done: Front side / Rear side switch in GA Builder (double-front
      ArTu-K boards), rear feeders + blank space per bay, rear drawn from
      behind, busbars / supports / enclosure costed for both faces, rear
      export. Still to do:
  - [ ] Update GA (bay sizing) to consider rear-face feeders too.
  - [ ] Bay-width checks that look at both faces (a bay only fits one
        width; the wider face decides).
  - [ ] Phone summary / PDFs: list front and rear feeders per bay.
  - [ ] Double-front workbook parts lists (ICC, rear doors) instead of the
        general rules.
- [ ] Busbar routing: incomer fed by **top busduct straight down to the
      ACB** (busduct riser in the bay / rear chamber) with the ACB output
      up to the main busbar chamber (BBC).
- [ ] Busbar routing: a feeder bay sitting in one bus section but **fed
      from the other section** ("busbar supply from Bus-B" on 4F, Bus-A
      side) — needs its own horizontal run.
- [ ] Busbar routing: vertical busbar in an **internal busbar chamber at
      the side of an MCC bay**, shared by the front and rear faces of a
      double-front panel.

## Other open items

- [ ] Busduct **exit** (only busduct entries exist today).
- [ ] Picking a double-front bay config could set the switchboard's
      Arrangement to Double front automatically.
- [ ] Decide whether the 7 existing boards that defaulted to "Single
      front" should be blanked so someone confirms them.
- [ ] Remarks on feeders: show on the PDFs / phone summary if wanted.
