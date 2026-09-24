/**
 * Which changes to an open drawing are the user's, over scene fingerprints
 * (see `use-synced-excalidraw.ts`).
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

  /** The editor now shows a stored scene, loaded like any other. */
  replaced(scene: string): void {
    this.baseline = scene;
    this.touchedSinceLoad = false;
  }

  /** The server now stores this scene. */
  saved(scene: string): void {
    this.baseline = scene;
  }

  hasLocalEdits(scene: string): boolean {
    return scene !== this.baseline;
  }
}
