"""Builds public/templates/item-master-template.xlsx -- the Item Master
import template (Item Master > Download template). Run with:
    python3 scripts/build-item-master-template.py
Sheet 1 "Item Master": the import columns (header row read by the xlsx
upload / Google Sheet sync) with one example row and dropdowns on the
fixed-value columns. Sheet 2 "Allowed values": every field that only takes
specific values, plus the compulsory-field rules."""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName

COLUMNS = ["sku", "vendor_cat", "description", "make", "category", "source", "status", "amps", "frame", "ka", "poles",
           "uom", "unit_cost", "list_price", "discount_pct", "supplier", "notes", "pricelisted", "mrp_or_lp", "hsn_code",
           "vendor_description", "material", "weight_kg"]
EXAMPLE = ["MCB-C32-3P", "", "MCB 32A 3 Pole C-Curve", "Schneider", "MCB", "Estimation", "active", 32, None, 10, 3, "nos",
           850, 1200, 29.2, "", "Every row needs a SKU or Vendor Cat (or both), a description, and a Source. See the Allowed values tab.",
           "yes", "MRP", "85362090", "MCB SP+N 32A C CURVE 10KA IC60N", None, None]

ALLOWED = {
    "source": (["Design", "Estimation"], "Required on every row."),
    "status": (["active", "inactive", "discontinued"], "Blank = active."),
    "pricelisted": (["yes", "no"], "y / true / 1 also mean yes; anything else (or blank) = no."),
    "mrp_or_lp": (["MRP", "LP"], "Anything else is left blank."),
    "material": (["GI", "CRCA"], "ArTuK enclosure parts: GI (galvanised) or CRCA steel. With weight_kg, the part is priced by weight x the project's GI / CRCA rate. 'Galvanised' is read as GI."),
}
FRAMES = ["E1.2", "E2.2", "E4.2", "E6.2", "FA1", "FA2", "FA4", "XT1", "XT2", "XT3", "XT4", "XT5", "XT6", "XT7", "T5", "T6", "T7", "A1", "A2", "A3", "P1", "P2", "P3"]
RULES = [
    ("sku / vendor_cat", "At least one of the two on every row. A row matching an existing SKU or Vendor Cat updates that item."),
    ("description", "Required (the item's name)."),
    ("make, category", "Required for new items."),
    ("category", "Free text. ACB, MCCB and MCB items also need amps, poles and ka; ACB and MCCB also need frame."),
    ("frame", "Free text; common ABB frames listed below (other makes: their own frame/model). FA1/FA2/FA4 and A1-A3 are the Formula series - discouraged in ArTuK panels."),
    ("amps, ka, poles, unit_cost, list_price, discount_pct, weight_kg", "Numbers only. discount_pct is a percentage (0-100). Net cost = list_price x (1 - discount_pct/100) when a list price is given, else unit_cost."),
    ("uom", "Free text; blank = nos."),
    ("frame / material / weight_kg on update", "A blank cell keeps the value already on file."),
]

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Item Master"
ws.append(COLUMNS)
ws.append(EXAMPLE)
bold = Font(bold=True)
head_fill = PatternFill("solid", fgColor="DDE7F0")
for c in ws[1]:
    c.font = bold
    c.fill = head_fill
for i, col in enumerate(COLUMNS, start=1):
    ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = max(12, min(40, len(col) + 6))
ws.freeze_panes = "A2"

av = wb.create_sheet("Allowed values")
av["A1"] = "Fields that only allow specific values"
av["A1"].font = Font(bold=True, size=13)
av.append([])
av.append(["Field", "Allowed values", "Notes"])
for c in av[3]:
    c.font = bold
    c.fill = head_fill
row = 4
for field, (values, note) in ALLOWED.items():
    av.cell(row=row, column=1, value=field).font = bold
    av.cell(row=row, column=2, value=", ".join(values))
    av.cell(row=row, column=3, value=note)
    row += 1

row += 1
av.cell(row=row, column=1, value="Rules for other fields").font = Font(bold=True, size=13)
row += 1
for field, note in RULES:
    av.cell(row=row, column=1, value=field).font = bold
    av.cell(row=row, column=3, value=note)
    row += 1

row += 1
av.cell(row=row, column=1, value="Common ABB frames (frame column)").font = Font(bold=True, size=13)
row += 1
av.cell(row=row, column=2, value=", ".join(FRAMES))
av.column_dimensions["A"].width = 34
av.column_dimensions["B"].width = 42
av.column_dimensions["C"].width = 110
for r in av.iter_rows(min_row=4):
    for c in r:
        c.alignment = Alignment(wrap_text=True, vertical="top")

# dropdown lists (hidden helper columns on the Allowed values sheet)
lists = wb.create_sheet("lists")
for j, (field, (values, _)) in enumerate(ALLOWED.items(), start=1):
    letter = openpyxl.utils.get_column_letter(j)
    lists.cell(row=1, column=j, value=field)
    for k, v in enumerate(values, start=2):
        lists.cell(row=k, column=j, value=v)
    ref = f"lists!${letter}$2:${letter}${len(values) + 1}"
    dv = DataValidation(type="list", formula1=f"={ref}", allow_blank=True, showErrorMessage=False)
    dv.promptTitle = field
    dv.prompt = "Allowed: " + ", ".join(values)
    dv.showInputMessage = True
    col = openpyxl.utils.get_column_letter(COLUMNS.index(field) + 1)
    dv.add(f"{col}2:{col}5000")
    ws.add_data_validation(dv)
lists.sheet_state = "hidden"

wb.save("public/templates/item-master-template.xlsx")
print("written")
