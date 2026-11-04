import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/require-auth.js";
const router = Router();
router.use(requireAuth);
const SOURCES = new Set(["self","family","purchased"]);
const STATUSES = new Set(["available","sold","redeemed"]);

router.get("/", async (req, res, next) => {
  try {
    const values = [req.user.id];
    const where = ["owner_id=$1"];
    const addFilter = (column, value) => {
      if (!value) return;
      values.push(value);
      where.push(column + "=$" + values.length);
    };
    addFilter("source_type", req.query.source);
    addFilter("status", req.query.status);
    addFilter("brand", req.query.brand);
    if (req.query.q) {
      values.push("%" + String(req.query.q).slice(0,100).replace(/[\\%_]/g, "\\$&") + "%");
      const p = "$" + values.length;
      where.push("(brand ILIKE " + p + " OR code ILIKE " + p + " OR supplier_name ILIKE " + p + ")");
    }
    const result = await pool.query(
      "SELECT id,brand,code,source_type,status,card_id,family_member_name,supplier_name,supplier_phone,value_inr,expiry_date,notes,created_at,updated_at FROM vouchers WHERE " +
      where.join(" AND ") + " ORDER BY expiry_date ASC NULLS LAST,created_at DESC LIMIT 1000",
      values
    );
    res.json({ vouchers:result.rows });
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM vouchers WHERE id=$1 AND owner_id=$2", [req.params.id,req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error:"Voucher not found." });
    res.json({ voucher:result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/bulk", async (req, res, next) => {
  const client = await pool.connect();
  let transaction = false;
  try {
    const brand = String(req.body?.brand || "").trim();
    const codes = Array.isArray(req.body?.codes) ? [...new Set(req.body.codes.map(code => String(code).trim()).filter(Boolean))] : [];
    const source = String(req.body?.source_type || "self");
    const value = Number(req.body?.value_inr || 0);
    const expiry = req.body?.expiry_date ? String(req.body.expiry_date) : null;
    const cardId = req.body?.card_id || null;
    const familyName = String(req.body?.family_member_name || "").trim();
    const supplierName = String(req.body?.supplier?.name || "").trim();
    const supplierPhone = String(req.body?.supplier?.phone || "").trim();
    const notes = String(req.body?.notes || "").trim();

    if (!brand || brand.length>100 || !codes.length || codes.length>250 || codes.some(code=>code.length>300))
      return res.status(400).json({ error:"Enter a brand and between 1 and 250 valid codes." });
    if (!SOURCES.has(source) || !Number.isFinite(value) || value<0 || value>100000000)
      return res.status(400).json({ error:"Invalid voucher origin or value." });
    if (source==="purchased" && (!supplierName || !supplierPhone || supplierName.length>160 || supplierPhone.length>40))
      return res.status(400).json({ error:"Purchased vouchers require the seller's name and phone number." });
    if (source==="family" && (!familyName || familyName.length>160))
      return res.status(400).json({ error:"Family vouchers require a cardholder name." });
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))
      return res.status(400).json({ error:"Expiry date must use YYYY-MM-DD format." });

    if (cardId) {
      const card = await client.query("SELECT id FROM cards WHERE id=$1 AND owner_id=$2", [cardId,req.user.id]);
      if (!card.rowCount) return res.status(400).json({ error:"Selected card was not found." });
    }
    await client.query("BEGIN");
    transaction = true;
    const inserted = [];
    for (const code of codes) {
      const result = await client.query(
        "INSERT INTO vouchers (owner_id,brand,code,source_type,status,card_id,family_member_name,supplier_name,supplier_phone,value_inr,expiry_date,notes) " +
        "VALUES ($1,$2,$3,$4,'available',$5,$6,$7,$8,$9,$10,$11) " +
        "RETURNING id,brand,code,source_type,status,card_id,family_member_name,supplier_name,supplier_phone,value_inr,expiry_date,notes,created_at",
        [req.user.id,brand,code,source,cardId,familyName||null,source==="purchased"?supplierName:null,
          source==="purchased"?supplierPhone:null,value,expiry,notes.slice(0,1000)]
      );
      inserted.push(result.rows[0]);
    }
    await client.query("COMMIT");
    transaction = false;
    res.status(201).json({ inserted:inserted.length,vouchers:inserted });
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(()=>{});
    if (error.code==="23505") return res.status(409).json({ error:"One or more codes already exist for this brand. No codes from this batch were saved." });
    next(error);
  } finally { client.release(); }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    const status = String(req.body?.status || "");
    if (!STATUSES.has(status)) return res.status(400).json({ error:"Invalid voucher status." });
    const result = await pool.query(
      "UPDATE vouchers SET status=$1,updated_at=now() WHERE id=$2 AND owner_id=$3 RETURNING id,status",
      [status,req.params.id,req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error:"Voucher not found." });
    res.json({ voucher:result.rows[0] });
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM vouchers WHERE id=$1 AND owner_id=$2 RETURNING id", [req.params.id,req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error:"Voucher not found." });
    res.json({ ok:true });
  } catch (error) { next(error); }
});
export default router;
