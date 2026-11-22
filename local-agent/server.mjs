import express from "express";
import { chromium } from "playwright";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA_DIR = path.join(HERE, ".data", "profiles");
const PORT = Number.parseInt(process.env.PORT || "3939", 10);
const HOST = "127.0.0.1";
const PAIRING_CODE = randomBytes(24).toString("base64url");
const PORTAL_URL = "https://www.rupay.co.in/select-booking";
const contexts = new Map();
const app = express();

app.disable("x-powered-by");
app.use(express.json({limit:"8kb"}));

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}
function tokenMatches(value) {
  if (typeof value !== "string") return false;
  const a = Buffer.from(value), b = Buffer.from(PAIRING_CODE);
  return a.length === b.length && timingSafeEqual(a,b);
}
function requireLocalAgent(req,res,next) {
  const host = String(req.get("host") || "").toLowerCase();
  const origin = String(req.get("origin") || "");
  const allowedHosts = new Set([HOST + ":" + PORT, "localhost:" + PORT]);
  const allowedOrigins = new Set(["http://" + HOST + ":" + PORT, "http://localhost:" + PORT]);
  if (!allowedHosts.has(host) || (origin && !allowedOrigins.has(origin))) {
    return res.status(403).json({error:"Local companion requests must come from this computer."});
  }
  if (!tokenMatches(req.get("x-local-agent-token"))) {
    return res.status(401).json({error:"Pairing code is missing or incorrect. Copy it from the local-agent terminal."});
  }
  next();
}
function getContext(id) {
  const item = contexts.get(id);
  if (!item) return null;
  try {
    if (item.context.pages().length === 0) {
      contexts.delete(id);
      return null;
    }
    return item;
  } catch {
    contexts.delete(id);
    return null;
  }
}
function classifyPage(url,title) {
  let host = "";
  try { host = new URL(url).host; } catch {}
  return {host,likelyPaymentPage:/payment|checkout|gateway|billdesk|payu|razorpay|cashfree|ccavenue|secure.*bank/i.test(host + " " + String(title || ""))};
}
async function inspectContext(id) {
  const item = getContext(id);
  if (!item) throw new Error("No browser session is open for this account. Open it first.");
  const page = item.context.pages()[0];
  const details = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const clean = element => (element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || "").replace(/\s+/g," ").trim().slice(0,100);
    const headings = [...document.querySelectorAll("h1,h2,h3,[role=heading]")].filter(visible).map(clean).filter(Boolean).slice(0,24);
    const buttons = [...document.querySelectorAll("button,[role=button],input[type=submit],a")].filter(visible).map(clean).filter(Boolean).slice(0,30);
    return {title:document.title || "",headings:[...new Set(headings)],buttons:[...new Set(buttons)],passwordFieldCount:document.querySelectorAll('input[type="password"]').length};
  });
  const pageInfo = classifyPage(page.url(),details.title);
  return {title:details.title,host:pageInfo.host,likelyPaymentPage:pageInfo.likelyPaymentPage,
    likelyLoginPage:details.passwordFieldCount > 0,headings:details.headings,buttons:details.buttons,scannedAt:new Date().toISOString()};
}

app.get("/api/agent/health",(_req,res) => res.json({ok:true,version:"1.0.0",browser:"Playwright / Chromium",host:HOST,port:PORT}));

app.post("/api/agent/accounts/:id/open",requireLocalAgent,async(req,res) => {
  const id = req.params.id;
  if (!validId(id)) return res.status(400).json({error:"Invalid account identifier."});
  try {
    await mkdir(DATA_DIR,{recursive:true});
    let item = getContext(id);
    if (!item) {
      const profileDir = path.join(DATA_DIR,id);
      const context = await chromium.launchPersistentContext(profileDir,{headless:false,viewport:null,acceptDownloads:false});
      item = {context,openedAt:new Date().toISOString()};
      contexts.set(id,item);
    }
    const page = item.context.pages()[0] || await item.context.newPage();
    if (!page.url() || page.url() === "about:blank") await page.goto(PORTAL_URL,{waitUntil:"domcontentloaded",timeout:45000});
    else await page.bringToFront();
    res.json({ok:true,portalUrl:PORTAL_URL,sessionOpen:true});
  } catch(error) {
    res.status(500).json({error:"Could not open the local browser. " + String(error.message || error).slice(0,240)});
  }
});

app.post("/api/agent/accounts/:id/inspect",requireLocalAgent,async(req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({error:"Invalid account identifier."});
  try { res.json(await inspectContext(req.params.id)); }
  catch(error) { res.status(409).json({error:String(error.message || error).slice(0,240)}); }
});

app.post("/api/agent/accounts/:id/close",requireLocalAgent,async(req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({error:"Invalid account identifier."});
  const item = contexts.get(req.params.id);
  if (!item) return res.json({ok:true,alreadyClosed:true});
  try {
    await item.context.close(); contexts.delete(req.params.id); res.json({ok:true});
  } catch(error) { res.status(500).json({error:"Could not close browser profile. " + String(error.message || error).slice(0,180)}); }
});

app.use((req,res,next) => {
  const pathname = String(req.path || "").toLowerCase();
  if (pathname.startsWith("/local-agent/node_modules/") || pathname.startsWith("/local-agent/.data/")) {
    return res.sendStatus(404);
  }
  next();
});
app.use(express.static(ROOT,{dotfiles:"ignore",index:"index.html",fallthrough:true}));
app.get("*",(_req,res) => res.sendFile(path.join(ROOT,"index.html")));

const server = app.listen(PORT,HOST,() => {
  console.log("");
  console.log("RuPay Benefits local companion is ready.");
  console.log("Open this URL on the same computer: http://" + HOST + ":" + PORT);
  console.log("Local pairing code (paste into RuPay Select Automation):");
  console.log(PAIRING_CODE);
  console.log("");
  console.log("Browser profiles are stored under local-agent/.data and never uploaded.");
  console.log("The companion does not store portal passwords, card numbers, CVV or OTPs.");
});
async function shutdown(signal) {
  console.log(signal + " received; closing local browser profiles.");
  server.close();
  await Promise.allSettled([...contexts.values()].map(item => item.context.close()));
  process.exit(0);
}
process.on("SIGINT",() => shutdown("SIGINT"));
process.on("SIGTERM",() => shutdown("SIGTERM"));