CREATE TABLE designer_bom_overrides_new (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL REFERENCES designer_design_heads(id) ON DELETE CASCADE,
  part_id TEXT,
  refdes TEXT NOT NULL,
  manufacturer TEXT,
  manufacturer_part_number TEXT,
  lcsc_part_number TEXT,
  supplier TEXT,
  unit_price_micros INTEGER,
  currency TEXT,
  dnp INTEGER NOT NULL DEFAULT 0,
  assembly_side TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO designer_bom_overrides_new (
  id,
  design_id,
  part_id,
  refdes,
  manufacturer,
  manufacturer_part_number,
  lcsc_part_number,
  supplier,
  unit_price_micros,
  currency,
  dnp,
  assembly_side,
  notes,
  created_at,
  updated_at
)
SELECT
  override.id,
  override.design_id,
  part.id,
  override.refdes,
  override.manufacturer,
  override.manufacturer_part_number,
  override.lcsc_part_number,
  override.supplier,
  override.unit_price_micros,
  override.currency,
  override.dnp,
  override.assembly_side,
  override.notes,
  override.created_at,
  override.updated_at
FROM designer_bom_overrides AS override
LEFT JOIN designer_schematic_parts AS part
  ON part.design_id = override.design_id
  AND part.reference = override.refdes;

DROP TABLE designer_bom_overrides;
ALTER TABLE designer_bom_overrides_new RENAME TO designer_bom_overrides;

CREATE UNIQUE INDEX designer_bom_overrides_design_part_uq
  ON designer_bom_overrides (design_id, part_id);

CREATE INDEX designer_bom_overrides_design_ref_idx
  ON designer_bom_overrides (design_id, refdes);

CREATE INDEX designer_bom_overrides_design_id_idx
  ON designer_bom_overrides (design_id);
