import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../server/db.js";
const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || "");
try {
  if (!email || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Set a valid ADMIN_EMAIL environment variable.");
  if (password.length<12 || password.length>200)
    throw new Error("ADMIN_PASSWORD must be between 12 and 200 characters.");
  const passwordHash = await bcrypt.hash(password,12);
  await pool.query("INSERT INTO users (email,password_hash) VALUES ($1,$2)",[email,passwordHash]);
  console.log("User account created. Remove ADMIN_EMAIL and ADMIN_PASSWORD from your shell environment.");
} catch (error) {
  if (error.code==="23505") console.error("An account with that email already exists. No account was changed.");
  else console.error(error.message);
  process.exitCode=1;
} finally { await pool.end(); }
