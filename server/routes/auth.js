import { Router } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { hashSessionToken, requireAuth } from "../middleware/require-auth.js";

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again later." }
});
function cookieOptions(maxAge) {
  return { httpOnly:true, secure:process.env.SESSION_COOKIE_SECURE !== "false",
    sameSite:"strict", path:"/", maxAge };
}

router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || email.length > 254 || !password || password.length > 200) {
      return res.status(400).json({ error:"Enter your email and password." });
    }
    const result = await pool.query(
      "SELECT id,email,password_hash FROM users WHERE lower(email)=$1 LIMIT 1", [email]
    );
    const user = result.rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!valid) return res.status(401).json({ error:"Email or password is incorrect." });

    const token = randomBytes(32).toString("base64url");
    const days = Math.min(30, Math.max(1, Number.parseInt(process.env.SESSION_DAYS || "7", 10)));
    await pool.query(
      "INSERT INTO sessions (user_id,token_hash,expires_at) VALUES ($1,$2,now()+($3*interval '1 day'))",
      [user.id, hashSessionToken(token), days]
    );
    const cookieName = process.env.SESSION_COOKIE_NAME || "rb_session";
    res.cookie(cookieName, token, cookieOptions(days * 86400000));
    res.json({ user:{ id:user.id, email:user.email } });
  } catch (error) { next(error); }
});

router.post("/logout", async (req, res, next) => {
  try {
    const cookieName = process.env.SESSION_COOKIE_NAME || "rb_session";
    const rawToken = req.cookies?.[cookieName];
    if (rawToken && typeof rawToken === "string" && rawToken.length <= 200) {
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [hashSessionToken(rawToken)]);
    }
    res.clearCookie(cookieName, cookieOptions(0));
    res.json({ ok:true });
  } catch (error) { next(error); }
});

router.get("/me", requireAuth, (req, res) => res.json({ user:req.user }));
export default router;
