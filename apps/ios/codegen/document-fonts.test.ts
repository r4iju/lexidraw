import { expect, test } from "bun:test";
import { embedRenderRequest } from "../../lexidraw/src/lib/embed-render-contract";
import { documentSettingsScript } from "./document-fonts";

test("every document font stack native resolves is accepted by the embed renderer", async () => {
  const context: {
    documentSettingsMetadata?: (elements: string, appState: string) => string;
  } = {};
  new Function("globalThis", await documentSettingsScript())(context);
  const elements = JSON.stringify({ root: { type: "root", children: [] } });
  const fonts = [
    null,
    "sans",
    "serif",
    "mono",
    "Fredoka",
    "Inter",
    "Ubuntu Mono",
    "M PLUS Rounded 1c",
    "Noto Sans JP",
    "Noto Sans SC",
    "Noto Sans TC",
    "Noto Sans KR",
    "Source Serif 4",
    "Noto Serif JP",
    "Noto Serif SC",
    "Noto Serif TC",
    "Noto Serif KR",
    "Yusei Magic",
    "Kosugi Maru",
    "Sawarabi Mincho",
    "Times New Roman",
  ];
  for (const lang of [null, "en", "ja", "zh", "zh-Hant", "zh-TW", "ko"])
    for (const defaultFontFamily of fonts) {
      const { fontFamily } = JSON.parse(
        context.documentSettingsMetadata?.(
          elements,
          JSON.stringify({ lang, defaultFontFamily }),
        ) ?? "{}",
      );
      const request = {
        node: { type: "equation", equation: "x", inline: false },
        theme: "light",
        width: 390,
        fontFamily,
        fontSize: 17,
      };
      expect(
        embedRenderRequest.safeParse(request).error?.issues,
        `${lang} ${defaultFontFamily}`,
      ).toBeUndefined();
    }
});
