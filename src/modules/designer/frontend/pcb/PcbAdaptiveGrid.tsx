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
uniform float uPixelsPerUnit;
uniform float uMinSpacingPx;
varying vec2 vWorldPos;

float lineDistance(vec2 coord) {
  vec2 centered = abs(fract(coord - 0.5) - 0.5);
  vec2 width = max(fwidth(coord), vec2(0.000001));
  vec2 pixelDistance = centered / width;
  return min(pixelDistance.x, pixelDistance.y);
}

void main() {
  float gridPx = uGridSize * uPixelsPerUnit;
  if (gridPx < uMinSpacingPx) discard;

  float minorDistance = lineDistance(vWorldPos / uGridSize);
  float majorDistance = lineDistance(vWorldPos / (uGridSize * uMajorEvery));

  float minorOutline = 1.0 - smoothstep(1.35, 1.9, minorDistance);
  float minorCore = 1.0 - smoothstep(0.45, 0.85, minorDistance);
  float majorOutline = 1.0 - smoothstep(2.1, 2.8, majorDistance);
  float majorCore = 1.0 - smoothstep(0.9, 1.35, majorDistance);

  float outlineAlpha = max(minorOutline * 0.82, majorOutline);
  float coreAlpha = max(minorCore * 0.88, majorCore);
  float alpha = max(outlineAlpha, coreAlpha);
  if (alpha < 0.005) discard;

  float coreMix = clamp(coreAlpha * 1.55, 0.0, 1.0);
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
      uPixelsPerUnit: { value: 1 },
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
    uniforms.uPixelsPerUnit.value = orthographic.zoom;
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
