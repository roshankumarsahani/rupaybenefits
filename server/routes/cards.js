import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/require-auth.js";
const router = Router();
router.use(requireAuth);
const CYCLES = new Set(["Monthly","Quarterly","Semi-annual","Annual","Mixed / multiple cycles"]);

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT c.*, (SELECT count(*)::int FROM vouchers v WHERE v.card_id=c.id AND v.owner_id=c.owner_id) AS voucher_count FROM cards c WHERE c.owner_id=$1 ORDER BY c.created_at DESC",
      [req.user.id]
    );
    res.json({ cards:result.rows });
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const bank = String(req.body?.bank || "").trim();
    const network = String(req.body?.network || "RuPay").trim();
    const last4 = String(req.body?.last4 || "").trim();
    const cycle = String(req.body?.benefit_cycle || "Monthly");
    const benefits = req.body?.benefits ?? [];
    if (!name || name.length>120 || !bank || bank.length>120)
      return res.status(400).json({ error:"A card name and bank are required." });
    if (last4 && !/^\d{4}$/.test(last4))
      return res.status(400).json({ error:"Only the last four card digits may be saved." });
    if (!CYCLES.has(cycle) || !Array.isArray(benefits) || benefits.length>50 ||
        benefits.some(item => typeof item!=="string" || item.length>300))
      return res.status(400).json({ error:"Invalid card benefit details." });
    const result = await pool.query(
      "INSERT INTO cards (owner_id,name,bank,network,last4,benefit_cycle,benefits) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *",
      [req.user.id,name,bank,network.slice(0,40),last4||null,cycle,JSON.stringify(benefits)]
    );
    res.status(201).json({ card:result.rows[0] });
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM cards WHERE id=$1 AND owner_id=$2 RETURNING id", [req.params.id,req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error:"Card not found." });
    res.json({ ok:true });
  } catch (error) { next(error); }
});
export default router;
