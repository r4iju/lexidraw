import { type LexicalNode, rawValue, withAccessors } from "lexical";
import { namedTransform, rawValueOr } from "../schema-values.js";

/** A width or height: pixels, or `inherit` for the size of what holds it. */
export type Size = "inherit" | number;

/** The fields images, video and YouTube embeds hold their size in. */
interface SizeFields {
  __width: Size;
  __height: Size;
}

/**
 * How images, video and YouTube embeds read and write their size: a size
 * that's no size at all is held as `inherit`, which is written as 0, and any
 * other value is kept as it was stored.
 */
export interface StoredSizeAccessors {
  getWidthJSON(): number;
  setWidthJSON(width: number): this;
  getHeightJSON(): number;
  setHeightJSON(height: number): this;
}

const writtenSize = (size: Size) => (size === "inherit" ? 0 : size);
const heldSize = (size: number): Size => size || "inherit";

const storedSizeAccessors = {
  getWidthJSON(this: SizeFields): number {
    return writtenSize(this.__width);
  },
  setWidthJSON<T extends SizeFields>(this: T, width: number): T {
    this.__width = heldSize(width);
    return this;
  },
  getHeightJSON(this: SizeFields): number {
    return writtenSize(this.__height);
  },
  setHeightJSON<T extends SizeFields>(this: T, height: number): T {
    this.__height = heldSize(height);
    return this;
  },
};

/** A stored size as it's written back: {@link StoredSizeAccessors}. */
const storedSizeValue = namedTransform(
  "storedSize",
  rawValue<Size>(),
  (size) => (!size || size === "inherit" ? 0 : size),
);

/**
 * The `width` and `height` schema entries for {@link StoredSizeAccessors}.
 * @internal
 */
export const storedSizeFields = {
  width: withAccessors(storedSizeValue, {
    getter: "getWidthJSON",
    setter: "setWidthJSON",
  }),
  height: withAccessors(storedSizeValue, {
    getter: "getHeightJSON",
    setter: "setHeightJSON",
  }),
};

/** Gives `klass` the {@link StoredSizeAccessors} its schema names. */
export function withStoredSize<
  T extends abstract new (
    ...args: never[]
  ) => LexicalNode & SizeFields & StoredSizeAccessors,
>(klass: T): T {
  Object.assign(klass.prototype, storedSizeAccessors);
  return klass;
}

/**
 * A chart's or diagram's size: `inherit` where it's absent, or 0, which is
 * how older documents stored an unset one.
 */
export const zeroAsInheritSize = namedTransform(
  "zeroAsInherit",
  rawValueOr<Size>("inherit"),
  (size) => (size === 0 ? "inherit" : size),
);

/** A drawing's size: `inherit` where it's absent or null. */
export const inheritOrStoredSize = rawValueOr<Size>("inherit", {
  nullAsAbsent: true,
});
