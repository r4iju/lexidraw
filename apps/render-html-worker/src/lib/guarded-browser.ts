import * as http from "node:http";
import * as net from "node:net";
import { reachable } from "@packages/lib/public-address";
import type { Browser, Viewport } from "puppeteer-core";
import { launchBrowser } from "./launch-browser";
import { type Check, publicCheck } from "./public-requests";

/**
 * Chromium that reaches only public addresses, at the address each was
 * checked to be: every connection it makes, navigations, redirects,
 * subresources, frames and scripts' requests alike, goes through a proxy
 * that looks the host up, checks it, and connects to what it checked, so
 * Chromium never looks a host up itself.
 */
export async function launchGuardedBrowser({
  viewport,
  check = publicCheck,
}: {
  viewport: Viewport;
  check?: Check;
}): Promise<Browser> {
  const proxy = await startGuardProxy(check);
  try {
    const browser = await launchBrowser({
      viewport,
      args: [
        `--proxy-server=${proxy.address}`,
        // Chromium otherwise goes to loopback addresses directly.
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });
    browser.once("disconnected", proxy.close);
    return browser;
  } catch (error) {
    proxy.close();
    throw error;
  }
}

/**
 * Every answer closes its connection: Chromium's next request on a kept one
 * never reached the handler.
 */
async function startGuardProxy(check: Check) {
  const tunnels = new Set<net.Socket>();
  const server = http.createServer(async (request, response) => {
    const url = reachable(request.url ?? "");
    const address =
      url?.protocol === "http:" && (await check(url).catch(() => undefined));
    if (!url || !address) {
      response.writeHead(403, { connection: "close" }).end();
      return;
    }
    const { "proxy-connection": _, ...headers } = request.headers;
    const onward = http.request(
      {
        host: address.address,
        family: address.family,
        port: url.port || 80,
        method: request.method,
        path: url.pathname + url.search,
        headers,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, [
          ...endToEnd(answer.rawHeaders),
          "connection",
          "close",
        ]);
        answer.pipe(response);
      },
    );
    onward.on("error", () => response.destroy());
    request.pipe(onward);
  });
  // HTTPS and WebSockets, tunnelled to the checked address.
  server.on("connect", async (request, client: net.Socket, head: Buffer) => {
    tunnels.add(client);
    client.on("close", () => tunnels.delete(client));
    client.on("error", () => client.destroy());
    const url = reachable(`https://${request.url}`);
    const address = url && (await check(url).catch(() => undefined));
    if (!url || !address) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const onward = net.connect(
      { host: address.address, port: Number(url.port || 443) },
      () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        onward.write(head);
        onward.pipe(client);
        client.pipe(onward);
      },
    );
    onward.on("error", () => client.destroy());
    client.on("close", () => onward.destroy());
  });
  await new Promise<void>((listening) =>
    server.listen(0, "127.0.0.1", listening),
  );
  const { port } = server.address() as net.AddressInfo;
  return {
    address: `http://127.0.0.1:${port}`,
    close: () => {
      for (const tunnel of tunnels) tunnel.destroy();
      server.closeAllConnections();
      server.close();
    },
  };
}

/** `raw` without the headers about the connection they came on. */
function endToEnd(raw: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] ?? "";
    if (!/^(connection|keep-alive|proxy-.*)$/i.test(name))
      kept.push(name, raw[i + 1] ?? "");
  }
  return kept;
}
