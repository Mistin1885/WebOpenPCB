import type {
  PcbFreeHole,
  PcbFreePad,
  PcbOverlayText,
  PcbPointMm,
} from "../../../../sdks";

export type PrimitiveResizeCorner = "nw" | "ne" | "se" | "sw";

export type FreePrimitiveResizeTarget =
  | { kind: "freeHole"; value: PcbFreeHole }
  | { kind: "freePad"; value: PcbFreePad }
  | { kind: "overlayText"; value: PcbOverlayText };

export type FreePrimitiveResizeResult =
  | { kind: "freeHole"; value: PcbFreeHole }
  | { kind: "freePad"; value: PcbFreePad }
  | { kind: "overlayText"; value: PcbOverlayText };

const HOLE_OUTLINE_PADDING_MM = 0.5;
const PAD_OUTLINE_PADDING_MM = 0.3;
const TEXT_X_PADDING_MM = 0.4;
const TEXT_Y_PADDING_MM = 0.3;
const MIN_SIZE_MM = 0.1;

const CORNER_SIGNS: Record<
  PrimitiveResizeCorner,
  readonly [x: -1 | 1, y: -1 | 1]
> = {
  nw: [-1, 1],
  ne: [1, 1],
  se: [1, -1],
  sw: [-1, -1],
};

function rotate(point: PcbPointMm, degrees: number): PcbPointMm {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function toWorld(
  local: PcbPointMm,
  center: PcbPointMm,
  rotationDeg: number,
): PcbPointMm {
  const rotated = rotate(local, rotationDeg);
  return { x: center.x + rotated.x, y: center.y + rotated.y };
}

function toLocal(
  world: PcbPointMm,
  center: PcbPointMm,
  rotationDeg: number,
): PcbPointMm {
  return rotate(
    { x: world.x - center.x, y: world.y - center.y },
    -rotationDeg,
  );
}

function textHalfExtents(text: PcbOverlayText): PcbPointMm {
  return {
    x: (text.fontSizeMm * text.text.length * 0.6) / 2 + TEXT_X_PADDING_MM,
    y: text.fontSizeMm / 2 + TEXT_Y_PADDING_MM,
  };
}

export function primitiveResizeHandles(
  target: FreePrimitiveResizeTarget,
): ReadonlyArray<{ corner: PrimitiveResizeCorner; pointMm: PcbPointMm }> {
  let center: PcbPointMm;
  let rotationDeg = 0;
  let halfExtents: PcbPointMm;

  if (target.kind === "freeHole") {
    center = target.value.centerMm;
    const half = target.value.drillMm / 2 + HOLE_OUTLINE_PADDING_MM;
    halfExtents = { x: half, y: half };
  } else if (target.kind === "freePad") {
    center = target.value.centerMm;
    rotationDeg = target.value.rotationDeg;
    halfExtents = {
      x: target.value.widthMm / 2 + PAD_OUTLINE_PADDING_MM,
      y: target.value.heightMm / 2 + PAD_OUTLINE_PADDING_MM,
    };
  } else {
    center = target.value.positionMm;
    rotationDeg = target.value.rotationDeg;
    halfExtents = textHalfExtents(target.value);
  }

  return (Object.keys(CORNER_SIGNS) as PrimitiveResizeCorner[]).map(
    (corner) => {
      const [sx, sy] = CORNER_SIGNS[corner];
      return {
        corner,
        pointMm: toWorld(
          { x: sx * halfExtents.x, y: sy * halfExtents.y },
          center,
          rotationDeg,
        ),
      };
    },
  );
}

export function hitPrimitiveResizeHandle(
  target: FreePrimitiveResizeTarget,
  pointMm: PcbPointMm,
  toleranceMm: number,
): PrimitiveResizeCorner | null {
  let best: { corner: PrimitiveResizeCorner; distanceSq: number } | null = null;
  for (const handle of primitiveResizeHandles(target)) {
    const dx = handle.pointMm.x - pointMm.x;
    const dy = handle.pointMm.y - pointMm.y;
    const distanceSq = dx * dx + dy * dy;
    if (
      distanceSq <= toleranceMm * toleranceMm &&
      (!best || distanceSq < best.distanceSq)
    ) {
      best = { corner: handle.corner, distanceSq };
    }
  }
  return best?.corner ?? null;
}

/**
 * Resize around the opposite corner for pads/text. Holes intentionally keep
 * their centre fixed and change only diameter, so every result stays round.
 */
export function resizeFreePrimitive(
  target: FreePrimitiveResizeTarget,
  corner: PrimitiveResizeCorner,
  pointerMm: PcbPointMm,
): FreePrimitiveResizeResult {
  const [sx, sy] = CORNER_SIGNS[corner];

  if (target.kind === "freeHole") {
    const local = toLocal(pointerMm, target.value.centerMm, 0);
    const outlineRadius = (Math.abs(local.x) + Math.abs(local.y)) / 2;
    const radius = Math.max(
      MIN_SIZE_MM / 2,
      outlineRadius - HOLE_OUTLINE_PADDING_MM,
    );
    return {
      kind: target.kind,
      value: { ...target.value, drillMm: radius * 2 },
    };
  }

  if (target.kind === "freePad") {
    const pad = target.value;
    // Through-hole / standard pads must always retain copper outside their
    // drill. Keep a small positive annulus even when the dragged handle is
    // pulled past the opposite corner.
    const minimumPadSize = Math.max(
      MIN_SIZE_MM,
      pad.drillMm === null ? MIN_SIZE_MM : pad.drillMm + 0.01,
    );
    const half = {
      x: pad.widthMm / 2 + PAD_OUTLINE_PADDING_MM,
      y: pad.heightMm / 2 + PAD_OUTLINE_PADDING_MM,
    };
    const localPointer = toLocal(pointerMm, pad.centerMm, pad.rotationDeg);
    const opposite = { x: -sx * half.x, y: -sy * half.y };
    const width = Math.max(
      minimumPadSize,
      Math.abs(localPointer.x - opposite.x) - PAD_OUTLINE_PADDING_MM * 2,
    );
    const height = Math.max(
      minimumPadSize,
      Math.abs(localPointer.y - opposite.y) - PAD_OUTLINE_PADDING_MM * 2,
    );
    const resizedHalf = {
      x: width / 2 + PAD_OUTLINE_PADDING_MM,
      y: height / 2 + PAD_OUTLINE_PADDING_MM,
    };
    const centerLocal = {
      x: opposite.x + sx * resizedHalf.x,
      y: opposite.y + sy * resizedHalf.y,
    };
    return {
      kind: target.kind,
      value: {
        ...pad,
        centerMm: toWorld(centerLocal, pad.centerMm, pad.rotationDeg),
        widthMm: width,
        heightMm: height,
      },
    };
  }

  const text = target.value;
  const half = textHalfExtents(text);
  const localPointer = toLocal(pointerMm, text.positionMm, text.rotationDeg);
  const opposite = { x: -sx * half.x, y: -sy * half.y };
  const initialDiagonal = { x: sx * half.x * 2, y: sy * half.y * 2 };
  const draggedDiagonal = {
    x: localPointer.x - opposite.x,
    y: localPointer.y - opposite.y,
  };
  const denominator =
    initialDiagonal.x * initialDiagonal.x +
    initialDiagonal.y * initialDiagonal.y;
  const rawScale =
    (draggedDiagonal.x * initialDiagonal.x +
      draggedDiagonal.y * initialDiagonal.y) /
    denominator;
  const scale = Math.max(MIN_SIZE_MM / text.fontSizeMm, rawScale);
  const resizedHalf = {
    x: (text.fontSizeMm * scale * text.text.length * 0.6) / 2 +
      TEXT_X_PADDING_MM,
    y: (text.fontSizeMm * scale) / 2 + TEXT_Y_PADDING_MM,
  };
  const centerLocal = {
    x: opposite.x + sx * resizedHalf.x,
    y: opposite.y + sy * resizedHalf.y,
  };
  return {
    kind: target.kind,
    value: {
      ...text,
      positionMm: toWorld(centerLocal, text.positionMm, text.rotationDeg),
      fontSizeMm: text.fontSizeMm * scale,
    },
  };
}
