export interface PcbGridContrastStyle {
  coreColor: string;
  outlineColor: string;
}

const LIGHT_CANDIDATES = ["#f8fafc", "#e2e8f0", "#bae6fd"] as const;
const DARK_CANDIDATES = ["#020617", "#0f172a", "#111827"] as const;

function linearChannel(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) throw new Error(`Unsupported grid contrast color: ${color}`);
  const red = Number.parseInt(match[1]!, 16) / 255;
  const green = Number.parseInt(match[2]!, 16) / 255;
  const blue = Number.parseInt(match[3]!, 16) / 255;
  return (
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue)
  );
}

export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function bestMinimumContrast(
  candidates: readonly string[],
  backgrounds: readonly string[],
): string {
  return candidates.reduce((best, candidate) => {
    const candidateScore = Math.min(
      ...backgrounds.map((background) => contrastRatio(candidate, background)),
    );
    const bestScore = Math.min(
      ...backgrounds.map((background) => contrastRatio(best, background)),
    );
    return candidateScore > bestScore ? candidate : best;
  });
}

/**
 * Pick a high-contrast dot core for the current PCB surface palette and an
 * opposite-luminance outline. The two-tone mark remains identifiable where
 * a bright silkscreen or saturated copper feature crosses the dark canvas.
 */
export function resolvePcbGridContrast(
  backgrounds: readonly string[],
): PcbGridContrastStyle {
  const safeBackgrounds = backgrounds.length > 0 ? backgrounds : ["#0e1116"];
  const light = bestMinimumContrast(LIGHT_CANDIDATES, safeBackgrounds);
  const dark = bestMinimumContrast(DARK_CANDIDATES, safeBackgrounds);
  const lightScore = Math.min(
    ...safeBackgrounds.map((background) => contrastRatio(light, background)),
  );
  const darkScore = Math.min(
    ...safeBackgrounds.map((background) => contrastRatio(dark, background)),
  );
  return lightScore >= darkScore
    ? { coreColor: light, outlineColor: dark }
    : { coreColor: dark, outlineColor: light };
}
