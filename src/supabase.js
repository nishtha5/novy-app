// ═══════════════════════════════════════════════════════════════════
// SUPABASE CLIENT — Novy Procurement System
// ═══════════════════════════════════════════════════════════════════
// 1. Go to supabase.com → create project
// 2. Run supabase-schema-v3.sql in SQL Editor
// 3. Copy your Project URL and anon key below
// 4. npm install @supabase/supabase-js
// ═══════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "YOUR_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── STAFF ─────────────────────────────────────────────────────────
export const fetchStaff = async () => {
  const { data, error } = await supabase
    .from("staff")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
  }));
};

export const upsertStaff = async (staff) => {
  const { data, error } = await supabase
    .from("staff")
    .upsert({ id: staff.id || undefined, name: staff.name, role: staff.role })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, role: data.role };
};

export const deleteStaff = async (id) => {
  const { error } = await supabase
    .from("staff")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw error;
};

// ── VENDORS ───────────────────────────────────────────────────────
export const fetchVendors = async () => {
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data.map((v) => ({
    id: v.id,
    name: v.name,
    contact: v.contact_person || "",
    phone: v.phone || "",
    gstin: v.gstin || "",
    state: v.state || "",
    intra: v.is_intra_state,
    terms: v.payment_terms || 30,
    category: v.category || "",
  }));
};

export const upsertVendor = async (vendor) => {
  const row = {
    id: vendor.id || undefined,
    name: vendor.name,
    contact_person: vendor.contact,
    phone: vendor.phone,
    gstin: vendor.gstin,
    state: vendor.state,
    is_intra_state: vendor.intra,
    payment_terms: vendor.terms,
    category: vendor.category,
  };
  const { data, error } = await supabase
    .from("vendors")
    .upsert(row)
    .select()
    .single();
  if (error) throw error;
  return { ...vendor, id: data.id };
};

export const deleteVendor = async (id) => {
  const { error } = await supabase
    .from("vendors")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw error;
};

// ── ITEMS ─────────────────────────────────────────────────────────
export const fetchItems = async () => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data.map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    category: i.category || "",
    hsn: i.hsn_code || "",
    gst: i.gst_rate || 0,
    vid: "", // vendor mapping done via vendor_items table
  }));
};

export const upsertItem = async (item) => {
  const row = {
    id: item.id || undefined,
    name: item.name,
    unit: item.unit,
    category: item.category,
    hsn_code: item.hsn,
    gst_rate: item.gst,
  };
  const { data, error } = await supabase
    .from("items")
    .upsert(row)
    .select()
    .single();
  if (error) throw error;
  return { ...item, id: data.id };
};

export const deleteItem = async (id) => {
  const { error } = await supabase
    .from("items")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw error;
};

// ── PURCHASE ORDERS ───────────────────────────────────────────────
export const fetchPurchaseOrders = async () => {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(`
      *,
      po_lines (*)
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((po) => ({
    id: po.id,
    num: po.po_number,
    date: po.created_at?.slice(0, 10),
    by: po.placed_by_name || "",
    status: po.status,
    vid: po.vendor_id,
    lines: (po.po_lines || []).map((l) => ({
      iid: l.item_id,
      name: l.item_name,
      qty: Number(l.qty),
      unit: l.unit,
      vid: po.vendor_id,
      vname: "",
      delDate: l.delivery_date || "",
      notes: l.notes || "",
    })),
    total: 0,
  }));
};

export const createPurchaseOrder = async (po, staffId) => {
  // Generate PO number
  const { data: numData } = await supabase.rpc("generate_po_number");
  const poNumber = numData || po.num;

  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({
      po_number: poNumber,
      vendor_id: po.vid,
      placed_by: staffId,
      placed_by_name: po.by,
      status: po.status || "draft",
      notes: po.notes || "",
    })
    .select()
    .single();
  if (error) throw error;

  // Insert PO lines
  const lines = po.lines.map((l) => ({
    po_id: data.id,
    item_id: l.iid,
    item_name: l.name,
    qty: l.qty,
    unit: l.unit,
    delivery_date: l.delDate || null,
    notes: l.notes || "",
  }));
  const { error: lineErr } = await supabase.from("po_lines").insert(lines);
  if (lineErr) throw lineErr;

  return { ...po, id: data.id, num: poNumber };
};

export const updatePOStatus = async (poId, status) => {
  const { error } = await supabase
    .from("purchase_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", poId);
  if (error) throw error;
};

// ── GRNs ──────────────────────────────────────────────────────────
export const fetchGRNs = async () => {
  const { data, error } = await supabase
    .from("grns")
    .select(`
      *,
      grn_lines (*)
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((g) => ({
    id: g.id,
    grnNum: g.grn_number,
    poId: g.po_id,
    poNum: g.po_number || "",
    vid: g.vendor_id,
    date: g.received_date || g.created_at?.slice(0, 10),
    signOff: g.sign_off_name,
    hasDisc: g.has_discrepancy,
    vendorInvNum: g.vendor_invoice_number || "",
    notes: g.notes || "",
    lines: (g.grn_lines || []).map((l) => ({
      iid: l.item_id,
      name: l.item_name,
      qty: Number(l.qty_ordered),
      qtyRec: Number(l.qty_received),
      unit: l.unit,
      discReason: l.discrepancy_reason || "",
      discNotes: l.discrepancy_notes || "",
    })),
  }));
};

export const createGRN = async (grn) => {
  const { data: numData } = await supabase.rpc("generate_grn_number");
  const grnNumber = numData || grn.grnNum;

  const { data, error } = await supabase
    .from("grns")
    .insert({
      grn_number: grnNumber,
      po_id: grn.poId,
      po_number: grn.poNum,
      vendor_id: grn.vid,
      received_by_name: grn.signOff,
      sign_off_name: grn.signOff,
      has_discrepancy: grn.hasDisc,
      vendor_invoice_number: grn.vendorInvNum || "",
      notes: grn.notes || "",
    })
    .select()
    .single();
  if (error) throw error;

  const lines = grn.lines.map((l) => ({
    grn_id: data.id,
    item_id: l.iid,
    item_name: l.name,
    unit: l.unit,
    qty_ordered: l.qty,
    qty_received: l.qtyRec,
    discrepancy_reason: l.discReason || null,
    discrepancy_notes: l.discNotes || null,
  }));
  const { error: lineErr } = await supabase.from("grn_lines").insert(lines);
  if (lineErr) throw lineErr;

  return { ...grn, id: data.id, grnNum: grnNumber };
};

export const updateGRNVendorInvoice = async (grnId, vendorInvNum) => {
  const { error } = await supabase
    .from("grns")
    .update({ vendor_invoice_number: vendorInvNum })
    .eq("id", grnId);
  if (error) throw error;
};

// ── INVOICES ──────────────────────────────────────────────────────
export const fetchInvoices = async () => {
  const { data, error } = await supabase
    .from("invoices")
    .select(`*, invoice_lines (*)`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((inv) => ({
    id: inv.id,
    num: inv.invoice_number,
    grnId: inv.grn_id,
    grnNum: inv.grn_number || "",
    poNum: inv.po_number || "",
    vid: inv.vendor_id,
    vname: inv.vendor_name || "",
    vgstin: inv.vendor_gstin || "",
    intra: inv.is_intra_state,
    date: inv.invoice_date || inv.created_at?.slice(0, 10),
    due: inv.due_date,
    base: Number(inv.base_total),
    cgst: Number(inv.cgst),
    sgst: Number(inv.sgst),
    igst: Number(inv.igst),
    totalGST: Number(inv.total_with_gst),
    vendorInvNum: inv.vendor_invoice_number || "",
    lines: (inv.invoice_lines || []).map((l) => ({
      iid: l.item_id,
      name: l.item_name,
      qty: Number(l.qty),
      unit: l.unit,
      price: Number(l.unit_price),
      gst: Number(l.gst_rate),
      hsn: l.hsn_code || "",
      lineBase: Number(l.line_base),
    })),
    extra: inv.extra_charges > 0
      ? { label: inv.extra_charges_label || "Extra", amt: Number(inv.extra_charges) }
      : null,
  }));
};

export const createInvoice = async (inv) => {
  const { data: numData } = await supabase.rpc("generate_invoice_number");
  const invNumber = numData || inv.num;

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: invNumber,
      grn_id: inv.grnId,
      grn_number: inv.grnNum,
      po_number: inv.poNum,
      vendor_id: inv.vid,
      vendor_name: inv.vname,
      vendor_gstin: inv.vgstin,
      vendor_invoice_number: inv.vendorInvNum,
      is_intra_state: inv.intra,
      due_date: inv.due,
      base_total: inv.base,
      extra_charges: inv.extra?.amt || 0,
      extra_charges_label: inv.extra?.label || "",
      cgst: inv.cgst,
      sgst: inv.sgst,
      igst: inv.igst,
      total_with_gst: inv.totalGST,
      created_by_name: inv.createdBy || "",
    })
    .select()
    .single();
  if (error) throw error;

  const lines = inv.lines.map((l) => ({
    invoice_id: data.id,
    item_id: l.iid,
    item_name: l.name,
    hsn_code: l.hsn,
    qty: l.qty,
    unit: l.unit,
    unit_price: l.price,
    gst_rate: l.gst,
    line_base: l.lineBase,
  }));
  const { error: lineErr } = await supabase
    .from("invoice_lines")
    .insert(lines);
  if (lineErr) throw lineErr;

  return { ...inv, id: data.id, num: invNumber };
};

// ── PAYMENTS ──────────────────────────────────────────────────────
export const fetchPayments = async () => {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    invId: p.invoice_id,
    vid: p.vendor_id,
    amount: Number(p.amount),
    date: p.payment_date,
    method: p.method || "",
    ref: p.reference_number || "",
    by: p.recorded_by_name || "",
  }));
};

export const createPayment = async (payment) => {
  const { data, error } = await supabase
    .from("payments")
    .insert({
      invoice_id: payment.invId,
      vendor_id: payment.vid,
      amount: payment.amount,
      payment_date: payment.date,
      method: payment.method,
      reference_number: payment.ref,
      recorded_by_name: payment.by,
    })
    .select()
    .single();
  if (error) throw error;
  return { ...payment, id: data.id };
};

// ── CREDIT NOTES ──────────────────────────────────────────────────
export const fetchCreditNotes = async () => {
  const { data, error } = await supabase
    .from("credit_notes")
    .select(`*, credit_note_lines (*)`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((cn) => ({
    id: cn.id,
    num: cn.cn_number,
    grnId: cn.grn_id,
    grnNum: cn.grn_number || "",
    invId: cn.invoice_id,
    vid: cn.vendor_id,
    vname: cn.vendor_name || "",
    reason: cn.reason,
    base: Number(cn.base_total),
    cgst: Number(cn.cgst),
    sgst: Number(cn.sgst),
    igst: Number(cn.igst),
    totalGST: Number(cn.total_with_gst),
    date: cn.cn_date || cn.created_at?.slice(0, 10),
    lines: (cn.credit_note_lines || []).map((l) => ({
      iid: l.item_id,
      name: l.item_name,
      unit: l.unit,
      returnQty: Number(l.return_qty),
      price: Number(l.unit_price),
      reason: l.reason || "",
      lineBase: Number(l.line_base),
    })),
  }));
};

export const createCreditNote = async (cn) => {
  const { data: numData } = await supabase.rpc("generate_cn_number");
  const cnNumber = numData || cn.num;

  const { data, error } = await supabase
    .from("credit_notes")
    .insert({
      cn_number: cnNumber,
      grn_id: cn.grnId,
      grn_number: cn.grnNum,
      invoice_id: cn.invId || null,
      vendor_id: cn.vid,
      vendor_name: cn.vname,
      reason: cn.reason,
      base_total: cn.base,
      cgst: cn.cgst,
      sgst: cn.sgst,
      igst: cn.igst,
      total_with_gst: cn.totalGST,
      created_by_name: cn.createdBy || "",
    })
    .select()
    .single();
  if (error) throw error;

  const lines = cn.lines
    .filter((l) => l.returnQty > 0)
    .map((l) => ({
      credit_note_id: data.id,
      item_id: l.iid,
      item_name: l.name,
      unit: l.unit,
      return_qty: l.returnQty,
      unit_price: l.price,
      reason: l.reason,
      line_base: l.lineBase,
    }));
  const { error: lineErr } = await supabase
    .from("credit_note_lines")
    .insert(lines);
  if (lineErr) throw lineErr;

  return { ...cn, id: data.id, num: cnNumber };
};

// ── PRICE HISTORY ─────────────────────────────────────────────────
export const savePriceHistory = async (entries) => {
  const rows = entries.map((e) => ({
    item_id: e.iid,
    vendor_id: e.vid,
    item_name: e.name,
    vendor_name: e.vname,
    unit_price: e.price,
    source: "grn",
  }));
  const { error } = await supabase.from("price_history").insert(rows);
  if (error) throw error;
};

export const fetchPriceHistory = async () => {
  const { data, error } = await supabase
    .from("price_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data.map((p) => ({
    iid: p.item_id,
    vid: p.vendor_id,
    name: p.item_name,
    vname: p.vendor_name,
    price: Number(p.unit_price),
    date: p.recorded_date,
  }));
};
