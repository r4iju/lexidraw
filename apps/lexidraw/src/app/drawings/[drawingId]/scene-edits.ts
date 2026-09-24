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
