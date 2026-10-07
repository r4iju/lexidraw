import puppeteer, { type Page } from "puppeteer";
import { signInToDev } from "./src/index";

const app = "http://localhost:3041";
const out = "/tmp/remove-slides-evidence/after";
const KS = "17d46124-451a-4395-b79d-4848e4d0db96";
const mine = (await Bun.file("/tmp/remove-slides-evidence/doc-id").text()).trim();

const browser = await puppeteer.launch({ headless: true, userDataDir: "/tmp/remove-slides-evidence/browser" });
const blocked: string[] = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await signInToDev(page, app);

  // The shared kitchen sink is viewed, never written: every write is aborted.
  let guard = true;
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const url = request.url();
    if (guard && url.includes("/api/") && !url.includes("/api/auth/") && request.method() !== "GET") {
      blocked.push(`${request.method()} ${url}`);
      void request.abort();
    }
  });

  async function shoot(theme: "light" | "dark", width: number, name: string) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
    await page.setViewport({ width, height: 900, isMobile: width < 500, hasTouch: width < 500 });
    await page.goto(`${app}/documents/${KS}`, { waitUntil: "networkidle2" });
    await page.evaluate((t) => { document.documentElement.classList.toggle("dark", t === "dark"); }, theme);
    const deck = await page.waitForSelector('[data-node-type="slide-deck"]', { timeout: 60000 });
    await deck!.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: `${out}/${name}`, type: "png" });
    const texts = await page.$$eval('[data-node-type="slide-deck"]', (els) => els.map((el) => el.textContent));
    console.log(name, JSON.stringify(texts));
  }
  await shoot("light", 1280, "kitchen-sink-1280-light.png");
  await shoot("dark", 1280, "kitchen-sink-1280-dark.png");
  await shoot("light", 390, "kitchen-sink-390-light.png");
  await page.goto("about:blank");

  // My own document: select the placeholder, delete it, and let autosave write.
  guard = false;
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${app}/documents/${mine}`, { waitUntil: "networkidle2" });
  const deck = await page.waitForSelector('[data-node-type="slide-deck"]');
  await deck!.click();
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `${out}/verify-selected-1280-light.png` });
  await page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 300));
  console.log("decks after delete:", await page.$$eval('[data-node-type="slide-deck"]', (els) => els.length));
  await new Promise((r) => setTimeout(r, 6000));
  await page.screenshot({ path: `${out}/verify-deleted-1280-light.png` });
} finally {
  await browser.close();
  console.log("blocked writes while viewing the kitchen sink:", blocked.length, blocked.slice(0, 5));
}
