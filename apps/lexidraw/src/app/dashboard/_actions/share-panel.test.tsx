/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { AccessLevel, PublicAccess } from "@packages/types";
import type { ComponentProps } from "react";
import {
  button,
  click,
  installDom,
  openWithKeyboard,
  render,
} from "~/test/dom";

installDom();
const { SharePanel } = await import("./share-panel");

type Props = ComponentProps<typeof SharePanel>;

function props(overrides: Partial<Props> = {}): Props {
  return {
    open: true,
    onOpenChange: () => {},
    entity: { title: "Launch plan", entityType: "document" },
    you: { name: "Ada", email: "ada@example.test", role: "owner" },
    people: [
      {
        userId: "u-bob",
        name: "Bob",
        email: "bob@example.test",
        accessLevel: AccessLevel.EDIT,
      },
    ],
    publicAccess: PublicAccess.PRIVATE,
    onPublicAccessChange: () => {},
    onInvite: () => {},
    inviting: false,
    inviteError: null,
    onRoleChange: () => {},
    onRemove: () => {},
    onCopyLink: () => {},
    ...overrides,
  };
}

const text = () => document.body.textContent ?? "";
const rows = () =>
  [...document.querySelectorAll("[data-share-person]")].map(
    (row) => row.textContent ?? "",
  );

describe("share dialog", () => {
  test("is titled with the file's name and starts in the email field", async () => {
    const view = await render(<SharePanel {...props()} />);
    expect(document.querySelector("[role=dialog] h2")?.textContent).toBe(
      "Share “Launch plan”",
    );
    expect(document.activeElement?.getAttribute("type")).toBe("email");
    await view.unmount();
  });

  test("lists you as the owner first, then each person with their email", async () => {
    const view = await render(<SharePanel {...props()} />);
    expect(rows()[0]).toContain("You · Owner");
    expect(rows()[1]).toContain("Bob");
    expect(rows()[1]).toContain("bob@example.test");
    await view.unmount();
  });

  test("says people need a Lexidraw account, and names an email that has none", async () => {
    const view = await render(
      <SharePanel
        {...props({
          inviteError:
            "No Lexidraw account uses eve@example.test. Ask them to sign up, then share again.",
        })}
      />,
    );
    expect(text()).toContain("People need a Lexidraw account");
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      "eve@example.test",
    );
    await view.unmount();
  });

  test("a person's role select ends with Remove access", async () => {
    const removed: string[] = [];
    const view = await render(
      <SharePanel {...props({ onRemove: (id) => removed.push(id) })} />,
    );
    await openWithKeyboard(
      document.querySelector("[data-share-person='u-bob'] [role=combobox]"),
    );
    const options = [...document.querySelectorAll("[role=option]")];
    expect(options.map((option) => option.textContent)).toEqual([
      "Can view",
      "Can edit",
      "Remove access",
    ]);
    await click(options.at(-1));
    expect(removed).toEqual(["u-bob"]);
    await view.unmount();
  });

  test("general access offers the three choices in order and explains the current one", async () => {
    const view = await render(
      <SharePanel {...props({ publicAccess: PublicAccess.READ })} />,
    );
    expect(text()).toContain("Anyone with the link can view it");
    await openWithKeyboard(
      document.querySelector("[aria-label='General access']"),
    );
    expect(
      [...document.querySelectorAll("[role=option]")].map(
        (option) => option.textContent,
      ),
    ).toEqual([
      "Restricted",
      "Anyone with the link can view",
      "Anyone with the link can edit",
    ]);
    await view.unmount();
  });

  test("copies the link from the footer", async () => {
    let copied = 0;
    const view = await render(
      <SharePanel {...props({ onCopyLink: () => copied++ })} />,
    );
    await click(button("Copy link"));
    expect(copied).toBe(1);
    await view.unmount();
  });

  test("a folder says whether the files inside are shared", async () => {
    const view = await render(
      <SharePanel
        {...props({ entity: { title: "Q3", entityType: "directory" } })}
      />,
    );
    expect(text()).toContain("doesn’t share the files in it");
    await view.unmount();
  });
});
