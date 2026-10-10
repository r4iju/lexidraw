import type { createByokSession } from "./session";

type Session = ReturnType<typeof createByokSession>;
type Browser = Pick<
  Window & typeof globalThis,
  | "FormData"
  | "Blob"
  | "Error"
  | "XMLHttpRequest"
  | "navigator"
  | "Storage"
  | "console"
  | "addEventListener"
  | "Document"
  | "document"
  | "localStorage"
  | "sessionStorage"
  | "IDBObjectStore"
> & {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};
export function installBrowserBoundary(browser: Browser, session: Session) {
  const check = (value: unknown) => {
    if (value == null) return;
    if (value instanceof Error || value instanceof browser.Error) {
      check(value.message);
      try {
        session.assertEgress(JSON.stringify(value));
      } catch {
        throw new Error("Credential egress blocked");
      }
      check(value.stack);
      check(value.cause);
      return;
    }
    if (typeof value === "string" || value instanceof URLSearchParams) {
      session.assertEgress(String(value));
    } else if (value instanceof browser.FormData) {
      for (const [name, entry] of value.entries()) {
        check(name);
        check(entry);
      }
    } else if (
      value instanceof browser.Blob ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value)
    ) {
      // Synchronous transports cannot inspect binary payloads before dispatch.
      if (session.protected()) throw new Error("Credential egress blocked");
    } else {
      try {
        session.assertEgress(JSON.stringify(value));
      } catch {
        throw new Error("Credential egress blocked");
      }
    }
  };
  browser.fetch = session.fetch;
  const xhr = browser.XMLHttpRequest.prototype;
  const metadata = new WeakMap<XMLHttpRequest, unknown[]>();
  const open = xhr.open;
  const send = xhr.send;
  const header = xhr.setRequestHeader;
  xhr.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    metadata.set(this, [url, username, password]);
    check(url);
    check(username);
    check(password);
    open.call(this, method, url, async, username, password);
  };
  xhr.setRequestHeader = function (name, value) {
    check(name);
    check(value);
    metadata.get(this)?.push(name, value);
    header.call(this, name, value);
  };
  xhr.send = function (body) {
    metadata.get(this)?.forEach(check);
    check(body);
    send.call(this, body);
  };
  if (browser.navigator.sendBeacon) {
    const beacon = browser.navigator.sendBeacon.bind(browser.navigator);
    browser.navigator.sendBeacon = (url, data) => {
      check(url);
      check(data);
      return beacon(url, data);
    };
  }
  const setItem = browser.Storage.prototype.setItem;
  browser.Storage.prototype.setItem = function (name, value) {
    check(name);
    check(value);
    setItem.call(this, name, value);
  };
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const storage = browser[name];
    const protectedStorage = new Proxy(storage, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, property, value) {
        check(String(property));
        check(value);
        return Reflect.set(target, property, value, target);
      },
      defineProperty(target, property, descriptor) {
        check(String(property));
        check(descriptor.value);
        return Reflect.defineProperty(target, property, descriptor);
      },
    });
    Object.defineProperty(browser, name, {
      configurable: true,
      get: () => protectedStorage,
    });
  }
  const cookie = Object.getOwnPropertyDescriptor(
    browser.Document.prototype,
    "cookie",
  );
  if (cookie?.set && cookie.get) {
    Object.defineProperty(browser.document, "cookie", {
      configurable: true,
      get: () => cookie.get?.call(browser.document),
      set: (value: string) => {
        check(value);
        cookie.set?.call(browser.document, value);
      },
    });
  }
  if (browser.IDBObjectStore) {
    for (const method of ["put", "add"] as const) {
      const write = browser.IDBObjectStore.prototype[method];
      browser.IDBObjectStore.prototype[method] = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        check(value);
        check(key);
        return write.call(this, value, key);
      };
    }
  }
  for (const method of ["log", "warn", "error", "info", "debug"] as const) {
    const write = browser.console[method].bind(browser.console);
    browser.console[method] = (...args: unknown[]) => {
      args.forEach(check);
      write(...args);
    };
  }
  browser.addEventListener("pagehide", () => session.remove());
  browser.addEventListener(
    "error",
    (event) => {
      try {
        check(event.message);
        check(event.error);
      } catch {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  browser.addEventListener(
    "unhandledrejection",
    (event) => {
      try {
        check(event.reason);
      } catch {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}
