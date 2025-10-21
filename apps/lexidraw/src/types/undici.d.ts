declare module "undici" {
  export type Dispatcher = unknown;
  export class ProxyAgent {
    constructor(proxyUrl: string);
  }
  export function fetch(
    input: string | URL | Request,
    init?: RequestInit & { dispatcher?: Dispatcher },
  ): Promise<Response>;
}
