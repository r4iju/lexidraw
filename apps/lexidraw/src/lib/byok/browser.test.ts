import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { installBrowserBoundary } from "./browser-boundary";
import { createByokSession } from "./session";

test("browser fetch, XHR, beacon, diagnostics and storage reject secrets before dispatch", async () => {
  const dom = new JSDOM("", { url: "https://lexidraw.test" });
  const window = dom.window;
  window.XMLHttpRequest.prototype.send = () => {};
  let calls = 0;
  window.fetch = async () => {
    calls++;
    return new Response();
  };
  window.navigator.sendBeacon = () => {
    calls++;
    return true;
  };
  const session = createByokSession(async () => {
    calls++;
    return new Response();
  }, window.location.origin);
  installBrowserBoundary(
    window as unknown as Window & typeof globalThis,
    session,
  );
  const secret = "sk-ant-distinctive-browser-guard";
  session.replace("openrouter", secret);
  await expect(
    window.fetch("/api/errors", { method: "POST", body: btoa(secret) }),
  ).rejects.toThrow("Credential egress blocked");
  expect(() => window.navigator.sendBeacon("/analytics", secret)).toThrow(
    "Credential egress blocked",
  );
  const xhr = new window.XMLHttpRequest();
  xhr.open("POST", "/api/upload");
  expect(() => xhr.send(JSON.stringify({ secret }))).toThrow(
    "Credential egress blocked",
  );
  expect(() => window.localStorage.setItem("key", secret)).toThrow(
    "Credential egress blocked",
  );
  expect(() => window.console.error({ error: secret })).toThrow(
    "Credential egress blocked",
  );
  expect(calls).toBe(0);
  dom.window.close();
});

test("a queued XHR cannot leak a key learned after request setup", () => {
  const dom = new JSDOM("", { url: "https://lexidraw.test" });
  const window = dom.window;
  window.XMLHttpRequest.prototype.send = () => {};
  const session = createByokSession(
    async () => new Response(),
    window.location.origin,
  );
  installBrowserBoundary(
    window as unknown as Window & typeof globalThis,
    session,
  );
  const xhr = new window.XMLHttpRequest();
  xhr.open("POST", "/api/upload?key=sk-or-queued-secret-distinctive");
  session.replace("openrouter", "sk-or-queued-secret-distinctive");
  expect(() => xhr.send("safe")).toThrow("Credential egress blocked");
  dom.window.close();
});

test("persistent browser writes cannot receive a credential", () => {
  const dom = new JSDOM("", { url: "https://lexidraw.test" });
  const window = dom.window;
  const session = createByokSession(
    async () => new Response(),
    window.location.origin,
  );
  installBrowserBoundary(
    window as unknown as Window & typeof globalThis,
    session,
  );
  const secret = "sk-or-persistent-leak-distinctive";
  session.replace("openrouter", secret);
  expect(() => {
    window.localStorage.credential = secret;
  }).toThrow("Credential egress blocked");
  expect(() => {
    window.document.cookie = `key=${secret}`;
  }).toThrow("Credential egress blocked");
  expect(window.localStorage.length).toBe(0);
  expect(window.document.cookie).toBe("");
  dom.window.close();
});

test("SDK error diagnostics cannot expose credential-bearing custom fields", () => {
  const dom = new JSDOM("", { url: "https://lexidraw.test" });
  const window = dom.window;
  window.console.error = () => {};
  const session = createByokSession(
    async () => new Response(),
    window.location.origin,
  );
  installBrowserBoundary(
    window as unknown as Window & typeof globalThis,
    session,
  );
  const secret = "sk-or-sdk-error-custom-fields-distinctive";
  session.replace("openrouter", secret);
  const error = Object.assign(new Error("Provider failed"), {
    request: { headers: { authorization: secret } },
  });
  expect(() => window.console.error(error)).toThrow(
    "Credential egress blocked",
  );
  dom.window.close();
});
