import pg from "pg";
const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Configure PostgreSQL in the server environment.");
}
const sslMode = (process.env.PGSSLMODE || "disable").toLowerCase();
const ssl = sslMode === "require"
  ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" }
  : undefined;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: Number.parseInt(process.env.PG_POOL_MAX || "10", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000
});
pool.on("error", error => console.error("Unexpected PostgreSQL pool error:", error.message));
