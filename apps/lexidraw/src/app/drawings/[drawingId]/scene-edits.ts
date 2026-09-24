import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * What a drawing save stores, as a string cheap to compare: the live
 * elements' versions, which every change to an element bumps, and the
 * background colour, the one piece of app state a save keeps. Scrolling and
 * zooming move neither.
 */
export function sceneKey(
  elements: readonly ExcalidrawElement[],
  appState?: { viewBackgroundColor?: string },
): string {
  let key = appState?.viewBackgroundColor ?? "";
  for (const element of elements) {
    if (!element.isDeleted) key += `,${element.id}@${element.version}`;
  }
  return key;
}

/**
 * Which changes to an open drawing are the user's, over scene keys.
 *
 * Excalidraw has no notion of who changed a scene: loading one and
 * re-measuring its text once the fonts arrive bump versions too. So the
 * baseline — the scene the server stores — follows the scene until the user
 * first touches the page, and only a change after that is an edit. A touch
 * that changes nothing, like panning, leaves the scene on the baseline.
 */
export class SceneEdits {
  private baseline: string;
  private touchedSinceLoad = false;
  /** A pointer is down: a drag goes on over whatever replaced the scene. */
  private pressing = false;

  constructor(scene: string) {
    this.baseline = scene;
  }

  /**
   * Excalidraw reported the scene. Answers whether it holds anything the
   * server does not store, which is whether there is anything to save.
   */
  changed(scene: string): boolean {
    if (!this.touchedSinceLoad) this.baseline = scene;
    return scene !== this.baseline;
  }

  /** The user pressed or typed somewhere on the page. */
  touched(): void {
    this.touchedSinceLoad = true;
  }

  /** A pointer went down: a touch that may outlast a reload. */
  pressed(): void {
    this.pressing = true;
    this.touched();
  }

  released(): void {
    this.pressing = false;
  }

  /** The editor now shows a stored scene, loaded like any other. */
  replaced(scene: string): void {
    this.baseline = scene;
    // A drag that began before the reload lands on the new scene; what it
    // changes there is the user's.
    this.touchedSinceLoad = this.pressing;
  }

  /** The server now stores this scene. */
  saved(scene: string): void {
    this.baseline = scene;
  }

  hasLocalEdits(scene: string): boolean {
    return scene !== this.baseline;
  }
}

/** What the user can touch a drawing with, from anywhere on the page. */
const TOUCHES = ["keydown", "paste", "drop"] as const;
/** What ends a press. */
const RELEASES = ["pointerup", "pointercancel"] as const;

/**
 * Tells `scene` about the user's input anywhere on the page, not only the
 * canvas: the library, the menus, and the dialogs change the scene too. A
 * touch that edits nothing costs a question at most, and an edit without a
 * touch would be replaced unasked. Answers a stop.
 */
export function watchPageInput(
  page: Window,
  scene: Pick<SceneEdits, "touched" | "pressed" | "released">,
): () => void {
  const touch = () => scene.touched();
  const press = () => scene.pressed();
  const release = () => scene.released();
  // The window losing focus covers a release the page never saw. Not
  // captured: a captured blur is every element's too, and pressing the canvas
  // blurs whatever button had focus while the press goes on.
  const leave = (event: Event) => {
    if (event.target === page) scene.released();
  };
  page.addEventListener("pointerdown", press, { capture: true });
  page.addEventListener("blur", leave);
  for (const type of TOUCHES) {
    page.addEventListener(type, touch, { capture: true });
  }
  for (const type of RELEASES) {
    page.addEventListener(type, release, { capture: true });
  }
  return () => {
    page.removeEventListener("pointerdown", press, { capture: true });
    page.removeEventListener("blur", leave);
    for (const type of TOUCHES) {
      page.removeEventListener(type, touch, { capture: true });
    }
    for (const type of RELEASES) {
      page.removeEventListener(type, release, { capture: true });
    }
  };
}
