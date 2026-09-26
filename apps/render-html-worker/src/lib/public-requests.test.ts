import { expect, test } from "bun:test";
import { publicAddress, type Resolve } from "@packages/lib/public-address";
import { guardRequests } from "./public-requests";

const resolve: Resolve = async (host) => [
  {
    address: host === "metadata.example" ? "169.254.169.254" : "93.184.215.14",
    family: 4,
  },
];

/** A page that takes each of `urls` as a request, answering what became of them. */
async function requestsOn(urls: string[]) {
  let intercepting = false;
  let handle: ((request: unknown) => Promise<void>) | undefined;
  const page = {
    setRequestInterception: async (on: boolean) => {
      intercepting = on;
    },
    on: (event: string, handler: (request: unknown) => Promise<void>) => {
      if (event === "request") handle = handler;
    },
  };
  await guardRequests(page as never, (url) => publicAddress(url, resolve));
  const outcomes: Record<string, string> = {};
  for (const url of urls)
    await handle?.({
      url: () => url,
      continue: async () => {
        outcomes[url] = "sent";
      },
      abort: async () => {
        outcomes[url] = "refused";
      },
    });
  return { intercepting, outcomes };
}

test("a rendered page reaches public addresses, and none inside", async () => {
  const { intercepting, outcomes } = await requestsOn([
    "https://news.example/post",
    "https://cdn.example/app.js",
    "data:image/png;base64,iVBORw0KGgo=",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.example/",
    "http://0xa9fea9fe/",
    "http://2130706433/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost:3000/",
    "file:///etc/passwd",
    "chrome://settings",
  ]);

  expect(intercepting).toBe(true);
  expect(outcomes).toEqual({
    "https://news.example/post": "sent",
    "https://cdn.example/app.js": "sent",
    "data:image/png;base64,iVBORw0KGgo=": "sent",
    "http://169.254.169.254/latest/meta-data/": "refused",
    "http://metadata.example/": "refused",
    "http://0xa9fea9fe/": "refused",
    "http://2130706433/": "refused",
    "http://10.0.0.1/": "refused",
    "http://172.16.0.1/": "refused",
    "http://192.168.1.1/": "refused",
    "http://[fc00::1]/": "refused",
    "http://[fe80::1]/": "refused",
    "http://[::ffff:127.0.0.1]/": "refused",
    "http://localhost:3000/": "refused",
    "file:///etc/passwd": "refused",
    "chrome://settings": "refused",
  });
});
