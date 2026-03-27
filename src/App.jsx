import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import * as db from "./supabase.js";

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════
const MANAGER_PASSWORD = "admin123";
const SETUP_PASSWORD = "setup123";
const UNITS = ["kg","g","litre","ml","piece","dozen","case","btl","can","bag","packet","bottle","box","bunch","tray","slab"];
const GST_RATES = [0, 5, 12, 18, 28];
const DISC_REASONS = ["Short delivery","Damaged in transit","Wrong item","Quality issue","Expired","Packaging issue","Order cancelled by us","Other"];
const COLORS = ["#f97316","#3b82f6","#10b981","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#6366f1","#84cc16"];
const PO_STATUSES = { draft:"Draft", sent_to_vendor:"Sent to Vendor", partially_received:"Partially Received", received:"Received", priced:"Priced", grn_done:"GRN Done", cancelled:"Cancelled" };

// Units that allow decimals (weight/volume) vs whole-number-only (countable)
const DECIMAL_UNITS = new Set(["kg","g","litre","ml"]);
const isDecimalUnit = (u) => DECIMAL_UNITS.has(u);
const qtyStep = (u) => isDecimalUnit(u) ? "0.01" : "1";
const sanitizeQty = (val, unit) => isDecimalUnit(unit) ? Math.round(val * 100) / 100 : Math.round(val);

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════
const uid = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
const R = (n) => "₹" + Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const td = () => new Date().toISOString().slice(0,10);
const addD = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
const fmt = (d) => d ? new Date(d+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const ddmmyyyy = (d) => { const p=d.split("-"); return p[2]+p[1]+p[0]; }; // 2026-03-23 → 23032026

function genNum(prefix, date, existing) {
  const ds = ddmmyyyy(date);
  const same = existing.filter(x => x.num?.includes(`${prefix}-${ds}-`));
  const seq = String(same.length + 1).padStart(3, "0");
  return `${prefix}-${ds}-${seq}`;
}

function calcGST(base,rate,intra){
  const g=base*(rate/100);
  return intra?{cgst:g/2,sgst:g/2,igst:0,total:base+g}:{cgst:0,sgst:0,igst:g,total:base+g};
}

function dlCSV(fn,hd,rows){
  const csv=[hd.join(","),...rows.map(r=>r.map(c=>`"${String(c??"").replace(/"/g,'""')}"`).join(","))].join("\n");
  const b=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(b);
  const a=document.createElement("a"); a.href=url; a.download=fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function printHTML(title, body) {
  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>
    body{font-family:Arial,sans-serif;padding:30px;font-size:13px}
    table{width:100%;border-collapse:collapse;margin:10px 0}
    th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}
    th{background:#f5f5f5;font-weight:600}
    .right{text-align:right} .center{text-align:center}
    h1{font-size:20px;margin:0} h2{font-size:15px;margin:0;color:#555}
    .header{text-align:center;margin-bottom:20px;border-bottom:2px solid #333;padding-bottom:10px}
    .meta{display:flex;justify-content:space-between;margin:10px 0}
    .total-row{font-weight:bold;background:#f9fafb}
    @media print{.no-print{display:none}}
  </style></head><body>${body}
  <div class="no-print" style="margin-top:20px;text-align:center">
    <button onclick="window.print()" style="padding:10px 24px;font-size:14px;background:#f97316;color:white;border:none;border-radius:8px;cursor:pointer">Print / Save as PDF</button>
  </div></body></html>`;
  // Try window.open first, fallback to blob download
  try {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); return; }
  } catch(e) {}
  // Fallback: download as HTML file
  const blob = new Blob([html], {type: "text/html"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = title.replace(/[^a-zA-Z0-9-]/g, "_") + ".html";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════════════════════════════════════════════════════════════
// SEED DATA
// ═══════════════════════════════════════════════════════════════════
const SEED = {
  staff:[
    {id:"s1",name:"Akim",role:"staff"},
    {id:"s2",name:"Amitoj",role:"staff"},
    {id:"s3",name:"Anish",role:"staff"},
    {id:"s4",name:"Anoop Rawat",role:"staff"},
    {id:"s5",name:"Arjun Singh Bisht",role:"staff"},
    {id:"s6",name:"Arun",role:"staff"},
    {id:"s7",name:"Ashok",role:"staff"},
    {id:"s8",name:"Bobby",role:"staff"},
    {id:"s9",name:"Chitra",role:"staff"},
    {id:"s10",name:"Jitendra",role:"staff"},
    {id:"s11",name:"Karthika",role:"staff"},
    {id:"s12",name:"Kushagra",role:"staff"},
    {id:"s13",name:"Lakshay",role:"staff"},
    {id:"s14",name:"Nandini",role:"staff"},
    {id:"s15",name:"Naresh",role:"staff"},
    {id:"s16",name:"Neeraj Singh Rawat",role:"staff"},
    {id:"s17",name:"Pankaj Kumar",role:"staff"},
    {id:"s18",name:"Pankaj Sunar",role:"staff"},
    {id:"s19",name:"Piyush",role:"staff"},
    {id:"s20",name:"Rajveer",role:"staff"},
    {id:"s21",name:"RK Singh (Hero)",role:"staff"},
    {id:"s22",name:"Sagar",role:"staff"},
    {id:"s23",name:"Sanshruti",role:"staff"},
    {id:"s24",name:"Saurav",role:"staff"},
    {id:"s25",name:"Silvia",role:"staff"},
    {id:"s26",name:"Sorin",role:"staff"},
    {id:"s27",name:"Tanush",role:"staff"},
    {id:"s28",name:"Ujjwal Bish",role:"staff"},
    {id:"s29",name:"Varsha",role:"staff"},
    {id:"s30",name:"Varun",role:"staff"},
    {id:"s31",name:"Yashdeep",role:"staff"},
  ],
  vendors:[
    {id:"v1",name:"Chenab Impex",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Imports"},
    {id:"v2",name:"Gourmet Foods",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Gourmet"},
    {id:"v3",name:"Grahini Super Store",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Grocery"},
    {id:"v4",name:"Jahid Chicken",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Poultry"},
    {id:"v5",name:"Pankaj Kumar Mishra (Vegetable)",contact:"Pankaj Mishra",phone:"",gstin:"",state:"",intra:true,terms:7,category:"Vegetables"},
    {id:"v6",name:"Royal Seas Enterprises",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Seafood"},
    {id:"v7",name:"Veggiesvillage India Pvt Ltd",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Vegetables"},
    {id:"v8",name:"Aamaya Impex",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Imports"},
    {id:"v9",name:"Newby",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Beverages"},
    {id:"v10",name:"Sehgal Office Solutions",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Office Supplies"},
    {id:"v11",name:"Greenways Management (Pest Control)",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Services"},
    {id:"v12",name:"K&A Frozen Water LLP",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Frozen"},
    {id:"v13",name:"Prokitchen Private Limited",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Kitchen Equipment"},
    {id:"v14",name:"Project Sweet Dish - Healthy",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Bakery"},
    {id:"v15",name:"Artisan Bakeshop LLP",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Bakery"},
    {id:"v16",name:"Hema Connoisseur Collections Ltd",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Gourmet"},
    {id:"v17",name:"Dam Good Fish",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Seafood"},
    {id:"v18",name:"Funguys Food",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Specialty"},
    {id:"v19",name:"Krishi Cress",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Microgreens"},
    {id:"v20",name:"Om Sai Puff Pastry",contact:"",phone:"",gstin:"",state:"",intra:true,terms:15,category:"Bakery"},
    {id:"v21",name:"SMS Supply",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"General Supply"},
    {id:"v22",name:"Swami Narayan",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"General Supply"},
    {id:"v23",name:"NG Traders",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Trading"},
    {id:"v24",name:"Digi House",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Electronics"},
    {id:"v25",name:"Radha Krishan & Sons Pvt Ltd",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Dairy"},
    {id:"v26",name:"DRB Foods Pvt Ltd",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Food Processing"},
    {id:"v27",name:"Varun Enterprises",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"General Supply"},
    {id:"v28",name:"Vivanda Gourmet",contact:"",phone:"",gstin:"",state:"",intra:true,terms:30,category:"Gourmet"},
  ],
  items:[
    // ── VEGETABLES & PRODUCE ──
    {id:"i1",name:"Achari Mirch",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i2",name:"Alphonso Mango",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i3",name:"Apple Green (Imported)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i4",name:"Arugula",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i5",name:"Avocado (Imported)",unit:"piece",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i6",name:"Baby Carrot",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i7",name:"Banana",unit:"dozen",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i8",name:"Banana Leaf",unit:"piece",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i9",name:"Basil",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i10",name:"Beetroot",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i11",name:"Beans",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i12",name:"Bhutta Whole (Corn on Cob)",unit:"piece",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i13",name:"Blueberry",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i14",name:"Brinjal Big",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i15",name:"Butternut Squash (Imported)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i16",name:"Capsicum Green",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i17",name:"Carrot",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i18",name:"Cauliflower",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i19",name:"Celery",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i20",name:"Cherry Tomato",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i21",name:"Chinese Cabbage",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i22",name:"Chipsona Potato",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i23",name:"Coconut Dry",unit:"piece",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i24",name:"Coriander",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i25",name:"Cucumber (Imported)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i26",name:"Dill Fresh",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i27",name:"Drumstick",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i28",name:"Edamame Beans",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i29",name:"Edible Flower",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i30",name:"Enoki Mushroom",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i31",name:"Fennel Root",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i32",name:"Galgal Lemon",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i33",name:"Garlic Chinese",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i34",name:"Ginger",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i35",name:"Green Chilli",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i36",name:"Jackfruit",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i37",name:"Kale",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i38",name:"Leek",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i39",name:"Lemon",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i40",name:"Lemon Leaf",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i41",name:"Louki (Bottle Gourd)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i42",name:"Malta (Imported)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i43",name:"Methi (Fenugreek)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i44",name:"Milky Mushroom",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i45",name:"Microgreen",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i46",name:"Mint",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i47",name:"Mushroom (Button)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i48",name:"Onion Large",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i49",name:"Onion Small",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i50",name:"Onion White",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i51",name:"Oyster Mushroom",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i52",name:"Papaya Raw",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i53",name:"Parsley",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i54",name:"Pears (Imported)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i55",name:"Peas Frozen",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i56",name:"Pineapple",unit:"piece",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i57",name:"Plum",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i58",name:"Pak Choi",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i59",name:"Potato Pahari",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i60",name:"Pumpkin Red",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i61",name:"Raspberry",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i62",name:"Red Currant",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i63",name:"Capsicum Red & Yellow",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i64",name:"Rosemary",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i65",name:"Raw Banana",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i66",name:"Tej Patta (Bay Leaf)",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i67",name:"Simji (Shimla Mirch)",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i68",name:"Spinach",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i69",name:"Spring Onion",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i70",name:"Strawberry",unit:"packet",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i71",name:"Sweet Potato",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i72",name:"Thai Red Chilli",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i73",name:"Thyme",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i74",name:"Tomato Salad",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i75",name:"USA Lemon",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i76",name:"Turnip",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    {id:"i77",name:"Thai Galangal",unit:"kg",hsn:"",gst:0,category:"Vegetables & Produce",vid:""},
    // ── OILS ──
    {id:"i78",name:"Sol Extra Virgin Olive Oil 1L",unit:"bottle",hsn:"",gst:5,category:"Oils",vid:""},
    {id:"i79",name:"LKK Sesame Oil 200ml",unit:"bottle",hsn:"",gst:5,category:"Oils",vid:""},
    {id:"i80",name:"Coconad Coconut Oil 1L",unit:"bottle",hsn:"",gst:5,category:"Oils",vid:""},
    {id:"i81",name:"Fortune Refined Oil 15L",unit:"can",hsn:"",gst:5,category:"Oils",vid:""},
    {id:"i82",name:"Urbani Truffle Oil 250ml",unit:"bottle",hsn:"",gst:5,category:"Oils",vid:""},
    {id:"i83",name:"Fortune Mustard Oil 1L",unit:"bottle",hsn:"",gst:5,category:"Oils",vid:""},
    {id:"i84",name:"Nandini Ghee",unit:"kg",hsn:"",gst:12,category:"Oils",vid:""},
    // ── SUGAR, SWEETENERS, PUREES & FLAVOURING ──
    {id:"i85",name:"Granulated Sugar 1kg",unit:"packet",hsn:"",gst:5,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i86",name:"Trust Icing Sugar 1kg",unit:"packet",hsn:"",gst:5,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i87",name:"Uttam Castor Sugar 1kg",unit:"packet",hsn:"",gst:5,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i88",name:"Brown Sugar 1kg",unit:"packet",hsn:"",gst:5,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i89",name:"Urban Platter Jaggery Powder 1kg",unit:"packet",hsn:"",gst:5,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i90",name:"Dabur Honey 1kg",unit:"bottle",hsn:"",gst:0,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i91",name:"Sailors Liquid Glucose 500g",unit:"packet",hsn:"",gst:18,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i92",name:"Everyday Milk Powder 1kg",unit:"packet",hsn:"",gst:5,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i93",name:"McDonalds Maple Syrup",unit:"bottle",hsn:"",gst:18,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i94",name:"Valneer White Confection",unit:"packet",hsn:"",gst:18,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i95",name:"Valneer Milk Confection",unit:"packet",hsn:"",gst:18,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i96",name:"Valneer Dark Confection",unit:"packet",hsn:"",gst:18,category:"Sugar/Sweeteners/Flavouring",vid:""},
    {id:"i97",name:"Nestle Milkmaid 190g",unit:"piece",hsn:"",gst:5,category:"Sugar/Sweeteners/Flavouring",vid:""},
    // ── DAIRY & CHEESE ──
    {id:"i98",name:"Dairy Craft Mascarpone 500g",unit:"piece",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i99",name:"Philadelphia Cream Cheese 226g",unit:"piece",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i100",name:"Imported Goat Cheese 1kg",unit:"kg",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i101",name:"Rich Cooking Cream 1L",unit:"piece",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i102",name:"President Butter Unsalted 500g",unit:"piece",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i103",name:"Elle & Vire Whipping Cream 1L",unit:"piece",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i104",name:"Dlecta Butter Unsalted 500g",unit:"piece",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i105",name:"Rich Whipping Cream 2L",unit:"piece",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i106",name:"Parmesan Reggiano",unit:"kg",hsn:"",gst:12,category:"Dairy & Cheese",vid:""},
    {id:"i107",name:"Keggs 6pc",unit:"piece",hsn:"",gst:0,category:"Dairy & Cheese",vid:""},
    {id:"i108",name:"Toned Milk 1L",unit:"piece",hsn:"",gst:0,category:"Dairy & Cheese",vid:""},
    {id:"i109",name:"Paneer 1kg",unit:"kg",hsn:"",gst:0,category:"Dairy & Cheese",vid:""},
    {id:"i110",name:"White Eggs (36 nos)",unit:"tray",hsn:"",gst:0,category:"Dairy & Cheese",vid:""},
    {id:"i111",name:"Nestle A+ Nourish Dahi 380g",unit:"piece",hsn:"",gst:0,category:"Dairy & Cheese",vid:""},
    {id:"i112",name:"Nestle Toned Milk 1L",unit:"piece",hsn:"",gst:0,category:"Dairy & Cheese",vid:""},
    {id:"i113",name:"Amul Curd 1kg",unit:"piece",hsn:"",gst:0,category:"Dairy & Cheese",vid:""},
    // ── SEAFOOD ──
    {id:"i114",name:"Hotate Large Scallop (20-30pcs) 35g",unit:"kg",hsn:"",gst:5,category:"Seafood",vid:""},
    {id:"i115",name:"Tuna Saku (AAA Grade) 1kg",unit:"kg",hsn:"",gst:5,category:"Seafood",vid:""},
    {id:"i116",name:"Squid Tube 40/60 (1kg)",unit:"kg",hsn:"",gst:5,category:"Seafood",vid:""},
    {id:"i117",name:"Black Cod Whole Head Off (4kg)",unit:"kg",hsn:"",gst:5,category:"Seafood",vid:""},
    {id:"i118",name:"Fresh Norwegian Salmon",unit:"kg",hsn:"",gst:5,category:"Seafood",vid:""},
    {id:"i119",name:"Prawn U7 T (500g each)",unit:"kg",hsn:"",gst:5,category:"Seafood",vid:""},
    {id:"i120",name:"Natholi Kari Kari Whitebait",unit:"kg",hsn:"",gst:5,category:"Seafood",vid:""},
    {id:"i121",name:"Indian Octopus",unit:"kg",hsn:"",gst:5,category:"Seafood",vid:""},
    // ── MEAT & POULTRY ──
    {id:"i122",name:"Lamb Rack Cap Off (NZ)",unit:"kg",hsn:"",gst:0,category:"Meat & Poultry",vid:""},
    {id:"i123",name:"Chicken Skin",unit:"kg",hsn:"",gst:0,category:"Meat & Poultry",vid:""},
    {id:"i124",name:"Belgian Pork Belly Skin On",unit:"kg",hsn:"",gst:0,category:"Meat & Poultry",vid:""},
    {id:"i125",name:"Whole Chicken with Skin (1500g each)",unit:"piece",hsn:"",gst:0,category:"Meat & Poultry",vid:""},
    {id:"i126",name:"Whole Chicken with Skin (1200g each)",unit:"piece",hsn:"",gst:0,category:"Meat & Poultry",vid:""},
    {id:"i127",name:"Chicken Leg with Skin & Bone",unit:"kg",hsn:"",gst:0,category:"Meat & Poultry",vid:""},
    {id:"i128",name:"Mutton Leg with Bone (Young Lamb)",unit:"kg",hsn:"",gst:0,category:"Meat & Poultry",vid:""},
    {id:"i129",name:"Nalli (Young Lamb 180g)",unit:"piece",hsn:"",gst:0,category:"Meat & Poultry",vid:""},
    // ── KITCHEN SUPPLIES & CONSUMABLES ──
    {id:"i130",name:"Aluminium Skewers",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i131",name:"AAA Batteries",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i132",name:"AA Batteries",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i133",name:"Paper Roll (Billing)",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i134",name:"Coffee Filter",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i135",name:"Parchment Paper",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i136",name:"Cling Wrap",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i137",name:"Wonder Wipe",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i138",name:"Kitchen Towels",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i139",name:"Phenyl",unit:"bottle",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i140",name:"Naphthalene Balls",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i141",name:"Blue Ball Pen",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i142",name:"Fine Tip Permanent Marker",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i143",name:"Masking Tape",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i144",name:"Master Chinese Piping Bag",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i145",name:"Crystal Poche Piping",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i146",name:"Jay Clothes Wiping Roll",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i147",name:"Oven Cloth Thick",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i148",name:"Vacuum Bags 500ml (Sous Vide)",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i149",name:"Vacuum Bags 1000ml (Sous Vide)",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i150",name:"Vacuum Bags 2000ml (Sous Vide)",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i151",name:"Garbage Bags XXXL",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i152",name:"Date Tags",unit:"packet",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i153",name:"Diversey All Purpose Cleaner",unit:"bottle",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i154",name:"Diversey Microfiber Green",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i155",name:"Diversey Microfiber Blue",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
    {id:"i156",name:"Regular Kitchen Duster",unit:"piece",hsn:"",gst:18,category:"Kitchen Supplies",vid:""},
  ],
};

// ═══════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════

// Standalone editable text input — keeps focus on re-render
const InlineEdit = ({value, onChange, placeholder, className}) => {
  const [local, setLocal] = useState(value || "");
  const ref = useRef(null);
  const flush = () => { if (local !== (value||"")) onChange(local); };
  return <input ref={ref} type="text" className={className} placeholder={placeholder} value={local} onChange={e=>setLocal(e.target.value)} onBlur={flush} onKeyDown={e=>{if(e.key==="Enter"){flush();ref.current?.blur();}}}/>;
};

const Badge = ({t, c}) => {
  const m = {green:"bg-green-100 text-green-700",yellow:"bg-yellow-100 text-yellow-700",red:"bg-red-100 text-red-700",blue:"bg-blue-100 text-blue-700",gray:"bg-gray-100 text-gray-600",orange:"bg-orange-100 text-orange-700",purple:"bg-purple-100 text-purple-700",cyan:"bg-cyan-100 text-cyan-700"};
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m[c]||m.gray}`}>{t}</span>;
};

const sc = s => ({draft:"gray",sent_to_vendor:"blue",partially_received:"yellow",received:"green",priced:"purple",grn_done:"purple",open:"orange",paid:"green",overdue:"red",partial:"yellow",cancelled:"red"})[s]||"gray";

const Btn = ({children, onClick, v="primary", disabled, s, cls=""}) => {
  const b = s ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const st = {primary:"bg-orange-500 text-white hover:bg-orange-600",secondary:"bg-gray-100 text-gray-700 hover:bg-gray-200",success:"bg-green-600 text-white hover:bg-green-700",danger:"bg-red-500 text-white hover:bg-red-600",outline:"border border-gray-300 text-gray-600 hover:bg-gray-50",ghost:"text-gray-500 hover:text-gray-700 hover:bg-gray-100"};
  return (<button onClick={onClick} disabled={disabled} className={`${b} font-medium rounded-lg transition-all disabled:opacity-40 ${st[v]} ${cls}`}>{children}</button>);
};

const Stat = ({label, value, sub, accent="orange"}) => {
  const a = {red:"text-red-600",blue:"text-blue-600",green:"text-green-600",yellow:"text-yellow-600",orange:"text-orange-600",purple:"text-purple-600"};
  return (<div className="bg-white rounded-xl border p-4"><p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold mt-1 ${a[accent]||a.orange}`}>{value}</p>{sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}</div>);
};

const Modal = ({title, onClose, children, wide}) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-6 overflow-y-auto" onClick={onClose}>
    <div className={`bg-white rounded-2xl shadow-2xl p-4 sm:p-6 m-4 mb-12 w-full ${wide?"sm:max-w-5xl":"sm:max-w-lg"}`} onClick={e=>e.stopPropagation()}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-gray-800">{title}</h2>
        <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 text-xl flex items-center justify-center">×</button>
      </div>
      {children}
    </div>
  </div>
);

const FilterBar = ({dateFrom, dateTo, setDateFrom, setDateTo, period, setPeriod, vendors, fV, setFV}) => {
  const set = (p) => {
    setPeriod(p); const t = td();
    if(p==="today"){setDateFrom(t);setDateTo(t);}
    else if(p==="week"){setDateFrom(addD(t,-7));setDateTo(t);}
    else if(p==="month"){setDateFrom(addD(t,-30));setDateTo(t);}
    else if(p==="quarter"){setDateFrom(addD(t,-90));setDateTo(t);}
    else if(p==="year"){setDateFrom(addD(t,-365));setDateTo(t);}
    else{setDateFrom("");setDateTo("");}
  };
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {vendors && setFV && (
        <select className="border rounded-lg px-2 py-1.5 text-xs" value={fV||""} onChange={e=>setFV(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      <select className="border rounded-lg px-2 py-1.5 text-xs" value={period||""} onChange={e=>set(e.target.value)}>
        <option value="">All time</option>
        <option value="today">Today</option>
        <option value="week">Last 7 days</option>
        <option value="month">Last 30 days</option>
        <option value="quarter">Last 90 days</option>
        <option value="year">Last year</option>
        <option value="custom">Custom range</option>
      </select>
      {period==="custom" && <>
        <input type="date" className="border rounded-lg px-2 py-1 text-xs" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
        <span className="text-gray-400 text-xs">to</span>
        <input type="date" className="border rounded-lg px-2 py-1 text-xs" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
      </>}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [staff, setStaff] = useState(SEED.staff);
  const [vendors, setVendors] = useState(SEED.vendors);
  const [items, setItems] = useState(SEED.items);
  const [orders, setOrders] = useState([]);      // POs
  const [grns, setGrns] = useState([]);           // GRNs (many per PO possible)
  const [invoices, setInvoices] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [priceHist, setPriceHist] = useState([]);
  const [tab, setTab] = useState("place_order");
  const [modal, setModal] = useState(null);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState(null);

  // ── Load data from Supabase on mount (falls back to SEED if offline) ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [s, v, i, o, g, inv, cn, pay, ph] = await Promise.all([
          db.fetchStaff(),
          db.fetchVendors(),
          db.fetchItems(),
          db.fetchPurchaseOrders(),
          db.fetchGRNs(),
          db.fetchInvoices(),
          db.fetchCreditNotes(),
          db.fetchPayments(),
          db.fetchPriceHistory(),
        ]);
        if (cancelled) return;
        if (s.length > 0) setStaff(s);
        if (v.length > 0) setVendors(v);
        if (i.length > 0) setItems(i);
        setOrders(o);
        setGrns(g);
        setInvoices(inv);
        setCreditNotes(cn);
        setPayments(pay);
        setPriceHist(ph);
        setDbReady(true);
      } catch (err) {
        console.warn("Supabase load failed, using SEED data:", err);
        if (!cancelled) { setDbError(err.message); setDbReady(false); }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const vM = useMemo(() => Object.fromEntries(vendors.map(v=>[v.id,v])), [vendors]);
  const iM = useMemo(() => Object.fromEntries(items.map(i=>[i.id,i])), [items]);
  const prefV = useCallback((iid) => vM[items.find(i=>i.id===iid)?.vid]||null, [items,vM]);

  const apData = useMemo(() => invoices.map(inv => {
    const paid = payments.filter(p=>p.invId===inv.id).reduce((s,p)=>s+p.amount,0);
    const cnAmt = creditNotes.filter(cn=>cn.invId===inv.id).reduce((s,cn)=>s+cn.totalGST,0);
    const bal = inv.totalGST - paid - cnAmt;
    const od = bal > 0 && inv.due < td();
    return {...inv, paid, cnAmt, balance:bal, overdue:od, cStatus:bal<=0?"paid":od?"overdue":"open"};
  }), [invoices, payments, creditNotes]);

  const isM = user?.role === "manager";

  // ═════════════════════════════════════════
  // LOGIN
  // ═════════════════════════════════════════
  if (!user) {
    const allStaff = staff.filter(s=>s.role==="staff");

    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-gray-900 tracking-tight">novy</h1>
            <p className="text-xs text-gray-400 mt-1">Procurement System</p>
          </div>
          <div className="mb-6">
            <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Staff ({allStaff.length})</p>
            <select className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white" value="" onChange={e=>{const s=staff.find(x=>x.id===e.target.value);if(s){setUser(s);setTab("place_order");}}}>
              <option value="">Select your name to login...</option>
              {allStaff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="border-t pt-5">
            <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Purchase Manager</p>
            <div className="flex gap-2">
              <input type="password" placeholder="Password" autoComplete="off" className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" value={pw} onChange={e=>{setPw(e.target.value);setPwErr("");}}
                onKeyDown={e=>{if(e.key==="Enter"){if(pw===MANAGER_PASSWORD){setUser({id:"mgr",name:"Purchase Manager",role:"manager"});setTab("mgr_dashboard");setPw("");}else setPwErr("Wrong");}}}
              />
              <Btn onClick={()=>{if(pw===MANAGER_PASSWORD){setUser({id:"mgr",name:"Purchase Manager",role:"manager"});setTab("mgr_dashboard");setPw("");}else setPwErr("Wrong");}}>Go</Btn>
            </div>
            {pwErr && <p className="text-red-500 text-xs mt-1">{pwErr}</p>}
          </div>
          <div className="mt-4 pt-3 border-t text-center">
            <span className={`inline-flex items-center gap-1.5 text-xs ${dbReady?"text-green-600":dbError?"text-red-500":"text-gray-400"}`}>
              <span className={`w-2 h-2 rounded-full ${dbReady?"bg-green-500":dbError?"bg-red-400":"bg-gray-300 animate-pulse"}`}/>
              {dbReady?"Connected to Supabase":dbError?"Offline — using local data":"Connecting..."}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════
  // PO PDF
  // ═════════════════════════════════════════
  const printPO = (po) => {
    const v = vM[po.vid];
    const rows = po.lines.map((l,i)=>`<tr><td class="center">${i+1}</td><td>${l.name}</td><td class="center">${l.qty}</td><td class="center">${l.unit}</td><td>${l.delDate?fmt(l.delDate):"—"}</td><td>${l.notes||"—"}</td></tr>`).join("");
    printHTML(po.num, `
      <div class="header"><h1>PURCHASE ORDER</h1><h2>MAVEN CREATORS AND HOSPITALITY LLP — NOVY HQ</h2></div>
      <div class="meta"><div><strong>PO Number:</strong> ${po.num}<br/><strong>Date:</strong> ${fmt(po.date)}<br/><strong>Placed By:</strong> ${po.by}<br/><strong>Status:</strong> ${PO_STATUSES[po.status]||po.status}</div>
      <div style="text-align:right"><strong>Vendor:</strong> ${v?.name||""}<br/><strong>Contact:</strong> ${v?.contact||""} — ${v?.phone||""}<br/><strong>GSTIN:</strong> ${v?.gstin||""}<br/><strong>Payment Terms:</strong> Net ${v?.terms||30} days</div></div>
      <table><thead><tr><th class="center">#</th><th>Item</th><th class="center">Qty</th><th class="center">Unit</th><th>Delivery Date</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="margin-top:30px;font-size:11px;color:#888">Generated by Novy Procurement System</p>
    `);
  };

  // ═════════════════════════════════════════
  // GRN PDF
  // ═════════════════════════════════════════
  const printGRN = (grn) => {
    const v = vM[grn.vid];
    const rows = grn.lines.map((l,i)=>{
      const diff = l.qtyRec !== l.qty;
      return `<tr${diff?' style="background:#fff8e1"':''}><td class="center">${i+1}</td><td>${l.name}</td><td class="center">${l.qty}</td><td class="center">${l.qtyRec}</td><td class="center">${l.unit}</td><td>${diff?(l.discReason||"—"):"—"}</td></tr>`;
    }).join("");
    printHTML(grn.grnNum, `
      <div class="header"><h1>GOODS RECEIPT NOTE</h1><h2>MAVEN CREATORS AND HOSPITALITY LLP — NOVY HQ</h2></div>
      <div class="meta"><div><strong>GRN Number:</strong> ${grn.grnNum}<br/><strong>PO Number:</strong> ${grn.poNum}<br/><strong>Date:</strong> ${fmt(grn.date)}<br/><strong>Received By:</strong> ${grn.signOff}</div>
      <div style="text-align:right"><strong>Vendor:</strong> ${v?.name||""}<br/><strong>GSTIN:</strong> ${v?.gstin||""}<br/><strong>Vendor Invoice:</strong> ${grn.vendorInvNum||"N/A"}</div></div>
      <table><thead><tr><th class="center">#</th><th>Item</th><th class="center">Ordered</th><th class="center">Received</th><th class="center">Unit</th><th>Discrepancy</th></tr></thead><tbody>${rows}</tbody></table>
      ${grn.hasDisc?"<p style='color:#d97706;font-weight:bold'>⚠ Discrepancies noted</p>":""}
      ${grn.notes?"<p><strong>Notes:</strong> "+grn.notes+"</p>":""}
    `);
  };

  // ═════════════════════════════════════════
  // PLACE ORDER (Staff)
  // ═════════════════════════════════════════
  const PlaceOrder = () => {
    const [search, setSearch] = useState("");
    const [lines, setLines] = useState([]);
    const [activeCat, setActiveCat] = useState("");
    const ref = useRef(null);
    const results = search.length >= 1 ? items.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())).slice(0,8) : [];

    const categories = useMemo(() => {
      const m = {};
      items.forEach(it => { const cat = it.category || "Other"; if(!m[cat]) m[cat]=[]; m[cat].push(it); });
      return m;
    }, [items]);
    const catNames = Object.keys(categories);

    const add = (item) => {
      if(lines.find(l=>l.iid===item.id)) return;
      const pv = prefV(item.id);
      setLines(p=>[...p, {iid:item.id, name:item.name, unit:item.unit, qty:1, vid:pv?.id||"", vname:pv?.name||"", delDate:addD(td(),1), notes:"", gst:item.gst, hsn:item.hsn}]);
    };

    const submit = async () => {
      if(lines.length===0) return;
      const byVendor = {};
      lines.forEach(l => { const vid = l.vid || "unknown"; if(!byVendor[vid]) byVendor[vid]=[]; byVendor[vid].push(l); });

      for (const [vid, vLines] of Object.entries(byVendor)) {
        const existingDraft = orders.find(o => o.vid === vid && o.date === td() && o.status === "draft");
        if (existingDraft) {
          setOrders(p => p.map(o => o.id === existingDraft.id ? {...o, lines: [...o.lines, ...vLines]} : o));
        } else {
          const num = genNum("PO", td(), orders);
          const newPO = {id:uid(), num, date:td(), by:user.name, status:"draft", vid, lines:vLines, total:0};
          setOrders(p=>[...p, newPO]);
          // Persist to Supabase
          try { await db.createPurchaseOrder(newPO, user.id); } catch(e) { console.warn("DB write PO failed:", e); }
        }
      }
      setLines([]); setSearch(""); setActiveCat("");
    };

    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="relative mb-3">
            <input ref={ref} type="text" placeholder="Search items..." className="w-full border rounded-lg px-3 py-2 text-sm" value={search} onChange={e=>setSearch(e.target.value)}/>
            {results.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border rounded-xl shadow-lg max-h-52 overflow-y-auto">
                {results.map(item=>{
                  const added = lines.find(l=>l.iid===item.id);
                  return (<button key={item.id} onClick={()=>!added && add(item)} className={`w-full text-left px-4 py-2.5 flex items-center gap-3 border-b last:border-0 text-sm ${added?"bg-green-50":"hover:bg-orange-50"}`}>
                    <span className="font-medium flex-1">{item.name}</span><span className="text-gray-400 text-xs">{item.unit}</span>{added ? <span className="text-green-500 text-xs">✓</span> : <span className="text-orange-400 text-xs">+</span>}
                  </button>);
                })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {catNames.map(cat=>(
              <button key={cat} onClick={()=>setActiveCat(activeCat===cat?"":cat)} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${activeCat===cat?"bg-orange-500 text-white shadow-sm":"bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {cat}<span className="ml-1 opacity-60">({categories[cat].length})</span>
              </button>
            ))}
          </div>
          {activeCat && categories[activeCat] && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5 mt-2 max-h-44 overflow-y-auto border rounded-lg p-2 bg-gray-50">
              {categories[activeCat].map(item=>{
                const added = lines.find(l=>l.iid===item.id);
                return (<button key={item.id} onClick={()=>add(item)} className={`text-left px-3 py-2 rounded-lg text-xs border transition-all ${added?"bg-green-50 border-green-200 text-green-700":"bg-white border-gray-200 hover:border-orange-300 hover:bg-orange-50 text-gray-700"}`}>
                  <span className="font-medium">{item.name}</span><span className="text-gray-400 ml-1">({item.unit})</span>{added && <span className="text-green-500 ml-1 font-bold">✓</span>}
                </button>);
              })}
            </div>
          )}
        </div>

        {lines.length === 0 && <div className="bg-white rounded-xl border p-6 text-center text-gray-400 text-sm">No items selected — pick from above</div>}

        {lines.length > 0 && (
          <div className="bg-white rounded-xl border">
            <div className="divide-y">
              {lines.map((l,i)=>(
                <div key={i} className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm text-gray-800">{l.name}</span>
                    <button onClick={()=>setLines(lines.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase">Qty</label>
                      <input type="number" min="0" step={qtyStep(l.unit)} className="w-full text-center border rounded px-2 py-1.5 text-sm" value={l.qty} onChange={e=>{const n=[...lines];n[i]={...n[i],qty:sanitizeQty(+e.target.value,l.unit)};setLines(n);}}/>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase">Unit</label>
                      <select className="w-full border rounded px-1 py-1.5 text-xs" value={l.unit} onChange={e=>{const n=[...lines];const u=e.target.value;n[i]={...n[i],unit:u,qty:sanitizeQty(n[i].qty,u)};setLines(n);}}>{UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase">Delivery</label>
                      <input type="date" className="w-full border rounded px-1 py-1.5 text-xs" value={l.delDate} onChange={e=>{const n=[...lines];n[i]={...n[i],delDate:e.target.value};setLines(n);}}/>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase">Vendor</label>
                      <select className="w-full border rounded px-1 py-1.5 text-xs" value={l.vid} onChange={e=>{const n=[...lines];n[i]={...n[i],vid:e.target.value,vname:vendors.find(v=>v.id===e.target.value)?.name||""};setLines(n);}}><option value="">Select vendor...</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase">Notes</label>
                      <input type="text" className="w-full border rounded px-2 py-1.5 text-xs" placeholder="Optional" value={l.notes} onChange={e=>{const n=[...lines];n[i]={...n[i],notes:e.target.value};setLines(n);}}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {(() => {
              const vG={}; lines.forEach(l=>{const vid=l.vid||"unknown";const vn=l.vname||"No vendor";if(!vG[vid])vG[vid]={name:vn,count:0};vG[vid].count++;});
              const gs=Object.values(vG);
              return gs.length>1?<div className="px-3 py-2 bg-orange-50 text-xs text-orange-700 border-t">Will create {gs.length} separate POs: {gs.map(g=>`${g.name} (${g.count} items)`).join(", ")}</div>:null;
            })()}
          </div>
        )}
        <div className="flex justify-end gap-2">
          {lines.length>0 && <Btn v="secondary" onClick={()=>setLines([])}>Clear</Btn>}
          <Btn disabled={lines.length===0} onClick={submit}>✓ Place Order</Btn>
        </div>
      </div>
    );
  };

  // ═════════════════════════════════════════
  // RECEIVING (Staff) — only POs with status "sent_to_vendor"
  // ═════════════════════════════════════════
  const Receiving = () => {
    const [fV, setFV] = useState("");
    const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState("");
    const pending = orders.filter(o=>{if(o.status!=="sent_to_vendor"&&o.status!=="partially_received")return false;if(fV&&o.vid!==fV)return false;if(dateFrom&&o.date<dateFrom)return false;if(dateTo&&o.date>dateTo)return false;return true;});
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-semibold text-gray-700">Receive Deliveries ({pending.length} pending)</p>
          <FilterBar {...{dateFrom,dateTo,setDateFrom,setDateTo,period,setPeriod,vendors,fV,setFV}}/>
        </div>
        {pending.length===0 && <div className="bg-white rounded-xl border p-6 text-center text-gray-400 text-sm">No POs sent to vendor yet — awaiting purchase team action</div>}
        {pending.map(po=>{
          const existingGrns = grns.filter(g=>g.poId===po.id);
          const alreadyReceived = {};
          existingGrns.forEach(g => g.lines.forEach(l => { alreadyReceived[l.iid] = (alreadyReceived[l.iid]||0) + l.qtyRec; }));
          const remaining = po.lines.filter(l => (alreadyReceived[l.iid]||0) < l.qty);
          return (
            <div key={po.id} className="bg-white rounded-xl border p-4">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <p className="font-bold text-sm">{po.num} <span className="font-normal text-gray-500">— {vM[po.vid]?.name||"Unknown"}</span></p>
                  <p className="text-xs text-gray-500">{fmt(po.date)} • <Badge t={PO_STATUSES[po.status]} c={sc(po.status)}/></p>
                  {existingGrns.length>0 && <p className="text-xs text-green-600 mt-1">{existingGrns.length} GRN(s) already created</p>}
                </div>
                <div className="flex gap-2">
                  <Btn v="ghost" s onClick={()=>printPO(po)}>PDF</Btn>
                  {po.status==="partially_received" && <Btn v="danger" s onClick={async()=>{if(!confirm("Close this PO? Remaining items won't be received."))return;setOrders(p=>p.map(x=>x.id===po.id?{...x,status:"received"}:x));try{await db.updatePOStatus(po.id,"received");}catch(e){console.warn("DB close PO failed:",e);}}}>Close PO</Btn>}
                  <Btn v="outline" s onClick={()=>setModal({type:"receive",data:po})} disabled={remaining.length===0}>{remaining.length>0?"Receive":"Fully Received"}</Btn>
                </div>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-full sm:min-w-[600px]">
                <thead className="bg-gray-50"><tr><th className="text-left px-2 sm:px-3 py-2">Item</th><th className="px-2 sm:px-3 py-2 text-center">Ordered</th><th className="px-2 sm:px-3 py-2 text-center">Received</th><th className="px-2 sm:px-3 py-2 text-center">Pending</th></tr></thead>
                <tbody>{po.lines.map((l,i)=>{
                  const rec = alreadyReceived[l.iid]||0;
                  return <tr key={i} className="border-t"><td className="px-2 sm:px-3 py-2 font-medium text-xs sm:text-sm">{l.name}</td><td className="px-2 sm:px-3 py-2 text-center">{l.qty}</td><td className="px-2 sm:px-3 py-2 text-center text-green-600">{rec}</td><td className="px-2 sm:px-3 py-2 text-center text-orange-600">{l.qty-rec}</td></tr>;
                })}</tbody>
              </table>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ═════════════════════════════════════════
  // RECEIVE MODAL
  // ═════════════════════════════════════════
  const ReceiveModal = ({po}) => {
    const existingGrns = grns.filter(g=>g.poId===po.id);
    const alreadyReceived = {};
    existingGrns.forEach(g => g.lines.forEach(l => { alreadyReceived[l.iid] = (alreadyReceived[l.iid]||0) + l.qtyRec; }));

    const [recL, setRecL] = useState(po.lines.map(l=>({...l, qtyRec: Math.max(0, l.qty - (alreadyReceived[l.iid]||0)), discReason:""})));
    const [signOff, setSignOff] = useState(user.name);
    const [notes, setNotes] = useState("");
    const up = (i,f,v) => { const n=[...recL]; n[i]={...n[i],[f]:v}; setRecL(n); };

    return (
      <Modal title={`Receive ${po.num}`} wide onClose={()=>setModal(null)}>
        <p className="text-sm text-gray-500 mb-3">{vM[po.vid]?.name}</p>
        <div className="space-y-0 divide-y mb-3 border rounded-lg overflow-hidden">
          {recL.map((l,i)=>{
            const prevRec = alreadyReceived[l.iid]||0;
            const maxQty = l.qty - prevRec;
            const diff = l.qtyRec !== maxQty;
            return (
              <div key={i} className={`p-3 ${diff?"bg-amber-50":""}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-gray-800">{l.name} <span className="text-gray-400 text-xs font-normal">({l.unit})</span></span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-1">
                  <div><label className="text-[10px] text-gray-400 uppercase">Ordered</label><div className="text-center border rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-600">{l.qty}</div></div>
                  <div><label className="text-[10px] text-gray-400 uppercase">Already Recd</label><div className="text-center border rounded px-2 py-1.5 text-sm bg-gray-50 text-green-600">{prevRec}</div></div>
                  <div><label className="text-[10px] text-gray-400 uppercase">Receiving</label><input type="number" min="0" max={maxQty} step={qtyStep(l.unit)} className="w-full text-center border rounded px-2 py-1.5 text-sm" value={l.qtyRec} onChange={e=>up(i,"qtyRec",sanitizeQty(+e.target.value,l.unit))}/></div>
                </div>
                {diff && (
                  <div className="mt-2"><label className="text-[10px] text-gray-400 uppercase">Reason for difference</label>
                    <select className="w-full border rounded px-2 py-1.5 text-sm" value={l.discReason} onChange={e=>up(i,"discReason",e.target.value)}><option value="">Select reason...</option>{DISC_REASONS.map(r=><option key={r}>{r}</option>)}</select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div><label className="text-xs text-gray-500">Sign-off</label><div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-600">{signOff}</div></div>
          <div><label className="text-xs text-gray-500">Notes</label><input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Optional..." value={notes} onChange={e=>setNotes(e.target.value)}/></div>
        </div>
        <div className="flex justify-end gap-2">
          <Btn v="outline" onClick={()=>setModal(null)}>Cancel</Btn>
          <Btn v="success" disabled={!signOff} onClick={async()=>{
            const disc = recL.some(l=>{const prev=alreadyReceived[l.iid]||0;return l.qtyRec!==(l.qty-prev);});
            const grnNum = genNum("GRN", td(), grns);
            const newGrn = {id:uid(), grnNum, poId:po.id, poNum:po.num, vid:po.vid, date:td(), signOff, hasDisc:disc, vendorInvNum:"", notes, lines:recL};
            setGrns(p=>[...p, newGrn]);
            const newAlready = {...alreadyReceived};
            recL.forEach(l => { newAlready[l.iid] = (newAlready[l.iid]||0) + l.qtyRec; });
            const allDone = po.lines.every(l => (newAlready[l.iid]||0) >= l.qty);
            const newStatus = allDone?"received":"partially_received";
            setOrders(p=>p.map(o=>o.id===po.id?{...o,status:newStatus}:o));
            setModal(null);
            try { await db.createGRN(newGrn); await db.updatePOStatus(po.id, newStatus); } catch(e) { console.warn("DB write GRN failed:", e); }
          }}>Confirm GRN</Btn>
        </div>
      </Modal>
    );
  };

  // ═════════════════════════════════════════
  // SETUP (Staff — password protected)
  // ═════════════════════════════════════════
  const Setup = () => {
    const [unlocked, setUnlocked] = useState(false);
    const [spw, setSpw] = useState("");
    const [view, setView] = useState("employees");
    const [nI, setNI] = useState({name:"",unit:"kg",hsn:"",gst:0,vid:""});
    const [nV, setNV] = useState({name:"",contact:"",phone:"",gstin:"",state:"Maharashtra",intra:true,terms:30,category:""});
    const [nE, setNE] = useState({name:"",role:"staff"});
    const [editId, setEditId] = useState(null);
    const [search, setSearch] = useState("");

    const clearEdit = () => {
      setEditId(null);
      setNI({name:"",unit:"kg",hsn:"",gst:0,vid:""});
      setNV({name:"",contact:"",phone:"",gstin:"",state:"Maharashtra",intra:true,terms:30,category:""});
      setNE({name:"",role:"staff"});
    };

    if(!unlocked) return (
      <div className="bg-white rounded-xl border p-6 max-w-sm mx-auto mt-8">
        <p className="text-sm font-semibold text-gray-700 mb-3 text-center">Setup Password</p>
        <div className="flex gap-2">
          <input type="password" className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Enter password" value={spw} onChange={e=>setSpw(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&spw===SETUP_PASSWORD)setUnlocked(true);}}/>
          <Btn onClick={()=>{if(spw===SETUP_PASSWORD)setUnlocked(true);}}>Unlock</Btn>
        </div>
      </div>
    );

    const filteredItems = search ? items.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())) : items;
    const filteredVendors = search ? vendors.filter(v=>v.name.toLowerCase().includes(search.toLowerCase())) : vendors;
    const filteredStaff = search ? staff.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())) : staff;

    return (
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap items-center">
          {["employees","items","vendors"].map(v=>(<Btn key={v} v={view===v?"primary":"outline"} s onClick={()=>{setView(v);clearEdit();setSearch("");}}>{v[0].toUpperCase()+v.slice(1)} ({v==="employees"?staff.length:v==="items"?items.length:vendors.length})</Btn>))}
          <input className="ml-auto border rounded-lg px-3 py-1.5 text-xs w-48" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>

        {view==="employees" && (<>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{editId?"Edit Employee":"Add Employee"}</p>
            <div className="flex gap-2 items-end">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Name *" value={nE.name} onChange={e=>setNE({...nE,name:e.target.value})}/>
              <select className="border rounded-lg px-2 py-2 text-sm" value={nE.role} onChange={e=>setNE({...nE,role:e.target.value})}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
              {editId && <Btn v="ghost" s onClick={clearEdit}>Cancel</Btn>}
              <Btn disabled={!nE.name.trim()} s onClick={async()=>{
                const staffObj = {id:editId||uid(),name:nE.name.trim(),role:nE.role};
                if(editId){setStaff(p=>p.map(s=>s.id===editId?{...s,...staffObj}:s));
                }else{setStaff(p=>[...p,staffObj]);}
                clearEdit();
                try { await db.upsertStaff(staffObj); } catch(e) { console.warn("DB staff save failed:", e); }
              }}>{editId?"Save":"+ Add"}</Btn>
            </div>
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="w-24"></th></tr></thead>
              <tbody>{filteredStaff.map(s=>(<tr key={s.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2 text-center"><Badge t={s.role==="manager"?"Manager":"Staff"} c={s.role==="manager"?"purple":"blue"}/></td>
                <td className="px-3 py-2 flex gap-2 justify-end">
                  <button onClick={()=>{setEditId(s.id);setNE({name:s.name,role:s.role});}} className="text-orange-500 text-xs">Edit</button>
                  <button onClick={async()=>{setStaff(p=>p.filter(x=>x.id!==s.id)); try{await db.deleteStaff(s.id);}catch(e){console.warn("DB staff delete failed:",e);}}} className="text-red-400 text-xs">Del</button>
                </td>
              </tr>))}</tbody>
            </table>
          </div>
        </>)}

        {view==="items" && (<>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{editId?"Edit Item":"Add Item"}</p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <input className="col-span-2 border rounded-lg px-3 py-2 text-sm" placeholder="Name *" value={nI.name} onChange={e=>setNI({...nI,name:e.target.value})}/>
              <select className="border rounded-lg px-2 py-2 text-sm" value={nI.unit} onChange={e=>setNI({...nI,unit:e.target.value})}>{UNITS.map(u=><option key={u}>{u}</option>)}</select>
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="HSN" value={nI.hsn} onChange={e=>setNI({...nI,hsn:e.target.value})}/>
              <select className="border rounded-lg px-2 py-2 text-sm" value={nI.gst} onChange={e=>setNI({...nI,gst:+e.target.value})}>{GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}</select>
              <select className="border rounded-lg px-2 py-2 text-sm" value={nI.vid} onChange={e=>setNI({...nI,vid:e.target.value})}><option value="">Vendor...</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              {editId && <Btn v="ghost" s onClick={clearEdit}>Cancel</Btn>}
              <Btn disabled={!nI.name} s onClick={async()=>{const itemObj={...nI,id:editId||uid()};if(editId){setItems(p=>p.map(i=>i.id===editId?itemObj:i));setEditId(null);}else{setItems(p=>[...p,itemObj]);}setNI({name:"",unit:"kg",hsn:"",gst:0,vid:""});try{await db.upsertItem(itemObj);}catch(e){console.warn("DB item save failed:",e);}}}>{editId?"Save":"+ Add"}</Btn>
            </div>
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Item</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2">HSN</th><th className="px-3 py-2">GST</th><th className="px-3 py-2">Vendor</th><th className="w-20"></th></tr></thead>
              <tbody>{filteredItems.map(it=>(<tr key={it.id} className="border-t hover:bg-gray-50"><td className="px-3 py-2 font-medium">{it.name}</td><td className="px-3 py-2 text-center text-gray-500">{it.unit}</td><td className="px-3 py-2 text-center text-gray-400">{it.hsn||"—"}</td><td className="px-3 py-2 text-center">{it.gst}%</td><td className="px-3 py-2 text-gray-500">{vM[it.vid]?.name||"—"}</td><td className="px-3 py-2 flex gap-2"><button onClick={()=>{setEditId(it.id);setNI({name:it.name,unit:it.unit,hsn:it.hsn,gst:it.gst,vid:it.vid||""});}} className="text-orange-500 text-xs">Edit</button><button onClick={async()=>{setItems(p=>p.filter(x=>x.id!==it.id));try{await db.deleteItem(it.id);}catch(e){console.warn("DB item delete failed:",e);}}} className="text-red-400 text-xs">Del</button></td></tr>))}</tbody>
            </table>
          </div>
        </>)}

        {view==="vendors" && (<>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{editId?"Edit Vendor":"Add Vendor"}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Name *" value={nV.name} onChange={e=>setNV({...nV,name:e.target.value})}/>
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Contact" value={nV.contact} onChange={e=>setNV({...nV,contact:e.target.value})}/>
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Phone" value={nV.phone} onChange={e=>setNV({...nV,phone:e.target.value})}/>
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="GSTIN" value={nV.gstin} onChange={e=>setNV({...nV,gstin:e.target.value})}/>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="State" value={nV.state} onChange={e=>setNV({...nV,state:e.target.value})}/>
              <div className="flex items-center gap-2"><span className="text-xs text-gray-500">Net</span><input type="number" className="w-14 border rounded px-2 py-2 text-sm" value={nV.terms} onChange={e=>setNV({...nV,terms:+e.target.value})}/><span className="text-xs text-gray-400">d</span></div>
              <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={nV.intra} onChange={e=>setNV({...nV,intra:e.target.checked})}/>Same state</label>
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Category" value={nV.category} onChange={e=>setNV({...nV,category:e.target.value})}/>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              {editId && <Btn v="ghost" s onClick={clearEdit}>Cancel</Btn>}
              <Btn disabled={!nV.name} s onClick={async()=>{const vObj={...nV,id:editId||uid()};if(editId){setVendors(p=>p.map(v=>v.id===editId?vObj:v));setEditId(null);}else{setVendors(p=>[...p,vObj]);}setNV({name:"",contact:"",phone:"",gstin:"",state:"Maharashtra",intra:true,terms:30,category:""});try{await db.upsertVendor(vObj);}catch(e){console.warn("DB vendor save failed:",e);}}}>{editId?"Save":"+ Add"}</Btn>
            </div>
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Vendor</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">GSTIN</th><th className="px-3 py-2">Terms</th><th className="px-3 py-2">Tax</th><th className="w-20"></th></tr></thead>
              <tbody>{filteredVendors.map(v=>(<tr key={v.id} className="border-t hover:bg-gray-50"><td className="px-3 py-2 font-medium">{v.name}</td><td className="px-3 py-2 text-gray-500">{v.contact} {v.phone}</td><td className="px-3 py-2 font-mono text-gray-400">{v.gstin}</td><td className="px-3 py-2 text-center">Net {v.terms}</td><td className="px-3 py-2 text-center"><Badge t={v.intra?"CGST+SGST":"IGST"} c={v.intra?"blue":"purple"}/></td><td className="px-3 py-2 flex gap-2"><button onClick={()=>{setEditId(v.id);setNV({name:v.name,contact:v.contact,phone:v.phone,gstin:v.gstin,state:v.state,intra:v.intra,terms:v.terms,category:v.category||""});setView("vendors");}} className="text-orange-500 text-xs">Edit</button><button onClick={async()=>{setVendors(p=>p.filter(x=>x.id!==v.id));try{await db.deleteVendor(v.id);}catch(e){console.warn("DB vendor delete failed:",e);}}} className="text-red-400 text-xs">Del</button></td></tr>))}</tbody>
            </table>
          </div>
        </>)}
      </div>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: DASHBOARD
  // ═════════════════════════════════════════
  const MgrDash = () => {
    const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState("");
    const fOrders = orders.filter(o=>{if(dateFrom&&o.date<dateFrom)return false;if(dateTo&&o.date>dateTo)return false;return true;});
    const draftC = fOrders.filter(o=>o.status==="draft").length;
    const sentC = fOrders.filter(o=>o.status==="sent_to_vendor").length;
    const completedC = fOrders.filter(o=>o.status==="grn_done").length;
    const spendV = vendors.map(v=>({name:v.name.split(" ").slice(0,2).join(" "),amt:invoices.filter(i=>i.vid===v.id).reduce((s,i)=>s+i.totalGST,0)})).filter(d=>d.amt>0).sort((a,b)=>b.amt-a.amt);
    const spendCat = useMemo(()=>{const m={};invoices.forEach(i=>{const c=vM[i.vid]?.category||"Other";m[c]=(m[c]||0)+i.totalGST;});return Object.entries(m).map(([name,value])=>({name,value}));},[invoices]);

    return (
      <div className="space-y-4">
        <FilterBar {...{dateFrom,dateTo,setDateFrom,setDateTo,period,setPeriod}}/>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total POs" value={fOrders.length}/>
          <Stat label="Draft" value={draftC} accent="yellow"/>
          <Stat label="Sent to Vendor" value={sentC} accent="blue"/>
          <Stat label="Completed" value={completedC} accent="green"/>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Spend by Vendor</p>
            {spendV.length===0?<p className="text-xs text-gray-400 italic">No data</p>:(
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={spendV} layout="vertical"><CartesianGrid strokeDasharray="3 3"/><XAxis type="number" tickFormatter={v=>`₹${v}`} tick={{fontSize:10}}/><YAxis type="category" dataKey="name" width={90} tick={{fontSize:10}}/><Tooltip formatter={v=>R(v)}/><Bar dataKey="amt" fill="#f97316" radius={[0,4,4,0]}/></BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Spend by Category</p>
            {spendCat.length===0?<p className="text-xs text-gray-400 italic">No data</p>:(
              <ResponsiveContainer width="100%" height={200}>
                <PieChart><Pie data={spendCat} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>{spendCat.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={v=>R(v)}/></PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: POs (with edit, send, download)
  // ═════════════════════════════════════════
  const MgrPOs = () => {
    const [fV, setFV] = useState("");
    const [fS, setFS] = useState("");
    const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState("");
    const shown = orders.filter(o=>{if(fV&&o.vid!==fV)return false;if(fS&&o.status!==fS)return false;if(dateFrom&&o.date<dateFrom)return false;if(dateTo&&o.date>dateTo)return false;return true;});

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-semibold text-gray-700">Purchase Orders ({shown.length})</p>
          <FilterBar {...{dateFrom,dateTo,setDateFrom,setDateTo,period,setPeriod,vendors,fV,setFV}}/>
          <select className="border rounded-lg px-2 py-1.5 text-xs" value={fS} onChange={e=>setFS(e.target.value)}><option value="">All statuses</option>{Object.entries(PO_STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
          <div className="flex-1"/>
          <Btn v="outline" s onClick={()=>dlCSV("pos.csv",["PO","Date","Vendor","By","Status","Items"],shown.map(o=>[o.num,o.date,vM[o.vid]?.name||"",o.by,PO_STATUSES[o.status],o.lines.length]))}>↓ CSV</Btn>
        </div>
        {shown.length===0?<div className="bg-white rounded-xl border p-6 text-center text-gray-400 text-sm">No POs</div>:(
          <div className="space-y-3">
            {shown.slice().reverse().map(o=>(
              <div key={o.id} className="bg-white rounded-xl border p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{o.num}</span>
                    <Badge t={PO_STATUSES[o.status]} c={sc(o.status)}/>
                  </div>
                  <span className="text-xs text-gray-500 sm:hidden">{vM[o.vid]?.name}</span>
                  <span className="text-xs text-gray-500 hidden sm:inline">{vM[o.vid]?.name} • {fmt(o.date)} • by {o.by}</span>
                  <div className="flex-1"/>
                  <div className="flex gap-2 flex-wrap">
                    {o.status==="draft" && <>
                      <Btn v="outline" s onClick={()=>setModal({type:"editPO",data:o})}>Edit</Btn>
                      <Btn v="primary" s onClick={async()=>{setOrders(p=>p.map(x=>x.id===o.id?{...x,status:"sent_to_vendor"}:x));try{await db.updatePOStatus(o.id,"sent_to_vendor");}catch(e){console.warn("DB PO status failed:",e);}}}>✓ Mark Sent</Btn>
                    </>}
                    <Btn v="ghost" s onClick={()=>printPO(o)}>PDF</Btn>
                  </div>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-full sm:min-w-[600px]">
                  <thead className="bg-gray-50"><tr><th className="text-left px-2 sm:px-3 py-1">Item</th><th className="hidden sm:table-cell px-3 py-1">Qty</th><th className="hidden md:table-cell px-3 py-1">Unit</th><th className="hidden lg:table-cell px-3 py-1">Vendor</th><th className="hidden xl:table-cell px-3 py-1">Delivery</th><th className="hidden 2xl:table-cell px-3 py-1">Notes</th></tr></thead>
                  <tbody>{o.lines.map((l,i)=><tr key={i} className="border-t"><td className="px-2 sm:px-3 py-1 font-medium text-xs sm:text-sm">{l.name}</td><td className="hidden sm:table-cell px-3 py-1 text-center">{l.qty}</td><td className="hidden md:table-cell px-3 py-1 text-center text-gray-500">{l.unit}</td><td className="hidden lg:table-cell px-3 py-1">{l.vid && l.vid !== "unknown" ? vM[l.vid]?.name : <select className="w-full border rounded px-1 py-1 text-xs" value={l.vid||""} onChange={e=>{const vid=e.target.value;const vname=vendors.find(v=>v.id===vid)?.name||"";setOrders(p=>p.map(x=>x.id===o.id?{...x,lines:x.lines.map((ll,j)=>j===i?{...ll,vid,vname}:ll)}:x));}}><option value="">Select...</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>}</td><td className="hidden xl:table-cell px-3 py-1 text-gray-500 text-xs">{fmt(l.delDate)}</td><td className="hidden 2xl:table-cell px-3 py-1 text-gray-400 text-xs">{l.notes||"—"}</td></tr>)}</tbody>
                </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ═════════════════════════════════════════
  // EDIT PO MODAL (only for draft)
  // ═════════════════════════════════════════
  const EditPOModal = ({po}) => {
    const [lines, setLines] = useState([...po.lines]);
    const up = (i,f,v) => { const n=[...lines]; n[i]={...n[i],[f]:v}; setLines(n); };
    return (
      <Modal title={`Edit ${po.num}`} wide onClose={()=>setModal(null)}>
        <div className="overflow-x-auto mb-3">
        <table className="w-full text-xs min-w-full sm:min-w-[600px]">
          <thead className="bg-gray-50"><tr><th className="text-left px-2 sm:px-3 py-2">Item</th><th className="hidden sm:table-cell px-3 py-2 w-24">Qty</th><th className="hidden md:table-cell px-3 py-2 w-20">Unit</th><th className="hidden lg:table-cell px-3 py-2 w-28">Delivery</th><th className="hidden xl:table-cell px-3 py-2">Notes</th><th className="px-2 sm:px-3 py-2 w-8"></th></tr></thead>
          <tbody>{lines.map((l,i)=>(
            <tr key={i} className="border-t">
              <td className="px-2 sm:px-3 py-2 font-medium text-xs sm:text-sm">{l.name}</td>
              <td className="hidden sm:table-cell px-3 py-1"><input type="number" min="0" step={qtyStep(l.unit)} className="w-full text-center border rounded px-2 py-2 text-sm min-w-[80px]" value={l.qty} onChange={e=>up(i,"qty",sanitizeQty(+e.target.value,l.unit))}/></td>
              <td className="hidden md:table-cell px-3 py-1"><select className="w-full border rounded px-1 py-1 text-xs" value={l.unit} onChange={e=>up(i,"unit",e.target.value)}>{UNITS.map(u=><option key={u}>{u}</option>)}</select></td>
              <td className="hidden lg:table-cell px-3 py-1"><input type="date" className="w-full border rounded px-1 py-1 text-xs" value={l.delDate} onChange={e=>up(i,"delDate",e.target.value)}/></td>
              <td className="hidden xl:table-cell px-3 py-1"><input type="text" className="w-full border rounded px-1 py-1 text-xs" value={l.notes} onChange={e=>up(i,"notes",e.target.value)}/></td>
              <td className="px-2 sm:px-3 py-1"><button onClick={()=>setLines(lines.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600">×</button></td>
            </tr>
          ))}</tbody>
        </table>
        </div>
        <div className="flex justify-end gap-2">
          <Btn v="danger" s onClick={async()=>{setOrders(p=>p.map(o=>o.id===po.id?{...o,status:"cancelled"}:o));setModal(null);try{await db.updatePOStatus(po.id,"cancelled");}catch(e){console.warn("DB cancel PO failed:",e);}}}>Cancel PO</Btn>
          <Btn v="outline" onClick={()=>setModal(null)}>Close</Btn>
          <Btn onClick={()=>{setOrders(p=>p.map(o=>o.id===po.id?{...o,lines}:o));setModal(null);}}>Save Changes</Btn>
        </div>
      </Modal>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: GRNs
  // ═════════════════════════════════════════
  const MgrGRNs = () => {
    const [fV, setFV] = useState("");
    const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState("");
    const shown = grns.filter(g=>{if(fV&&g.vid!==fV)return false;if(dateFrom&&g.date<dateFrom)return false;if(dateTo&&g.date>dateTo)return false;return true;});
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-semibold text-gray-700">Goods Receipt Notes ({shown.length})</p>
          <FilterBar {...{dateFrom,dateTo,setDateFrom,setDateTo,period,setPeriod,vendors,fV,setFV}}/>
          <div className="flex-1"/>
          <Btn v="outline" s onClick={()=>dlCSV("grns.csv",["GRN","PO","Vendor","Date","Received By","Discrepancies","Vendor Inv#","Items"],shown.map(g=>[g.grnNum,g.poNum,vM[g.vid]?.name||"",g.date,g.signOff,g.hasDisc?"Yes":"No",g.vendorInvNum||"",g.lines.map(l=>`${l.name}:${l.qtyRec}${l.unit}`).join("; ")]))}>↓ CSV</Btn>
        </div>
        {shown.length===0?<div className="bg-white rounded-xl border p-6 text-center text-gray-400 text-sm">No GRNs yet</div>:(
          <div className="space-y-3">
            {shown.slice().reverse().map(g=>{
              const v = vM[g.vid];
              return (
                <div key={g.id} className="bg-white rounded-xl border p-4">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-bold text-sm">{g.grnNum}</span>
                    <Badge t={`PO: ${g.poNum}`} c="blue"/>
                    {g.hasDisc && <Badge t="Discrepancies" c="yellow"/>}
                    <span className="text-xs text-gray-500">{v?.name} • {fmt(g.date)} • {g.signOff}</span>
                    <div className="flex-1"/>
                    <Btn v="ghost" s onClick={()=>printGRN(g)}>PDF</Btn>
                    <Btn v="outline" s onClick={()=>setModal({type:"creditNote",data:g})}>+ Credit Note</Btn>
                  </div>
                  <div className="flex items-center gap-2 mb-2 bg-blue-50 rounded-lg px-3 py-2">
                    <span className="text-xs font-medium text-blue-700">Vendor Invoice #:</span>
                    <InlineEdit className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="Enter vendor bill/invoice number" value={g.vendorInvNum||""} onChange={val=>{setGrns(p=>p.map(x=>x.id===g.id?{...x,vendorInvNum:val}:x));db.updateGRNVendorInvoice(g.id,val).catch(e=>console.warn("DB vendor inv# failed:",e));}}/>
                    {g.vendorInvNum && <Badge t="Mapped" c="green"/>}
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-full sm:min-w-[600px]">
                    <thead className="bg-gray-50"><tr><th className="text-left px-2 sm:px-3 py-1">Item</th><th className="hidden sm:table-cell px-3 py-1">Ordered</th><th className="px-2 sm:px-3 py-1">Received</th><th className="hidden md:table-cell px-3 py-1">Unit</th><th className="hidden lg:table-cell px-3 py-1">Discrepancy</th></tr></thead>
                    <tbody>{g.lines.map((l,i)=>{
                      const diff = l.qtyRec !== l.qty;
                      return <tr key={i} className={`border-t ${diff?"bg-amber-50":""}`}><td className="px-2 sm:px-3 py-1 font-medium text-xs sm:text-sm">{l.name}</td><td className="hidden sm:table-cell px-3 py-1 text-center">{l.qty}</td><td className="px-2 sm:px-3 py-1 text-center">{l.qtyRec}</td><td className="hidden md:table-cell px-3 py-1 text-center text-gray-500">{l.unit}</td><td className="hidden lg:table-cell px-3 py-1 text-gray-500 text-xs">{diff?(l.discReason||"—"):"—"}</td></tr>;
                    })}</tbody>
                  </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ═════════════════════════════════════════
  // CREDIT NOTE MODAL
  // ═════════════════════════════════════════
  const CreditNoteModal = ({grn}) => {
    const [cnLines, setCnLines] = useState(grn.lines.map(l=>({...l, returnQty:0, reason:""})));
    const [cnReason, setCnReason] = useState("");
    const up = (i,f,v) => { const n=[...cnLines]; n[i]={...n[i],[f]:v}; setCnLines(n); };
    const v = vM[grn.vid];

    // Find invoice for this GRN to get prices
    const inv = invoices.find(i => i.grnId === grn.id);
    const hasReturn = cnLines.some(l=>l.returnQty>0);

    return (
      <Modal title={`Credit Note for ${grn.grnNum}`} wide onClose={()=>setModal(null)}>
        <p className="text-sm text-gray-500 mb-3">{v?.name} • Vendor Invoice: {grn.vendorInvNum||"N/A"}</p>
        <div className="overflow-x-auto mb-3">
        <table className="w-full text-xs min-w-full sm:min-w-[600px]">
          <thead className="bg-gray-50"><tr><th className="text-left px-2 sm:px-3 py-2">Item</th><th className="hidden sm:table-cell px-3 py-2">Received</th><th className="px-2 sm:px-3 py-2 w-20 sm:w-24">Return</th><th className="hidden md:table-cell px-3 py-2">Price</th><th className="hidden lg:table-cell px-3 py-2">Credit Amt</th><th className="hidden xl:table-cell text-left px-3 py-2">Reason</th></tr></thead>
          <tbody>{cnLines.map((l,i)=>{
            const price = inv?.lines?.find(il=>il.iid===l.iid)?.price || 0;
            const creditAmt = l.returnQty * price;
            return (
              <tr key={i} className={`border-t ${l.returnQty>0?"bg-red-50":""}`}>
                <td className="px-2 sm:px-3 py-2 font-medium text-xs sm:text-sm">{l.name}</td>
                <td className="hidden sm:table-cell px-3 py-2 text-center">{l.qtyRec}</td>
                <td className="px-2 sm:px-3 py-1"><input type="number" min="0" max={l.qtyRec} step={qtyStep(l.unit)} className="w-full text-center border rounded px-2 py-2 text-xs sm:text-sm min-w-[60px]" value={l.returnQty} onChange={e=>up(i,"returnQty",sanitizeQty(+e.target.value,l.unit))}/></td>
                <td className="hidden md:table-cell px-3 py-2 text-right">{price?R(price):"—"}</td>
                <td className="hidden lg:table-cell px-3 py-2 text-right text-red-600 font-medium text-xs">{creditAmt>0?R(creditAmt):"—"}</td>
                <td className="hidden xl:table-cell px-3 py-1">{l.returnQty>0?<input type="text" className="w-full border rounded px-2 py-1 text-xs" placeholder="Reason..." value={l.reason} onChange={e=>up(i,"reason",e.target.value)}/>:<span className="text-gray-300">—</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
        </div>
        <div className="mb-3">
          <label className="text-xs text-gray-500">Overall Reason</label>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Quality issue discovered after receiving" value={cnReason} onChange={e=>setCnReason(e.target.value)}/>
        </div>
        <div className="flex justify-end gap-2">
          <Btn v="outline" onClick={()=>setModal(null)}>Cancel</Btn>
          <Btn v="danger" disabled={!hasReturn||!cnReason} onClick={async()=>{
            const returnLines = cnLines.filter(l=>l.returnQty>0);
            const baseTotal = returnLines.reduce((s,l)=>{
              const price = inv?.lines?.find(il=>il.iid===l.iid)?.price || 0;
              return s + l.returnQty * price;
            }, 0);
            const gstCalc = calcGST(baseTotal, returnLines[0]?.gst||0, v?.intra);
            const cnNum = genNum("CN", td(), creditNotes);
            const newCN = {id:uid(), num:cnNum, grnId:grn.id, grnNum:grn.grnNum, invId:inv?.id, vid:grn.vid, vname:v?.name, date:td(), reason:cnReason, base:baseTotal, cgst:gstCalc.cgst, sgst:gstCalc.sgst, igst:gstCalc.igst, totalGST:gstCalc.total, lines:returnLines};
            setCreditNotes(p=>[...p, newCN]);
            setModal(null);
            try { await db.createCreditNote(newCN); } catch(e) { console.warn("DB credit note failed:", e); }
          }}>Create Credit Note</Btn>
        </div>
      </Modal>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: PRICING
  // ═════════════════════════════════════════
  const Pricing = () => {
    const [fV, setFV] = useState("");
    const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState("");
    const unpricedGrns = grns.filter(g => {
      const po = orders.find(o=>o.id===g.poId);
      if(!(po && (po.status==="received" || po.status==="partially_received"))) return false;
      if(fV&&g.vid!==fV) return false;
      if(dateFrom&&g.date<dateFrom) return false;
      if(dateTo&&g.date>dateTo) return false;
      return true;
    });

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-semibold text-gray-700">Pricing ({unpricedGrns.length} GRNs to price)</p>
          <FilterBar {...{dateFrom,dateTo,setDateFrom,setDateTo,period,setPeriod,vendors,fV,setFV}}/>
        </div>
        {unpricedGrns.length===0?<div className="bg-white rounded-xl border p-6 text-center text-gray-400 text-sm">No GRNs to price</div>:(
          unpricedGrns.map(g => <PricingCard key={g.id} grn={g}/>)
        )}
      </div>
    );
  };

  const PricingCard = ({grn}) => {
    const po = orders.find(o=>o.id===grn.poId);
    const vendor = vM[grn.vid];
    const [pL, setPL] = useState(grn.lines.map(l=>{
      const prev = priceHist.filter(p=>p.itemId===l.iid&&p.vendorId===grn.vid).sort((a,b)=>b.date?.localeCompare(a.date))[0];
      return{...l, price:prev?.price||0, prevPrice:prev?.price||0, gst:iM[l.iid]?.gst||0, hsn:iM[l.iid]?.hsn||"", totalOverride:null};
    }));
    const [extraLabel, setExtraLabel] = useState("");
    const [extraAmt, setExtraAmt] = useState(0);
    const [vendorInvNum] = useState(grn.vendorInvNum||"");
    const up = (i, updates) => { setPL(prev => { const n=[...prev]; n[i]={...n[i],...updates}; return n; }); };

    const baseTotal = pL.reduce((s,l)=>{const qty=l.qtyRec||l.qty;const lt=l.totalOverride!==null?l.totalOverride:qty*l.price;return s+lt;},0)+extraAmt;
    const gstB = pL.reduce((a,l)=>{const qty=l.qtyRec||l.qty;const lb=l.totalOverride!==null?l.totalOverride:qty*l.price;const g=calcGST(lb,l.gst,vendor?.intra);return{cgst:a.cgst+g.cgst,sgst:a.sgst+g.sgst,igst:a.igst+g.igst};},{cgst:0,sgst:0,igst:0});
    const grand = baseTotal + gstB.cgst + gstB.sgst + gstB.igst;
    const allPriced = pL.every(l=>l.price>0||l.totalOverride>0);

    const approve = async () => {
      const priceEntries = pL.map(l=>({iid:l.iid,vid:grn.vid,name:l.name,vname:vendor?.name,price:l.price}));
      pL.forEach(l=>{setPriceHist(p=>[...p,{id:uid(),itemId:l.iid,vendorId:grn.vid,itemName:l.name,vendorName:vendor?.name,price:l.price,date:td()}]);});
      const invL = pL.map(l=>{const qty=l.qtyRec||l.qty;const lb=l.totalOverride!==null?l.totalOverride:qty*l.price;const g=calcGST(lb,l.gst,vendor?.intra);return{...l,qty,lineBase:lb,lineCgst:g.cgst,lineSgst:g.sgst,lineIgst:g.igst,lineTotal:g.total};});
      const invNum = genNum("INV", td(), invoices);
      const newInv = {id:uid(),num:invNum,grnId:grn.id,grnNum:grn.grnNum,poNum:po?.num,vid:grn.vid,vname:vendor?.name,vgstin:vendor?.gstin,intra:vendor?.intra,date:td(),due:addD(td(),vendor?.terms||30),base:baseTotal,cgst:gstB.cgst,sgst:gstB.sgst,igst:gstB.igst,totalGST:grand,lines:invL,extra:extraAmt>0?{label:extraLabel,amt:extraAmt}:null,vendorInvNum};
      setInvoices(p=>[...p, newInv]);
      setOrders(p=>p.map(o=>o.id===grn.poId?{...o,status:"grn_done",total:grand}:o));
      try {
        await db.savePriceHistory(priceEntries);
        await db.createInvoice(newInv);
        await db.updatePOStatus(grn.poId, "grn_done");
      } catch(e) { console.warn("DB pricing approve failed:", e); }
    };

    return (
      <div className="bg-white rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="font-bold text-sm">{grn.grnNum}</span>
          <Badge t={`PO: ${po?.num}`} c="blue"/>
          <Badge t={vendor?.name} c="orange"/>
          {vendorInvNum && <Badge t={`Vendor Inv: ${vendorInvNum}`} c="cyan"/>}
          <span className="text-xs text-gray-400">{vendor?.intra?"CGST+SGST":"IGST"}</span>
        </div>
        <div className="divide-y mb-3">
          {pL.map((l,i)=>{
            const qty=l.qtyRec||l.qty;const autoTotal=qty*l.price;const diff=l.prevPrice>0&&l.price>0&&l.price!==l.prevPrice;
            return (<div key={i} className={`py-3 ${diff?"bg-amber-50 -mx-4 px-4":""}`}>
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-sm">{l.name}{diff&&<span className="text-amber-600 ml-1">⚑</span>}</span>
                <span className="text-xs text-gray-500">{qty} {l.unit}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-gray-400 uppercase">Rate ₹</label>
                  <input type="number" step="0.01" min="0" className="w-full text-right border rounded px-2 py-1.5 text-sm" value={l.price||""} placeholder="0" onChange={e=>up(i,{price:+e.target.value,totalOverride:null})}/>
                  {l.prevPrice>0&&<span className="text-[10px] text-gray-400">Prev: {R(l.prevPrice)}</span>}
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase">GST%</label>
                  <select className="w-full border rounded px-1 py-1.5 text-xs" value={l.gst} onChange={e=>up(i,{gst:+e.target.value})}>{GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}</select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase">Total ₹</label>
                  <input type="number" step="0.01" min="0" className="w-full text-right border rounded px-2 py-1.5 text-sm" value={l.totalOverride!==null?l.totalOverride:autoTotal||""} onChange={e=>up(i,{totalOverride:+e.target.value})}/>
                </div>
              </div>
            </div>);
          })}
        </div>
        <div className="mb-3">
          <label className="text-[10px] text-gray-400 uppercase">Extra charges (freight/delivery)</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <input className="border rounded px-3 py-1.5 text-sm" placeholder="Label..." value={extraLabel} onChange={e=>setExtraLabel(e.target.value)}/>
            <input type="number" step="0.01" className="border rounded px-3 py-1.5 text-right text-sm" placeholder="₹0" value={extraAmt||""} onChange={e=>setExtraAmt(+e.target.value)}/>
          </div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap gap-4 items-center text-xs mb-3">
          <span>Base: <strong>{R(baseTotal)}</strong></span>
          {vendor?.intra?<><span>CGST: <strong>{R(gstB.cgst)}</strong></span><span>SGST: <strong>{R(gstB.sgst)}</strong></span></>:<span>IGST: <strong>{R(gstB.igst)}</strong></span>}
          <span className="ml-auto text-base">Total: <strong>{R(grand)}</strong></span>
        </div>
        <div className="flex justify-end"><Btn v="success" disabled={!allPriced} onClick={approve}>✓ Approve & Generate Invoice</Btn></div>
      </div>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: INVOICES
  // ═════════════════════════════════════════
  const MgrInvoices = () => (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold text-gray-700">Invoices ({invoices.length})</p>
        <Btn v="outline" s onClick={()=>dlCSV("invoices.csv",["Inv","GRN","Vendor","GSTIN","Date","Due","Base","CGST","SGST","IGST","Total","Paid","CN","Balance","Status"],apData.map(i=>[i.num,i.grnNum,i.vname,i.vgstin,i.date,i.due,i.base?.toFixed(2),i.cgst?.toFixed(2),i.sgst?.toFixed(2),i.igst?.toFixed(2),i.totalGST?.toFixed(2),i.paid?.toFixed(2),i.cnAmt?.toFixed(2),i.balance?.toFixed(2),i.cStatus]))}>↓ CSV</Btn>
      </div>
      {invoices.length===0?<div className="bg-white rounded-xl border p-6 text-center text-gray-400 text-sm">No invoices</div>:(
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-xs min-w-[600px]">
            <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Inv</th><th className="text-left px-3 py-2">GRN</th><th className="text-left px-3 py-2">Vendor</th><th className="px-3 py-2">Date</th><th className="text-right px-3 py-2">Base</th><th className="text-right px-3 py-2">GST</th><th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Balance</th><th className="px-3 py-2">Due</th><th className="text-center px-3 py-2">Status</th><th className="w-10"></th></tr></thead>
            <tbody>{apData.slice().reverse().map(inv=>(
              <tr key={inv.id} className={`border-t hover:bg-gray-50 ${inv.overdue?"bg-red-50":""}`}>
                <td className="px-3 py-2 font-medium">{inv.num}</td>
                <td className="px-3 py-2 text-gray-500">{inv.grnNum}</td>
                <td className="px-3 py-2">{inv.vname}</td>
                <td className="px-3 py-2 text-gray-500">{fmt(inv.date)}</td>
                <td className="px-3 py-2 text-right">{R(inv.base)}</td>
                <td className="px-3 py-2 text-right text-gray-500">{R(inv.cgst+inv.sgst+inv.igst)}</td>
                <td className="px-3 py-2 text-right font-bold">{R(inv.totalGST)}</td>
                <td className="px-3 py-2 text-right font-medium">{R(inv.balance)}</td>
                <td className="px-3 py-2 text-gray-500">{fmt(inv.due)}</td>
                <td className="px-3 py-2 text-center"><Badge t={inv.cStatus} c={sc(inv.cStatus)}/></td>
                <td className="px-3 py-2">{inv.balance>0&&<button onClick={()=>setModal({type:"pay",data:inv})} className="text-green-600 text-xs">Pay</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ═════════════════════════════════════════
  // PAYMENT MODAL
  // ═════════════════════════════════════════
  const PayModal = ({inv}) => {
    const [amt, setAmt] = useState(inv.balance);
    const [dt, setDt] = useState(td());
    const [method, setMethod] = useState("upi");
    const [refNum, setRefNum] = useState("");
    return (
      <Modal title="Record Payment" onClose={()=>setModal(null)}>
        <p className="text-sm text-gray-600 mb-3">{inv.num} — {inv.vname} — Balance: <strong>{R(inv.balance)}</strong></p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="text-xs text-gray-500">Amount</label><input type="number" step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm" value={amt} onChange={e=>setAmt(+e.target.value)}/></div>
          <div><label className="text-xs text-gray-500">Date</label><input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={dt} onChange={e=>setDt(e.target.value)}/></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <select className="border rounded-lg px-3 py-2 text-sm" value={method} onChange={e=>setMethod(e.target.value)}><option value="upi">UPI</option><option value="neft">NEFT</option><option value="cheque">Cheque</option><option value="cash">Cash</option></select>
          <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Ref / UTR" value={refNum} onChange={e=>setRefNum(e.target.value)}/>
        </div>
        <div className="flex justify-end gap-2">
          <Btn v="outline" onClick={()=>setModal(null)}>Cancel</Btn>
          <Btn v="success" disabled={!amt} onClick={async()=>{const newPay={id:uid(),invId:inv.id,vid:inv.vid,amount:+amt,date:dt,method,ref:refNum,by:user?.name||""};setPayments(p=>[...p,newPay]);setModal(null);try{await db.createPayment(newPay);}catch(e){console.warn("DB payment failed:",e);}}}>Record</Btn>
        </div>
      </Modal>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: VENDOR LEDGER (Tally-style)
  // ═════════════════════════════════════════
  const Ledger = () => {
    const [selVendors, setSelVendors] = useState([]);
    const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState("");
    const [expanded, setExpanded] = useState(null);
    const shownVendors = selVendors.length>0 ? vendors.filter(v=>selVendors.includes(v.id)) : vendors;
    const toggleVendor = (vid) => setSelVendors(p=>p.includes(vid)?p.filter(x=>x!==vid):[...p,vid]);

    const ledger = shownVendors.map(v => {
      let vInv = apData.filter(i=>i.vid===v.id);
      if(dateFrom) vInv = vInv.filter(i=>i.date>=dateFrom);
      if(dateTo) vInv = vInv.filter(i=>i.date<=dateTo);
      const invoiced = vInv.reduce((s,i)=>s+i.totalGST,0);
      const paid = vInv.reduce((s,i)=>s+i.paid,0);
      const cnAmt = creditNotes.filter(cn=>cn.vid===v.id).reduce((s,cn)=>s+cn.totalGST,0);
      return{...v,vInv,invoiced,paid,cnAmt,balance:invoiced-paid-cnAmt,count:vInv.length};
    }).filter(v=>v.count>0||selVendors.includes(v.id));

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-start">
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1">Select vendor(s)</p>
            <div className="flex flex-wrap gap-1">
              {vendors.map(v=>(<button key={v.id} onClick={()=>toggleVendor(v.id)} className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${selVendors.includes(v.id)?"bg-orange-500 text-white":"bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{v.name.split(" ")[0]}</button>))}
              {selVendors.length>0&&<button onClick={()=>setSelVendors([])} className="px-2 py-1 text-xs text-gray-400 hover:text-red-500">Clear</button>}
            </div>
          </div>
        </div>
        <FilterBar {...{dateFrom,dateTo,setDateFrom,setDateTo,period,setPeriod}}/>
        {expanded===null&&(
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Vendor</th><th className="text-right px-3 py-2">Invoiced</th><th className="text-right px-3 py-2">Paid</th><th className="text-right px-3 py-2">Credit Notes</th><th className="text-right px-3 py-2">Balance</th><th className="px-3 py-2"></th></tr></thead>
              <tbody>{ledger.map(v=>(<tr key={v.id} className="border-t hover:bg-gray-50 cursor-pointer" onDoubleClick={()=>setExpanded(v.id)}><td className="px-3 py-2 font-medium">{v.name}</td><td className="px-3 py-2 text-right">{R(v.invoiced)}</td><td className="px-3 py-2 text-right">{R(v.paid)}</td><td className="px-3 py-2 text-right text-red-500">{v.cnAmt>0?R(v.cnAmt):"—"}</td><td className="px-3 py-2 text-right font-bold">{R(v.balance)}</td><td className="px-3 py-2 text-right text-gray-400 text-xs">double-click</td></tr>))}</tbody>
            </table>
          </div>
        )}
        {expanded!==null&&(()=>{
          const v = vendors.find(x=>x.id===expanded);
          const vInv = apData.filter(i=>i.vid===expanded);
          const vCN = creditNotes.filter(cn=>cn.vid===expanded);
          const vPay = payments.filter(p=>p.vid===expanded);
          const closingBal = vInv.reduce((s,i)=>s+i.totalGST,0) - vPay.reduce((s,p)=>s+p.amount,0) - vCN.reduce((s,cn)=>s+cn.totalGST,0);
          return (
            <div className="bg-white rounded-xl border p-4 overflow-x-auto">
              <div className="mb-4 pb-4 border-b">
                <h3 className="font-bold text-center text-sm mb-1">MAVEN CREATORS AND HOSPITALITY LLP</h3>
                <p className="text-center text-xs text-gray-600 mb-2">NOVY HQ</p>
                <p className="text-center text-xs font-semibold">{v?.name} — {v?.contact}</p>
                <p className="text-center text-xs text-gray-500">{v?.gstin}</p>
              </div>
              <table className="w-full text-xs mb-4">
                <thead><tr className="border-b-2 border-gray-800"><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Particulars</th><th className="text-left px-3 py-2">Vch Type</th><th className="text-center px-3 py-2">Vch No</th><th className="text-left px-3 py-2">Vendor Inv #</th><th className="text-right px-3 py-2">Debit</th><th className="text-right px-3 py-2">Credit</th></tr></thead>
                <tbody>
                  {vInv.map(inv=>(<tr key={inv.id} className="border-b border-gray-200 align-top"><td className="py-2">{fmt(inv.date)}</td><td className="py-2"><p className="font-bold">Dr (as per details)</p><p className="ml-4 text-gray-600">Purchase - {v?.name}</p>{inv.lines?.map((l,j)=>(<p key={j} className="ml-8 text-gray-500">{l.name} {l.qty} {l.unit} {l.price?`${R(l.price)}/${l.unit}`:""} {l.lineBase?R(l.lineBase):""}</p>))}{inv.extra&&<p className="ml-4 text-gray-500">{inv.extra.label}: {R(inv.extra.amt)}</p>}{(inv.cgst>0||inv.sgst>0)&&<p className="ml-4 text-gray-500">CGST: {R(inv.cgst)} | SGST: {R(inv.sgst)}</p>}{inv.igst>0&&<p className="ml-4 text-gray-500">IGST: {R(inv.igst)}</p>}</td><td className="py-2">Purchase</td><td className="py-2">{inv.num}</td><td className="py-2 text-gray-500">{grns.find(g=>g.id===inv.grnId)?.vendorInvNum||"—"}</td><td className="py-2"></td><td className="py-2 text-right font-bold">{R(inv.totalGST)}</td></tr>))}
                  {vCN.map(cn=>(<tr key={cn.id} className="border-b border-gray-200 bg-red-50"><td className="py-2">{fmt(cn.date)}</td><td className="py-2"><p className="font-bold text-red-600">Credit Note</p><p className="ml-4 text-gray-500">{cn.reason}</p></td><td className="py-2">CN</td><td className="py-2">{cn.num}</td><td className="py-2"></td><td className="py-2 text-right font-bold text-red-600">{R(cn.totalGST)}</td><td className="py-2"></td></tr>))}
                  {vPay.sort((a,b)=>a.date.localeCompare(b.date)).map(p=>(<tr key={p.id} className="border-b border-gray-200"><td className="py-2">{fmt(p.date)}</td><td className="py-2"><p className="font-bold">Payment ({p.method?.toUpperCase()})</p><p className="ml-4 text-gray-500">Ref: {p.ref||"—"}</p></td><td className="py-2">Payment</td><td className="py-2">—</td><td className="py-2"></td><td className="py-2 text-right font-bold">{R(p.amount)}</td><td className="py-2"></td></tr>))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-800"><td colSpan={5}></td><td className="py-2 text-right">{R(vPay.reduce((s,p)=>s+p.amount,0)+vCN.reduce((s,cn)=>s+cn.totalGST,0))}</td><td className="py-2 text-right">{R(vInv.reduce((s,i)=>s+i.totalGST,0))}</td></tr>
                  <tr><td colSpan={4} className="py-1">{closingBal>0?"Cr":"Dr"}</td><td className="font-bold text-right" colSpan={1}>Closing Balance</td><td colSpan={2} className="text-right"><strong>{R(Math.abs(closingBal))}</strong></td></tr>
                </tfoot>
              </table>
              <div className="flex justify-end mt-4 gap-2">
                <Btn v="outline" s onClick={()=>setExpanded(null)}>Close</Btn>
                <Btn v="outline" s onClick={()=>{
                  const rows=[];
                  vInv.forEach(inv=>{const vinv=grns.find(g=>g.id===inv.grnId)?.vendorInvNum||"";rows.push([fmt(inv.date),"Purchase",inv.num,vinv,R(inv.totalGST)]);inv.lines?.forEach(l=>{rows.push(["",`  ${l.name} ${l.qty} ${l.unit}`,l.price?`${R(l.price)}/${l.unit}`:"",R(l.lineBase||0),""])});});
                  vCN.forEach(cn=>{rows.push([fmt(cn.date),`Credit Note: ${cn.reason}`,cn.num,"",R(cn.totalGST)]);});
                  vPay.forEach(p=>{rows.push([fmt(p.date),`Payment (${p.method}) Ref:${p.ref}`,"-","",R(p.amount)]);});
                  rows.push(["","Closing Balance","","",R(closingBal)]);
                  dlCSV(`ledger-${v?.name.replace(/\s/g,"-")}.csv`,["Date","Particulars","Ref","Vendor Inv #","Debit","Credit"],rows);
                }}>↓ Download Ledger</Btn>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: PAYABLES
  // ═════════════════════════════════════════
  const Payables = () => {
    const [expandedVid, setExpandedVid] = useState(null);
    const [fV, setFV] = useState("");
    const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState("");
    const open = apData.filter(i=>{if(i.balance<=0)return false;if(fV&&i.vid!==fV)return false;if(dateFrom&&i.date<dateFrom)return false;if(dateTo&&i.date>dateTo)return false;return true;});
    const tot = open.reduce((s,i)=>s+i.balance,0);
    const od = open.filter(i=>i.overdue);

    const byVendor = useMemo(()=>{
      const m = {};
      open.forEach(inv=>{
        if(!m[inv.vid]) m[inv.vid]={vid:inv.vid, vname:inv.vname||vM[inv.vid]?.name||"Unknown", invoices:[], total:0, overdue:0};
        m[inv.vid].invoices.push(inv);
        m[inv.vid].total += inv.balance;
        if(inv.overdue) m[inv.vid].overdue += inv.balance;
      });
      return Object.values(m).sort((a,b)=>b.total-a.total);
    },[open]);

    const exportPayablesPDF = () => {
      let rows = "";
      byVendor.forEach(vg=>{
        rows += `<tr style="background:#f9fafb;font-weight:bold"><td colspan="6">${vg.vname}</td><td style="text-align:right">${R(vg.total)}</td></tr>`;
        vg.invoices.sort((a,b)=>a.due.localeCompare(b.due)).forEach(inv=>{
          const vinv = grns.find(g=>g.id===inv.grnId)?.vendorInvNum || "—";
          rows += `<tr><td></td><td>${inv.num}</td><td>${vinv}</td><td style="text-align:right">${R(inv.totalGST)}</td><td style="text-align:right">${R(inv.paid)}</td><td style="text-align:right">${R(inv.balance)}</td><td>${fmt(inv.due)}</td></tr>`;
        });
      });
      printHTML("Payables-Report", `
        <div class="header"><h1>ACCOUNTS PAYABLE</h1><h2>MAVEN CREATORS AND HOSPITALITY LLP — NOVY HQ</h2></div>
        <p style="margin:10px 0">Total Payable: <strong>${R(tot)}</strong> | Overdue: <strong>${R(od.reduce((s,i)=>s+i.balance,0))}</strong> | As of ${fmt(td())}</p>
        <table><thead><tr><th></th><th>Invoice</th><th>Vendor Inv #</th><th style="text-align:right">Total</th><th style="text-align:right">Paid</th><th style="text-align:right">Balance</th><th>Due</th></tr></thead><tbody>${rows}</tbody></table>
      `);
    };

    const exportPayablesCSV = () => {
      const rows = [];
      open.sort((a,b)=>(a.vname||"").localeCompare(b.vname||"")).forEach(inv=>{
        const vinv = grns.find(g=>g.id===inv.grnId)?.vendorInvNum || "";
        rows.push([inv.vname, inv.num, vinv, inv.grnNum||"", inv.totalGST?.toFixed(2), inv.paid?.toFixed(2), inv.cnAmt?.toFixed(2), inv.balance?.toFixed(2), inv.due, inv.cStatus]);
      });
      dlCSV("payables.csv",["Vendor","Invoice","Vendor Inv #","GRN","Total","Paid","CN","Balance","Due","Status"],rows);
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-gray-700">Payables</p>
          <FilterBar {...{dateFrom,dateTo,setDateFrom,setDateTo,period,setPeriod,vendors,fV,setFV}}/>
          <div className="flex-1"/>
          <div className="flex gap-2">
            <Btn v="outline" s onClick={exportPayablesPDF}>↓ PDF</Btn>
            <Btn v="outline" s onClick={exportPayablesCSV}>↓ Excel</Btn>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total Payable" value={R(tot)}/>
          <Stat label="Overdue" value={R(od.reduce((s,i)=>s+i.balance,0))} accent="red" sub={`${od.length} invoices`}/>
          <Stat label="Paid (month)" value={R(payments.filter(p=>p.date.slice(0,7)===td().slice(0,7)).reduce((s,p)=>s+p.amount,0))} accent="green"/>
        </div>
        {byVendor.length>0&&(
          <div className="space-y-2">
            {byVendor.map(vg=>(
              <div key={vg.vid} className="bg-white rounded-xl border overflow-hidden">
                <div onClick={()=>setExpandedVid(expandedVid===vg.vid?null:vg.vid)} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors">
                  <span className="text-sm">{expandedVid===vg.vid?"▼":"▶"}</span>
                  <span className="font-medium text-sm flex-1">{vg.vname}</span>
                  <span className="text-xs text-gray-500">{vg.invoices.length} inv</span>
                  {vg.overdue>0&&<Badge t={`${R(vg.overdue)} overdue`} c="red"/>}
                  <span className="font-bold text-sm">{R(vg.total)}</span>
                </div>
                {expandedVid===vg.vid&&(
                  <div className="border-t overflow-x-auto">
                    <table className="w-full text-xs min-w-[600px]">
                      <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Invoice</th><th className="text-left px-3 py-2">Vendor Inv #</th><th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Paid</th><th className="text-right px-3 py-2">Balance</th><th className="px-3 py-2">Due</th><th className="text-center px-3 py-2">Status</th><th className="w-10"></th></tr></thead>
                      <tbody>{vg.invoices.sort((a,b)=>a.due.localeCompare(b.due)).map(inv=>{
                        const vinv = grns.find(g=>g.id===inv.grnId)?.vendorInvNum || "—";
                        return (<tr key={inv.id} className={`border-t ${inv.overdue?"bg-red-50":""}`}>
                          <td className="px-3 py-2 font-medium">{inv.num}</td>
                          <td className="px-3 py-2 text-gray-500">{vinv}</td>
                          <td className="px-3 py-2 text-right">{R(inv.totalGST)}</td>
                          <td className="px-3 py-2 text-right text-green-600">{R(inv.paid)}</td>
                          <td className="px-3 py-2 text-right font-bold">{R(inv.balance)}</td>
                          <td className="px-3 py-2">{fmt(inv.due)}</td>
                          <td className="px-3 py-2 text-center"><Badge t={inv.cStatus} c={sc(inv.cStatus)}/></td>
                          <td className="px-3 py-2"><button onClick={e=>{e.stopPropagation();setModal({type:"pay",data:inv});}} className="text-green-600 text-xs font-medium">Pay</button></td>
                        </tr>);
                      })}</tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {byVendor.length===0&&<div className="bg-white rounded-xl border p-6 text-center text-gray-400 text-sm">No outstanding payables</div>}
      </div>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: CREDIT NOTES LIST
  // ═════════════════════════════════════════
  const CreditNotesList = () => {
    const [fV, setFV] = useState("");
    const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [period, setPeriod] = useState("");
    const shown = creditNotes.filter(cn=>{if(fV&&cn.vid!==fV)return false;if(dateFrom&&cn.date<dateFrom)return false;if(dateTo&&cn.date>dateTo)return false;return true;});
    return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-sm font-semibold text-gray-700">Credit Notes ({shown.length})</p>
        <FilterBar {...{dateFrom,dateTo,setDateFrom,setDateTo,period,setPeriod,vendors,fV,setFV}}/>
      </div>
      {shown.length===0?<div className="bg-white rounded-xl border p-6 text-center text-gray-400 text-sm">No credit notes yet — create from GRNs tab</div>:(
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-xs min-w-[600px]">
            <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">CN #</th><th className="text-left px-3 py-2">GRN</th><th className="text-left px-3 py-2">Vendor</th><th className="px-3 py-2">Date</th><th className="text-left px-3 py-2">Reason</th><th className="text-right px-3 py-2">Base</th><th className="text-right px-3 py-2">GST</th><th className="text-right px-3 py-2">Total</th></tr></thead>
            <tbody>{shown.slice().reverse().map(cn=>(
              <tr key={cn.id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{cn.num}</td>
                <td className="px-3 py-2 text-gray-500">{cn.grnNum}</td>
                <td className="px-3 py-2">{cn.vname}</td>
                <td className="px-3 py-2 text-gray-500">{fmt(cn.date)}</td>
                <td className="px-3 py-2 text-gray-600">{cn.reason}</td>
                <td className="px-3 py-2 text-right">{R(cn.base)}</td>
                <td className="px-3 py-2 text-right text-gray-500">{R(cn.cgst+cn.sgst+cn.igst)}</td>
                <td className="px-3 py-2 text-right font-bold text-red-600">{R(cn.totalGST)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
  };

  // ═════════════════════════════════════════
  // NAVIGATION & RENDER
  // ═════════════════════════════════════════
  const staffTabs = [{id:"place_order",l:"Place Order"},{id:"receiving",l:"Receiving",b:orders.filter(o=>o.status==="sent_to_vendor"||o.status==="partially_received").length},{id:"setup",l:"Setup"}];
  const mgrTabs = [
    {id:"mgr_dashboard",l:"Dashboard"},
    {id:"mgr_pos",l:"POs",b:orders.filter(o=>o.status==="draft").length},
    {id:"mgr_grns",l:"GRNs"},
    {id:"mgr_pricing",l:"Pricing",b:grns.filter(g=>{const po=orders.find(o=>o.id===g.poId);return po&&(po.status==="received"||po.status==="partially_received");}).length},
    {id:"mgr_ledger",l:"Vendor Ledger"},
    {id:"mgr_payables",l:"Payables",b:apData.filter(i=>i.overdue).length},
    {id:"mgr_cn",l:"Credit Notes",b:creditNotes.length||0}
  ];
  const tabs = isM ? mgrTabs : staffTabs;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
          <h1 className="text-xl font-black text-gray-900 tracking-tight">novy</h1>
          <span className="text-xs text-gray-300">procurement</span>
          <div className="flex-1"/>
          <span className="text-sm font-medium text-gray-600">{user.name}</span>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${isM?"bg-purple-500":"bg-orange-400"}`}>{user.name[0]}</div>
          <button onClick={()=>setUser(null)} className="text-xs text-gray-400 hover:text-red-500">Logout</button>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex gap-0.5 overflow-x-auto overflow-y-hidden scrollbar-hide">
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} className={`px-2 sm:px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${tab===t.id?"border-orange-500 text-orange-600":"border-transparent text-gray-500 hover:text-gray-700"}`}>
              {t.l}{t.b>0&&<span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-red-100 text-red-700">{t.b}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 py-5">
        {tab==="place_order"&&!isM&&<PlaceOrder/>}
        {tab==="receiving"&&!isM&&<Receiving/>}
        {tab==="setup"&&!isM&&<Setup/>}
        {tab==="mgr_dashboard"&&isM&&<MgrDash/>}
        {tab==="mgr_pos"&&isM&&<MgrPOs/>}
        {tab==="mgr_grns"&&isM&&<MgrGRNs/>}
        {tab==="mgr_pricing"&&isM&&<Pricing/>}
        {tab==="mgr_ledger"&&isM&&<Ledger/>}
        {tab==="mgr_payables"&&isM&&<Payables/>}
        {tab==="mgr_cn"&&isM&&<CreditNotesList/>}
      </div>
      {modal?.type==="receive"&&<ReceiveModal po={modal.data}/>}
      {modal?.type==="pay"&&<PayModal inv={modal.data}/>}
      {modal?.type==="editPO"&&<EditPOModal po={modal.data}/>}
      {modal?.type==="creditNote"&&<CreditNoteModal grn={modal.data}/>}
    </div>
  );
}
