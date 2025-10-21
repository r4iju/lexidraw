# Lexidraw

This is a wrapper around Excalidraw and Lexical, providing persistance and sharing capabilities.
The Web-RTC based collaboration feature is currently not reliable.

## Getting started

Setup a database, configure connect string with the .env.example, and run `pnpm install`, then `pnpm dev`

## How do I deploy this?

Follow t3-stack deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.

## URL Article Distillation (MVP)

- Trigger: Open a URL entity and click "Distill article".
- Storage: Results are saved into `Entities.elements.distilled` (title, byline, site, excerpt, sanitized `contentHtml`, word count, images, timestamps).
- Safety: Server fetch only over http/https, basic SSRF guards (no private hostnames), timeout and 8MB cap, JS not executed. Content is sanitized with `sanitize-html` and links/images are rewritten to absolute URLs.
- Legal: We do not bypass paywalls or logins. The app stores only content returned by a direct fetch.
- Re-distill: Use the Re-distill button in the preview to refresh content.

### NordVPN dynamic HTTPS proxy support

- The server dynamically fetches recommended HTTPS proxy endpoints from Nord's public API (`/v1/servers/recommendations?filters[servers_technologies][identifier]=proxy_ssl`) and connects via port 89 using undici's `ProxyAgent`.
- Attempts: 1 direct fetch + up to 20 proxy attempts (shuffled).
- Credentials: set `NORDVPN_SERVICE_USER` and `NORDVPN_SERVICE_PASS` with your Nord service credentials (from "Set up NordVPN manually").
- Notes: No manual proxy override env is used. SOCKS5 is not supported here.
