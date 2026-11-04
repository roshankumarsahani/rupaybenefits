import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.js";
import cardRoutes from "./routes/cards.js";
import voucherRoutes from "./routes/vouchers.js";

const app = express();
const port = Number.parseInt(process.env.PORT || "3000",10);
const allowedOrigins = (process.env.APP_ORIGINS || "").split(",").map(v=>v.trim()).filter(Boolean);
app.disable("x-powered-by");
app.set("trust proxy",1);
app.use(helmet());
app.use(cors({
  credentials:true,
  origin(origin,callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null,true);
    return callback(new Error("Origin not allowed."));
  }
}));
app.use(express.json({limit:"1mb"}));
app.use(cookieParser());
app.use("/api",rateLimit({windowMs:60000,limit:180,standardHeaders:"draft-7",legacyHeaders:false}));

app.get("/health",async (_req,res)=>{
  try { await pool.query("SELECT 1"); res.json({ok:true,service:"rupay-benefits-api",database:"connected"}); }
  catch { res.status(503).json({ok:false,service:"rupay-benefits-api",database:"unavailable"}); }
});
app.use("/api/auth",authRoutes);
app.use("/api/cards",cardRoutes);
app.use("/api/vouchers",voucherRoutes);
app.use((_req,res)=>res.status(404).json({error:"Route not found."}));
app.use((error,_req,res,_next)=>{
  if (error.message==="Origin not allowed.") return res.status(403).json({error:"This website origin is not allowed."});
  console.error("API request failed:",error.code || error.name || "Error");
  res.status(500).json({error:"An unexpected server error occurred."});
});
const server = app.listen(port,"0.0.0.0",()=>console.log("RuPay Benefits API listening on port "+port));
async function shutdown(signal) {
  console.log(signal+" received; closing API and database connections.");
  server.close(async()=>{await pool.end();process.exit(0);});
  setTimeout(()=>process.exit(1),10000).unref();
}
process.on("SIGTERM",()=>shutdown("SIGTERM"));
process.on("SIGINT",()=>shutdown("SIGINT"));
