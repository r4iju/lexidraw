import { type ExcalidrawElement, } from "@excalidraw/excalidraw/types/element/types";
import { type AppState as ExcalidrawAppState } from "@excalidraw/excalidraw/types/types";
import { z } from "zod";

export const CreateDrawing = z.object({
  id: z.string(),
  title: z.string(),
});

export type CreateDrawing = z.infer<typeof CreateDrawing>

export const ElementSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "selection", "rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "image", "frame", "embeddable"]),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  version: z.number(),
  versionNonce: z.number(),
  isDeleted: z.boolean(),
  fillStyle: z.enum(["solid", "hachure", "cross-hatch", "zigzag"]),
  strokeWidth: z.number(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]),
  roughness: z.number(),
  opacity: z.number(),
  angle: z.number(),
  strokeColor: z.string(),
  backgroundColor: z.string(),
  seed: z.number(),
  // groupIds: z.array(z.string()).or(z.array(z.string()).readonly()),
  groupIds: z.any(),
  frameId: z.string().nullable(),
  roundness: z.any().optional(),
  // boundElements: z.array(BoundElement).or(z.array(BoundElement).readonly()).nullable(),
  boundElements: z.any(),
  updated: z.number(),
  link: z.string().nullable(),
  locked: z.boolean(),
  text: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.number().optional(),
  textAlign: z.string().optional(),
  verticalAlign: z.string().optional(),
  baseline: z.number().optional(),
  containerId: z.string().nullable().optional(),
  originalText: z.string().optional(),
  lineHeight: z.number().optional(),
})

export type ElementSchema = z.infer<typeof ElementSchema>

export const AppStateSchema = z.object({
  showWelcomeScreen: z.boolean(),
  theme: z.enum(["light", "dark"]),
  collaborators: z.map(z.string(), z.any()).optional(),
  currentChartType: z.enum(["bar", "line"]),
  currentItemBackgroundColor: z.string(),
  currentItemEndArrowhead: z.any().nullable(),
  currentItemFillStyle: ElementSchema.shape.fillStyle,
  currentItemFontFamily: z.number(),
  currentItemFontSize: z.number(),
  currentItemOpacity: z.number(),
  currentItemRoughness: z.number(),
  currentItemStartArrowhead: z.enum(["arrow", "bar", "dot", "triangle"]).nullable(),
  currentItemStrokeColor: z.string(),
  currentItemRoundness: z.enum(["round", "sharp"]),
  currentItemStrokeStyle: ElementSchema.shape.strokeStyle,
  currentItemStrokeWidth: z.number(),
  currentItemTextAlign: z.string(),
  cursorButton: z.enum(["up", "down"]),
  activeEmbeddable: z.any(),
  draggingElement: z.any(),
  editingElement: z.any(),
  editingGroupId: z.string().nullable(),
  editingLinearElement: z.any().nullable(),
  activeTool: z.any(),
  penMode: z.boolean(),
  penDetected: z.boolean(),
  errorMessage: z.any().nullable(),
  exportBackground: z.boolean(),
  exportScale: z.number(),
  exportEmbedScene: z.boolean(),
  exportWithDarkMode: z.boolean(),
  fileHandle: z.string().nullable(),
  gridSize: z.number().nullable(),
  isBindingEnabled: z.boolean(),
  defaultSidebarDockedPreference: z.boolean(),
  isLoading: z.boolean(),
  isResizing: z.boolean(),
  isRotating: z.boolean(),
  lastPointerDownWith: z.enum(["mouse", "touch", "pen"]),
  multiElement: z.any(),
  name: z.string(),
  contextMenu: z.object({
    items: z.array(z.any()),
    top: z.number(),
    left: z.number(),
  }).nullable(),
  openMenu: z.enum(["canvas", "shape"]).nullable(),
  openPopup: z.enum(["canvasBackground", "elementBackground", "elementStroke"]).nullable(),
  openSidebar: z.object({
    name: z.string(),
    tab: z.string().optional(),
  }).nullable(),
  openDialog: z.enum(["imageExport", "help", "jsonExport", "mermaid"]).nullable(),
  pasteDialog: z.any(),
  previousSelectedElementIds: z.object({}),
  resizingElement: z.any(),
  scrolledOutside: z.boolean(),
  scrollX: z.number(),
  scrollY: z.number(),
  selectedElementIds: z.object({}),
  selectedGroupIds: z.object({}),
  selectedElementsAreBeingDragged: z.boolean(),
  selectionElement: z.any(),
  shouldCacheIgnoreZoom: z.boolean(),
  showStats: z.boolean(),
  startBoundElement: z.any().nullable(),
  suggestedBindings: z.array(z.any()),
  frameRendering: z.object({
    enabled: z.boolean(),
    clip: z.boolean(),
    name: z.boolean(),
    outline: z.boolean(),
  }),
  frameToHighlight: z.any(),
  editingFrame: z.string().nullable(),
  elementsToHighlight: z.array(z.any()).nullable(),
  toast: z.object({
    message: z.string(),
    closable: z.boolean().optional(),
    duration: z.number().optional(),
  }).nullable(),
  viewBackgroundColor: z.string(),
  zenModeEnabled: z.boolean(),
  zoom: z.any(),
  viewModeEnabled: z.boolean(),
  pendingImageElementId: z.string().nullable(),
  showHyperlinkPopup: z.enum(["info", "editor"]).or(z.literal(false)),
  selectedLinearElement: z.any().nullable(),
  snapLines: z.any(),
  originSnapOffset: z.object({
    x: z.number(),
    y: z.number(),
  }).nullable(),
  objectsSnapModeEnabled: z.boolean(),
  offsetLeft: z.number(),
  offsetTop: z.number(),
  width: z.number(),
  height: z.number(),
})

export type AppStateSchema = z.infer<typeof AppStateSchema>

// Example of making a compatibility check function
function assertTypeCompatibility<T>(a: T): T {
  return a;
}

/* These are just to make sure that the types are compatible with Excalidraw's types */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const testElement: ElementSchema = assertTypeCompatibility<ExcalidrawElement>(undefined as never);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const testAppState: AppStateSchema = assertTypeCompatibility<ExcalidrawAppState>(undefined as never);

export const SaveDrawing = z.object({
  id: z.string(),
  title: z.string().optional(),
  elements: z.array(ElementSchema).readonly(),
  appState: AppStateSchema,
  // appState: z.string(),
})

export type SaveDrawing = z.infer<typeof SaveDrawing>