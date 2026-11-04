import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "../server/db.js";
try {
  const schemaPath = fileURLToPath(new URL("../database/schema.sql",import.meta.url));
  await pool.query(await readFile(schemaPath,"utf8"));
  console.log("RuPay Benefits database schema applied successfully.");
} catch (error) {
  console.error("Database migration failed:",error.message);
  process.exitCode=1;
} finally { await pool.end(); }
