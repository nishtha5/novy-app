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
  // Extract max sequence number from existing to avoid collisions
  let maxSeq = same.length;
  same.forEach(x => {
    const m = x.num?.match(new RegExp(`${prefix}-${ds}-(\\d+)`));
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  });
  const seq = String(maxSeq + 1).padStart(3, "0");
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
    {id:"i1",name:"Camas Merlot 750 ML",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i2",name:"Camas Pinot Noir 750 ML",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i3",name:"Camas Sauvignon Blanc 750 ML",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i4",name:"Chum Churum 375 ML",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i5",name:"Don Julio Blanco 700 ML",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i6",name:"Don Julio Reposado 750 ML",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i7",name:"JW Black Label 750 ML",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i8",name:"Ketel One Vodka",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i9",name:"Tanqueray Gin 750 ML",unit:"bottle",category:"Alcohol",gst:0,vid:""},
    {id:"i10",name:"Baguette",unit:"piece",category:"Bakery",gst:5,vid:""},
    {id:"i11",name:"Brioche Loaf",unit:"piece",category:"Bakery",gst:0,vid:""},
    {id:"i12",name:"Butter Croissant",unit:"piece",category:"Bakery",gst:5,vid:""},
    {id:"i13",name:"Ciabatta",unit:"piece",category:"Bakery",gst:0,vid:""},
    {id:"i14",name:"Focaccia",unit:"piece",category:"Bakery",gst:0,vid:""},
    {id:"i15",name:"Lavash",unit:"piece",category:"Bakery",gst:0,vid:""},
    {id:"i16",name:"Sourdough Loaf",unit:"piece",category:"Bakery",gst:0,vid:""},
    {id:"i17",name:"Trials (Bread Stick)",unit:"piece",category:"Bakery",gst:0,vid:""},
    {id:"i18",name:"Trials (Brioche Roll)",unit:"piece",category:"Bakery",gst:0,vid:""},
    {id:"i19",name:"Liquid Glucose 500 GM",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i20",name:"Catch Soda 500ml Pk24",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i21",name:"Coca Cola Can 300ml Pkt24",unit:"case",category:"Beverages",gst:40,vid:""},
    {id:"i22",name:"Coca Cola Zero Can 300ml Pkt24",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i23",name:"Diet Coca Cola Can 300ml Pkt24",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i24",name:"Loose Coffee French Vanilla",unit:"kg",category:"Beverages",gst:0,vid:""},
    {id:"i25",name:"Loose Coffee Original Custom Roast",unit:"kg",category:"Beverages",gst:0,vid:""},
    {id:"i26",name:"Real Apple Juice 1Ltr Pkt12",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i27",name:"Real Cranberry Juice 1ltr Pkt12",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i28",name:"Real Pineapple Juice 1ltr Pkt12",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i29",name:"Schweppes Soda Water Can 300ml Pkt24",unit:"case",category:"Beverages",gst:5,vid:""},
    {id:"i30",name:"Schweppes Tonic Can 300ml Pkt24",unit:"case",category:"Beverages",gst:40,vid:""},
    {id:"i31",name:"Sepoy & Co Spiced Grapefruit Tonic 200ml Pkt24",unit:"case",category:"Beverages",gst:40,vid:""},
    {id:"i32",name:"Tea",unit:"piece",category:"Beverages",gst:0,vid:""},
    {id:"i33",name:"Veen Still 12*660ml",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i34",name:"Chicken Chorizo Sausage",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i35",name:"Duck Leg",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i36",name:"Lamb Rack Cap Off QN (flecher)",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i37",name:"Lamb Rack Cap Off",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i38",name:"Pork Belly Skin On",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i39",name:"Pilati 2.55 Fiamma",unit:"piece",category:"Canned Goods",gst:0,vid:""},
    {id:"i40",name:"Coconut Cream Chaokoh 400 Ml",unit:"piece",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i41",name:"Cremeitalia Burrata Cheese 250GM",unit:"piece",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i42",name:"Dairy Craft Burrata 250 Gm",unit:"piece",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i43",name:"Desi Ghee",unit:"piece",category:"Dairy & Cream",gst:5,vid:""},
    {id:"i44",name:"Dlecta Butter Unsalted 500gm",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i45",name:"Dlecta Cream Cheese 1 Kg",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i46",name:"Dlecta Mascarpone 400 Gm",unit:"piece",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i47",name:"Eleftheria Belper Knolle 400g",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i48",name:"Eleftheria Brunost Cheese 450g",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i49",name:"Eleftheria Cultured Butter Truffle 599g",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i50",name:"Eleftheria Halloumi Cheese 200g",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i51",name:"Eleftheria Konark French Tomme 1kg",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i52",name:"Eleftheria Moony Cloth Bound Cheddar 200g",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i53",name:"Eleftheria Nilah Blue Cheese 150g",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i54",name:"Eleftheria Stracciatella 500g",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i55",name:"Eleftheria Truffle Burrata Cheese 100g",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i56",name:"Elle & Vire UHT Whipping Cream 1ltr",unit:"litre",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i57",name:"Milkmaid 380 Gm Nestle",unit:"piece",category:"Dairy & Cream",gst:18,vid:""},
    {id:"i58",name:"Eighty 7 Cashews 240 No",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i59",name:"Hazel Nuts 1kg",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i60",name:"Hazelnuts",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i61",name:"Pecans",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i62",name:"Pishori Pista Kernels 1Kg",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i63",name:"Pista",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i64",name:"Walnut",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i65",name:"Walnut Giri",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i66",name:"Brown Sugar 1 Kg Mawana",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i67",name:"Caster Sugar 1 KG Mawana",unit:"kg",category:"Dry Grocery",gst:5,vid:""},
    {id:"i68",name:"Coconut Dry",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i69",name:"Cornflour 500 Gm Weikfield",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i70",name:"Luciana Panko Bread Crumbs 1kg*15pcs",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i71",name:"Maida",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i72",name:"Maida Rajdhani 500gm",unit:"piece",category:"Dry Grocery",gst:5,vid:""},
    {id:"i73",name:"Mr. Hung Tempura Flour 1kg*10",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i74",name:"Pirouette Dark Brown Soft Sugar 500 Gm",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i75",name:"Sol White Corn Masa Flour 1kg",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i76",name:"Soya Badi",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i77",name:"Spring Roll Sheet 50each 7.5 Size",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i78",name:"Sugar",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i79",name:"Tata Salt",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i80",name:"Wai Wai",unit:"piece",category:"Dry Grocery",gst:5,vid:""},
    {id:"i81",name:"Edamame 1 Kg Violla",unit:"piece",category:"Frozen",gst:0,vid:""},
    {id:"i82",name:"Peas Frozen",unit:"kg",category:"Frozen",gst:0,vid:""},
    {id:"i83",name:"Alphonso Mango",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i84",name:"Apple",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i85",name:"Apple Green Imported",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i86",name:"Avocado Imported",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i87",name:"Banana",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i88",name:"Banana Kg",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i89",name:"Banana Pcs",unit:"piece",category:"Fruits",gst:0,vid:""},
    {id:"i90",name:"Blueberry",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i91",name:"Galgal Lemon",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i92",name:"Grapefruit",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i93",name:"Japanese Melon Imported",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i94",name:"Lemon",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i95",name:"Malta",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i96",name:"Malta Imported",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i97",name:"Orange",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i98",name:"Pineapple",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i99",name:"Pomelo Imported",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i100",name:"Raspberry",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i101",name:"Raw Mango",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i102",name:"Red Apple Imported",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i103",name:"Red Currant",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i104",name:"Sarda Melon",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i105",name:"Strawberry",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i106",name:"USA Lemon",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i107",name:"Watermelon",unit:"kg",category:"Fruits",gst:0,vid:""},
    {id:"i108",name:"Edible Flower",unit:"kg",category:"Garnishes & Toppings",gst:0,vid:""},
    {id:"i109",name:"Maraschino Cherry Red Original 400 GM",unit:"piece",category:"Garnishes & Toppings",gst:0,vid:""},
    {id:"i110",name:"Lowball 160ml 6pcs Set",unit:"piece",category:"Glassware & Barware",gst:0,vid:""},
    {id:"i111",name:"Dustbin",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i112",name:"Martellato Pastry Brush",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i113",name:"Mould Aluminium",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i114",name:"Paddle Dustbin",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i115",name:"Plastic Container (250GRM)",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i116",name:"Plastic Container 1kg",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i117",name:"Plastic Container 500 Grm",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i118",name:"SS Condiment Tray",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i119",name:"SS Lid",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i120",name:"Scoop",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i121",name:"Spatula",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i122",name:"Spoon",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i123",name:"Tag Stand",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i124",name:"Tea Spoon",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i125",name:"Wooden Tray",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i126",name:"Basil",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i127",name:"Beetroot Microgreen Big Box 1box 35 Gram",unit:"box",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i128",name:"Coriander",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i129",name:"Dill Fresh",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i130",name:"Kale (Flat)",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i131",name:"Lemon Grass",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i132",name:"Lemon Leaf",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i133",name:"Mint",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i134",name:"Nasturtium Leaf 1box 30gram",unit:"box",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i135",name:"Parsley",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i136",name:"Peashoot Microgreen Big Box 1Box 40Gram",unit:"box",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i137",name:"Rosemary",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i138",name:"Sage Leaf",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i139",name:"Shiso Leaf",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i140",name:"Sweet Martima Flower-Pink",unit:"box",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i141",name:"Sweet Martima Flower-Purple",unit:"box",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i142",name:"Thyme",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i143",name:"Wild Italian Rocket",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i144",name:"Black Fungus",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i145",name:"Black Shiitake Mushroom",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i146",name:"Cremini Mushroom",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i147",name:"Enoki",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i148",name:"King Oyster Mushroom",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i149",name:"Mushroom Pinet",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i150",name:"Nameko Mushrooms",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i151",name:"Pioppino",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i152",name:"Shimeji",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i153",name:"White Oyster Mushrooms",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i154",name:"White Shimeji",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i155",name:"Extra Virgin Olive Oil (5 Ltr)",unit:"litre",category:"Oils & Condiments",gst:5,vid:""},
    {id:"i156",name:"Pomace Olive Oil (5LTR)",unit:"litre",category:"Oils & Condiments",gst:5,vid:""},
    {id:"i157",name:"Refined Oil 15ltr",unit:"litre",category:"Oils & Condiments",gst:5,vid:""},
    {id:"i158",name:"36*45 Black 75 Micron Garbage Bag",unit:"kg",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i159",name:"Aluminium Foil 18 Microns 1KG",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i160",name:"Black 20*24 Garbage Bag",unit:"kg",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i161",name:"Black Round Container 500ml",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i162",name:"Bullet Satay Stick 6 Inches",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i163",name:"Colin",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i164",name:"HRT Kitchen Roll 2KG",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i165",name:"M Fold Tissue 20Pcs Box",unit:"packet",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i166",name:"Microfiber Dry Mop Heavy",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i167",name:"Nitrile Black 100Pcs Pack",unit:"packet",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i168",name:"Odonil Room Freshener",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i169",name:"Plastic LD Bag 10*12 (Butchery Bag)",unit:"kg",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i170",name:"Plastic LD Bag 12*18 (Butchery Bag)",unit:"kg",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i171",name:"Plastic LD Bag 6*8 (Butchery Bag)",unit:"kg",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i172",name:"Room Freshener",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i173",name:"Stretch Film Big 6 Pcs Box 2.2 Kg",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i174",name:"Suma Multi 5ltr Can",unit:"can",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i175",name:"Toothpick Fruit",unit:"packet",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i176",name:"Wiping Sheet Cloth",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i177",name:"Wonder Wiper",unit:"piece",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i178",name:"Italian Garden Green Olive 450g*12",unit:"bottle",category:"Pickles & Preserves",gst:0,vid:""},
    {id:"i179",name:"Jalapeno Slice 670 Gm",unit:"bottle",category:"Pickles & Preserves",gst:5,vid:""},
    {id:"i180",name:"Olive Kalamata 370 Gm",unit:"piece",category:"Pickles & Preserves",gst:0,vid:""},
    {id:"i181",name:"Red Paprika Slice Neo 350 Ml",unit:"piece",category:"Pickles & Preserves",gst:0,vid:""},
    {id:"i182",name:"Sundried Tomato 280 Gm",unit:"piece",category:"Pickles & Preserves",gst:0,vid:""},
    {id:"i183",name:"Black Chana",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i184",name:"Masoor Red",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i185",name:"Mix Dal",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i186",name:"Rajma Chitra",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i187",name:"White Chana",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i188",name:"Bon Morello Cherry Puree",unit:"kg",category:"Purees & Pastes",gst:0,vid:""},
    {id:"i189",name:"Celebre Pistachio Paste 1kg",unit:"kg",category:"Purees & Pastes",gst:0,vid:""},
    {id:"i190",name:"Dira Passion Fruit Puree",unit:"kg",category:"Purees & Pastes",gst:0,vid:""},
    {id:"i191",name:"Passion Puree Frozen Fruit",unit:"kg",category:"Purees & Pastes",gst:0,vid:""},
    {id:"i192",name:"Pistachio Paste 1kg",unit:"kg",category:"Purees & Pastes",gst:0,vid:""},
    {id:"i193",name:"Arborio Rice 1 Kg Abbies",unit:"kg",category:"Rice & Grains",gst:0,vid:""},
    {id:"i194",name:"Barley Pearl Indian (400 Gm)",unit:"piece",category:"Rice & Grains",gst:0,vid:""},
    {id:"i195",name:"Rice Basmati",unit:"kg",category:"Rice & Grains",gst:0,vid:""},
    {id:"i196",name:"Ab Truffle Sauce 200ml",unit:"kg",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i197",name:"Dijon Mustard (370 GMS *PCS)",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i198",name:"FunFood Veg Mayo Original 800 GM",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i199",name:"Kikkoman Soy Sauce 1 LTR Imported",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i200",name:"Sakura Miso Paste 1 Kg",unit:"kg",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i201",name:"Soya Sauce Light 500ml LKK",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i202",name:"Tabasco Red 60 ML",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i203",name:"Tahina Gormade",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i204",name:"Tahina Paste 650 Ml Al Saedwa",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i205",name:"Tamarind Paste 250 Ml",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i206",name:"Black Cod",unit:"kg",category:"Seafood",gst:5,vid:""},
    {id:"i207",name:"Fresh Atlantic Salmon",unit:"kg",category:"Seafood",gst:0,vid:""},
    {id:"i208",name:"Octopus Frozen",unit:"kg",category:"Seafood",gst:5,vid:""},
    {id:"i209",name:"Prawn U7 T",unit:"kg",category:"Seafood",gst:5,vid:""},
    {id:"i210",name:"Prawns 8-12 1kg",unit:"kg",category:"Seafood",gst:0,vid:""},
    {id:"i211",name:"Squid Tube",unit:"kg",category:"Seafood",gst:0,vid:""},
    {id:"i212",name:"Ace Chef Ginger Powder 400gm*12pcs",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i213",name:"Chai Masala",unit:"packet",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i214",name:"Deggi Mirch 100GM",unit:"packet",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i215",name:"Dhania Powder MDH 100GM",unit:"packet",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i216",name:"Garam Masala MDH 100GM",unit:"packet",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i217",name:"Gochugaru Powder 1 KG Korean",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i218",name:"Haldi Powder 100gm",unit:"packet",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i219",name:"Jeera",unit:"kg",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i220",name:"Jeera Powder 100gm",unit:"packet",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i221",name:"Kashmiri Mirch Powder",unit:"packet",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i222",name:"Methi Dana",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i223",name:"NS Onion Powder 400GM",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i224",name:"Red Chilli Whole",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i225",name:"Saffron",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i226",name:"Saunf Moti",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i227",name:"Sol Spanish Saffron Filaments 1gm",unit:"piece",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i228",name:"Uttam Red Chilli Bayadaki Whole",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i229",name:"White Pepper Powder 100GM",unit:"packet",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i230",name:"Agave Syrup 500 Ml",unit:"piece",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i231",name:"Honey",unit:"bottle",category:"Syrups & Sweeteners",gst:5,vid:""},
    {id:"i232",name:"Maple Joe Maple Syrup 150gm 12pcs",unit:"piece",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i233",name:"Monin Blueberry Puree 1ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i234",name:"Monin Caramel Syrup 1ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i235",name:"Monin Hazelnut Syrup 1ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i236",name:"Monin Passion Fruit Syrup 1ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i237",name:"Monin Peach Syrup 1ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i238",name:"Monin Strawberry Puree 1Ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i239",name:"Monin Vanilla Syrup 1ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i240",name:"Monin Watermelon Syrup 1ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i241",name:"Achari Mirch",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i242",name:"Baby Corn",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i243",name:"Beans",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i244",name:"Beetroot",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i245",name:"Bok Choy",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i246",name:"Brinjal Big",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i247",name:"Broccoli",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i248",name:"Capsicum Green",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i249",name:"Carrot",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i250",name:"Cauliflower",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i251",name:"Celery",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i252",name:"Cherry Tomato",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i253",name:"Chip Sona",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i254",name:"Cucumber",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i255",name:"Cucumber Imported",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i256",name:"Drumstick",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i257",name:"Dumallo",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i258",name:"Fennel Root",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i259",name:"Garlic China",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i260",name:"Ginger",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i261",name:"Green Chilli",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i262",name:"Leek",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i263",name:"Onion Large",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i264",name:"Onion Small",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i265",name:"Potato Pahari",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i266",name:"Pumpkin Red",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i267",name:"Raw Banana",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i268",name:"Red & Yellow Capsicum",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i269",name:"Red Cabbage",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i270",name:"Spinach",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i271",name:"Spring Onion",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i272",name:"Sweet Corn",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i273",name:"Sweet Potato",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i274",name:"Thai Ginger",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i275",name:"Thai Red Chilli",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i276",name:"Tomato Salad",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i277",name:"Zucchini Green",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i278",name:"Zucchini Yellow",unit:"kg",category:"Vegetables",gst:0,vid:""},
    {id:"i279",name:"Apple Cider Vinegar 500ml",unit:"piece",category:"Vinegars",gst:0,vid:""},
    {id:"i280",name:"De Nigris 500ml White Vinegar",unit:"piece",category:"Vinegars",gst:0,vid:""},
    {id:"i281",name:"Mirin Cooking Vinegar 1.8 Ltr Sakura",unit:"piece",category:"Vinegars",gst:0,vid:""},
    {id:"i282",name:"Sake Cooking Seasoning 1.8 Ltr Sakura",unit:"piece",category:"Vinegars",gst:0,vid:""},
    {id:"i283",name:"Sherry Vinegar 750 Ml",unit:"piece",category:"Vinegars",gst:0,vid:""},
    {id:"i284",name:"White Vinegar 610 Ml",unit:"piece",category:"Vinegars",gst:0,vid:""},
    {id:"i285",name:"Arancio Panko Bread Crumb 1kg",unit:"kg",category:"Dry Grocery",gst:5,vid:""},
    {id:"i286",name:"Chtoura Garden Orange Blossom Water 500ml",unit:"piece",category:"Baking",gst:18,vid:""},
    {id:"i287",name:"GF Blanched Almond Flour",unit:"kg",category:"Baking",gst:5,vid:""},
    {id:"i288",name:"Gelita Gelatine Sheets 1Kg",unit:"piece",category:"Baking",gst:5,vid:""},
    {id:"i289",name:"Lotus Smooth Biscoff Spread 400gm*12",unit:"piece",category:"Baking",gst:5,vid:""},
    {id:"i290",name:"Sprig Natural Bourbon Vanilla Extract 100ml*48",unit:"piece",category:"Baking",gst:5,vid:""},
    {id:"i291",name:"Urban Platter Cocoa Nibs 250gm*12",unit:"piece",category:"Baking",gst:5,vid:""},
    {id:"i292",name:"Val Rhona Equatoriale Noire 55% Dark Chocolate",unit:"kg",category:"Baking",gst:5,vid:""},
    {id:"i293",name:"Vanilla Beans (Pods)",unit:"g",category:"Baking",gst:5,vid:""},
    {id:"i294",name:"Real Orange Juice 1Ltr Pk12 MRP 122",unit:"case",category:"Beverages",gst:5,vid:""},
    {id:"i295",name:"Redbull Can 250ml Pk24",unit:"case",category:"Beverages",gst:40,vid:""},
    {id:"i296",name:"Schweppes Ginger Ale Can 300ml Pk24 MRP 60",unit:"case",category:"Beverages",gst:40,vid:""},
    {id:"i297",name:"CHAOKOH Coconut Cream 400GM *24",unit:"can",category:"Dairy & Cream",gst:5,vid:""},
    {id:"i298",name:"CHAOKOH Coconut Milk 400ML *24 Tin",unit:"piece",category:"Dairy & Cream",gst:5,vid:""},
    {id:"i299",name:"Ferrari Veg Italian Hard Cheese (Parmession)",unit:"kg",category:"Dairy & Cream",gst:5,vid:""},
    {id:"i300",name:"Fresh Blueberries (Parmesan Reggino)",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i301",name:"Maggi Coconut Milk Powder 1kg*12",unit:"piece",category:"Dairy & Cream",gst:5,vid:""},
    {id:"i302",name:"Rich Whip Cream",unit:"kg",category:"Dairy & Cream",gst:5,vid:""},
    {id:"i303",name:"Rich's Dairy Free Whip Topping 2Kg",unit:"packet",category:"Dairy & Cream",gst:5,vid:""},
    {id:"i304",name:"Unsalted Butter (President) 500GM",unit:"kg",category:"Dairy & Cream",gst:5,vid:""},
    {id:"i305",name:"Cashew Nut Whole",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i306",name:"Chef's Choice Flakes Seeds (Lin Seed) 1kgs",unit:"packet",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i307",name:"Chilgoza",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i308",name:"Chilgoza (Golden Wash)",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i309",name:"GF Red Cranberries (Orean Spray) 11.340kg",unit:"piece",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i310",name:"Habit Pumpkin Seed Kernel 25kg",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i311",name:"Kishmish (Raisins)",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i312",name:"Moongfalidana",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i313",name:"Pinenuts 1kgs",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i314",name:"Pumpkin Seeds",unit:"kg",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i315",name:"Urban Platter Pitted California Prunes 250g",unit:"piece",category:"Dry Fruits & Nuts",gst:5,vid:""},
    {id:"i316",name:"Atta AW 5KG",unit:"piece",category:"Dry Grocery",gst:5,vid:""},
    {id:"i317",name:"Dates",unit:"packet",category:"Dry Grocery",gst:5,vid:""},
    {id:"i318",name:"Sushi Ginger Pink (Songheng) 1.8Kg*6",unit:"piece",category:"Dry Grocery",gst:5,vid:""},
    {id:"i319",name:"Trust White Sugar Sachets (200 Pcs)10*PKT",unit:"packet",category:"Dry Grocery",gst:5,vid:""},
    {id:"i320",name:"Urban Platter Basil Seed (SABJA) 700GM",unit:"piece",category:"Dry Grocery",gst:5,vid:""},
    {id:"i321",name:"Uttam Brown Sugar 1kg X 10",unit:"kg",category:"Dry Grocery",gst:5,vid:""},
    {id:"i322",name:"Uttam Castor Sugar",unit:"kg",category:"Dry Grocery",gst:5,vid:""},
    {id:"i323",name:"Wind Mill Potato Starch 500GM*50",unit:"piece",category:"Dry Grocery",gst:5,vid:""},
    {id:"i324",name:"Cream Charger -10",unit:"piece",category:"Kitchen Equipment",gst:18,vid:""},
    {id:"i325",name:"Baby Carrot (Mix)",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i326",name:"Baby Carrot (Orange)",unit:"kg",category:"Microgreens & Herbs",gst:0,vid:""},
    {id:"i327",name:"Brown Shimeji",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i328",name:"Italian Garden Dried Morel Mushroom 250gms",unit:"packet",category:"Mushrooms",gst:5,vid:""},
    {id:"i329",name:"Portobello Mushroom",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i330",name:"Shiitake Mushrooms",unit:"kg",category:"Mushrooms",gst:0,vid:""},
    {id:"i331",name:"LKK Pure Sesame Oil 200ml*12",unit:"piece",category:"Oils & Condiments",gst:5,vid:""},
    {id:"i332",name:"Mustard Oil",unit:"bottle",category:"Oils & Condiments",gst:5,vid:""},
    {id:"i333",name:"Delivery Charge (60×10 trips)",unit:"piece",category:"Other",gst:5,vid:""},
    {id:"i334",name:"Freight & Forwarding Charges",unit:"piece",category:"Other",gst:0,vid:""},
    {id:"i335",name:"First Choice Green Olive Pitted 450gm*12",unit:"bottle",category:"Pickles & Preserves",gst:5,vid:""},
    {id:"i336",name:"Italian Garden Black Olive Pitted 450gm X12",unit:"bottle",category:"Pickles & Preserves",gst:5,vid:""},
    {id:"i337",name:"Italian Garden Black Olive Sliced 3kg X 6",unit:"can",category:"Pickles & Preserves",gst:5,vid:""},
    {id:"i338",name:"Boiron Coconut Puree 1ltr*6",unit:"piece",category:"Purees & Pastes",gst:5,vid:""},
    {id:"i339",name:"Boiron Passion Fruit Frozen Puree 1kg",unit:"piece",category:"Purees & Pastes",gst:5,vid:""},
    {id:"i340",name:"Boiron Raspberry Frozen Puree",unit:"piece",category:"Purees & Pastes",gst:5,vid:""},
    {id:"i341",name:"Nourcery Pearl Barley Rice 500gm",unit:"piece",category:"Rice & Grains",gst:5,vid:""},
    {id:"i342",name:"Reggia Riso (Orzo) Pasta 500gm",unit:"packet",category:"Rice & Grains",gst:5,vid:""},
    {id:"i343",name:"Rice Staf",unit:"kg",category:"Rice & Grains",gst:0,vid:""},
    {id:"i344",name:"SE-BRM Instant Rolled Oats",unit:"packet",category:"Rice & Grains",gst:5,vid:""},
    {id:"i345",name:"SE-Gluten Free Rolled Oats 907gm",unit:"packet",category:"Rice & Grains",gst:5,vid:""},
    {id:"i346",name:"Abbie's Pickle Caper in Brine 100g",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i347",name:"Colman Horseradish Sauce 136gms",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i348",name:"Habit Kasundi Mustard Sauce 560g*12",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i349",name:"Heinz Tomato Ketchup 450gmX18",unit:"bottle",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i350",name:"Kewpie Mayonnaise 310ml*12",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i351",name:"Kikoman Ponzu Lemon 250ml*6",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i352",name:"LN Orange Sauce",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i353",name:"Maille Dijon Mustard Original 215gm",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i354",name:"Royal Garden Anchovy Fillet 43gm Imp",unit:"piece",category:"Sauces & Condiments",gst:5,vid:""},
    {id:"i355",name:"Fish Tuna",unit:"kg",category:"Seafood",gst:5,vid:""},
    {id:"i356",name:"Frozen Chuke Wakame 1kg",unit:"packet",category:"Seafood",gst:5,vid:""},
    {id:"i357",name:"Prawns U10",unit:"kg",category:"Seafood",gst:5,vid:""},
    {id:"i358",name:"Black Pepper Whole",unit:"kg",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i359",name:"Cloves",unit:"kg",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i360",name:"Naturally Aged Black Garlic 500gms",unit:"piece",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i361",name:"Ship Madras Curry Powder 500G",unit:"piece",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i362",name:"Urban Platter Pure Citric Acid Crystals 100gm",unit:"piece",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i363",name:"Urban Platter Soy Lecithin Powder 200gm",unit:"bottle",category:"Spices & Seasonings",gst:5,vid:""},
    {id:"i364",name:"Hersheys Chocolate Syrup 630gm*12",unit:"bottle",category:"Syrups & Sweeteners",gst:18,vid:""},
    {id:"i365",name:"Monin Coconut Syrup 1Ltr",unit:"bottle",category:"Syrups & Sweeteners",gst:5,vid:""},
    {id:"i366",name:"Monin Melon Syrup 700ml",unit:"bottle",category:"Syrups & Sweeteners",gst:5,vid:""},
    {id:"i367",name:"De Nigris White Wine Vinegar 12x1ltr",unit:"bottle",category:"Vinegars",gst:18,vid:""},
    {id:"i368",name:"Pita Bread",unit:"piece",category:"Bakery",gst:0,vid:""},
    {id:"i369",name:"Baking Powder 400gm (Weikfield)",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i370",name:"Baking Soda 100gm (Weikfield)",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i371",name:"Cacao Roasted & Cracked 250gm (Urban Platter)",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i372",name:"Custard Powder 500gm (Weikfield)",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i373",name:"Dark Chocolate Compound 500gm (Van Leer)",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i374",name:"Malic Acid 200gm",unit:"packet",category:"Baking",gst:0,vid:""},
    {id:"i375",name:"Milk Chocolate Compound 500gm (Van Leer)",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i376",name:"Neutralin 1kg (Mec3)",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i377",name:"Savoiardi (Ladyfinger Biscuits) 200gm",unit:"packet",category:"Baking",gst:0,vid:""},
    {id:"i378",name:"Sodium Alginate Powder 500gm",unit:"piece",category:"Baking",gst:0,vid:""},
    {id:"i379",name:"Angostura Bitter 200ml",unit:"bottle",category:"Beverages",gst:0,vid:""},
    {id:"i380",name:"Orange Bitter 100ml",unit:"bottle",category:"Beverages",gst:0,vid:""},
    {id:"i381",name:"Real Guava Juice 1ltr",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i382",name:"Tomato Juice 1ltr (Real)",unit:"case",category:"Beverages",gst:0,vid:""},
    {id:"i383",name:"Bone Marrow",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i384",name:"Chicken Boiler",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i385",name:"Chicken Leg",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i386",name:"Chicken Skin",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i387",name:"Chicken Tangri",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i388",name:"Chicken with Skin",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i389",name:"Mutton Boneless",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i390",name:"Mutton Legs",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i391",name:"Mutton Shank",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i392",name:"Tenderloin",unit:"kg",category:"Butchery",gst:0,vid:""},
    {id:"i393",name:"Artichokes alla Romana 2.4kg (LGM)",unit:"piece",category:"Canned Goods",gst:0,vid:""},
    {id:"i394",name:"Fava Beans 500gm",unit:"piece",category:"Canned Goods",gst:0,vid:""},
    {id:"i395",name:"Water Chestnut 507gm",unit:"piece",category:"Canned Goods",gst:0,vid:""},
    {id:"i396",name:"Curd (Staff)",unit:"piece",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i397",name:"Falooda Milk",unit:"litre",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i398",name:"Milk",unit:"litre",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i399",name:"Milk Amul Gold 1ltr",unit:"litre",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i400",name:"Milk Amul Taza",unit:"litre",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i401",name:"Nestle A+ Curd",unit:"piece",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i402",name:"Nestle Toned Milk A+ 1ltr",unit:"packet",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i403",name:"Staff Milk",unit:"litre",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i404",name:"Staff Paneer",unit:"kg",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i405",name:"Vita Curd (Staff)",unit:"piece",category:"Dairy & Cream",gst:0,vid:""},
    {id:"i406",name:"Black Chia Seeds 1kg",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i407",name:"Date Crown 500gm (Fard)",unit:"piece",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i408",name:"Green Kishmish 500gm",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i409",name:"Peanut with Skin",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i410",name:"Whole Almond",unit:"kg",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i411",name:"Besan 500gm (Rajdhani)",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i412",name:"Bonito Flakes (Katsuobushi) 500gm",unit:"packet",category:"Dry Grocery",gst:0,vid:""},
    {id:"i413",name:"Dry Soba Noodle 300gm (Green Label)",unit:"packet",category:"Dry Grocery",gst:0,vid:""},
    {id:"i414",name:"Farina Di Grano Tenero Pizza Flour 1kg (Casillo)",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i415",name:"Gulkand 400gm",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i416",name:"Icing Sugar 1kg (Mawana)",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i417",name:"Jaggery Powder 1kg (Urban Platter)",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i418",name:"Konbu Leaf 500gm",unit:"packet",category:"Dry Grocery",gst:0,vid:""},
    {id:"i419",name:"Rice Cakes 500gm (Urban Platter)",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i420",name:"Rice Flour 1kg (Wet Milling)",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i421",name:"Rice Paper 400gm (Triple Elephant)",unit:"packet",category:"Dry Grocery",gst:0,vid:""},
    {id:"i422",name:"Semola Di Grano Duro Semolina 1kg (Casillo)",unit:"kg",category:"Dry Grocery",gst:0,vid:""},
    {id:"i423",name:"Splenda Sugar Sachets 100pcs",unit:"packet",category:"Dry Grocery",gst:0,vid:""},
    {id:"i424",name:"Egg Tray",unit:"tray",category:"Eggs",gst:0,vid:""},
    {id:"i425",name:"Keggs Egg",unit:"piece",category:"Eggs",gst:0,vid:""},
    {id:"i426",name:"Lighter Fuel 355ml (Zippo)",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i427",name:"Piping Bag Big",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i428",name:"Smoking Chips Mesquite 250ml",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i429",name:"Smoking Wood Chips 100ml (Camerons)",unit:"piece",category:"Kitchen Equipment",gst:0,vid:""},
    {id:"i430",name:"Dried Shiitake Mushroom 1kg (Yoko)",unit:"packet",category:"Mushrooms",gst:0,vid:""},
    {id:"i431",name:"Extra Virgin Olive Oil 1ltr (Sabor del Cielo)",unit:"bottle",category:"Oils & Condiments",gst:0,vid:""},
    {id:"i432",name:"Refined Oil 1ltr",unit:"bottle",category:"Oils & Condiments",gst:0,vid:""},
    {id:"i433",name:"Air Laid Napkin 50pcs",unit:"packet",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i434",name:"Straw 8mm 250mm 50pcs",unit:"packet",category:"Packaging & Cleaning",gst:0,vid:""},
    {id:"i435",name:"Black Olive Pitted 225gm (Italian Garden)",unit:"piece",category:"Pickles & Preserves",gst:0,vid:""},
    {id:"i436",name:"Gherkin 350gm (Golden Crown)",unit:"bottle",category:"Pickles & Preserves",gst:0,vid:""},
    {id:"i437",name:"Kalamata Whole Olive 200gm (Elita)",unit:"piece",category:"Pickles & Preserves",gst:0,vid:""},
    {id:"i438",name:"Sliced Black Olive in Brine 3kg (Italian Garden)",unit:"can",category:"Pickles & Preserves",gst:0,vid:""},
    {id:"i439",name:"Kabuli Chana",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i440",name:"Kali Masoor Dal",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i441",name:"Moong Dal",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i442",name:"Soya Bean",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i443",name:"Urad Dal",unit:"kg",category:"Pulses & Lentils",gst:0,vid:""},
    {id:"i444",name:"Mango Pulp Alphonso 850gm (Golden Crown)",unit:"piece",category:"Purees & Pastes",gst:0,vid:""},
    {id:"i445",name:"Yuzu Puree 1ltr (Monin)",unit:"bottle",category:"Purees & Pastes",gst:0,vid:""},
    {id:"i446",name:"Cous Cous 500gm (Abbie's)",unit:"piece",category:"Rice & Grains",gst:0,vid:""},
    {id:"i447",name:"Glutinous Rice 1kg (Sakura)",unit:"kg",category:"Rice & Grains",gst:0,vid:""},
    {id:"i448",name:"Idli Rice",unit:"kg",category:"Rice & Grains",gst:0,vid:""},
    {id:"i449",name:"Polenta Bramata 1kg",unit:"kg",category:"Rice & Grains",gst:0,vid:""},
    {id:"i450",name:"Quinoa Seeds",unit:"kg",category:"Rice & Grains",gst:0,vid:""},
    {id:"i451",name:"Sticky Rice 1kg (Meishi)",unit:"kg",category:"Rice & Grains",gst:0,vid:""},
    {id:"i452",name:"Sticky Rice 500gm (Meishi)",unit:"piece",category:"Rice & Grains",gst:0,vid:""},
    {id:"i453",name:"Dark Soy Sauce LKK 500ml",unit:"bottle",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i454",name:"Dijon Mustard 370gm (Covinor)",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i455",name:"Japanese Mayo 450gm",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i456",name:"Mayonnaise 1kg (Dr. Oetker)",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i457",name:"Oyster Sauce LKK 510gm",unit:"bottle",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i458",name:"Peanut Butter Creamy 510gm (Abbie's)",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i459",name:"Peanut Butter Crunchy 510gm (Abbie's)",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i460",name:"Rodolfi Tomato Paste 130gm (Italian)",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i461",name:"Tomato Ketchup 480gm (Maggi)",unit:"bottle",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i462",name:"Tomato Ketchup 960gm (Maggi)",unit:"bottle",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i463",name:"Wasabi Paste 43gm",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i464",name:"Spiced Okra Chips 40gm (TBH)",unit:"piece",category:"Snacks",gst:0,vid:""},
    {id:"i465",name:"Ajwain Whole",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i466",name:"Black Cardamom",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i467",name:"Black Salt",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i468",name:"Chaat Masala 100gm",unit:"packet",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i469",name:"Chilli Flakes 1kg (Luciana)",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i470",name:"Coriander Whole",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i471",name:"Dal Chini (Cinnamon)",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i472",name:"Dry Lemon Grass 1kg",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i473",name:"Dry Rose Petals (Gulab Patti)",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i474",name:"Green Cardamom",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i475",name:"Hing 50gm (LG)",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i476",name:"Kashmiri Chilli Whole",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i477",name:"Kasturi Methi 100gm (MDH)",unit:"packet",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i478",name:"Mustard Seeds",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i479",name:"Nutmeg",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i480",name:"Pandhra Rassa Masala 50gm (Mahalaxmi)",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i481",name:"Pipli Long Pepper",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i482",name:"Red Pepper Powder 500gm (Umai)",unit:"packet",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i483",name:"Sea Salt 750gm (Naturesmith)",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i484",name:"Shichimi Togarashi Powder 300gm",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i485",name:"Smoked Paprika Powder 400gm (Naturesmith)",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i486",name:"Star Anise",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i487",name:"Szechuan Pepper 500gm",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i488",name:"Tajin Seasoning 142gm (Clasico)",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i489",name:"Tej Patta (Bay Leaf)",unit:"kg",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i490",name:"Wasabi Powder 1kg (Sakura)",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i491",name:"Marker Permanent",unit:"piece",category:"Stationery & Supplies",gst:0,vid:""},
    {id:"i492",name:"Requisition Book",unit:"piece",category:"Stationery & Supplies",gst:0,vid:""},
    {id:"i493",name:"Tape",unit:"piece",category:"Stationery & Supplies",gst:0,vid:""},
    {id:"i494",name:"Agave Syrup 350gm (Sunnyvia)",unit:"piece",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i495",name:"Almond Syrup 700ml (Monin)",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i496",name:"Amaretto Syrup 700ml (Monin)",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i497",name:"Blueberry Fruit Crush 750ml (Mapro)",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i498",name:"Green Apple Syrup 1ltr (Monin)",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i499",name:"Grenadine Syrup 1ltr (Monin)",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i500",name:"Kokum Syrup 1ltr (Omkar)",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i501",name:"Mexican Blue Agave Syrup 500gm (Urban Platter)",unit:"piece",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i502",name:"Mojito Mint Syrup 1ltr (Monin)",unit:"bottle",category:"Syrups & Sweeteners",gst:0,vid:""},
    {id:"i503",name:"Balsamic Vinegar 1ltr (Andrea Milano)",unit:"bottle",category:"Vinegars",gst:0,vid:""},
    {id:"i504",name:"Balsamic Vinegar 500ml (Ponti)",unit:"bottle",category:"Vinegars",gst:0,vid:""},
    {id:"i505",name:"Red Wine Vinegar 1ltr (Gran Sapore)",unit:"bottle",category:"Vinegars",gst:0,vid:""},
    {id:"i506",name:"Sushi Rice Vinegar 1.8ltr (Mizkan)",unit:"bottle",category:"Vinegars",gst:0,vid:""},
    {id:"i507",name:"White Wine Vinegar 1ltr (De Nigris)",unit:"bottle",category:"Vinegars",gst:0,vid:""},
    {id:"i508",name:"White Wine Vinegar 500ml (Andrea Milano)",unit:"bottle",category:"Vinegars",gst:0,vid:""},
    {id:"i509",name:"White Wine Vinegar 500ml (De Nigris)",unit:"bottle",category:"Vinegars",gst:0,vid:""},
    {id:"i510",name:"Asparagus",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i511",name:"Aubergine",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i512",name:"Bamboo Leaves",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i513",name:"Butternut Squash",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i514",name:"Celeriac",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i515",name:"Curry Leaves",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i516",name:"Galangal",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i517",name:"Gangura Leaves",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i518",name:"Gondhoraj Lime",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i519",name:"Green Bell Pepper",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i520",name:"Jerusalem Artichoke",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i521",name:"Kaffir Lime Leaf",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i522",name:"Lauki (Bottle Gourd)",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i523",name:"Mixed Lettuce",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i524",name:"Rocket Leaves (Arugula)",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i525",name:"Tapioca (Kappa)",unit:"piece",category:"Vegetables",gst:0,vid:""},
    {id:"i526",name:"Ajinomoto (MSG)",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i527",name:"Barley",unit:"piece",category:"Rice & Grains",gst:0,vid:""},
    {id:"i528",name:"Caperberries",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i529",name:"Chuka Wakame",unit:"piece",category:"Seafood",gst:0,vid:""},
    {id:"i530",name:"Dried Cranberry",unit:"piece",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i531",name:"Heeng (Asafoetida)",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i532",name:"Nescafe Coffee Powder",unit:"piece",category:"Beverages",gst:0,vid:""},
    {id:"i533",name:"Oats",unit:"piece",category:"Rice & Grains",gst:0,vid:""},
    {id:"i534",name:"Pathiri Podi",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i535",name:"Prunes",unit:"piece",category:"Dry Fruits & Nuts",gst:0,vid:""},
    {id:"i536",name:"Puff Jowar",unit:"piece",category:"Rice & Grains",gst:0,vid:""},
    {id:"i537",name:"Soba Noodles",unit:"piece",category:"Dry Grocery",gst:0,vid:""},
    {id:"i538",name:"Bay Leaves",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i539",name:"Cinnamon Sticks",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i540",name:"Gochugaru",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i541",name:"Kasoori Methi Powder",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i542",name:"White Sesame Seeds",unit:"piece",category:"Spices & Seasonings",gst:0,vid:""},
    {id:"i543",name:"Baileys Liqueur",unit:"piece",category:"Alcohol",gst:0,vid:""},
    {id:"i544",name:"Madeira Wine",unit:"piece",category:"Alcohol",gst:0,vid:""},
    {id:"i545",name:"Old Monk Rum",unit:"piece",category:"Alcohol",gst:0,vid:""},
    {id:"i546",name:"Port Wine",unit:"piece",category:"Alcohol",gst:0,vid:""},
    {id:"i547",name:"Anchovies Tin",unit:"piece",category:"Seafood",gst:0,vid:""},
    {id:"i548",name:"Kari Kadi Shrimp",unit:"piece",category:"Seafood",gst:0,vid:""},
    {id:"i549",name:"Scallops",unit:"piece",category:"Seafood",gst:0,vid:""},
    {id:"i550",name:"Whitebait",unit:"piece",category:"Seafood",gst:0,vid:""},
    {id:"i551",name:"Blackberry",unit:"piece",category:"Fruits",gst:0,vid:""},
    {id:"i552",name:"Pear",unit:"piece",category:"Fruits",gst:0,vid:""},
    {id:"i553",name:"Pink Guava",unit:"piece",category:"Fruits",gst:0,vid:""},
    {id:"i554",name:"Plum",unit:"piece",category:"Fruits",gst:0,vid:""},
    {id:"i555",name:"Puff Pastry",unit:"piece",category:"Dairy",gst:0,vid:""},
    {id:"i556",name:"Tofu",unit:"piece",category:"Dairy",gst:0,vid:""},
    {id:"i557",name:"Tofu (Firm)",unit:"piece",category:"Dairy",gst:0,vid:""},
    {id:"i558",name:"Coke Zero",unit:"piece",category:"Beverages",gst:0,vid:""},
    {id:"i559",name:"Diet Coke",unit:"piece",category:"Beverages",gst:0,vid:""},
    {id:"i560",name:"Kikkoman Ponzu",unit:"piece",category:"Sauces & Condiments",gst:0,vid:""},
    {id:"i561",name:"Mirin",unit:"piece",category:"Vinegars",gst:0,vid:""},
    {id:"i562",name:"Bacon",unit:"piece",category:"Butchery",gst:0,vid:""}
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
  const [setupUnlocked, setSetupUnlocked] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const notify = useCallback((msg, ok=true) => {
    if(toastTimer.current) clearTimeout(toastTimer.current);
    setToast({msg, ok});
    toastTimer.current = setTimeout(()=>setToast(null), ok?2000:4000);
  },[]);

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
        // Run diagnostics in background
        db.diagnose().then(r => console.log("[novy] DB diagnostics:", r)).catch(() => {});
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
  const prefV = useCallback((iid) => {
    // First check item's assigned vendor
    const item = items.find(i=>i.id===iid);
    if(item?.vid && vM[item.vid]) return vM[item.vid];
    // Fallback: latest vendor from price history
    const latest = priceHist.filter(p=>p.iid===iid).sort((a,b)=>(b.date||"").localeCompare(a.date||""))[0];
    if(latest?.vid && vM[latest.vid]) return vM[latest.vid];
    return null;
  }, [items,vM,priceHist]);

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
      // Staff submits all items into a single draft PO (no vendor required)
      // Manager assigns vendors later and splits when marking "Sent"
      const existingDraft = orders.find(o => o.by === user.name && o.date === td() && o.status === "draft");
      if (existingDraft) {
        // Merge into today's existing draft
        const merged = [...existingDraft.lines];
        lines.forEach(l => { if(!merged.find(m=>m.iid===l.iid)) merged.push(l); });
        setOrders(p => p.map(o => o.id === existingDraft.id ? {...o, lines: merged} : o));
        notify("Items added to today's draft");
      } else {
        const num = genNum("PO", td(), orders);
        const newPO = {id:uid(), num, date:td(), by:user.name, status:"draft", vid:"", lines, total:0};
        setOrders(p=>[...p, newPO]);
        notify("Draft order created");
      }
      // Drafts stay local — synced to Supabase when manager assigns vendor & marks sent
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
                  {po.status==="partially_received" && <Btn v="danger" s onClick={async()=>{if(!confirm("Close this PO? Remaining items won't be received."))return;setOrders(p=>p.map(x=>x.id===po.id?{...x,status:"received"}:x));try{await db.updatePOStatus(po.id,"received");notify("PO closed");}catch(e){notify("PO close not synced",false);}}}>Close PO</Btn>}
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
            try { await db.createGRN(newGrn); await db.updatePOStatus(po.id, newStatus); notify("GRN saved"); } catch(e) { notify("GRN not synced — saved locally", false); }
          }}>Confirm GRN</Btn>
        </div>
      </Modal>
    );
  };

  // ═════════════════════════════════════════
  // SETUP (Staff — password protected)
  // ═════════════════════════════════════════
  const Setup = () => {
    const [spw, setSpw] = useState("");
    const [view, setView] = useState("employees");
    const [nI, setNI] = useState({name:"",unit:"kg",hsn:"",gst:0,vid:"",category:""});
    const [nV, setNV] = useState({name:"",contact:"",phone:"",gstin:"",state:"Maharashtra",intra:true,terms:30,category:""});
    const [nE, setNE] = useState({name:"",role:"staff"});
    const [editId, setEditId] = useState(null);
    const [search, setSearch] = useState("");

    const clearEdit = () => {
      setEditId(null);
      setNI({name:"",unit:"kg",hsn:"",gst:0,vid:"",category:""});
      setNV({name:"",contact:"",phone:"",gstin:"",state:"Maharashtra",intra:true,terms:30,category:""});
      setNE({name:"",role:"staff"});
    };

    if(!setupUnlocked) return (
      <div className="bg-white rounded-xl border p-6 max-w-sm mx-auto mt-8">
        <p className="text-sm font-semibold text-gray-700 mb-3 text-center">Setup Password</p>
        <div className="flex gap-2">
          <input type="password" className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Enter password" value={spw} onChange={e=>setSpw(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&spw===SETUP_PASSWORD)setSetupUnlocked(true);}}/>
          <Btn onClick={()=>{if(spw===SETUP_PASSWORD)setSetupUnlocked(true);}}>Unlock</Btn>
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
                try {
                  const saved = await db.upsertStaff(staffObj);
                  // If Supabase returned a new UUID (SEED id was replaced), update local state
                  if(saved.id !== staffObj.id) setStaff(p=>p.map(s=>s.id===staffObj.id?{...s,id:saved.id}:s));
                  notify("Staff saved");
                } catch(e) { notify("Staff not synced", false); }
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
                  <button onClick={async()=>{setStaff(p=>p.filter(x=>x.id!==s.id)); try{await db.deleteStaff(s.id);notify("Staff deleted");}catch(e){notify("Delete not synced",false);}}} className="text-red-400 text-xs">Del</button>
                </td>
              </tr>))}</tbody>
            </table>
          </div>
        </>)}

        {view==="items" && (<>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{editId?"Edit Item":"Add Item"}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input className="col-span-2 border rounded-lg px-3 py-2 text-sm" placeholder="Name *" value={nI.name} onChange={e=>setNI({...nI,name:e.target.value})}/>
              <select className="border rounded-lg px-2 py-2 text-sm" value={nI.unit} onChange={e=>setNI({...nI,unit:e.target.value})}>{UNITS.map(u=><option key={u}>{u}</option>)}</select>
              <select className="border rounded-lg px-2 py-2 text-sm" value={nI.category} onChange={e=>setNI({...nI,category:e.target.value})}><option value="">Category...</option>{[...new Set(items.map(i=>i.category).filter(Boolean))].sort().map(c=><option key={c} value={c}>{c}</option>)}<option value="__new">+ New category</option></select>
              {nI.category==="__new"&&<input className="col-span-2 border rounded-lg px-3 py-2 text-sm" placeholder="New category name" onChange={e=>setNI({...nI,category:e.target.value})}/>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="HSN" value={nI.hsn} onChange={e=>setNI({...nI,hsn:e.target.value})}/>
              <select className="border rounded-lg px-2 py-2 text-sm" value={nI.gst} onChange={e=>setNI({...nI,gst:+e.target.value})}>{GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}</select>
              <select className="border rounded-lg px-2 py-2 text-sm" value={nI.vid} onChange={e=>setNI({...nI,vid:e.target.value})}><option value="">Vendor...</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              {editId && <Btn v="ghost" s onClick={clearEdit}>Cancel</Btn>}
              <Btn disabled={!nI.name} s onClick={async()=>{const itemObj={...nI,id:editId||uid()};if(editId){setItems(p=>p.map(i=>i.id===editId?itemObj:i));setEditId(null);}else{setItems(p=>[...p,itemObj]);}setNI({name:"",unit:"kg",hsn:"",gst:0,vid:"",category:""});try{const saved=await db.upsertItem(itemObj);if(saved.id!==itemObj.id)setItems(p=>p.map(i=>i.id===itemObj.id?{...i,id:saved.id}:i));notify("Item saved");}catch(e){notify("Item not synced",false);}}}>{editId?"Save":"+ Add"}</Btn>
            </div>
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Item</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2">HSN</th><th className="px-3 py-2">GST</th><th className="px-3 py-2">Vendor</th><th className="w-20"></th></tr></thead>
              <tbody>{filteredItems.map(it=>(<tr key={it.id} className="border-t hover:bg-gray-50"><td className="px-3 py-2 font-medium">{it.name}</td><td className="px-3 py-2 text-center text-gray-500 text-xs">{it.category||"—"}</td><td className="px-3 py-2 text-center text-gray-500">{it.unit}</td><td className="px-3 py-2 text-center text-gray-400">{it.hsn||"—"}</td><td className="px-3 py-2 text-center">{it.gst}%</td><td className="px-3 py-2 text-gray-500">{vM[it.vid]?.name||"—"}</td><td className="px-3 py-2 flex gap-2"><button onClick={()=>{setEditId(it.id);setNI({name:it.name,unit:it.unit,hsn:it.hsn,gst:it.gst,vid:it.vid||"",category:it.category||""});}} className="text-orange-500 text-xs">Edit</button><button onClick={async()=>{setItems(p=>p.filter(x=>x.id!==it.id));try{await db.deleteItem(it.id);notify("Item deleted");}catch(e){notify("Delete not synced",false);}}} className="text-red-400 text-xs">Del</button></td></tr>))}</tbody>
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
              <Btn disabled={!nV.name} s onClick={async()=>{const vObj={...nV,id:editId||uid()};if(editId){setVendors(p=>p.map(v=>v.id===editId?vObj:v));setEditId(null);}else{setVendors(p=>[...p,vObj]);}setNV({name:"",contact:"",phone:"",gstin:"",state:"Maharashtra",intra:true,terms:30,category:""});try{const saved=await db.upsertVendor(vObj);if(saved.id!==vObj.id)setVendors(p=>p.map(v=>v.id===vObj.id?{...v,id:saved.id}:v));notify("Vendor saved");}catch(e){notify("Vendor not synced",false);}}}>{editId?"Save":"+ Add"}</Btn>
            </div>
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Vendor</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">GSTIN</th><th className="px-3 py-2">Terms</th><th className="px-3 py-2">Tax</th><th className="w-20"></th></tr></thead>
              <tbody>{filteredVendors.map(v=>(<tr key={v.id} className="border-t hover:bg-gray-50"><td className="px-3 py-2 font-medium">{v.name}</td><td className="px-3 py-2 text-gray-500">{v.contact} {v.phone}</td><td className="px-3 py-2 font-mono text-gray-400">{v.gstin}</td><td className="px-3 py-2 text-center">Net {v.terms}</td><td className="px-3 py-2 text-center"><Badge t={v.intra?"CGST+SGST":"IGST"} c={v.intra?"blue":"purple"}/></td><td className="px-3 py-2 flex gap-2"><button onClick={()=>{setEditId(v.id);setNV({name:v.name,contact:v.contact,phone:v.phone,gstin:v.gstin,state:v.state,intra:v.intra,terms:v.terms,category:v.category||""});setView("vendors");}} className="text-orange-500 text-xs">Edit</button><button onClick={async()=>{setVendors(p=>p.filter(x=>x.id!==v.id));try{await db.deleteVendor(v.id);notify("Vendor deleted");}catch(e){notify("Delete not synced",false);}}} className="text-red-400 text-xs">Del</button></td></tr>))}</tbody>
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
                  <span className="text-xs text-gray-500 sm:hidden">{vM[o.vid]?.name||"No vendor"} • {fmt(o.date)}</span>
                  <span className="text-xs text-gray-500 hidden sm:inline">{vM[o.vid]?.name||"No vendor yet"} • {fmt(o.date)} • by {o.by}</span>
                  <div className="flex-1"/>
                  <div className="flex gap-2 flex-wrap">
                    {o.status==="draft" && <>
                      <Btn v="outline" s onClick={()=>setModal({type:"editPO",data:o})}>Edit</Btn>
                      <Btn v="primary" s onClick={async()=>{
                        // Check all lines have vendors assigned
                        const unassigned = o.lines.filter(l=>!l.vid || l.vid==="unknown");
                        if(unassigned.length>0){notify(`${unassigned.length} item(s) need a vendor assigned first`,false);return;}
                        // Split by vendor → create separate POs per vendor in Supabase
                        const byVendor = {};
                        o.lines.forEach(l=>{if(!byVendor[l.vid])byVendor[l.vid]=[];byVendor[l.vid].push(l);});
                        const vendorIds = Object.keys(byVendor);
                        // Remove original draft
                        setOrders(p=>p.filter(x=>x.id!==o.id));
                        let syncOk = true;
                        for(const vid of vendorIds){
                          const vLines = byVendor[vid];
                          const num = genNum("PO", o.date||td(), orders);
                          const newPO = {id:uid(), num, date:o.date||td(), by:o.by, status:"sent_to_vendor", vid, lines:vLines, total:0};
                          setOrders(p=>[...p, newPO]);
                          try{const saved = await db.createPurchaseOrder(newPO, user.id); setOrders(p=>p.map(x=>x.id===newPO.id?{...x,id:saved.id,num:saved.num}:x));await db.updatePOStatus(saved.id,"sent_to_vendor");}catch(e){console.error("[novy] PO send error:",e.message);syncOk=false;}
                        }
                        notify(syncOk?`${vendorIds.length} PO(s) sent to vendors`:"POs created locally, sync had errors",syncOk);
                      }}>✓ Mark Sent</Btn>
                    </>}
                    <Btn v="ghost" s onClick={()=>printPO(o)}>PDF</Btn>
                  </div>
                </div>
                {o.status==="draft"&&<div className="flex items-center gap-2 mb-2"><span className="text-xs text-gray-500">Assign all to:</span><select className="border rounded px-2 py-1 text-xs" value="" onChange={e=>{const vid=e.target.value;if(!vid)return;const vname=vendors.find(v=>v.id===vid)?.name||"";setOrders(p=>p.map(x=>x.id===o.id?{...x,vid,lines:x.lines.map(ll=>({...ll,vid,vname}))}:x));}}><option value="">Pick vendor...</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></div>}
                <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-full sm:min-w-[600px]">
                  <thead className="bg-gray-50"><tr><th className="text-left px-2 sm:px-3 py-1">Item</th><th className="hidden sm:table-cell px-3 py-1">Qty</th><th className="px-2 sm:px-3 py-1">Vendor</th><th className="hidden lg:table-cell px-3 py-1">Delivery</th><th className="hidden xl:table-cell px-3 py-1">Notes</th></tr></thead>
                  <tbody>{o.lines.map((l,i)=><tr key={i} className={`border-t ${!l.vid||l.vid==="unknown"?"bg-amber-50":""}`}><td className="px-2 sm:px-3 py-1 font-medium text-xs sm:text-sm">{l.name}</td><td className="hidden sm:table-cell px-3 py-1 text-center">{l.qty} {l.unit}</td><td className="px-2 sm:px-3 py-1">{o.status==="draft"?<select className="w-full border rounded px-1 py-1 text-xs" value={l.vid||""} onChange={e=>{const vid=e.target.value;const vname=vendors.find(v=>v.id===vid)?.name||"";setOrders(p=>p.map(x=>x.id===o.id?{...x,lines:x.lines.map((ll,j)=>j===i?{...ll,vid,vname}:ll)}:x));}}><option value="">Select vendor...</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>:<span className="text-xs text-gray-500">{vM[l.vid]?.name||"—"}</span>}</td><td className="hidden lg:table-cell px-3 py-1 text-gray-500 text-xs">{fmt(l.delDate)}</td><td className="hidden xl:table-cell px-3 py-1 text-gray-400 text-xs">{l.notes||"—"}</td></tr>)}</tbody>
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
          <Btn v="danger" s onClick={async()=>{setOrders(p=>p.map(o=>o.id===po.id?{...o,status:"cancelled"}:o));setModal(null);try{await db.updatePOStatus(po.id,"cancelled");notify("PO cancelled");}catch(e){notify("Cancel not synced",false);}}}>Cancel PO</Btn>
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
                    <InlineEdit className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="Enter vendor bill/invoice number" value={g.vendorInvNum||""} onChange={val=>{setGrns(p=>p.map(x=>x.id===g.id?{...x,vendorInvNum:val}:x));db.updateGRNVendorInvoice(g.id,val).then(()=>notify("Invoice # saved")).catch(e=>notify("Invoice # not synced",false));}}/>
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
            try { await db.createCreditNote(newCN); notify("Credit note saved"); } catch(e) { notify("Credit note not synced", false); }
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
      const prev = priceHist.filter(p=>p.iid===l.iid&&p.vid===grn.vid).sort((a,b)=>(b.date||"").localeCompare(a.date||""))[0];
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
      const invNum = genNum("INV", td(), invoices);
      const priceEntries = pL.map(l=>({iid:l.iid,vid:grn.vid,name:l.name,vname:vendor?.name,price:l.price,grnNum:grn.grnNum,invNum}));
      pL.forEach(l=>{
        const prevEntry = priceHist.filter(p=>p.iid===l.iid&&p.vid===grn.vid).sort((a,b)=>(b.date||"").localeCompare(a.date||""))[0];
        setPriceHist(p=>[...p,{id:uid(),iid:l.iid,vid:grn.vid,name:l.name,vname:vendor?.name,price:l.price,prevPrice:prevEntry?.price||0,date:td(),grnNum:grn.grnNum,invNum}]);
        // Update item's default vendor and GST
        setItems(p=>p.map(it=>it.id===l.iid?{...it,vid:grn.vid,gst:l.gst}:it));
      });
      const invL = pL.map(l=>{const qty=l.qtyRec||l.qty;const lb=l.totalOverride!==null?l.totalOverride:qty*l.price;const g=calcGST(lb,l.gst,vendor?.intra);return{...l,qty,lineBase:lb,lineCgst:g.cgst,lineSgst:g.sgst,lineIgst:g.igst,lineTotal:g.total};});
      const newInv = {id:uid(),num:invNum,grnId:grn.id,grnNum:grn.grnNum,poNum:po?.num,vid:grn.vid,vname:vendor?.name,vgstin:vendor?.gstin,intra:vendor?.intra,date:td(),due:addD(td(),vendor?.terms||30),base:baseTotal,cgst:gstB.cgst,sgst:gstB.sgst,igst:gstB.igst,totalGST:grand,lines:invL,extra:extraAmt>0?{label:extraLabel,amt:extraAmt}:null,vendorInvNum};
      setInvoices(p=>[...p, newInv]);
      setOrders(p=>p.map(o=>o.id===grn.poId?{...o,status:"grn_done",total:grand}:o));
      // Sync each step independently — one failure shouldn't block the rest
      const errors = [];
      try { await db.savePriceHistory(priceEntries); } catch(e) { errors.push("prices"); console.error("[novy] savePriceHistory:", e.message); }
      try { await db.createInvoice(newInv); } catch(e) { errors.push("invoice"); console.error("[novy] createInvoice:", e.message); }
      try { await db.updatePOStatus(grn.poId, "grn_done"); } catch(e) { errors.push("PO status"); console.error("[novy] updatePOStatus:", e.message); }
      // Update items with vendor/GST defaults
      for (const l of pL) {
        try { await db.upsertItem({id:l.iid, name:l.name, unit:l.unit, vid:grn.vid, gst:l.gst}); } catch(e) { console.error("[novy] upsertItem:", e.message); }
      }
      if (errors.length === 0) notify("Invoice created");
      else notify(`Saved locally, sync failed: ${errors.join(", ")}`, false);
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
          <Btn v="success" disabled={!amt} onClick={async()=>{const newPay={id:uid(),invId:inv.id,vid:inv.vid,amount:+amt,date:dt,method,ref:refNum,by:user?.name||""};setPayments(p=>[...p,newPay]);setModal(null);try{await db.createPayment(newPay);notify("Payment recorded");}catch(e){notify("Payment not synced",false);}}}>Record</Btn>
        </div>
      </Modal>
    );
  };

  // ═════════════════════════════════════════
  // MANAGER: VENDOR LEDGER (Tally-style)
  // ═════════════════════════════════════════
  const COMPANY = {name:"MAVEN CREATORS AND HOSPITALITY LLP",addr:"NOVY HQ 27 B660 SHUSHANT LOK PH-1",city:"GURUGRAM SEC-27 HARYANA 122001"};

  // Helper: get GRN line details for an invoice (qty ordered, received, discrepancy)
  const getGrnDetails = (inv) => {
    const grn = grns.find(g=>g.id===inv.grnId);
    if(!grn) return {};
    const map = {};
    grn.lines.forEach(l => { map[l.iid] = l; });
    return map;
  };

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

    // Build ledger rows for a vendor (used by screen, CSV, and PDF)
    const buildLedgerRows = (vid) => {
      let vInv = apData.filter(i=>i.vid===vid);
      if(dateFrom) vInv = vInv.filter(i=>i.date>=dateFrom);
      if(dateTo) vInv = vInv.filter(i=>i.date<=dateTo);
      const vCN = creditNotes.filter(cn=>cn.vid===vid);
      const vPay = payments.filter(p=>p.vid===vid);
      const closingBal = vInv.reduce((s,i)=>s+i.totalGST,0) - vPay.reduce((s,p)=>s+p.amount,0) - vCN.reduce((s,cn)=>s+cn.totalGST,0);
      return {vInv, vCN, vPay, closingBal};
    };

    // CSV download
    const downloadCSV = (v) => {
      const {vInv, vCN, vPay, closingBal} = buildLedgerRows(v.id);
      const rows = [];
      vInv.forEach(inv => {
        const grnMap = getGrnDetails(inv);
        const vendorInvNum = grns.find(g=>g.id===inv.grnId)?.vendorInvNum||"";
        inv.lines?.forEach(l => {
          const gl = grnMap[l.iid];
          const disc = gl && gl.qty !== gl.qtyRec ? `Ordered ${gl.qty}, Got ${gl.qtyRec} — ${gl.discReason||"Unknown"}` : "";
          rows.push([fmt(inv.date), inv.num, vendorInvNum, l.name, l.qty, l.unit, l.price, `${l.gst}%`, l.lineBase, disc, "", inv.totalGST]);
        });
        if(inv.extra) rows.push([fmt(inv.date), inv.num, vendorInvNum, inv.extra.label, "", "", "", "", inv.extra.amt, "", "", ""]);
      });
      vCN.forEach(cn => { rows.push([fmt(cn.date), cn.num, "", `Credit Note: ${cn.reason}`, "", "", "", "", "", "", cn.totalGST, ""]); });
      vPay.forEach(p => { rows.push([fmt(p.date), "", `Ref: ${p.ref}`, `Payment (${p.method})`, "", "", "", "", "", "", p.amount, ""]); });
      rows.push(["", "", "", "CLOSING BALANCE", "", "", "", "", "", "", "", closingBal]);
      dlCSV(`ledger-${v.name.replace(/\s/g,"-")}.csv`, ["Date","Invoice #","Vendor Inv #","Item","Qty","Unit","Rate","GST%","Amount","Discrepancy","Debit","Credit"], rows);
    };

    // PDF download
    const downloadPDF = (v) => {
      const {vInv, vCN, vPay, closingBal} = buildLedgerRows(v.id);
      const dateRange = dateFrom||dateTo ? `${dateFrom?fmt(dateFrom):"Start"} to ${dateTo?fmt(dateTo):"Today"}` : "All time";
      let tableRows = "";
      vInv.forEach(inv => {
        const grnMap = getGrnDetails(inv);
        const vendorInvNum = grns.find(g=>g.id===inv.grnId)?.vendorInvNum||"";
        inv.lines?.forEach((l,j) => {
          const gl = grnMap[l.iid];
          const disc = gl && gl.qty !== gl.qtyRec ? `Ordered ${gl.qty}, Got ${gl.qtyRec} — ${gl.discReason||"Unknown"}` : "";
          tableRows += `<tr${j===0?` style="border-top:2px solid #999"`:""}>
            ${j===0?`<td rowspan="${inv.lines.length+(inv.extra?1:0)}" style="vertical-align:top">${fmt(inv.date)}</td><td rowspan="${inv.lines.length+(inv.extra?1:0)}" style="vertical-align:top">${inv.num}</td><td rowspan="${inv.lines.length+(inv.extra?1:0)}" style="vertical-align:top">${vendorInvNum||"—"}</td>`:""}
            <td>${l.name}</td><td class="right">${l.qty} ${l.unit}</td><td class="right">${R(l.price)}/${l.unit}</td><td class="center">${l.gst}%</td><td class="right">${R(l.lineBase)}</td><td style="color:#b91c1c;font-size:11px">${disc}</td>
            ${j===0?`<td rowspan="${inv.lines.length+(inv.extra?1:0)}" class="right" style="vertical-align:top;font-weight:bold">${R(inv.totalGST)}</td>`:""}
          </tr>`;
        });
        if(inv.extra) {
          tableRows += `<tr><td>${inv.extra.label}</td><td></td><td></td><td></td><td class="right">${R(inv.extra.amt)}</td><td></td></tr>`;
        }
      });
      vCN.forEach(cn => {
        tableRows += `<tr style="background:#fef2f2;border-top:2px solid #999"><td>${fmt(cn.date)}</td><td>${cn.num}</td><td></td><td colspan="4" style="color:#b91c1c">Credit Note: ${cn.reason}</td><td></td><td></td><td class="right" style="color:#b91c1c;font-weight:bold">${R(cn.totalGST)}</td></tr>`;
      });
      vPay.sort((a,b)=>a.date.localeCompare(b.date)).forEach(p => {
        tableRows += `<tr style="background:#f0fdf4;border-top:2px solid #999"><td>${fmt(p.date)}</td><td>—</td><td>Ref: ${p.ref||"—"}</td><td colspan="4">Payment (${p.method?.toUpperCase()})</td><td></td><td></td><td class="right" style="font-weight:bold">${R(p.amount)}</td></tr>`;
      });

      printHTML(`Ledger - ${v.name}`, `
        <div class="header">
          <h1>${COMPANY.name}</h1>
          <h2>${COMPANY.addr}<br/>${COMPANY.city}</h2>
          <div style="margin-top:12px;border-top:2px solid #333;padding-top:8px">
            <h2 style="font-size:16px;color:#000;font-weight:bold">${v.name}</h2>
            <p style="font-size:12px;color:#666">Bill-wise Details &nbsp;|&nbsp; ${dateRange}</p>
            ${v.gstin?`<p style="font-size:11px;color:#888">GSTIN: ${v.gstin}</p>`:""}
          </div>
        </div>
        <table style="font-size:11px">
          <thead><tr><th>Date</th><th>Invoice #</th><th>Vendor Inv #</th><th>Item</th><th class="right">Qty</th><th class="right">Rate</th><th class="center">GST%</th><th class="right">Amount</th><th>Discrepancy</th><th class="right">Credit</th></tr></thead>
          <tbody>${tableRows}</tbody>
          <tfoot>
            <tr style="border-top:3px solid #333"><td colspan="9" style="text-align:right;font-weight:bold">Closing Balance (${closingBal>0?"Cr":"Dr"})</td><td class="right" style="font-weight:bold;font-size:14px">${R(Math.abs(closingBal))}</td></tr>
          </tfoot>
        </table>
        <p style="margin-top:20px;font-size:10px;color:#aaa">Generated by Novy Procurement System</p>
      `);
    };

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
              <tbody>{ledger.map(v=>(<tr key={v.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={()=>setExpanded(v.id)}><td className="px-3 py-2 font-medium">{v.name}</td><td className="px-3 py-2 text-right">{R(v.invoiced)}</td><td className="px-3 py-2 text-right">{R(v.paid)}</td><td className="px-3 py-2 text-right text-red-500">{v.cnAmt>0?R(v.cnAmt):"—"}</td><td className="px-3 py-2 text-right font-bold">{R(v.balance)}</td><td className="px-3 py-2 text-right"><Btn v="ghost" s onClick={(e)=>{e.stopPropagation();setExpanded(v.id);}}>View</Btn></td></tr>))}</tbody>
            </table>
          </div>
        )}
        {expanded!==null&&(()=>{
          const v = vendors.find(x=>x.id===expanded);
          const {vInv, vCN, vPay, closingBal} = buildLedgerRows(expanded);
          const dateRange = dateFrom||dateTo ? `${dateFrom?fmt(dateFrom):"Start"} to ${dateTo?fmt(dateTo):"Today"}` : "All time";
          return (
            <div className="bg-white rounded-xl border p-4 overflow-x-auto">
              <div className="mb-4 pb-4 border-b text-center">
                <h3 className="font-bold text-sm">{COMPANY.name}</h3>
                <p className="text-[10px] text-gray-500">{COMPANY.addr}, {COMPANY.city}</p>
                <p className="text-sm font-bold mt-2">{v?.name}</p>
                <p className="text-xs text-gray-500">Bill-wise Details | {dateRange}</p>
                {v?.gstin&&<p className="text-[10px] text-gray-400">GSTIN: {v.gstin}</p>}
              </div>
              {/* Invoice-level rows with item detail */}
              {vInv.map(inv => {
                const grnMap = getGrnDetails(inv);
                const vendorInvNum = grns.find(g=>g.id===inv.grnId)?.vendorInvNum||"";
                return (
                  <div key={inv.id} className="mb-3 border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-bold">{fmt(inv.date)}</span>
                      <span className="text-gray-500">{inv.num}</span>
                      {vendorInvNum&&<span className="text-gray-400">Vendor Inv: {vendorInvNum}</span>}
                      <span className="flex-1"/>
                      <span className="font-bold text-sm">{R(inv.totalGST)}</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead><tr className="bg-gray-50 text-gray-500"><th className="text-left px-3 py-1">Item</th><th className="text-right px-3 py-1">Qty</th><th className="text-right px-3 py-1">Rate</th><th className="text-center px-3 py-1">GST</th><th className="text-right px-3 py-1">Amount</th><th className="text-left px-3 py-1">Discrepancy</th></tr></thead>
                      <tbody>
                        {inv.lines?.map((l,j) => {
                          const gl = grnMap[l.iid];
                          const hasDisc = gl && gl.qty !== gl.qtyRec;
                          return (
                            <tr key={j} className={`border-t ${hasDisc?"bg-red-50":""}`}>
                              <td className="px-3 py-1.5 font-medium">{l.name}</td>
                              <td className="px-3 py-1.5 text-right">{l.qty} {l.unit}</td>
                              <td className="px-3 py-1.5 text-right">{R(l.price)}/{l.unit}</td>
                              <td className="px-3 py-1.5 text-center">{l.gst}%</td>
                              <td className="px-3 py-1.5 text-right font-medium">{R(l.lineBase)}</td>
                              <td className="px-3 py-1.5 text-red-600 text-[10px]">{hasDisc?`Ordered ${gl.qty}, Got ${gl.qtyRec} — ${gl.discReason||"Unknown"}`:""}</td>
                            </tr>
                          );
                        })}
                        {inv.extra&&<tr className="border-t"><td className="px-3 py-1.5 text-gray-500" colSpan={4}>{inv.extra.label}</td><td className="px-3 py-1.5 text-right">{R(inv.extra.amt)}</td><td></td></tr>}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-gray-50 text-[10px] text-gray-500">
                          <td colSpan={4} className="px-3 py-1 text-right">{inv.intra?`CGST: ${R(inv.cgst)} + SGST: ${R(inv.sgst)}`:`IGST: ${R(inv.igst)}`}</td>
                          <td className="px-3 py-1 text-right font-bold text-gray-800">{R(inv.totalGST)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })}
              {/* Credit Notes */}
              {vCN.map(cn=>(<div key={cn.id} className="mb-2 border border-red-200 rounded-lg bg-red-50 px-3 py-2 flex flex-wrap items-center gap-3 text-xs"><span className="font-bold">{fmt(cn.date)}</span><span className="text-red-600 font-bold">Credit Note</span><span className="text-gray-500">{cn.num}</span><span className="text-gray-500">{cn.reason}</span><span className="flex-1"/><span className="font-bold text-red-600">-{R(cn.totalGST)}</span></div>))}
              {/* Payments */}
              {vPay.sort((a,b)=>a.date.localeCompare(b.date)).map(p=>(<div key={p.id} className="mb-2 border border-green-200 rounded-lg bg-green-50 px-3 py-2 flex flex-wrap items-center gap-3 text-xs"><span className="font-bold">{fmt(p.date)}</span><span className="text-green-700 font-bold">Payment</span><span className="text-gray-500">{p.method?.toUpperCase()}</span>{p.ref&&<span className="text-gray-400">Ref: {p.ref}</span>}<span className="flex-1"/><span className="font-bold text-green-700">{R(p.amount)}</span></div>))}
              {/* Closing balance */}
              <div className="mt-4 pt-3 border-t-2 border-gray-800 flex justify-between items-center">
                <span className="text-xs text-gray-500">{closingBal>0?"Cr":"Dr"}</span>
                <div className="text-right"><p className="text-xs text-gray-500">Closing Balance</p><p className="text-lg font-bold">{R(Math.abs(closingBal))}</p></div>
              </div>
              <div className="flex justify-end mt-4 gap-2">
                <Btn v="outline" s onClick={()=>setExpanded(null)}>Close</Btn>
                <Btn v="outline" s onClick={()=>downloadCSV(v)}>↓ CSV</Btn>
                <Btn v="primary" s onClick={()=>downloadPDF(v)}>↓ PDF</Btn>
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
      {toast&&<div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium transition-all ${toast.ok?"bg-green-600 text-white":"bg-red-500 text-white"}`}>{toast.ok?"✓":"✗"} {toast.msg}</div>}
    </div>
  );
}
