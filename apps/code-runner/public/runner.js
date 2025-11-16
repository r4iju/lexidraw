(function () {
  "use strict";

  /** @type {string[]} */
  const logs = [];
  function log() {
    try {
      const msg = Array.prototype.map
        .call(arguments, (x) => {
          try {
            return typeof x === "string" ? x : JSON.stringify(x);
          } catch {
            return String(x);
          }
        })
        .join(" ");
      logs.push(msg);
    } catch {
      // ignore logging errors
    }
  }

  /**
   * @param {any} initialDoc
   */
  function createHostApi(initialDoc) {
    /** @type {any} */ let nextDoc = undefined;
    return {
      getDocument: async function () {
        try {
          return JSON.parse(JSON.stringify(initialDoc));
        } catch {
          return initialDoc;
        }
      },
      setDocument: async function (doc) {
        nextDoc = doc;
        return true;
      },
      getSelection: async function () {
        // Optional: not implemented in this minimal runner
        return undefined;
      },
      log: log,
      /** @internal */
      __getNextDoc: function () {
        return nextDoc;
      },
    };
  }

  /**
   * Execute user code with a constrained API.
   * Supports patterns:
   * - module.exports = async function main(api) { ... }
   * - exports.default = async function main(api) { ... }
   * - return a result object with { newDoc? }
   * @param {string} code
   * @param {any} api
   */
  async function runUserCode(code, api) {
    const exports = {};
    const module = { exports };
    // Wrap code; return a callable or an object
    const factory = new Function(
      "api",
      "exports",
      "module",
      '"use strict";\n' +
        code +
        "\n;return module.exports?.default ?? exports.default ?? module.exports ?? exports;",
    );
    const entry = factory(api, exports, module);
    if (typeof entry === "function") {
      return await entry(api);
    }
    return entry;
  }

  /**
   * @param {MessageEvent} ev
   */
  function onMessage(ev) {
    try {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      const correlationId = data.correlationId;
      const code = data.code;
      if (typeof correlationId !== "string" || typeof code !== "string") {
        return;
      }
      const initialDoc = data.initialDoc;
      const api = createHostApi(initialDoc);
      Promise.resolve()
        .then(async () => {
          const result = await runUserCode(code, api);
          const nextDoc = api.__getNextDoc();
          /** @type {{ newDoc?: any, logs?: string[] }} */
          const envelope = {
            newDoc: nextDoc !== undefined ? nextDoc : result?.newDoc,
            logs: logs.slice(0, 100),
          };
          /** @type {any} */
          const resp = {
            correlationId,
            ok: true,
            ...envelope,
          };
          (ev.source || window.parent).postMessage(resp, "*");
        })
        .catch((error) => {
          const msg =
            error && typeof error.message === "string"
              ? error.message
              : String(error);
          /** @type {any} */
          const resp = {
            correlationId,
            ok: false,
            error: msg,
            logs: logs.slice(0, 100),
          };
          (ev.source || window.parent).postMessage(resp, "*");
        });
    } catch (e) {
      try {
        const resp = {
          correlationId: (ev && ev.data && ev.data.correlationId) || "n/a",
          ok: false,
          error: e && e.message ? e.message : String(e),
          logs: logs.slice(0, 100),
        };
        (ev.source || window.parent).postMessage(resp, "*");
      } catch {
        // ignore
      }
    }
  }

  window.addEventListener("message", onMessage);
})();
