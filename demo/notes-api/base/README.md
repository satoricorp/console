# notes-api

A tiny notes service, and a playground for [gx](https://gx.run).

The working tree has an uncommitted implementation of the API — the kind of
change an agent hands you at the end of a session. Before you push it, see
what review catches:

```
gx review
```

There's at least one security bug, an architecture problem, and a handful of
code-quality issues in there.

## Endpoints

- `POST /signup` — create a user
- `POST /login` — get a token
- `GET /notes` — list your notes
- `POST /notes` — create a note
- `GET /notes/search?q=` — search your notes
