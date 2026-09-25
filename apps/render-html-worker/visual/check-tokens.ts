import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";

export async function checkTokens(page: Page) {
  await page.goto(`${appUrl}/signin`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector('input[name="email"]');
  await page.addStyleTag({
    content: "*, ::before, ::after { transition: none !important; }",
  });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      for (const name of ["light", "dark"])
        document.documentElement.classList.toggle(name, name === value);
    }, theme);
    const result = await page.evaluate(() => {
      const probe = document.createElement("div");
      document.body.append(probe);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const maybeContext = canvas.getContext("2d");
      if (!maybeContext) throw new Error("Canvas unavailable");
      const context = maybeContext;
      function rgb(value: string) {
        probe.style.backgroundColor = value;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(probe).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      }
      function luminance(value: string) {
        const [r, g, b] = rgb(value).map((channel) => {
          const c = channel / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      }
      function contrast(a: string, b: string) {
        const x = luminance(a);
        const y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      }
      const primary = document.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      const input = document.querySelector<HTMLInputElement>(
        'input[name="email"]',
      );
      if (!primary || !input) throw new Error("Missing sign-in controls");
      const buttonStyle = getComputedStyle(primary);
      const inputStyle = getComputedStyle(input);
      const measurements = {
        primary: contrast(buttonStyle.color, buttonStyle.backgroundColor),
        muted: contrast("var(--muted-foreground)", "var(--popover)"),
        destructive: contrast("var(--destructive)", "var(--popover)"),
        input: contrast(inputStyle.borderColor, inputStyle.backgroundColor),
        switchOff: contrast("var(--switch-thumb)", "var(--switch-track)"),
        switchOn: contrast("var(--primary-foreground)", "var(--primary)"),
        layers: ["--background", "--card", "--popover", "--accent"].map((v) =>
          luminance(`var(${v})`),
        ),
        accent: rgb("var(--accent)"),
        font: getComputedStyle(document.body).fontFamily,
      };
      probe.remove();
      return measurements;
    });
    console.log(theme, result);
    assert.ok(result.primary >= 4.5, `${theme}: primary label contrast`);
    assert.ok(result.muted >= 4.5, `${theme}: muted text contrast`);
    assert.ok(result.destructive >= 4.5, `${theme}: destructive text contrast`);
    assert.ok(
      result.switchOff >= 3 && result.switchOn >= 3,
      `${theme}: switch thumb contrast`,
    );
    assert.ok(
      result.input >= 1.2 && result.input < 2,
      `${theme}: input edge visible but soft`,
    );
    assert.ok(
      Math.max(...result.accent) - Math.min(...result.accent) < 12,
      `${theme}: neutral hover`,
    );
    assert.ok(
      !result.font.toLowerCase().includes("fredoka"),
      `${theme}: neutral UI font`,
    );
    if (theme === "dark") {
      assert.ok(
        result.layers.every((l, i, layers) => i === 0 || l > layers[i - 1]!),
        "Raised dark surfaces are lighter",
      );
    }
  }
}
