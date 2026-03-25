// ═══════════════════════════════════════════════════════════════════
// SUPABASE REST CLIENT — Novy Procurement System
// ═══════════════════════════════════════════════════════════════════
// Uses fetch directly against Supabase's PostgREST API — no npm package needed.
// 1. Go to supabase.com → create project
// 2. Run supabase-schema-v3.sql in SQL Editor
// 3. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env or Vercel
// ═══════════════════════════════════════════════════════════════════

const URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const REST = `${URL}/rest/v1`;

// Helper: convert non-UUID strings like "unknown" to null
const toUUID = (v) => (v && v.length > 10 && v !== "unknown" ? v : null);

const hdrs = (extra = {}) => ({
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
  ...extra,
});

// ── Generic helpers ──────────────────────────────────────────────
async function get(table, query = "") {
  const r = await fetch(`${REST}/${table}?${query}`, { headers: hdrs() });
  if (!r.ok) throw new Error(`GET ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function post(table, body) {
  const r = await fetch(`${REST}/${table}`, {
    method: "POST", headers: hdrs(), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function patch(table, query, body) {
  const r = await fetch(`${REST}/${table}?${query}`, {
    method: "PATCH", headers: hdrs(), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function upsert(table, body) {
  const r = await fetch(`${REST}/${table}`, {
    method: "POST",
    headers: hdrs({ Prefer: "return=representation,resolution=merge-duplicates" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`UPSERT ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function rpc(fnName) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fnName}`, {
    method: "POST", headers: hdrs(), body: "{}",
  });
  if (!r.ok) return null;
  return r.json();
}

// ── STAFF ─────────────────────────────────────────────────────────
export const fetchStaff = async () => {
  const data = await get("staff", "is_active=eq.true&order=name");
  return data.map((s) => ({ id: s.id, name: s.name, role: s.role }));
};

export const upsertStaff = async (staff) => {
  const rows = await upsert("staff", { id: staff.id || undefined, name: staff.name, role: staff.role });
  const d = rows[0];
  return { id: d.id, name: d.name, role: d.role };
};

export const deleteStaff = async (id) => {
  await patch("staff", `id=eq.${id}`, { is_active: false });
};

// ── VENDORS ───────────────────────────────────────────────────────
export const fetchVendors = async () => {
  const data = await get("vendors", "is_active=eq.true&order=name");
  return data.map((v) => ({
    id: v.id, name: v.name, contact: v.contact_person || "",
    phone: v.phone || "", gstin: v.gstin || "", state: v.state || "",
    intra: v.is_intra_state, terms: v.payment_terms || 30, category: v.category || "",
  }));
};

export const upsertVendor = async (vendor) => {
  const row = {
    id: vendor.id || undefined, name: vendor.name, contact_person: vendor.contact,
    phone: vendor.phone, gstin: vendor.gstin, state: vendor.state,
    is_intra_state: vendor.intra, payment_terms: vendor.terms, category: vendor.category,
  };
  const rows = await upsert("vendors", row);
  return { ...vendor, id: rows[0].id };
};

export const deleteVendor = async (id) => {
  await patch("vendors", `id=eq.${id}`, { is_active: false });
};

// ── ITEMS ─────────────────────────────────────────────────────────
export const fetchItems = async () => {
  const data = await get("items", "is_active=eq.true&order=name");
  return data.map((i) => ({
    id: i.id, name: i.name, unit: i.unit, category: i.category || "",
    hsn: i.hsn_code || "", gst: i.gst_rate || 0, vid: "",
  }));
};

export const upsertItem = async (item) => {
  const row = {
    id: item.id || undefined, name: item.name, unit: item.unit,
    category: item.category, hsn_code: item.hsn, gst_rate: item.gst,
  };
  const rows = await upsert("items", row);
  return { ...item, id: rows[0].id };
};

export const deleteItem = async (id) => {
  await patch("items", `id=eq.${id}`, { is_active: false });
};

// ── PURCHASE ORDERS ───────────────────────────────────────────────
export const fetchPurchaseOrders = async () => {
  const data = await get("purchase_orders", "select=*,po_lines(*)&order=created_at.desc");
  return data.map((po) => ({
    id: po.id, num: po.po_number, date: po.created_at?.slice(0, 10),
    by: po.placed_by_name || "", status: po.status, vid: po.vendor_id,
    lines: (po.po_lines || []).map((l) => ({
      iid: l.item_id, name: l.item_name, qty: Number(l.qty), unit: l.unit,
      vid: po.vendor_id, vname: "", delDate: l.delivery_date || "", notes: l.notes || "",
    })),
    total: 0,
  }));
};

export const createPurchaseOrder = async (po, staffId) => {
  const numData = await rpc("generate_po_number");
  const poNumber = numData || po.num;
  const rows = await post("purchase_orders", {
    po_number: poNumber, vendor_id: toUUID(po.vid), placed_by: toUUID(staffId),
    placed_by_name: po.by, status: po.status || "draft", notes: po.notes || "",
  });
  const d = rows[0];
  const lines = po.lines.map((l) => ({
    po_id: d.id, item_id: l.iid, item_name: l.name,
    qty: l.qty, unit: l.unit, delivery_date: l.delDate || null, notes: l.notes || "",
  }));
  if (lines.length > 0) await post("po_lines", lines);
  return { ...po, id: d.id, num: poNumber };
};

export const updatePOStatus = async (poId, status) => {
  await patch("purchase_orders", `id=eq.${poId}`, { status, updated_at: new Date().toISOString() });
};

// ── GRNs ──────────────────────────────────────────────────────────
export const fetchGRNs = async () => {
  const data = await get("grns", "select=*,grn_lines(*)&order=created_at.desc");
  return data.map((g) => ({
    id: g.id, grnNum: g.grn_number, poId: g.po_id, poNum: g.po_number || "",
    vid: g.vendor_id, date: g.received_date || g.created_at?.slice(0, 10),
    signOff: g.sign_off_name, hasDisc: g.has_discrepancy,
    vendorInvNum: g.vendor_invoice_number || "", notes: g.notes || "",
    lines: (g.grn_lines || []).map((l) => ({
      iid: l.item_id, name: l.item_name, qty: Number(l.qty_ordered),
      qtyRec: Number(l.qty_received), unit: l.unit,
      discReason: l.discrepancy_reason || "", discNotes: l.discrepancy_notes || "",
    })),
  }));
};

export const createGRN = async (grn) => {
  const numData = await rpc("generate_grn_number");
  const grnNumber = numData || grn.grnNum;
  const rows = await post("grns", {
    grn_number: grnNumber, po_id: grn.poId, po_number: grn.poNum,
    vendor_id: toUUID(grn.vid), received_by_name: grn.signOff, sign_off_name: grn.signOff,
    has_discrepancy: grn.hasDisc, vendor_invoice_number: grn.vendorInvNum || "", notes: grn.notes || "",
  });
  const d = rows[0];
  const lines = grn.lines.map((l) => ({
    grn_id: d.id, item_id: l.iid, item_name: l.name, unit: l.unit,
    qty_ordered: l.qty, qty_received: l.qtyRec,
    discrepancy_reason: l.discReason || null, discrepancy_notes: l.discNotes || null,
  }));
  if (lines.length > 0) await post("grn_lines", lines);
  return { ...grn, id: d.id, grnNum: grnNumber };
};

export const updateGRNVendorInvoice = async (grnId, vendorInvNum) => {
  await patch("grns", `id=eq.${grnId}`, { vendor_invoice_number: vendorInvNum });
};

// ── INVOICES ──────────────────────────────────────────────────────
export const fetchInvoices = async () => {
  const data = await get("invoices", "select=*,invoice_lines(*)&order=created_at.desc");
  return data.map((inv) => ({
    id: inv.id, num: inv.invoice_number, grnId: inv.grn_id, grnNum: inv.grn_number || "",
    poNum: inv.po_number || "", vid: inv.vendor_id, vname: inv.vendor_name || "",
    vgstin: inv.vendor_gstin || "", intra: inv.is_intra_state,
    date: inv.invoice_date || inv.created_at?.slice(0, 10), due: inv.due_date,
    base: Number(inv.base_total), cgst: Number(inv.cgst), sgst: Number(inv.sgst),
    igst: Number(inv.igst), totalGST: Number(inv.total_with_gst),
    vendorInvNum: inv.vendor_invoice_number || "",
    lines: (inv.invoice_lines || []).map((l) => ({
      iid: l.item_id, name: l.item_name, qty: Number(l.qty), unit: l.unit,
      price: Number(l.unit_price), gst: Number(l.gst_rate), hsn: l.hsn_code || "",
      lineBase: Number(l.line_base),
    })),
    extra: inv.extra_charges > 0
      ? { label: inv.extra_charges_label || "Extra", amt: Number(inv.extra_charges) }
      : null,
  }));
};

export const createInvoice = async (inv) => {
  const numData = await rpc("generate_invoice_number");
  const invNumber = numData || inv.num;
  const rows = await post("invoices", {
    invoice_number: invNumber, grn_id: inv.grnId, grn_number: inv.grnNum,
    po_number: inv.poNum, vendor_id: toUUID(inv.vid), vendor_name: inv.vname,
    vendor_gstin: inv.vgstin, vendor_invoice_number: inv.vendorInvNum,
    is_intra_state: inv.intra, due_date: inv.due, base_total: inv.base,
    extra_charges: inv.extra?.amt || 0, extra_charges_label: inv.extra?.label || "",
    cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst,
    total_with_gst: inv.totalGST, created_by_name: inv.createdBy || "",
  });
  const d = rows[0];
  const lines = inv.lines.map((l) => ({
    invoice_id: d.id, item_id: l.iid, item_name: l.name, hsn_code: l.hsn,
    qty: l.qty, unit: l.unit, unit_price: l.price, gst_rate: l.gst, line_base: l.lineBase,
  }));
  if (lines.length > 0) await post("invoice_lines", lines);
  return { ...inv, id: d.id, num: invNumber };
};

// ── PAYMENTS ──────────────────────────────────────────────────────
export const fetchPayments = async () => {
  const data = await get("payments", "order=created_at.desc");
  return data.map((p) => ({
    id: p.id, invId: p.invoice_id, vid: p.vendor_id, amount: Number(p.amount),
    date: p.payment_date, method: p.method || "", ref: p.reference_number || "",
    by: p.recorded_by_name || "",
  }));
};

export const createPayment = async (payment) => {
  const rows = await post("payments", {
    invoice_id: toUUID(payment.invId), vendor_id: toUUID(payment.vid), amount: payment.amount,
    payment_date: payment.date, method: payment.method,
    reference_number: payment.ref, recorded_by_name: payment.by,
  });
  return { ...payment, id: rows[0].id };
};

// ── CREDIT NOTES ──────────────────────────────────────────────────
export const fetchCreditNotes = async () => {
  const data = await get("credit_notes", "select=*,credit_note_lines(*)&order=created_at.desc");
  return data.map((cn) => ({
    id: cn.id, num: cn.cn_number, grnId: cn.grn_id, grnNum: cn.grn_number || "",
    invId: cn.invoice_id, vid: cn.vendor_id, vname: cn.vendor_name || "",
    reason: cn.reason, base: Number(cn.base_total), cgst: Number(cn.cgst),
    sgst: Number(cn.sgst), igst: Number(cn.igst), totalGST: Number(cn.total_with_gst),
    date: cn.cn_date || cn.created_at?.slice(0, 10),
    lines: (cn.credit_note_lines || []).map((l) => ({
      iid: l.item_id, name: l.item_name, unit: l.unit,
      returnQty: Number(l.return_qty), price: Number(l.unit_price),
      reason: l.reason || "", lineBase: Number(l.line_base),
    })),
  }));
};

export const createCreditNote = async (cn) => {
  const numData = await rpc("generate_cn_number");
  const cnNumber = numData || cn.num;
  const rows = await post("credit_notes", {
    cn_number: cnNumber, grn_id: cn.grnId, grn_number: cn.grnNum,
    invoice_id: toUUID(cn.invId), vendor_id: toUUID(cn.vid), vendor_name: cn.vname,
    reason: cn.reason, base_total: cn.base, cgst: cn.cgst, sgst: cn.sgst,
    igst: cn.igst, total_with_gst: cn.totalGST, created_by_name: cn.createdBy || "",
  });
  const d = rows[0];
  const lines = cn.lines.filter((l) => l.returnQty > 0).map((l) => ({
    credit_note_id: d.id, item_id: l.iid, item_name: l.name, unit: l.unit,
    return_qty: l.returnQty, unit_price: l.price, reason: l.reason, line_base: l.lineBase,
  }));
  if (lines.length > 0) await post("credit_note_lines", lines);
  return { ...cn, id: d.id, num: cnNumber };
};

// ── PRICE HISTORY ─────────────────────────────────────────────────
export const savePriceHistory = async (entries) => {
  const rows = entries.map((e) => ({
    item_id: toUUID(e.iid), vendor_id: toUUID(e.vid), item_name: e.name,
    vendor_name: e.vname, unit_price: e.price, source: "grn",
  }));
  await post("price_history", rows);
};

export const fetchPriceHistory = async () => {
  const data = await get("price_history", "order=created_at.desc&limit=500");
  return data.map((p) => ({
    iid: p.item_id, vid: p.vendor_id, name: p.item_name,
    vname: p.vendor_name, price: Number(p.unit_price), date: p.recorded_date,
  }));
};
