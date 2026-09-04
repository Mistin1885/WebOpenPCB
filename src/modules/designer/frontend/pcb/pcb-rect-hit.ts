import type {
  PcbPlacedPart,
  PcbPointMm,
  PcbMeasurement,
  PcbFreeHole,
  PcbFreePad,
  PcbOverlayText,
  PcbTrace,
  PcbVia,
} from "../../../../sdks";
import { placementMirrorX } from "../../../../sdks/designer/pcb-helpers";
import type { BoundsMm } from "../../../../shared/rendering/types";
import {
  aabbContains,
  aabbOverlap,
  polylineContainedInAabb,
  polylineIntersectsAabb,
} from "../../../../shared/frontend/canvas/selection/rubber-band";

const NM_PER_MM = 1_000_000;

/** Local→world transform mirroring `pcb-hit.ts` `transformLocal`. */
function transformLocal(
  localMm: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  const mx = mirrored ? -localMm.x : localMm.x;
  const my = localMm.y;
  switch (r) {
    case 90:
      return { x: -my, y: mx };
    case 180:
      return { x: -mx, y: -my };
    case 270:
      return { x: my, y: -mx };
    default:
      return { x: mx, y: my };
  }
}

/**
 * Forward-transform the four corners of `placement.footprint.preview.bounds`
 * with rotation+mirror, translate by `placement.positionMm`, and return the
 * world AABB. Returns null when the footprint has no bounds.
 */
export function placementBoundsMm(placement: PcbPlacedPart): BoundsMm | null {
  const local = placement.footprint.preview?.bounds;
  if (!local) return null;
  const corners: PcbPointMm[] = [
    { x: local.minX, y: local.minY },
    { x: local.maxX, y: local.minY },
    { x: local.maxX, y: local.maxY },
    { x: local.minX, y: local.maxY },
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const offset = transformLocal(
      corner,
      placement.rotationDeg,
      placementMirrorX(placement),
    );
    const x = placement.positionMm.x + offset.x;
    const y = placement.positionMm.y + offset.y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function placementContainedInRect(
  placement: PcbPlacedPart,
  rect: BoundsMm,
): boolean {
  const b = placementBoundsMm(placement);
  if (!b) return false;
  return aabbContains(rect, b);
}

export function placementIntersectsRect(
  placement: PcbPlacedPart,
  rect: BoundsMm,
): boolean {
  const b = placementBoundsMm(placement);
  if (!b) return false;
  return aabbOverlap(b, rect);
}

function tracePointsMm(trace: PcbTrace): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  for (const p of trace.pointsNm) {
    out.push({ x: p.x / NM_PER_MM, y: p.y / NM_PER_MM });
  }
  return out;
}

/** Trace's polyline is fully inside `rect` (every vertex inside). */
export function traceContainedInRect(trace: PcbTrace, rect: BoundsMm): boolean {
  return polylineContainedInAabb(tracePointsMm(trace), rect);
}

/** Trace touches `rect` (any vertex inside or any segment crosses). */
export function traceIntersectsRect(trace: PcbTrace, rect: BoundsMm): boolean {
  return polylineIntersectsAabb(tracePointsMm(trace), rect);
}

/** Via center is fully inside `rect`. */
export function viaContainedInRect(via: PcbVia, rect: BoundsMm): boolean {
  return (
    via.centerMm.x >= rect.minX &&
    via.centerMm.x <= rect.maxX &&
    via.centerMm.y >= rect.minY &&
    via.centerMm.y <= rect.maxY
  );
}

/** Via bounding box overlaps `rect`. */
export function viaIntersectsRect(via: PcbVia, rect: BoundsMm): boolean {
  const r = via.diameterMm / 2;
  const b = {
    minX: via.centerMm.x - r,
    minY: via.centerMm.y - r,
    maxX: via.centerMm.x + r,
    maxY: via.centerMm.y + r,
  };
  return aabbOverlap(b, rect);
}

function aabbForFreePad(pad: PcbFreePad): BoundsMm {
  return {
    minX: pad.centerMm.x - pad.widthMm / 2,
    minY: pad.centerMm.y - pad.heightMm / 2,
    maxX: pad.centerMm.x + pad.widthMm / 2,
    maxY: pad.centerMm.y + pad.heightMm / 2,
  };
}

function aabbForOverlayText(text: PcbOverlayText): BoundsMm {
  const halfW = text.fontSizeMm * text.text.length * 0.3;
  const halfH = text.fontSizeMm / 2;
  return {
    minX: text.positionMm.x - halfW,
    minY: text.positionMm.y - halfH,
    maxX: text.positionMm.x + halfW,
    maxY: text.positionMm.y + halfH,
  };
}

export function freeHoleContainedInRect(
  hole: PcbFreeHole,
  rect: BoundsMm,
): boolean {
  const r = hole.drillMm / 2;
  return aabbContains(rect, {
    minX: hole.centerMm.x - r,
    minY: hole.centerMm.y - r,
    maxX: hole.centerMm.x + r,
    maxY: hole.centerMm.y + r,
  });
}

export function freeHoleIntersectsRect(
  hole: PcbFreeHole,
  rect: BoundsMm,
): boolean {
  const r = hole.drillMm / 2;
  return aabbOverlap(rect, {
    minX: hole.centerMm.x - r,
    minY: hole.centerMm.y - r,
    maxX: hole.centerMm.x + r,
    maxY: hole.centerMm.y + r,
  });
}

export function freePadContainedInRect(
  pad: PcbFreePad,
  rect: BoundsMm,
): boolean {
  return aabbContains(rect, aabbForFreePad(pad));
}
export function freePadIntersectsRect(
  pad: PcbFreePad,
  rect: BoundsMm,
): boolean {
  return aabbOverlap(rect, aabbForFreePad(pad));
}
export function overlayTextContainedInRect(
  text: PcbOverlayText,
  rect: BoundsMm,
): boolean {
  return aabbContains(rect, aabbForOverlayText(text));
}
export function overlayTextIntersectsRect(
  text: PcbOverlayText,
  rect: BoundsMm,
): boolean {
  return aabbOverlap(rect, aabbForOverlayText(text));
}

/** A measurement is contained when both endpoints are in the window. */
export function measurementContainedInRect(
  measurement: PcbMeasurement,
  rect: BoundsMm,
): boolean {
  return polylineContainedInAabb(
    [measurement.startMm, measurement.endMm],
    rect,
  );
}

/** A measurement intersects when either endpoint or its line crosses the box. */
export function measurementIntersectsRect(
  measurement: PcbMeasurement,
  rect: BoundsMm,
): boolean {
  return polylineIntersectsAabb([measurement.startMm, measurement.endMm], rect);
}
