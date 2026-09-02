import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import { RENDER_ORDER } from "../../../../shared/frontend/canvas/layers";

const vertexShader = /* glsl */ `
varying vec2 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xy;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = /* glsl */ `
uniform float uGridSize;
uniform float uMajorEvery;
uniform vec3 uCoreColor;
uniform vec3 uOutlineColor;
uniform float uMinSpacingPx;
varying vec2 vWorldPos;

float lineDistance(vec2 coord) {
  vec2 centered = abs(fract(coord - 0.5) - 0.5);
  vec2 width = max(fwidth(coord), vec2(0.000001));
  vec2 pixelDistance = centered / width;
  return min(pixelDistance.x, pixelDistance.y);
}

float levelVisibility(vec2 coord) {
  // Derive density from screen-space derivatives so the first demand-rendered
  // frame does not depend on a later useFrame uniform update.
  vec2 derivative = max(fwidth(coord), vec2(0.000001));
  float spacingPx = 1.0 / max(derivative.x, derivative.y);
  return smoothstep(uMinSpacingPx, uMinSpacingPx * 1.35, spacingPx);
}

void main() {
  vec2 minorCoord = vWorldPos / uGridSize;
  vec2 majorCoord = vWorldPos / (uGridSize * uMajorEvery);
  float minorVisibility = levelVisibility(minorCoord);
  float majorVisibility = levelVisibility(majorCoord);
  if (minorVisibility < 0.005 && majorVisibility < 0.005) discard;

  float minorDistance = lineDistance(minorCoord);
  float majorDistance = lineDistance(majorCoord);

  float minorOutline = 1.0 - smoothstep(0.8, 1.25, minorDistance);
  float minorCore = 1.0 - smoothstep(0.25, 0.55, minorDistance);
  float majorOutline = 1.0 - smoothstep(1.1, 1.6, majorDistance);
  float majorCore = 1.0 - smoothstep(0.35, 0.7, majorDistance);

  float outlineAlpha = max(
    minorOutline * 0.22 * minorVisibility,
    majorOutline * 0.34 * majorVisibility
  );
  float coreAlpha = max(
    minorCore * 0.36 * minorVisibility,
    majorCore * 0.55 * majorVisibility
  );
  float alpha = max(outlineAlpha, coreAlpha);
  if (alpha < 0.005) discard;

  float coreMix = clamp(
    max(minorCore * minorVisibility, majorCore * majorVisibility) * 1.4,
    0.0,
    1.0
  );
  vec3 color = mix(uOutlineColor, uCoreColor, coreMix);
  gl_FragColor = vec4(color, alpha);
}
`;

interface PcbAdaptiveGridProps {
  gridSize: number;
  majorEvery?: number;
  coreColor: string;
  outlineColor: string;
  minSpacingPx?: number;
}

export function PcbAdaptiveGrid({
  gridSize,
  majorEvery = 5,
  coreColor,
  outlineColor,
  minSpacingPx = 5,
}: PcbAdaptiveGridProps): ReactElement {
  const meshRef = useRef<THREE.Mesh>(null);
  const core = useMemo(() => new THREE.Color(coreColor), [coreColor]);
  const outline = useMemo(
    () => new THREE.Color(outlineColor),
    [outlineColor],
  );
  const uniforms = useMemo(
    () => ({
      uGridSize: { value: gridSize },
      uMajorEvery: { value: majorEvery },
      uCoreColor: { value: core },
      uOutlineColor: { value: outline },
      uMinSpacingPx: { value: minSpacingPx },
    }),
    [core, gridSize, majorEvery, minSpacingPx, outline],
  );

  uniforms.uGridSize.value = gridSize;
  uniforms.uMajorEvery.value = majorEvery;
  uniforms.uCoreColor.value.copy(core);
  uniforms.uOutlineColor.value.copy(outline);
  uniforms.uMinSpacingPx.value = minSpacingPx;

  useFrame(({ camera, viewport }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const orthographic = camera as THREE.OrthographicCamera;
    mesh.position.x = orthographic.position.x;
    mesh.position.y = orthographic.position.y;
    mesh.scale.x = viewport.width * 3;
    mesh.scale.y = viewport.height * 3;
  });

  return (
    <mesh
      ref={meshRef}
      renderOrder={RENDER_ORDER.METADATA - 0.5}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
