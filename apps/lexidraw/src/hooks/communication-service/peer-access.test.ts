/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { PeerAccess } from "./peer-access";

describe("updates from peers", () => {
  test("are applied from a peer the room says may edit", () => {
    const access = new PeerAccess();
    access.heard({ type: "join", room: "r", from: "editor", canEdit: true });
    expect(access.accepts("editor")).toBe(true);
  });

  test("are dropped from a peer the room says may only read", () => {
    const access = new PeerAccess();
    access.heard({
      type: "offer",
      room: "r",
      from: "reader",
      to: "me",
      offer: "{}",
      canEdit: false,
    });
    expect(access.accepts("reader")).toBe(false);
  });

  test("are dropped from a peer the room never announced", () => {
    const access = new PeerAccess();
    expect(access.accepts("stranger")).toBe(false);
  });

  test("follow a peer that leaves and comes back with other access", () => {
    const access = new PeerAccess();
    access.heard({ type: "join", room: "r", from: "peer", canEdit: false });
    access.heard({ type: "leave", room: "r", from: "peer", canEdit: false });
    access.heard({ type: "join", room: "r", from: "peer", canEdit: true });
    expect(access.accepts("peer")).toBe(true);
  });
});
