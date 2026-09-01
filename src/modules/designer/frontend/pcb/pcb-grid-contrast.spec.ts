import { describe, expect, test } from "bun:test";
import {
  contrastRatio,
  resolvePcbGridContrast,
} from "./pcb-grid-contrast";

describe("PCB grid contrast", () => {
  test("chooses a light core for the dark PCB canvas palette", () => {
    const style = resolvePcbGridContrast([
      "#0e1116",
      "#15191f",
      "#ff0000",
      "#1e40af",
    ]);
    expect(contrastRatio(style.coreColor, "#0e1116")).toBeGreaterThan(8);
    expect(contrastRatio(style.coreColor, style.outlineColor)).toBeGreaterThan(
      10,
    );
  });

  test("chooses a dark core when all surfaces are light", () => {
    const style = resolvePcbGridContrast(["#ffffff", "#f8fafc", "#fde68a"]);
    expect(contrastRatio(style.coreColor, "#ffffff")).toBeGreaterThan(10);
    expect(contrastRatio(style.coreColor, style.outlineColor)).toBeGreaterThan(
      10,
    );
  });
});
