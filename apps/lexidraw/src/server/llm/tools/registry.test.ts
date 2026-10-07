import { expect, test } from "bun:test";
import { getAvailableToolNames } from "./registry";

/** Every tool the agent once had for building and editing slide decks. */
const SLIDE_TOOLS = [
  "insertSlideDeckNode",
  "addSlidePage",
  "removeSlidePage",
  "reorderSlidePage",
  "setSlidePageBackground",
  "addBoxToSlidePage",
  "addImageToSlidePage",
  "addChartToSlidePage",
  "searchAndAddImageToSlidePage",
  "generateAndAddImageToSlidePage",
  "setDeckMetadata",
  "setSlideMetadata",
  "saveDeckTheme",
  "saveStoryboardOutput",
  "saveSlideContentAndMetadata",
  "updateElementProperties",
];

test("the agent is offered no tool that makes or edits a slide deck", () => {
  const tools = getAvailableToolNames();

  expect(tools).toContain("insertMarkdown");
  expect(tools.filter((name) => SLIDE_TOOLS.includes(name))).toEqual([]);
});
