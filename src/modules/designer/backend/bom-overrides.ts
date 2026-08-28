import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  BomOverride,
  BomOverridePatch,
} from "../../../sdks/designer/types";
import { bomOverrides, schematicParts } from "./schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

type BomOverrideRow = typeof bomOverrides.$inferSelect;

export function listBomOverrides(
  db: DbClient,
  designId: string,
): BomOverride[] {
  const currentReferenceByPartId = new Map(
    db
      .select({ id: schematicParts.id, reference: schematicParts.reference })
      .from(schematicParts)
      .where(eq(schematicParts.designId, designId))
      .all()
      .map((part) => [part.id, part.reference]),
  );
  return db
    .select()
    .from(bomOverrides)
    .where(eq(bomOverrides.designId, designId))
    .all()
    .map((row) =>
      toDto(
        row,
        (row.partId && currentReferenceByPartId.get(row.partId)) || row.refdes,
      ),
    );
}

export function upsertBomOverride(
  db: DbClient,
  designId: string,
  refdes: string,
  patch: BomOverridePatch,
  timestamp: string,
): BomOverride {
  const part = db
    .select({ id: schematicParts.id })
    .from(schematicParts)
    .where(
      and(
        eq(schematicParts.designId, designId),
        eq(schematicParts.reference, refdes),
      ),
    )
    .get();
  const existing = part
    ? db
        .select()
        .from(bomOverrides)
        .where(
          and(
            eq(bomOverrides.designId, designId),
            eq(bomOverrides.partId, part.id),
          ),
        )
        .get() ??
      db
        .select()
        .from(bomOverrides)
        .where(
          and(
            eq(bomOverrides.designId, designId),
            eq(bomOverrides.refdes, refdes),
            isNull(bomOverrides.partId),
          ),
        )
        .get()
    : db
        .select()
        .from(bomOverrides)
        .where(
          and(
            eq(bomOverrides.designId, designId),
            eq(bomOverrides.refdes, refdes),
            isNull(bomOverrides.partId),
          ),
        )
        .get();
  const next = {
    id: existing?.id ?? crypto.randomUUID(),
    designId,
    partId: part?.id ?? existing?.partId ?? null,
    refdes,
    manufacturer:
      patch.manufacturer !== undefined ? normalizeString(patch.manufacturer) : existing?.manufacturer ?? null,
    manufacturerPartNumber:
      patch.manufacturerPartNumber !== undefined
        ? normalizeString(patch.manufacturerPartNumber)
        : existing?.manufacturerPartNumber ?? null,
    lcscPartNumber:
      patch.lcscPartNumber !== undefined
        ? normalizeString(patch.lcscPartNumber)
        : existing?.lcscPartNumber ?? null,
    supplier:
      patch.supplier !== undefined ? normalizeString(patch.supplier) : existing?.supplier ?? null,
    unitPriceMicros:
      patch.unitPrice !== undefined
        ? priceToMicros(patch.unitPrice)
        : existing?.unitPriceMicros ?? null,
    currency:
      patch.currency !== undefined
        ? normalizeString(patch.currency)?.toUpperCase() ?? null
        : existing?.currency ?? null,
    dnp: patch.dnp !== undefined ? (patch.dnp ? 1 : 0) : existing?.dnp ?? 0,
    assemblySide:
      patch.assemblySide !== undefined ? patch.assemblySide : existing?.assemblySide ?? null,
    notes:
      patch.notes !== undefined ? normalizeString(patch.notes) : existing?.notes ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  if (existing) {
    db.update(bomOverrides)
      .set(next)
      .where(eq(bomOverrides.id, existing.id))
      .run();
  } else {
    db.insert(bomOverrides).values(next).run();
  }
  return toDto(next, refdes);
}

function toDto(row: BomOverrideRow, refdes = row.refdes): BomOverride {
  return {
    designId: row.designId,
    refdes,
    manufacturer: row.manufacturer,
    manufacturerPartNumber: row.manufacturerPartNumber,
    lcscPartNumber: row.lcscPartNumber,
    supplier: row.supplier,
    unitPrice:
      row.unitPriceMicros === null ? null : row.unitPriceMicros / 1_000_000,
    currency: row.currency,
    dnp: row.dnp === 1,
    assemblySide: parseAssemblySide(row.assemblySide),
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

function parseAssemblySide(value: string | null): "top" | "bottom" | null {
  return value === "top" || value === "bottom" ? value : null;
}

function normalizeString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function priceToMicros(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1_000_000);
}
