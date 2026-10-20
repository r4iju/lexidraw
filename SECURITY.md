# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/r4iju/lexidraw/security/advisories/new).
Do not open a public issue, pull request, or discussion for a security problem.

Include what you can of:

- the affected component, URL, or file;
- steps to reproduce, or a proof of concept;
- the impact you expect, such as data exposure or account takeover;
- any suggested fix.

## What to expect

Lexidraw has a single maintainer, so these are targets rather than guarantees:

- acknowledgement within 7 days;
- an initial assessment within 14 days;
- a fix or mitigation plan for confirmed issues, prioritised by severity.

Confirmed issues are fixed on `master`, deployed, and disclosed through a
[GitHub Security Advisory](https://github.com/r4iju/lexidraw/security/advisories),
with a CVE where one applies. Reporters are credited unless they ask not to be.

## Scope

In scope:

- the production deployment at <https://lexidraw.vercel.app>;
- the code in this repository: `apps/*` and `packages/*`.

Out of scope:

- vulnerabilities in upstream dependencies such as Excalidraw or Lexical that
  do not depend on how Lexidraw uses them; report those upstream;
- denial of service through traffic volume, and rate-limit findings without a
  security impact;
- social engineering, phishing, and physical attacks;
- findings that need a compromised device or browser.

Only the latest `master` and the current production deployment receive fixes.

## Testing guidelines

Test only against accounts and documents you own. Do not access, change, or
delete other users' data, and stop and report as soon as you can show impact.
Do not run automated scanners at a volume that degrades the service. Good-faith
research that follows these guidelines will not be pursued legally.
