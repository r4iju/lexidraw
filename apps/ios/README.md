# Lexidraw for iOS

`xcodegen generate` writes `Lexidraw.xcodeproj` from `project.yml`; the
project isn't committed. To point a build at a local server, build with
`LEXIDRAW_SERVER_URL=http://localhost:3025`. Leave code signing on: an app
built with `CODE_SIGNING_ALLOWED=NO` can't keep its token in the Keychain, so
it can't sign in. The simulator's ad-hoc signing is enough.

LexicalSwift follows the Lexical version the web editor uses. To upgrade
Lexical, see [Upgrading Lexical](../../docs/lexical-upgrade.md).

## Corpus check

`bun run test:corpus` loads and saves every document an account owns with
both LexicalSwift and Lexical, and fails on any difference. It takes the
token from `LEXIDRAW_TOKEN`, or else the CLI's in the Keychain, and the host
from `LEXIDRAW_URL`. Failures name documents by id, never by content. In CI
the **iOS** workflow runs it with the repository secret
`LEXIDRAW_CORPUS_TOKEN`, a Lexidraw API token; without it the check is
skipped.

## Differential fuzzer

`FUZZ_SEED=<n> FUZZ_STEPS=<n> swift test --filter lexicalSwiftMatchesTheReference`
runs LexicalSwift and Lexical side by side on random commands. Steps count
only commands both accepted. Last run, on macOS 27 with words from
`Intl.Segmenter`: seeds 101 to 110, 100,000 steps each, 1,000,000 in all,
with no divergence; 632 commands were refused by both, for the same reason.

## TestFlight

The **iOS TestFlight** workflow runs by hand on `master`. It tests, archives,
signs and uploads a build numbered by the run. What it needs, set up once by
hand:

- An App Store Connect app record for `xyz.raiju.lexidraw`, with no
  capabilities, and the share extension's bundle ID
  `xyz.raiju.lexidraw.share` registered in the developer portal.
- An App Store Connect API team key (App Manager), as the repository secrets
  `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` (the whole `.p8`), and the
  team ID as the variable `APPLE_TEAM_ID`.
- An internal TestFlight group with automatic distribution. An upload from
  `xcodebuild` can't name a group, so this is what gets each build to testers.

## Decisions

- Release builds talk to `https://lexidraw.vercel.app`, the host the CLI uses.
  `https://dev.hackdocean.com` is behind Cloudflare Access, which answers the
  app's API calls with a login page.
- Home lists with the web's default sort, last changed first. It ignores the
  sort the web saves in a cookie.
- A device signs in under its model name, "iPhone" or "iPad", so two phones
  share a name in the web's list of API tokens.
- The TestFlight group is set up by hand, as above.
- A new file asks for its name straight away, as a new folder in Files does.
  The web opens the new file instead, which the app cannot do yet.
- The app doesn't save files yet, so the save messages that name the file and
  say what to do next belong to #130, which brings editing.
- The share extension signs in with the app's token through a Keychain
  access group named for the app's own App ID, the group the token was
  already kept in. So it needs no app group and no capability in the portal,
  and a token saved by an earlier build stays readable.
- The share extension waits for a link's page to be read before it closes,
  as the web's New link does, so a link never stays titled "New link"
  without saying why.
- Listen starts from a file's menu, since files don't open in the app yet.
- Listen reads in the caller's read-aloud settings from the web, except that
  it makes MP3 where they choose Ogg. Someone who chose Ogg has one audio of
  a file for the web and another for the app.
- Where a listen stopped is kept on the device. The web keeps none to share.
- A document's audio, once made, plays even after the document changes, as
  on the web. Making it again is done on the web.
