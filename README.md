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
