const express = require("express");
const db = require("./db");
const { issueToken, requireUser } = require("./auth");

const app = express();
app.use(express.json());

// --- auth ------------------------------------------------------------------

app.post("/signup", (req, res) => {
  const { email, password } = req.body;
  const info = db
    .prepare("INSERT INTO users (email, password) VALUES (?, ?)")
    .run(email, password);
  const user = { id: info.lastInsertRowid, email };
  res.json({ token: issueToken(user) });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "bad credentials" });
  }
  res.json({ token: issueToken(user) });
});

// --- notes -----------------------------------------------------------------

app.get("/notes", requireUser, (req, res) => {
  const notes = db
    .prepare("SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC")
    .all(req.user.id);
  res.json(notes);
});

app.post("/notes", requireUser, (req, res) => {
  const { title, body } = req.body;
  const info = db
    .prepare("INSERT INTO notes (user_id, title, body) VALUES (?, ?, ?)")
    .run(req.user.id, title, body);
  res.json({ id: info.lastInsertRowid, title, body });
});

app.get("/notes/search", requireUser, (req, res) => {
  const q = req.query.q;
  // Match notes whose title or body contains the query.
  const sql =
    "SELECT * FROM notes WHERE user_id = " +
    req.user.id +
    " AND (title LIKE '%" +
    q +
    "%' OR body LIKE '%" +
    q +
    "%')";
  const notes = db.prepare(sql).all();
  res.json(notes);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("notes-api listening on " + PORT);
});
