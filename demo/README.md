# /new terminal playground

The second slide on the `/new` landing is a small faux-terminal
(`src/components/landing-v2/terminal-panel.tsx`). It recognizes a handful of
commands (`gx review`, `ls`, `git status`, `cat src/auth.js`, `help`, `clear`)
and prints canned output — no backend, no wasm, no shell. `gx review` prints the
findings seeded into the demo repo below.

## The demo repo it mirrors

**`notes-api/`** is a real, tiny Express + SQLite notes service — the source of
truth the canned output is written against, and something we can publish so
people can clone it and run `gx review` for real. `base/` is the committed
skeleton; `overlay/` is the implementation, and `setup.sh` lays the overlay down
as an *uncommitted* change so a real `gx review` has a diff:

```
cd notes-api && ./setup.sh && cd workdir && gx review
```

Seeded findings (all verified against the real code):

- **Security** — `requireUser` verifies tokens with `jwt.decode()` instead of
  `jwt.verify()`, so a forged token is accepted (auth bypass); `/notes/search`
  concatenates the query into SQL (injection); passwords are stored plaintext.
- **Architecture** — HTTP handlers, business logic, and SQLite access all live
  in `server.js` against an import-time DB singleton — nothing is testable or
  swappable.
- **Quality** — leftover `console.log`s, no input validation, 30-day tokens,
  magic strings.

If the canned output in `terminal-panel.tsx` and the real repo ever drift, the
repo wins — update the panel to match.
