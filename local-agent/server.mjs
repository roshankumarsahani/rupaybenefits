import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { chromium } from "playwright";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA_DIR = path.join(HERE, ".data", "profiles");
const PORT = Number.parseInt(process.env.PORT || "3939", 10);
const HOST = process.env.BIND_HOST || "127.0.0.1";
const AUTH_MODE = process.env.AGENT_AUTH_MODE || "local";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "rupay-benefits";
const PAIRING_CODE = randomBytes(24).toString("base64url");
const PORTAL_URL = "https://www.rupay.co.in/select-booking";
const contexts = new Map();
const app = express();
const firebaseKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy:false, crossOriginResourcePolicy:{ policy:"same-origin" } }));
app.use(express.json({ limit:"16kb" }));
app.use("/api/agent", rateLimit({ windowMs:60_000, limit:180, standardHeaders:"draft-7", legacyHeaders:false }));

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}
function tokenMatches(value) {
  if (typeof value !== "string") return false;
  const a = Buffer.from(value), b = Buffer.from(PAIRING_CODE);
  return a.length === b.length && timingSafeEqual(a,b);
}
function sameOrigin(req) {
  const origin = req.get("origin");
  if (!origin) return AUTH_MODE !== "firebase";
  try { return new URL(origin).host === String(req.get("host") || "").toLowerCase(); }
  catch { return false; }
}
async function requireAgentAuth(req,res,next) {
  if (!sameOrigin(req)) return res.status(403).json({ error:"Same-origin browser request required." });
  if (AUTH_MODE === "firebase") {
    const match = /^Bearer\s+(.+)$/i.exec(String(req.get("authorization") || ""));
    if (!match) return res.status(401).json({ error:"Your RuPay Benefits sign-in has expired. Sign in again." });
    try {
      const { payload } = await jwtVerify(match[1], firebaseKeys, {
        issuer:"https://securetoken.google.com/" + FIREBASE_PROJECT_ID,
        audience:FIREBASE_PROJECT_ID
      });
      if (typeof payload.sub !== "string" || payload.sub.length < 1 || payload.sub.length > 128) {
        return res.status(401).json({ error:"Invalid Firebase user identity." });
      }
      req.agentUid = payload.sub;
      return next();
    } catch {
      return res.status(401).json({ error:"Firebase session could not be verified. Sign in again." });
    }
  }
  const host = String(req.get("host") || "").toLowerCase();
  const allowedHosts = new Set([HOST + ":" + PORT, "localhost:" + PORT]);
  if (!allowedHosts.has(host) || !tokenMatches(req.get("x-local-agent-token"))) {
    return res.status(401).json({ error:"Local pairing code is missing or incorrect." });
  }
  req.agentUid = "local";
  next();
}
function profileKey(uid,id) { return uid + ":" + id; }
function getContext(uid,id) {
  const key = profileKey(uid,id), item = contexts.get(key);
  if (!item) return null;
  try {
    if (item.context.pages().length === 0) { contexts.delete(key); return null; }
    return item;
  } catch { contexts.delete(key); return null; }
}
function profilePath(uid,id) {
  if (!validId(id) || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error("Invalid user or account identifier.");
  return path.join(DATA_DIR,uid,id);
}
function classifyPage(url,title) {
  let host = "";
  try { host = new URL(url).host; } catch {}
  const payment = /payment|checkout|gateway|billdesk|payu|razorpay|cashfree|ccavenue|secure.*bank/i.test(host + " " + String(title || ""));
  return { host, likelyPaymentPage:payment };
}
async function inspectContext(uid,id) {
  const item = getContext(uid,id);
  if (!item) throw new Error("No browser session is open for this account. Open it first.");
  const page = item.context.pages().at(-1);
  const details = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const clean = element => (element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || "")
      .replace(/\s+/g," ").trim().slice(0,100);
    const headings = [...document.querySelectorAll("h1,h2,h3,[role=heading]")].filter(visible).map(clean).filter(Boolean).slice(0,24);
    const buttons = [...document.querySelectorAll("button,[role=button],input[type=submit],a")].filter(visible).map(clean).filter(Boolean).slice(0,30);
    return { title:document.title || "", headings:[...new Set(headings)], buttons:[...new Set(buttons)],
      passwordFieldCount:document.querySelectorAll('input[type="password"]').length };
  });
  const info = classifyPage(page.url(),details.title);
  return { title:details.title, host:info.host, likelyPaymentPage:info.likelyPaymentPage,
    likelyLoginPage:details.passwordFieldCount > 0, headings:details.headings, buttons:details.buttons };
}
async function screenshotContext(uid,id) {
  const item = getContext(uid,id);
  if (!item) throw new Error("No browser session is open for this account. Open it first.");
  const page = item.context.pages()[0];
  const image = await page.screenshot({ type:"jpeg", quality:68, fullPage:false, animations:"disabled" });
  const info = classifyPage(page.url(), await page.title().catch(() => ""));
  const viewport = page.viewportSize() || { width:1280, height:800 };
  return { image:image.toString("base64"), width:viewport.width, height:viewport.height,
    likelyPaymentPage:info.likelyPaymentPage, host:info.host };
}
app.get("/api/agent/health",(_req,res) => res.json({
  ok:true, version:"1.1.0", browser:"Playwright / Chromium", mode:AUTH_MODE, headless:AUTH_MODE === "firebase"
}));
app.post("/api/agent/accounts/:id/open",requireAgentAuth,async(req,res) => {
  const uid=req.agentUid, id=req.params.id;
  if (!validId(id)) return res.status(400).json({error:"Invalid account identifier."});
  try {
    await mkdir(profilePath(uid,id),{recursive:true});
    let item=getContext(uid,id);
    if (!item) {
      const activeForUser=[...contexts.keys()].filter(key=>key.startsWith(uid + ":")).length;
      if (activeForUser >= 4) return res.status(429).json({error:"This account already has four open browser sessions. Close one first."});
      const context=await chromium.launchPersistentContext(profilePath(uid,id),{
        headless:AUTH_MODE === "firebase",
        viewport:{width:1280,height:800},
        acceptDownloads:false,
        args:["--disable-dev-shm-usage","--disable-save-password-bubble"]
      });
      item={context,openedAt:new Date().toISOString()};
      contexts.set(profileKey(uid,id),item);
    }
    const page=item.context.pages()[0] || await item.context.newPage();
    if (!page.url() || page.url()==="about:blank") {
      await page.goto(PORTAL_URL,{waitUntil:"domcontentloaded",timeout:45000});
    } else await page.bringToFront().catch(()=>{});
    const screen=await screenshotContext(uid,id);
    res.json({ok:true,portalUrl:PORTAL_URL,sessionOpen:true,...screen});
  } catch(error) {
    res.status(500).json({error:"Could not open the browser. " + String(error.message || error).slice(0,220)});
  }
});
app.post("/api/agent/accounts/:id/inspect",requireAgentAuth,async(req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({error:"Invalid account identifier."});
  try { res.json(await inspectContext(req.agentUid,req.params.id)); }
  catch(error) { res.status(409).json({error:String(error.message || error).slice(0,220)}); }
});
app.post("/api/agent/accounts/:id/screenshot",requireAgentAuth,async(req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({error:"Invalid account identifier."});
  try { res.json(await screenshotContext(req.agentUid,req.params.id)); }
  catch(error) { res.status(409).json({error:String(error.message || error).slice(0,220)}); }
});
app.post("/api/agent/accounts/:id/click",requireAgentAuth,async(req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({error:"Invalid account identifier."});
  const x=Number(req.body?.x), y=Number(req.body?.y);
  try {
    const item=getContext(req.agentUid,req.params.id);
    if (!item) throw new Error("Open this account's browser first.");
    const page=item.context.pages().at(-1), viewport=page.viewportSize() || {width:1280,height:800};
    if (!Number.isFinite(x) || !Number.isFinite(y) || x<0 || y<0 || x>=viewport.width || y>=viewport.height) {
      return res.status(400).json({error:"Tap position is outside the browser screen."});
    }
    await page.mouse.click(x,y);
    await page.waitForTimeout(250);
    res.json(await screenshotContext(req.agentUid,req.params.id));
  } catch(error) { res.status(409).json({error:String(error.message || error).slice(0,220)}); }
});
app.post("/api/agent/accounts/:id/type",requireAgentAuth,async(req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({error:"Invalid account identifier."});
  const value=req.body?.text;
  if (typeof value!=="string" || value.length>2000) return res.status(400).json({error:"Text must be 2,000 characters or fewer."});
  try {
    const item=getContext(req.agentUid,req.params.id);
    if (!item) throw new Error("Open this account's browser first.");
    const page=item.context.pages().at(-1);
    await page.keyboard.insertText(value);
    res.json(await screenshotContext(req.agentUid,req.params.id));
  } catch(error) { res.status(409).json({error:String(error.message || error).slice(0,220)}); }
});
app.post("/api/agent/accounts/:id/press",requireAgentAuth,async(req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({error:"Invalid account identifier."});
  const allowed=new Set(["Enter","Tab","Backspace","Escape","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Delete","PageUp","PageDown","Home","End"," "]);
  const key=req.body?.key;
  if (!allowed.has(key)) return res.status(400).json({error:"That keyboard key is not enabled."});
  try {
    const item=getContext(req.agentUid,req.params.id);
    if (!item) throw new Error("Open this account's browser first.");
    await item.context.pages()[0].keyboard.press(key);
    await item.context.pages()[0].waitForTimeout(150);
    res.json(await screenshotContext(req.agentUid,req.params.id));
  } catch(error) { res.status(409).json({error:String(error.message || error).slice(0,220)}); }
});
app.post("/api/agent/accounts/:id/close",requireAgentAuth,async(req,res) => {
  if (!validId(req.params.id)) return res.status(400).json({error:"Invalid account identifier."});
  const key=profileKey(req.agentUid,req.params.id), item=contexts.get(key);
  if (!item) return res.json({ok:true,alreadyClosed:true});
  try { await item.context.close(); contexts.delete(key); res.json({ok:true}); }
  catch(error) { res.status(500).json({error:"Could not close browser profile. " + String(error.message || error).slice(0,160)}); }
});

app.use((req,res,next) => {
  const pathname=String(req.path || "").toLowerCase();
  if (pathname.startsWith("/local-agent/node_modules/") || pathname.startsWith("/local-agent/.data/") ||
      pathname.startsWith("/.git/") || pathname === "/.env") return res.sendStatus(404);
  next();
});
app.use(express.static(ROOT,{dotfiles:"ignore",index:"index.html",fallthrough:true}));
app.get("*",(_req,res) => res.sendFile(path.join(ROOT,"index.html")));

const server=app.listen(PORT,HOST,() => {
  console.log("RuPay Benefits browser companion listening on " + HOST + ":" + PORT + " (" + AUTH_MODE + " auth).");
  console.log("Browser profiles are persisted under local-agent/.data/profiles.");
  if (AUTH_MODE !== "firebase") console.log("Local pairing code: " + PAIRING_CODE);
});
async function shutdown(signal) {
  console.log(signal + " received; closing browser profiles.");
  server.close();
  await Promise.allSettled([...contexts.values()].map(item=>item.context.close()));
  process.exit(0);
}
process.on("SIGINT",()=>shutdown("SIGINT"));
process.on("SIGTERM",()=>shutdown("SIGTERM"));
