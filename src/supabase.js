// ═══════════════════════════════════════════════════════════════════
// SUPABASE REST CLIENT — Novy Procurement System (v4 — master debug)
// ═══════════════════════════════════════════════════════════════════
// Uses fetch directly against Supabase's PostgREST API — no npm package needed.
// 1. Go to supabase.com → create project
// 2. Run supabase-schema-v3.sql in SQL Editor
// 3. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env or Vercel
// ═══════════════════════════════════════════════════════════════════

const URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const REST = `${URL}/rest/v1`;

// ── UUID validation ─────────────────────────────────────────────
// Real UUID: 550e8400-e29b-41d4-a716-446655440000  (36 chars)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (v) => typeof v === "string" && UUID_RE.test(v);

// Convert to UUID or null. Catches SEED IDs like "s1","v1","i1","mgr","unknown"
const toUUID = (v) => (isUUID(v) ? v : null);

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

async function del(table, query) {
  const r = await fetch(`${REST}/${table}?${query}`, {
    method: "DELETE", headers: hdrs(),
  });
  if (!r.ok) throw new Error(`DELETE ${table}: ${r.status} ${await r.text()}`);
}

async function rpc(fnName) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fnName}`, {
    method: "POST", headers: hdrs(), body: "{}",
  });
  if (!r.ok) return null;
  const data = await r.json();
  return typeof data === "string" ? data : null;
}

// ── STAFF ─────────────────────────────────────────────────────────
export const fetchStaff = async () => {
  const data = await get("staff", "is_active=eq.true&order=name");
  return data.map((s) => ({ id: s.id, name: s.name, role: s.role }));
};

export const upsertStaff = async (staff) => {
  // If id is a SEED id (not UUID), omit it so Supabase generates one
  const row = { name: staff.name, role: staff.role };
  if (isUUID(staff.id)) row.id = staff.id;
  const rows = await upsert("staff", row);
  const d = rows[0];
  return { id: d.id, name: d.name, role: d.role };
};

export const deleteStaff = async (id) => {
  if (!isUUID(id)) return; // SEED id — nothing to delete in Supabase
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
    name: vendor.name, contact_person: vendor.contact,
    phone: vendor.phone, gstin: vendor.gstin, state: vendor.state,
    is_intra_state: vendor.intra, payment_terms: vendor.terms, category: vendor.category,
  };
  if (isUUID(vendor.id)) row.id = vendor.id;
  const rows = await upsert("vendors", row);
  return { ...vendor, id: rows[0].id };
};

export const deleteVendor = async (id) => {
  if (!isUUID(id)) return;
  await patch("vendors", `id=eq.${id}`, { is_active: false });
};

// ── ITEMS ─────────────────────────────────────────────────────────
export const fetchItems = async () => {
  const [data, viData] = await Promise.all([
    get("items", "is_active=eq.true&order=name"),
    get("vendor_items", "select=item_id,vendor_id"),
  ]);
  // Build item→vendor map (use first match per item)
  const viMap = {};
  viData.forEach(vi => { if (!viMap[vi.item_id]) viMap[vi.item_id] = vi.vendor_id; });
  return data.map((i) => ({
    id: i.id, name: i.name, unit: i.unit, category: i.category || "",
    hsn: i.hsn_code || "", gst: i.gst_rate || 0, vid: viMap[i.id] || "",
  }));
};

export const upsertItem = async (item) => {
  const row = {
    name: item.name, unit: item.unit,
    category: item.category || null, hsn_code: item.hsn || null, gst_rate: item.gst || 0,
  };
  if (isUUID(item.id)) row.id = item.id;
  const rows = await upsert("items", row);
  const itemId = rows[0].id;

  // Also upsert vendor_items mapping if vendor is provided
  if (isUUID(item.vid)) {
    await upsert("vendor_items", { item_id: itemId, vendor_id: item.vid });
  }

  return { ...item, id: itemId };
};

export const deleteItem = async (id) => {
  if (!isUUID(id)) return;
  await patch("items", `id=eq.${id}`, { is_active: false });
};

// ── VENDOR-ITEM MAPPING ─────────────────────────────────────────
export const upsertVendorItem = async (itemId, vendorId) => {
  if (!isUUID(itemId) || !isUUID(vendorId)) return;
  await upsert("vendor_items", { item_id: itemId, vendor_id: vendorId });
};

// ── PURCHASE ORDERS ───────────────────────────────────────────────
export const fetchPurchaseOrders = async () => {
  const data = await get("purchase_orders", "select=*,po_lines(*)&order=created_at.desc");
  return data.map((po) => ({
    id: po.id, num: po.po_number, date: po.created_at?.slice(0, 10),
    by: po.placed_by_name || "", status: po.status, vid: po.vendor_id || "",
    lines: (po.po_lines || []).map((l) => ({
      iid: l.item_id, name: l.item_name, qty: Number(l.qty), unit: l.unit,
      vid: l.vendor_id || po.vendor_id || "", vname: "", delDate: l.delivery_date || "", notes: l.notes || "",
    })),
    total: 0,
  }));
};

// Save a draft PO — vendor is optional (staff can create without vendor)
export const saveDraftPO = async (po, staffId) => {
  const vendorId = toUUID(po.vid) || null; // NULL is fine for drafts
  const poNumber = (await rpc("generate_po_number")) || po.num;
  const body = {
    po_number: poNumber, vendor_id: vendorId,
    placed_by_name: po.by || "", status: "draft",
  };
  if (isUUID(po.id)) body.id = po.id;
  const staffUUID = toUUID(staffId);
  if (staffUUID) body.placed_by = staffUUID;

  console.log("[novy] Saving draft PO:", JSON.stringify(body));
  const rows = await post("purchase_orders", body);
  const d = rows[0];

  // Save lines — each line can have its own vendor_id for per-line assignment
  const lines = po.lines.filter(l => isUUID(l.iid)).map((l) => ({
    po_id: d.id, item_id: l.iid, item_name: l.name,
    qty: Number(l.qty), unit: l.unit, vendor_id: toUUID(l.vid) || null,
    delivery_date: l.delDate || null, notes: l.notes || "",
  }));
  if (lines.length > 0) await post("po_lines", lines);
  return { ...po, id: d.id, num: poNumber };
};

// Update an existing draft PO (lines + vendor assignments)
export const updateDraftPO = async (po) => {
  if (!isUUID(po.id)) return;
  const vendorId = toUUID(po.vid) || null;
  await patch("purchase_orders", `id=eq.${po.id}`, {
    vendor_id: vendorId, updated_at: new Date().toISOString(),
  });
  // Delete old lines and re-insert (simplest approach for draft edits)
  await del("po_lines", `po_id=eq.${po.id}`);
  const lines = po.lines.filter(l => isUUID(l.iid)).map((l) => ({
    po_id: po.id, item_id: l.iid, item_name: l.name,
    qty: Number(l.qty), unit: l.unit, vendor_id: toUUID(l.vid) || null,
    delivery_date: l.delDate || null, notes: l.notes || "",
  }));
  if (lines.length > 0) await post("po_lines", lines);
};

// Delete a draft PO (used when splitting into vendor-specific POs on "Mark Sent")
export const deleteDraftPO = async (poId) => {
  if (!isUUID(poId)) return;
  await del("po_lines", `po_id=eq.${poId}`);
  await del("purchase_orders", `id=eq.${poId}`);
};

export const createPurchaseOrder = async (po, staffId) => {
  const vendorId = toUUID(po.vid);
  if (!vendorId) throw new Error("No vendor assigned — select a vendor before ordering");

  const poNumber = (await rpc("generate_po_number")) || po.num;
  const body = {
    po_number: poNumber, vendor_id: vendorId,
    placed_by_name: po.by || "", status: po.status || "draft",
  };
  // Send the local UUID so Supabase uses it (keeps local & remote IDs in sync)
  if (isUUID(po.id)) body.id = po.id;
  const staffUUID = toUUID(staffId);
  if (staffUUID) body.placed_by = staffUUID;

  console.log("[novy] Creating PO:", JSON.stringify(body));
  const rows = await post("purchase_orders", body);
  const d = rows[0];

  // Filter out lines with non-UUID item ids (SEED items)
  const lines = po.lines.filter(l => isUUID(l.iid)).map((l) => ({
    po_id: d.id, item_id: l.iid, item_name: l.name,
    qty: Number(l.qty), unit: l.unit, delivery_date: l.delDate || null, notes: l.notes || "",
  }));
  console.log("[novy] PO lines:", lines.length);
  if (lines.length > 0) await post("po_lines", lines);
  return { ...po, id: d.id, num: poNumber };
};

export const updatePOStatus = async (poId, status) => {
  if (!isUUID(poId)) return; // Local-only PO
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
  const vendorId = toUUID(grn.vid);
  const poId = toUUID(grn.poId);
  if (!vendorId) throw new Error("GRN: vendor ID is not valid");
  if (!poId) throw new Error("GRN: PO was not synced to database yet");

  const grnNumber = (await rpc("generate_grn_number")) || grn.grnNum;
  const body = {
    grn_number: grnNumber, po_id: poId, po_number: grn.poNum,
    vendor_id: vendorId, received_by_name: grn.signOff, sign_off_name: grn.signOff,
    has_discrepancy: grn.hasDisc, vendor_invoice_number: grn.vendorInvNum || "", notes: grn.notes || "",
  };
  // Send the local UUID so Supabase uses it (keeps IDs in sync for FK references)
  if (isUUID(grn.id)) body.id = grn.id;
  const rows = await post("grns", body);
  const d = rows[0];

  const lines = grn.lines.filter(l => isUUID(l.iid)).map((l) => ({
    grn_id: d.id, item_id: l.iid, item_name: l.name, unit: l.unit,
    qty_ordered: Number(l.qty), qty_received: Number(l.qtyRec),
    discrepancy_reason: l.discReason || null, discrepancy_notes: l.discNotes || null,
  }));
  if (lines.length > 0) await post("grn_lines", lines);
  return { ...grn, id: d.id, grnNum: grnNumber };
};

export const updateGRNVendorInvoice = async (grnId, vendorInvNum) => {
  if (!isUUID(grnId)) return;
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
  const vendorId = toUUID(inv.vid);
  const grnId = toUUID(inv.grnId);
  if (!vendorId) throw new Error("Invoice: vendor ID is not valid");

  const invNumber = (await rpc("generate_invoice_number")) || inv.num;
  const body = {
    invoice_number: invNumber, grn_number: inv.grnNum,
    po_number: inv.poNum, vendor_id: vendorId, vendor_name: inv.vname,
    vendor_gstin: inv.vgstin, vendor_invoice_number: inv.vendorInvNum,
    is_intra_state: inv.intra, due_date: inv.due, base_total: inv.base,
    extra_charges: inv.extra?.amt || 0, extra_charges_label: inv.extra?.label || "",
    cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst,
    total_with_gst: inv.totalGST, created_by_name: inv.createdBy || "",
  };
  if (isUUID(inv.id)) body.id = inv.id;
  if (grnId) body.grn_id = grnId;

  const rows = await post("invoices", body);
  const d = rows[0];

  const lines = inv.lines.filter(l => isUUID(l.iid)).map((l) => ({
    invoice_id: d.id, item_id: l.iid, item_name: l.name, hsn_code: l.hsn,
    qty: Number(l.qty), unit: l.unit, unit_price: Number(l.price),
    gst_rate: Number(l.gst), line_base: Number(l.lineBase),
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
  const invoiceId = toUUID(payment.invId);
  const vendorId = toUUID(payment.vid);
  if (!invoiceId) throw new Error("Payment: invoice not synced to DB");
  if (!vendorId) throw new Error("Payment: vendor ID is not valid");

  const body = {
    invoice_id: invoiceId, vendor_id: vendorId, amount: payment.amount,
    payment_date: payment.date, method: payment.method,
    reference_number: payment.ref, recorded_by_name: payment.by,
  };
  if (isUUID(payment.id)) body.id = payment.id;
  const rows = await post("payments", body);
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
  const vendorId = toUUID(cn.vid);
  if (!vendorId) throw new Error("Credit note: vendor ID is not valid");

  const cnNumber = (await rpc("generate_cn_number")) || cn.num;
  const body = {
    cn_number: cnNumber, grn_number: cn.grnNum,
    vendor_id: vendorId, vendor_name: cn.vname,
    reason: cn.reason, base_total: cn.base, cgst: cn.cgst, sgst: cn.sgst,
    igst: cn.igst, total_with_gst: cn.totalGST, created_by_name: cn.createdBy || "",
  };
  if (isUUID(cn.id)) body.id = cn.id;
  const grnId = toUUID(cn.grnId);
  const invId = toUUID(cn.invId);
  if (grnId) body.grn_id = grnId;
  if (invId) body.invoice_id = invId;

  const rows = await post("credit_notes", body);
  const d = rows[0];

  const lines = cn.lines.filter(l => l.returnQty > 0 && isUUID(l.iid)).map((l) => ({
    credit_note_id: d.id, item_id: l.iid, item_name: l.name, unit: l.unit,
    return_qty: Number(l.returnQty), unit_price: Number(l.price),
    reason: l.reason, line_base: Number(l.lineBase),
  }));
  if (lines.length > 0) await post("credit_note_lines", lines);
  return { ...cn, id: d.id, num: cnNumber };
};

// ── PRICE HISTORY ─────────────────────────────────────────────────
export const savePriceHistory = async (entries) => {
  // Filter out entries with non-UUID item/vendor ids
  const rows = entries
    .filter(e => isUUID(e.iid) && isUUID(e.vid))
    .map((e) => ({
      item_id: e.iid, vendor_id: e.vid, item_name: e.name,
      vendor_name: e.vname, unit_price: e.price, source: "grn",
    }));
  if (rows.length > 0) await post("price_history", rows);
};

export const fetchPriceHistory = async () => {
  const data = await get("price_history", "order=created_at.desc&limit=500");
  return data.map((p) => ({
    id: p.id, iid: p.item_id, vid: p.vendor_id, name: p.item_name,
    vname: p.vendor_name, price: Number(p.unit_price), date: p.recorded_date,
  }));
};

// ── DIAGNOSTICS ──────────────────────────────────────────────────
export const diagnose = async () => {
  const results = [];
  const log = (msg) => { console.log("[diag]", msg); results.push(msg); };

  // 1. Check env vars
  if (!URL) { log("✗ VITE_SUPABASE_URL is not set!"); return results; }
  if (!KEY) { log("✗ VITE_SUPABASE_ANON_KEY is not set!"); return results; }
  log(`✓ URL: ${URL}`);
  log(`✓ KEY: ${KEY.slice(0, 20)}...`);

  // 2. Test reads
  for (const t of ["staff", "vendors", "items", "vendor_items", "purchase_orders", "grns", "invoices"]) {
    try {
      const d = await get(t, "limit=1");
      log(`✓ READ ${t}: OK (${d.length} sample rows)`);
    } catch (e) { log(`✗ READ ${t}: ${e.message}`); }
  }

  // 3. Test write
  try {
    const vendors = await get("vendors", "limit=1&select=id");
    if (!vendors[0]) { log("✗ No vendors — cannot test write"); }
    else {
      const testNum = `TEST-${Date.now()}`;
      const r = await fetch(`${REST}/purchase_orders`, {
        method: "POST", headers: hdrs(), body: JSON.stringify({
          po_number: testNum, vendor_id: vendors[0].id, status: "draft",
        }),
      });
      const body = await r.text();
      if (r.ok) {
        log(`✓ WRITE purchase_orders: OK`);
        try { const d = JSON.parse(body); await del("purchase_orders", `id=eq.${d[0]?.id}`); log("  (test row cleaned up)"); } catch (_) {}
      } else {
        log(`✗ WRITE purchase_orders: ${r.status} ${body}`);
      }
    }
  } catch (e) { log(`✗ WRITE test error: ${e.message}`); }

  // 4. Check RPC functions
  for (const fn of ["generate_po_number", "generate_grn_number", "generate_invoice_number", "generate_cn_number"]) {
    const r = await rpc(fn);
    log(r ? `✓ RPC ${fn}: "${r}"` : `⚠ RPC ${fn}: not found (using local fallback)`);
  }

  console.log("\n=== DIAGNOSIS ===\n" + results.join("\n"));
  return results;
};
