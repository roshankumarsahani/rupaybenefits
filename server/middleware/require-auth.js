import { createHash } from "node:crypto";
import { pool } from "../db.js";
export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
export async function requireAuth(req, res, next) {
  try {
    const cookieName = process.env.SESSION_COOKIE_NAME || "rb_session";
    const rawToken = req.cookies?.[cookieName];
    if (!rawToken || typeof rawToken !== "string" || rawToken.length > 200) {
      return res.status(401).json({ error: "Sign in required." });
    }
    const result = await pool.query(
      "SELECT u.id, u.email, s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1",
      [hashSessionToken(rawToken)]
    );
    if (!result.rowCount) return res.status(401).json({ error: "Session expired. Please sign in again." });
    req.user = { id: result.rows[0].id, email: result.rows[0].email };
    req.sessionId = result.rows[0].session_id;
    next();
  } catch (error) {
    next(error);
  }
}
