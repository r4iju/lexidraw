import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceAgentView } from "./device-view";
test("device composer explains uncertainty, saved edits and zero Pro debit", () => {
  const html = renderToStaticMarkup(
    <DeviceAgentView
      checkpoint={null}
      available={false}
      keyAvailable={false}
      onStart={() => {}}
      onResume={() => {}}
      onStop={() => {}}
    />,
  );
  expect(html).toContain("No Pro credits");
  expect(html).toContain("OpenRouter");
  expect(html).toContain("Search");
  expect(html).not.toContain("model selector");
});
