-- ═══════════════════════════════════════════════════════════════════
-- NOVY PROCUREMENT SYSTEM — Schema v4 (new tables for expansion)
-- Run this in Supabase SQL Editor AFTER v3 schema is already applied
-- ═══════════════════════════════════════════════════════════════════

-- ── DIRECT ORDERS (purchases outside normal PO flow) ─────────────
CREATE TABLE IF NOT EXISTS direct_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL,
  vendor_id UUID REFERENCES vendors(id),
  vendor_name TEXT,
  invoice_number TEXT,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (paid_status IN ('paid','unpaid','partial')),
  payment_method TEXT,
  payment_date DATE,
  payment_reference TEXT,
  notes TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS direct_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direct_order_id UUID NOT NULL REFERENCES direct_orders(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id),
  item_name TEXT NOT NULL,
  qty NUMERIC(10,2) NOT NULL,
  unit TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  category TEXT,
  gst_rate NUMERIC(5,2) DEFAULT 0,
  hsn_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RPC for direct order number generation
CREATE OR REPLACE FUNCTION generate_do_number()
RETURNS TEXT AS $$
DECLARE
  today_str TEXT;
  seq_num INT;
  result TEXT;
BEGIN
  today_str := to_char(CURRENT_DATE, 'DDMMYYYY');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_number FROM 'DO-' || today_str || '-(\d+)') AS INT)
  ), 0) + 1 INTO seq_num
  FROM direct_orders
  WHERE order_number LIKE 'DO-' || today_str || '-%';
  result := 'DO-' || today_str || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ── REQUISITIONS (dry store issuance tracking) ───────────────────
CREATE TABLE IF NOT EXISTS requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id),
  staff_name TEXT NOT NULL,
  requisition_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requisition_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id),
  item_name TEXT NOT NULL,
  qty NUMERIC(10,2) NOT NULL,
  unit TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requisition_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL REFERENCES requisitions(id),
  line_id UUID REFERENCES requisition_lines(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  action TEXT NOT NULL CHECK (action IN ('edit','delete')),
  edited_by_name TEXT,
  edited_at TIMESTAMPTZ DEFAULT now()
);

-- ── DRY STORE BALANCES (monthly inventory tracking) ──────────────
CREATE TABLE IF NOT EXISTS dry_store_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id),
  item_name TEXT NOT NULL,
  month TEXT NOT NULL,
  opening_balance NUMERIC(10,2) DEFAULT 0,
  closing_balance NUMERIC(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(item_id, month)
);

-- ── PERISHABLE LOGS (daily usage & wastage for veg/butchery) ─────
CREATE TABLE IF NOT EXISTS perishable_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES items(id),
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  qty_used NUMERIC(10,2) NOT NULL DEFAULT 0,
  qty_wasted NUMERIC(10,2) NOT NULL DEFAULT 0,
  logged_by UUID REFERENCES staff(id),
  logged_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── RLS policies (allow anon access like existing tables) ────────
ALTER TABLE direct_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE dry_store_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE perishable_logs ENABLE ROW LEVEL SECURITY;

-- Allow full access for anon role (matching existing table policies)
CREATE POLICY "anon_all_direct_orders" ON direct_orders FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_direct_order_lines" ON direct_order_lines FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_requisitions" ON requisitions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_requisition_lines" ON requisition_lines FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_requisition_edits" ON requisition_edits FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_dry_store_balances" ON dry_store_balances FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_perishable_logs" ON perishable_logs FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── Indexes for performance ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_direct_orders_date ON direct_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_direct_orders_vendor ON direct_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_staff ON requisitions(staff_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_date ON requisitions(requisition_date);
CREATE INDEX IF NOT EXISTS idx_dry_store_balances_month ON dry_store_balances(month);
CREATE INDEX IF NOT EXISTS idx_perishable_logs_date ON perishable_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_perishable_logs_item ON perishable_logs(item_id);
