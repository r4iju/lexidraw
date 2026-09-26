# Lexidraw for iOS

`xcodegen generate` writes `Lexidraw.xcodeproj` from `project.yml`; the
project isn't committed. To point a build at a local server, build with
`LEXIDRAW_SERVER_URL=http://localhost:3025`. Leave code signing on: an app
built with `CODE_SIGNING_ALLOWED=NO` can't keep its token in the Keychain, so
it can't sign in. The simulator's ad-hoc signing is enough.

## TestFlight

The **iOS TestFlight** workflow runs by hand on `master`. It tests, archives,
signs and uploads a build numbered by the run. What it needs, set up once by
hand:

- An App Store Connect app record for `xyz.raiju.lexidraw`, with no
  capabilities.
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
- Shared with Me offers no move: where a file is kept is its owner's to
  arrange.
- Deleting says the file can be restored from the Trash. The web says it can't
  be undone, since the web has no Trash to restore from.
