import { JSDOM } from "jsdom";

/** The globals the shim owns, restored to what they were on the way out. */
const SHIMMED = [
  "window",
  "self",
  "top",
  "parent",
  "document",
  "navigator",
  "location",
  "devicePixelRatio",
  "Element",
  "HTMLElement",
  "Node",
  "FontFace",
] as const;

let shim: Record<string, unknown> | undefined;
let depth = 0;

/**
 * Enough of a browser for `@excalidraw/excalidraw` to be imported on the
 * server. The package is the editor, so it reads `window`, `document`, a 2d
 * canvas context and the font APIs while its modules evaluate, long before any
 * React renders. Nothing here draws: the canvas is a stub, and text is
 * measured by the provider `converter.ts` installs.
 */
function buildShim(): Record<string, unknown> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;

  const context2d = {
    filter: "none",
    font: "",
    measureText: (text: string) => ({ width: text.length * 10 }),
    beginPath() {},
    clearRect() {},
    closePath() {},
    drawImage() {},
    fill() {},
    fillRect() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    lineTo() {},
    moveTo() {},
    putImageData() {},
    restore() {},
    save() {},
    scale() {},
    stroke() {},
    translate() {},
  };
  window.HTMLCanvasElement.prototype.getContext = (() => context2d) as never;

  // jsdom has no font loading, and the editor registers its own fonts on
  // import; the registrations are never used because nothing is rasterized.
  class FontFaceStub {
    readonly family: string;
    readonly status = "loaded";
    constructor(family: string) {
      this.family = family;
    }
    load() {
      return Promise.resolve(this);
    }
  }
  Object.defineProperty(window.document, "fonts", {
    configurable: true,
    value: {
      add() {},
      check: () => true,
      clear() {},
      delete: () => true,
      forEach() {},
      load: async () => [],
      ready: Promise.resolve(undefined),
      [Symbol.iterator]: function* () {},
    },
  });

  return {
    window,
    self: window,
    top: window,
    parent: window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    devicePixelRatio: 1,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    FontFace: FontFaceStub,
  };
}

/**
 * Browser globals, for as long as it takes to run `body` and no longer.
 *
 * These globals are process-wide, and this process also server-renders pages:
 * a `window` left behind makes every later render take the browser branch of
 * whatever it tests for, which is how a page that degrades cleanly on the
 * server starts producing markup the client then has to disagree with. Scoping
 * them costs nothing because conversion is synchronous, so nothing else runs
 * while they are in place.
 */
export function withDomShim<T>(body: () => T): T {
  const previous = install();
  try {
    return body();
  } finally {
    restore(previous);
  }
}

/**
 * The same, around a module that reads the DOM while it evaluates. The await
 * is the one point where another request can observe the globals; it happens
 * once per process, on the first drawing written.
 */
export async function importWithDomShim<T>(load: () => Promise<T>): Promise<T> {
  const previous = install();
  try {
    return await load();
  } finally {
    restore(previous);
  }
}

type Saved = Map<string, PropertyDescriptor | undefined>;

function install(): Saved | undefined {
  depth += 1;
  if (depth > 1) return undefined;
  shim ??= buildShim();
  const previous: Saved = new Map();
  for (const name of SHIMMED) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    // Defined rather than assigned: Node already exposes some of these, and
    // `navigator` in particular is a getter, so `globalThis.navigator = ...`
    // throws.
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: shim[name],
    });
  }
  return previous;
}

function restore(previous: Saved | undefined): void {
  depth -= 1;
  if (!previous) return;
  for (const [name, descriptor] of previous) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[name];
    }
  }
}
