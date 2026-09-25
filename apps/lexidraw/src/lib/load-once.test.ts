/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadOnce } from "./load-once";

test("callers share one load, and a failed load is tried again", async () => {
  let attempts = 0;
  const load = loadOnce(async () => {
    attempts++;
    if (attempts === 1) throw new Error("offline");
    return attempts;
  });
  const [first, second] = await Promise.allSettled([load(), load()]);
  expect([first.status, second.status]).toEqual(["rejected", "rejected"]);
  expect(await load()).toBe(2);
  expect(await load()).toBe(2);
  expect(attempts).toBe(2);
});
