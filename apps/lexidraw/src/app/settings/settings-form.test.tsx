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
  test("the nav lists every section", async () => {
    const view = await render(<SettingsNav />);
    expect(
      [...document.querySelectorAll("nav a")].map((link) => link.textContent),
    ).toEqual(["Account", "Editor", "AI", "Read aloud", "API tokens"]);
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

  test("an unset model shows the default as the select's value", async () => {
    const view = await render(<SettingsForm {...props()} />);
    const chat = document.querySelector("[aria-label='Chat model']");
    expect(chat?.textContent).toBe("Default (Gemini 3 Pro)");
    await view.unmount();
  });

  test("sliders rest on the default, and advanced options start collapsed", async () => {
    const view = await render(<SettingsForm {...props()} />);
    const advanced = document.querySelector<HTMLDetailsElement>(
      "#settings-ai details",
    );
    expect(advanced?.open).toBe(false);
    const temperature =
      advanced?.querySelector<HTMLInputElement>("input[type=range]");
    expect(temperature?.value).toBe("0.5");
    await view.unmount();
  });
});
