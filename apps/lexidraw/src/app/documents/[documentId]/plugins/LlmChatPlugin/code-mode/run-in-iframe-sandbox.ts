"use client";

import type { CodeModeRequest, CodeModeResponse } from "./message-protocol";
import { generateCorrelationId, isCodeModeResponse } from "./message-protocol";

export type RunInIframeSandboxOptions = {
  iframeSrc: string;
  code: string;
  initialDoc: unknown;
  toolParams?: Record<string, unknown>;
  timeoutMs?: number;
  allowedOrigin?: string; // e.g. https://code-runner.your-sandbox.example
};

/**
 * Runs LLM-generated code in a sandboxed iframe (separate origin recommended).
 * The iframe must implement a small handler that listens for CodeModeRequest messages,
 * executes the code, and responds with a CodeModeResponse.
 */
export async function runInIframeSandbox(
  options: RunInIframeSandboxOptions,
): Promise<CodeModeResponse> {
  const {
    iframeSrc,
    code,
    initialDoc,
    toolParams,
    timeoutMs = 15_000,
    allowedOrigin,
  } = options;

  const correlationId = generateCorrelationId();
  const request: CodeModeRequest = {
    correlationId,
    code,
    initialDoc,
    toolParams,
  };

  const iframe = document.createElement("iframe");
  iframe.src = iframeSrc;
  iframe.sandbox.add("allow-scripts");
  iframe.style.display = "none";
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          reject(new Error("Sandbox load timeout"));
        },
        Math.min(5_000, timeoutMs),
      );
      iframe.onload = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    const targetWindow = iframe.contentWindow;
    if (!targetWindow) {
      throw new Error("Sandbox contentWindow not available");
    }

    const response = await new Promise<CodeModeResponse>((resolve, reject) => {
      const onMessage = (ev: MessageEvent) => {
        if (allowedOrigin && ev.origin !== allowedOrigin) {
          return;
        }
        if (isCodeModeResponse(ev.data, correlationId)) {
          window.removeEventListener("message", onMessage);
          resolve(ev.data);
        }
      };
      window.addEventListener("message", onMessage);
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Sandbox execution timeout"));
      }, timeoutMs);
      // Ensure we clear timer when promise resolves/rejects
      const origResolve = resolve;
      const origReject = reject;
      resolve = (value: unknown) => {
        clearTimeout(timer);
        origResolve(value as CodeModeResponse);
      };
      reject = (err: unknown) => {
        clearTimeout(timer);
        origReject(err as Error);
      };
      targetWindow.postMessage(request, "*");
    });

    return response;
  } finally {
    // Clean up iframe to avoid DOM leaks
    try {
      iframe.remove();
    } catch {
      // ignore
    }
  }
}
