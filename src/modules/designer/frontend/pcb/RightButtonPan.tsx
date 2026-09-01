import { useThree } from "@react-three/fiber";
import { useEffect, useRef, type ReactElement } from "react";
import * as THREE from "three";
import type {
  InteractionCoordinateTransform,
  InteractionEvent,
  InteractionHandler,
} from "../../../../shared/frontend/canvas/interaction/types";

const PAN_THRESHOLD_PX = 5;

interface PanSession {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  previousCanvasCursor: string;
  previousCanvasCursorPriority: string;
  previousBodyCursor: string;
  previousBodyCursorPriority: string;
}

interface RightButtonPanProps {
  interactionHandler: InteractionHandler;
  interactionCoordinateTransform: InteractionCoordinateTransform;
}

/**
 * PCB-specific right-button navigation. A drag pans the orthographic camera;
 * a stationary right click replays the existing PCB context-menu event.
 */
export function RightButtonPan({
  interactionHandler,
  interactionCoordinateTransform,
}: RightButtonPanProps): ReactElement | null {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const sessionRef = useRef<PanSession | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;

    const consume = (event: PointerEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const release = () => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      canvas.style.setProperty(
        "cursor",
        session.previousCanvasCursor,
        session.previousCanvasCursorPriority,
      );
      document.body.style.setProperty(
        "cursor",
        session.previousBodyCursor,
        session.previousBodyCursorPriority,
      );
    };

    const buildContextEvent = (event: PointerEvent): InteractionEvent => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector3(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
        0,
      );
      ndc.unproject(camera);
      const worldPoint = interactionCoordinateTransform.scenePointToWorldPoint({
        x: ndc.x,
        y: ndc.y,
      });
      return {
        worldPoint,
        snappedPoint: worldPoint,
        screenPoint: { x: event.clientX, y: event.clientY },
        modifiers: {
          shift: event.shiftKey,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          alt: event.altKey,
        },
        button: 2,
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 2) return;
      consume(event);
      sessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        previousCanvasCursor: canvas.style.getPropertyValue("cursor"),
        previousCanvasCursorPriority:
          canvas.style.getPropertyPriority("cursor"),
        previousBodyCursor: document.body.style.getPropertyValue("cursor"),
        previousBodyCursorPriority:
          document.body.style.getPropertyPriority("cursor"),
      };
      canvas.style.setProperty("cursor", "grabbing", "important");
      document.body.style.setProperty("cursor", "grabbing", "important");
    };

    const handlePointerMove = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      consume(event);
      canvas.style.setProperty("cursor", "grabbing", "important");
      document.body.style.setProperty("cursor", "grabbing", "important");
      let dx = event.clientX - session.lastX;
      let dy = event.clientY - session.lastY;
      if (!session.moved) {
        dx = event.clientX - session.startX;
        dy = event.clientY - session.startY;
        if (Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return;
        session.moved = true;
      }
      session.lastX = event.clientX;
      session.lastY = event.clientY;
      camera.position.x -= dx / camera.zoom;
      camera.position.y += dy / camera.zoom;
      camera.updateProjectionMatrix();
      invalidate();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      consume(event);
      const openMenu = !session.moved;
      release();
      if (openMenu) {
        interactionHandler.onContextMenu?.(buildContextEvent(event));
        invalidate();
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (sessionRef.current?.pointerId !== event.pointerId) return;
      consume(event);
      release();
    };

    const handleWindowBlur = () => release();

    canvas.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
      release();
    };
  }, [
    camera,
    gl,
    interactionCoordinateTransform,
    interactionHandler,
    invalidate,
  ]);

  return null;
}
