# Signaling server

Introduces peers who have the same entity open, so they can open WebRTC data
channels to each other. It relays `join`, `leave`, `offer`, `answer` and
`iceCandidate` messages within a room, and a room is an entity id. It never
sees document content, which travels peer to peer.

```sh
bun run dev     # watches src/, port 8080
bun run start
bun run test
```

The app finds it through `NEXT_PUBLIC_WS_SERVER`.

## Room tokens

| Variable           | Where                                  | Required |
| ------------------ | -------------------------------------- | -------- |
| `SIGNALING_SECRET` | this server, and the app (server-only) | no       |

Set `SIGNALING_SECRET` to the same value in this server's environment and in
the app's. The value is at least 32 characters, e.g. from
`openssl rand -base64 32`. The app then gives everyone who can read an entity
a short-lived room token. The token names the room, the peer id and whether
that peer may edit. The client presents it as `?token=` when it connects.
With the secret set, this server does the following:

- It closes a connection whose token is malformed, expired or signed with
  another secret (close code 4401).
- It closes a connection that joins another room, or speaks as another peer,
  than its token names (close code 4403).
- It stamps every message it relays from a token-holder with that peer's
  `canEdit`, replacing whatever the sender claimed. Clients ignore updates
  from peers with `canEdit: false`.
- It keeps peers without a token apart from peers with one. Tokenless peers
  still meet each other, so clients of an app that doesn't issue tokens yet
  keep collaborating among themselves. They never reach a token-holder.

Without the secret, the server behaves as it always has: anyone may join any
room as anyone. It logs one warning at startup. An app without the secret
issues no tokens, and its clients connect exactly as before.

Either side can go first, and live editing keeps working:

1. **App first.** Clients start sending tokens, and a server without the
   secret ignores them.
2. **Server first.** Clients send no tokens and meet in the tokenless rooms,
   as before, until the app is deployed with the secret.

Once both sides have the secret, a tab opened before the app had it stays
among tokenless peers until it reloads. If the two values differ, every
token is refused (close code 4401). Clients keep retrying, and live editing
stops until the values match.

With Docker:

```sh
docker build -t lexidraw-signaling .
docker run -p 8080:8080 -e SIGNALING_SECRET=... lexidraw-signaling
```
