// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { InteractionHandler } from "../../../../shared/frontend/canvas/interaction/types";

const fiberState = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(fiberState.current ?? {}),
}));

import { RightButtonPan } from "./RightButtonPan";

afterEach(() => {
  document.body.replaceChildren();
  fiberState.current = null;
});

describe("RightButtonPan", () => {
  test("keeps panning across prop rerenders until the right button is released", async () => {
    const canvas = document.createElement("canvas");
    const capturedPointers = new Set<number>();
    canvas.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
    canvas.releasePointerCapture = (pointerId) =>
      void capturedPointers.delete(pointerId);
    canvas.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
    document.body.append(canvas);

    const host = document.createElement("div");
    document.body.append(host);
    const camera = new THREE.OrthographicCamera();
    camera.zoom = 10;
    fiberState.current = {
      camera,
      gl: { domElement: canvas },
      invalidate: vi.fn(),
    };
    const coordinateTransform = {
      sceneUnit: "mm" as const,
      worldUnit: "nm" as const,
      yAxis: "up" as const,
      scenePointToWorldPoint: (point: { x: number; y: number }) => point,
    };
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RightButtonPan
          interactionHandler={{} as InteractionHandler}
          interactionCoordinateTransform={coordinateTransform}
        />,
      );
    });

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 2,
        buttons: 2,
        clientX: 100,
        clientY: 100,
        pointerId: 7,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        buttons: 2,
        clientX: 120,
        clientY: 100,
        pointerId: 7,
      }),
    );
    expect(camera.position.x).toBe(-2);

    await act(async () => {
      root.render(
        <RightButtonPan
          interactionHandler={{ onContextMenu: vi.fn() }}
          interactionCoordinateTransform={coordinateTransform}
        />,
      );
    });
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        buttons: 2,
        clientX: 150,
        clientY: 100,
        pointerId: 7,
      }),
    );
    expect(camera.position.x).toBe(-5);

    window.dispatchEvent(
      new PointerEvent("pointerup", {
        button: 2,
        clientX: 150,
        clientY: 100,
        pointerId: 7,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        buttons: 0,
        clientX: 180,
        clientY: 100,
        pointerId: 7,
      }),
    );
    expect(camera.position.x).toBe(-5);

    await act(async () => root.unmount());
  });
});
