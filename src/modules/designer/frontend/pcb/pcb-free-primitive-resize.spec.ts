import { describe, expect, test } from "bun:test";
import type { PcbFreeHole, PcbFreePad, PcbOverlayText } from "../../../../sdks";
import {
  hitPrimitiveResizeHandle,
  primitiveResizeHandles,
  resizeFreePrimitive,
} from "./pcb-free-primitive-resize";

const hole: PcbFreeHole = {
  id: "hole-1",
  centerMm: { x: 10, y: 20 },
  drillMm: 2,
  lockedAt: null,
};

const pad: PcbFreePad = {
  id: "pad-1",
  centerMm: { x: 0, y: 0 },
  rotationDeg: 0,
  padType: "smd",
  shape: "rect",
  widthMm: 2,
  heightMm: 1,
  drillMm: null,
  layer: "F.Cu",
  netId: null,
  solderMaskExpansionMm: null,
  solderPasteExpansionMm: null,
  lockedAt: null,
};

const text: PcbOverlayText = {
  id: "text-1",
  layer: "F.SilkS",
  positionMm: { x: 0, y: 0 },
  text: "PCB",
  fontSizeMm: 1,
  rotationDeg: 0,
  mirror: false,
  justify: "center",
  lockedAt: null,
};

describe("free primitive resize", () => {
  test("finds all four visible corner handles", () => {
    const handles = primitiveResizeHandles({ kind: "freePad", value: pad });
    expect(handles.map((handle) => handle.corner)).toEqual([
      "nw",
      "ne",
      "se",
      "sw",
    ]);
    expect(
      hitPrimitiveResizeHandle(
        { kind: "freePad", value: pad },
        handles[1]!.pointMm,
        0.1,
      ),
    ).toBe("ne");
  });

  test("resizes a pad around its opposite corner", () => {
    const result = resizeFreePrimitive(
      { kind: "freePad", value: pad },
      "ne",
      { x: 2.3, y: 1.8 },
    );
    expect(result.kind).toBe("freePad");
    if (result.kind !== "freePad") return;
    expect(result.value.widthMm).toBeCloseTo(3);
    expect(result.value.heightMm).toBeCloseTo(2);
    expect(result.value.centerMm.x).toBeCloseTo(0.5);
    expect(result.value.centerMm.y).toBeCloseTo(0.5);
  });

  test("keeps a drilled pad larger than its drill at minimum size", () => {
    const drilledPad: PcbFreePad = {
      ...pad,
      padType: "std",
      drillMm: 0.8,
    };
    const result = resizeFreePrimitive(
      { kind: "freePad", value: drilledPad },
      "ne",
      { x: -1.3, y: -0.8 },
    );
    expect(result.kind).toBe("freePad");
    if (result.kind !== "freePad") return;
    expect(result.value.widthMm).toBeCloseTo(0.81);
    expect(result.value.heightMm).toBeCloseTo(0.81);
    expect(result.value.widthMm).toBeGreaterThan(drilledPad.drillMm!);
    expect(result.value.heightMm).toBeGreaterThan(drilledPad.drillMm!);
    // The south-west outline corner remains anchored at its original point.
    expect(result.value.centerMm.x - result.value.widthMm / 2).toBeCloseTo(-1);
    expect(result.value.centerMm.y - result.value.heightMm / 2).toBeCloseTo(
      -0.5,
    );
  });

  test("keeps a hole circular and its centre fixed", () => {
    const result = resizeFreePrimitive(
      { kind: "freeHole", value: hole },
      "ne",
      { x: 12.5, y: 22.5 },
    );
    expect(result.kind).toBe("freeHole");
    if (result.kind !== "freeHole") return;
    expect(result.value.centerMm).toEqual(hole.centerMm);
    expect(result.value.drillMm).toBe(4);
  });

  test("scales text uniformly while anchoring the opposite corner", () => {
    const handles = primitiveResizeHandles({ kind: "overlayText", value: text });
    const ne = handles.find((handle) => handle.corner === "ne")!;
    const result = resizeFreePrimitive(
      { kind: "overlayText", value: text },
      "ne",
      { x: ne.pointMm.x * 2, y: ne.pointMm.y * 2 },
    );
    expect(result.kind).toBe("overlayText");
    if (result.kind !== "overlayText") return;
    expect(result.value.fontSizeMm).toBeGreaterThan(text.fontSizeMm);
    expect(result.value.positionMm.x).toBeGreaterThan(0);
    expect(result.value.positionMm.y).toBeGreaterThan(0);
  });
});
