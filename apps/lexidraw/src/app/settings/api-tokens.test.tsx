/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { button, click, installDom, render, type } from "~/test/dom";

installDom("https://app.test/settings");
const { ApiTokens } = await import("./api-tokens");

const DAY = 24 * 60 * 60 * 1000;
const token = (overrides: Record<string, unknown>) => ({
  id: "t1",
  name: "laptop",
  scope: "write" as const,
  expiresAt: null,
  lastUsedAt: new Date(Date.now() - 3 * DAY),
  createdAt: new Date(Date.now() - 10 * DAY),
  revokedAt: null,
  ...overrides,
});

const noop = async () => {};
const text = () => document.body.textContent ?? "";

describe("API tokens", () => {
  test("explains the scopes and links to the CLI setup", async () => {
    const view = await render(
      <ApiTokens
        tokens={[]}
        onCreate={async () => ({ name: "", token: "" })}
        onRevoke={noop}
      />,
    );
    expect(text()).toContain(
      "Read: list and open your files. Read and write: also create, edit and delete them.",
    );
    const cli = [...document.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Set up the CLI"),
    );
    expect(cli).toBeDefined();
    await view.unmount();
  });

  test("capitalises scope and status, and dates are relative with the exact time on hover", async () => {
    const view = await render(
      <ApiTokens
        tokens={[token({})]}
        onCreate={async () => ({ name: "", token: "" })}
        onRevoke={noop}
      />,
    );
    const row = document.querySelector("[data-token='t1']");
    expect(row?.textContent).toContain("Read and write");
    expect(row?.textContent).toContain("Active");
    const lastUsed = row?.querySelector("time");
    expect(lastUsed?.textContent).toBe("3 days ago");
    expect(lastUsed?.getAttribute("title")).toBeTruthy();
    await view.unmount();
  });

  test("revoking asks first, naming the token", async () => {
    const revoked: string[] = [];
    const view = await render(
      <ApiTokens
        tokens={[token({})]}
        onCreate={async () => ({ name: "", token: "" })}
        onRevoke={async (id) => {
          revoked.push(id);
        }}
      />,
    );
    await click(button("Revoke"));
    expect(revoked).toEqual([]);
    const dialog = document.querySelector("[role=alertdialog], [role=dialog]");
    expect(dialog?.textContent).toContain("Revoke “laptop”?");
    expect(dialog?.textContent).toContain("stops working right away");
    await click(
      [...(dialog?.querySelectorAll("button") ?? [])].find(
        (candidate) => candidate.textContent?.trim() === "Revoke",
      ),
    );
    expect(revoked).toEqual(["t1"]);
    await view.unmount();
  });

  test("revoked tokens collapse into their own group", async () => {
    const view = await render(
      <ApiTokens
        tokens={[
          token({}),
          token({
            id: "t2",
            name: "old ci",
            revokedAt: new Date(Date.now() - DAY),
          }),
        ]}
        onCreate={async () => ({ name: "", token: "" })}
        onRevoke={noop}
      />,
    );
    const group = document.querySelector("details");
    expect(group?.open).toBe(false);
    expect(group?.querySelector("summary")?.textContent).toContain(
      "Revoked (1)",
    );
    expect(group?.querySelector("[data-token='t2']")).not.toBeNull();
    expect(group?.querySelector("[data-token='t1']")).toBeNull();
    await view.unmount();
  });

  test("the new token's Copy button says Copied", async () => {
    const written: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => written.push(value) },
    });
    const view = await render(
      <ApiTokens
        tokens={[]}
        onCreate={async () => ({ name: "laptop", token: "ldt_secret" })}
        onRevoke={noop}
      />,
    );
    const name = document.querySelector<HTMLInputElement>("#token-name");
    if (!name) throw new Error("no name field");
    await type(name, "laptop");
    await act(async () => {
      name.form?.requestSubmit();
    });
    expect(text()).toContain("ldt_secret");
    await click(button("Copy"));
    expect(written).toEqual(["ldt_secret"]);
    expect(button("Copied")).toBeDefined();
    await view.unmount();
  });
});
