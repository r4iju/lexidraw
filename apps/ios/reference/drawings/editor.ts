/// <reference lib="dom" />
/**
 * The web editor, driven step by step by the recorder: the same pointer,
 * keyboard and tool steps the iOS editor replays in `DrawingKitTests`, so
 * both can be compared by the elements they leave.
 *
 * Pointer steps are dispatched as the pointer events a finger or a pencil
 * makes, straight to the canvas the editor listens on, so they carry the
 * pointer type and pressure an iPad would. A finger, like a mouse, reports
 * the 0.5 a pointer without pressure has while pressed. A double tap is the
 * editor's double click, after the two taps it follows.
 */
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import type { Step } from "./interactions.js";

type Played = Exclude<Step, { type: string } | { press: string }>;

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
    load: (elements: unknown[]) => Promise<void>;
    play: (step: Played) => Promise<void>;
    elements: () => unknown[];
  }
}

window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/`;

const host = document.createElement("div");
host.style.cssText = "position:fixed;left:0;top:0;width:1200px;height:800px";
document.body.style.margin = "0";
document.body.append(host);

/** Lets the editor's frame-throttled handlers run, as between two events. */
const nextFrame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

let api: ExcalidrawImperativeAPI | undefined;
let pointer = { type: "touch", pressure: 0.5 };

window.load = async (elements) => {
  api = await new Promise<ExcalidrawImperativeAPI>((resolve) => {
    createRoot(host).render(
      createElement(Excalidraw, {
        initialData: {
          elements: elements as never,
          appState: { viewBackgroundColor: "#ffffff" },
        },
        excalidrawAPI: resolve,
      }),
    );
  });
  // The editor measures text as soon as it is placed, and a face still
  // loading measures as the fallback; iOS has its fonts from the start. A
  // loaded face reaches canvases a few frames later, so this waits until
  // text measures differently from how it measured before.
  const measure = () => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return 0;
    context.font = "20px Excalifont, Xiaolai, Segoe UI Emoji";
    return context.measureText(" Hello").width;
  };
  const fallback = measure();
  await Promise.all(
    [...document.fonts]
      .filter((face) => face.family.includes("Excalifont"))
      .map((face) => face.load()),
  );
  for (let frame = 0; frame < 120 && measure() === fallback; frame++) {
    await nextFrame();
  }
  await nextFrame();
};

function dispatch(kind: string, [x, y]: [number, number], pressure?: number) {
  const canvas = document.querySelector("canvas.interactive");
  if (!canvas) throw new Error("The editor has no canvas");
  const down = kind !== "pointerup";
  canvas.dispatchEvent(
    new PointerEvent(kind, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: pointer.type,
      isPrimary: true,
      button: 0,
      buttons: down ? 1 : 0,
      pressure: down ? (pressure ?? pointer.pressure) : 0,
    }),
  );
}

window.play = async (step) => {
  if ("tool" in step) {
    api?.setActiveTool({ type: step.tool });
  } else if ("down" in step) {
    pointer = {
      type: step.pointer ?? "touch",
      pressure: step.pressure ?? 0.5,
    };
    // A press focuses the editor, which is where it listens for keys.
    document.querySelector<HTMLElement>(".excalidraw-container")?.focus();
    dispatch("pointerdown", step.down);
  } else if ("move" in step) {
    dispatch("pointermove", step.move, step.pressure);
  } else if ("doubleTap" in step) {
    const [x, y] = step.doubleTap;
    document
      .querySelector("canvas.interactive")
      ?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }),
      );
  } else {
    dispatch("pointerup", step.up);
  }
  await nextFrame();
};

window.elements = () => [...(api?.getSceneElementsIncludingDeleted() ?? [])];
