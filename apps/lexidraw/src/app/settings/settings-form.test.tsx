/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { act, type ComponentProps } from "react";
import { button, click, installDom, render, type } from "~/test/dom";

installDom("https://app.test/settings");
const { SettingsForm } = await import("./settings-form");
const { SettingsNav } = await import("./settings-nav");

type Props = ComponentProps<typeof SettingsForm>;

const policy = (mode: "chat" | "agent" | "autocomplete") => ({
  mode,
  provider: "google",
  modelId: "gemini-3-pro-preview",
  temperature: 0.5,
  maxOutputTokens: 8000,
  allowedModels: [
    { provider: "google", modelId: "gemini-3-pro-preview" },
    { provider: "openai", modelId: "gpt-5-mini" },
  ],
  enforcedCaps: { maxOutputTokensByProvider: { openai: 32768, google: 65535 } },
  extraConfig: null,
});

function props(overrides: Partial<Props> = {}): Props {
  return {
    user: {
      id: "u1",
      name: "Ada",
      email: "ada@example.test",
      config: {},
    } as Props["user"],
    autoSave: true,
    policies: [policy("chat"), policy("agent"), policy("autocomplete")],
    onSave: async () => {},
    ...overrides,
  };
}

describe("Settings", () => {
  test("writing suggestions start opted out and have no feature model picker", async () => {
    const view = await render(<SettingsForm {...props()} />);
    const label = [...document.querySelectorAll("label")].find(
      (label) => label.textContent === "Writing suggestions",
    );
    expect(label).toBeDefined();
    const control = document.getElementById(label?.htmlFor ?? "");
    expect(control?.getAttribute("aria-checked")).toBe("false");
    expect(
      document.querySelector("[aria-label='Autocomplete model']"),
    ).toBeNull();
    expect(
      document.querySelector("input[name='autocomplete.modelId']"),
    ).toBeNull();
    await view.unmount();
  });

  test("the nav lists every section", async () => {
    const view = await render(<SettingsNav />);
    expect(
      [...document.querySelectorAll("nav a")].map((link) => link.textContent),
    ).toEqual([
      "Account",
      "Editor",
      "AI power",
      "AI",
      "Read aloud",
      "Sign-in methods",
      "API tokens",
      "Delete account",
    ]);
    await view.unmount();
  });

  test("each section says what it is for", async () => {
    const view = await render(<SettingsForm {...props()} />);
    const sections = [...document.querySelectorAll("section")];
    expect(
      sections.map((section) => section.querySelector("h2")?.textContent),
    ).toEqual(["Account", "Editor", "AI", "Read aloud"]);
    for (const section of sections) {
      expect(
        section.querySelector("h2 + p")?.textContent?.length,
      ).toBeGreaterThan(10);
    }
    await view.unmount();
  });

  test("Save says No changes until something changes", async () => {
    const saved: unknown[] = [];
    const view = await render(
      <SettingsForm
        {...props({ onSave: async (data) => void saved.push(data) })}
      />,
    );
    expect(button("No changes")?.disabled).toBe(true);

    const name = document.querySelector<HTMLInputElement>("input[name=name]");
    if (!name) throw new Error("no name field");
    await type(name, "Ada Lovelace");
    const save = button("Save changes");
    expect(save?.disabled).toBe(false);

    await click(save);
    await act(async () => {});
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: "Ada Lovelace" });
    await view.unmount();
  });

  test("AI settings expose one power boundary and never render legacy model or voice service controls", async () => {
    const view = await render(<SettingsForm {...props()} />);
    for (const label of ["Chat model", "Agent model", "Voice service", "Voice"])
      expect(document.querySelector(`[aria-label='${label}']`)).toBeNull();
    expect(document.querySelector("#settings-ai")?.textContent).toContain(
      "AI Power",
    );
    expect(
      document.querySelector("#settings-read-aloud")?.textContent,
    ).toContain("Saved recordings");
    await view.unmount();
  });
  test("ordinary profile edits send only profile, opt-in and playback data, preserving stored legacy configuration", async () => {
    const saved: unknown[] = [];
    const view = await render(
      <SettingsForm
        {...props({
          onSave: async (value) => {
            saved.push(value);
          },
        })}
      />,
    );
    const name = document.querySelector<HTMLInputElement>("input[name=name]");
    if (!name) throw Error("Missing profile field");
    await type(name, "Ada Changed");
    await click(button("Save changes"));
    expect(saved[0]).toEqual({
      name: "Ada Changed",
      email: "ada@example.test",
      autoSave: true,
      autocomplete: { enabled: false },
      tts: { speed: null },
    });
    await view.unmount();
  });
});
