# Lexidraw for iOS

`xcodegen generate` writes `Lexidraw.xcodeproj` from `project.yml`; the
project isn't committed. To point a build at a local server, build with
`LEXIDRAW_SERVER_URL=http://localhost:3025`. Leave code signing on: an app
built with `CODE_SIGNING_ALLOWED=NO` can't keep its token in the Keychain, so
it can't sign in. The simulator's ad-hoc signing is enough.

## TestFlight

The **iOS TestFlight** workflow runs by hand on `master`. It tests, archives,
signs and uploads a build numbered by the run. Set up once:

1. In App Store Connect, create the app record for the bundle ID
   `xyz.raiju-studios.lexidraw` (the `PRODUCT_BUNDLE_IDENTIFIER` in
   `project.yml`). It needs no capabilities: Sign in with Apple happens on the
   web page, not in the app.
2. Under Users and Access → Integrations → App Store Connect API, create a team
   key with the App Manager role and download its `.p8`.
3. Add repository secrets `ASC_KEY_ID` (the key ID), `ASC_ISSUER_ID` (the
   issuer ID above the key list) and `ASC_KEY_P8` (the whole `.p8` file).
4. Add the repository variable `APPLE_TEAM_ID`, the team ID from the Apple
   Developer membership page.
5. In the app's TestFlight tab, create an internal group with yourself in it and
   automatic distribution on, so each upload reaches your phone.
