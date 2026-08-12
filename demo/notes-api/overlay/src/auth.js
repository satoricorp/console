const jwt = require("jsonwebtoken");
const db = require("./db");

const SECRET = process.env.JWT_SECRET || "notes-dev-secret";

function issueToken(user) {
  console.log("issuing token for", user.email);
  return jwt.sign({ id: user.id, email: user.email }, SECRET, {
    expiresIn: "30d",
  });
}

function requireUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  try {
    req.user = jwt.decode(token);
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const row = db.prepare("SELECT id FROM users WHERE id = ?").get(req.user.id);
    if (!row) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  } catch (err) {
    res.status(401).json({ error: "unauthorized" });
  }
}

module.exports = { issueToken, requireUser, SECRET };
