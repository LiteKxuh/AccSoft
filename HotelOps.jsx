import { useState, useEffect, useMemo, useRef } from "react";
import {
  Building2, Clock, Calendar, Users, DollarSign, FileText, BarChart3,
  Settings as SettingsIcon, LogOut, ChevronDown, Plus, Search, Edit2, Trash2,
  CheckCircle2, AlertCircle, FileWarning, Upload, Download, Eye,
  ArrowLeft, ArrowRight, X, Save, Play, Pause, ClipboardList,
  TrendingUp, BedDouble, Home, ChevronRight, MoreHorizontal,
  Shield, UserCircle2, MapPin, Phone, Mail, Hash, Briefcase,
  LayoutDashboard, Coffee, FileCheck2, Paperclip, Receipt
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, ComposedChart
} from "recharts";
import { extractAudit as _extractAudit, fileToBase64 as _fileToBase64, splitAuditBatch as _splitAuditBatch, parseAuditBatch as _parseAuditBatch } from "./src/lib/auditParser.js";
import { useToast as _useToast } from "./src/lib/toast.jsx";
import { commandBus as _commandBus } from "./src/lib/CommandPalette.jsx";
import { forecast as _forecast } from "./src/lib/forecast.js";
import { autoSeedBudgets as _autoSeedBudgets, actualsFor as _actualsFor, budgetTotal as _budgetTotal, pacing as _pacing, monthOf as _monthOf, emptyBudget as _emptyBudget } from "./src/lib/budget.js";

/* =========================================================================
   FONTS + GLOBAL STYLE
   ========================================================================= */
const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700;9..144,800;9..144,900&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
    .font-display { font-family: 'Fraunces', 'Times New Roman', serif; font-feature-settings: "ss01"; letter-spacing: -0.01em; }
    .font-body { font-family: 'Manrope', system-ui, sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .tabular { font-variant-numeric: tabular-nums; }
    .scroll-thin::-webkit-scrollbar { width: 6px; height: 6px; }
    .scroll-thin::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.18); border-radius: 6px; }
    .scroll-thin::-webkit-scrollbar-track { background: transparent; }
    .ring-focus:focus { outline: 2px solid #b45309; outline-offset: 2px; }
    body { margin: 0; }

    @keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pulse-soft { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
    @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes spin-slow { to { transform: rotate(360deg); } }
    @keyframes count-bounce { 0% { transform: scale(0.92); opacity: 0; } 60% { transform: scale(1.02); } 100% { transform: scale(1); opacity: 1; } }
    @keyframes orbit { 0% { transform: rotate(0deg) translateX(60px) rotate(0deg); } 100% { transform: rotate(360deg) translateX(60px) rotate(-360deg); } }
    .anim-fade-up { animation: fade-up 0.5s ease-out both; }
    .anim-fade-in { animation: fade-in 0.4s ease-out both; }
    .anim-pulse-soft { animation: pulse-soft 1.8s ease-in-out infinite; }
    .anim-count { animation: count-bounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
    .anim-spin-slow { animation: spin-slow 2s linear infinite; }
    .delay-100 { animation-delay: 0.1s; }
    .delay-200 { animation-delay: 0.2s; }
    .delay-300 { animation-delay: 0.3s; }
    .delay-400 { animation-delay: 0.4s; }
    .delay-500 { animation-delay: 0.5s; }

    .grain { position: relative; }
    .grain::before {
      content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0.5;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.85' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.18'/%3E%3C/svg%3E");
      mix-blend-mode: overlay;
    }

    .shimmer-bg {
      background: linear-gradient(90deg, rgba(180,83,9,0) 0%, rgba(180,83,9,0.18) 50%, rgba(180,83,9,0) 100%);
      background-size: 200% 100%; animation: shimmer 1.6s linear infinite;
    }

    .hero-glow {
      position: relative; overflow: hidden;
    }
    .hero-glow::after {
      content: ''; position: absolute; top: -50%; right: -20%; width: 60%; height: 200%;
      background: radial-gradient(ellipse at center, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0) 60%);
      pointer-events: none;
    }

    .accounting-bg {
      background-image:
        radial-gradient(circle at 20% 0%, rgba(180,83,9,0.04) 0%, transparent 40%),
        radial-gradient(circle at 80% 100%, rgba(120,113,108,0.05) 0%, transparent 50%);
    }

    .number-display { font-feature-settings: "tnum", "ss01", "lnum"; }
  `}</style>
);

/* =========================================================================
   CONSTANTS & SEED DATA
   ========================================================================= */
const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const SEED = {
  properties: [
    { id: "p1", name: "Riverbend Inn", location: "Pine Bluff, AR", rooms: 84, type: "Limited Service" },
    { id: "p2", name: "Cypress Point Lodge", location: "Hot Springs, AR", rooms: 142, type: "Full Service" },
  ],
  employees: [
    { id: "e1", firstName: "Marcus", lastName: "Williams", role: "admin", title: "Regional Director", email: "marcus.w@hotelops.demo", phone: "(870) 555-0101", propertyId: "p1", propertyAccess: ["p1","p2"], hourlyRate: 0, salary: 92000, hireDate: "2019-06-10", status: "active", ssnLast4: "8821", emergency: "K. Williams · (870) 555-0102" },
    { id: "e2", firstName: "Sarah", lastName: "Chen", role: "manager", title: "General Manager", email: "sarah.c@hotelops.demo", phone: "(870) 555-0103", propertyId: "p1", propertyAccess: ["p1"], hourlyRate: 0, salary: 64000, hireDate: "2022-03-15", status: "active", ssnLast4: "4521", emergency: "James Chen · (870) 555-0143" },
    { id: "e3", firstName: "Diego", lastName: "Reyes", role: "manager", title: "General Manager", email: "diego.r@hotelops.demo", phone: "(501) 555-0104", propertyId: "p2", propertyAccess: ["p2"], hourlyRate: 0, salary: 71000, hireDate: "2021-09-02", status: "active", ssnLast4: "9034", emergency: "Mariana Reyes · (501) 555-0105" },
    { id: "e4", firstName: "Aisha", lastName: "Patel", role: "front_desk", title: "Front Desk Lead", email: "aisha.p@hotelops.demo", phone: "(870) 555-0106", propertyId: "p1", propertyAccess: ["p1"], hourlyRate: 19.50, hireDate: "2023-01-22", status: "active", ssnLast4: "2210", emergency: "Raj Patel · (870) 555-0107" },
    { id: "e5", firstName: "Tyler", lastName: "Brooks", role: "front_desk", title: "Front Desk Agent", email: "tyler.b@hotelops.demo", phone: "(870) 555-0108", propertyId: "p1", propertyAccess: ["p1"], hourlyRate: 16.25, hireDate: "2024-05-11", status: "active", ssnLast4: "7733", emergency: "S. Brooks · (870) 555-0109" },
    { id: "e6", firstName: "Marisol", lastName: "Fuentes", role: "housekeeping", title: "Executive Housekeeper", email: "marisol.f@hotelops.demo", phone: "(870) 555-0110", propertyId: "p1", propertyAccess: ["p1"], hourlyRate: 21.00, hireDate: "2020-11-04", status: "active", ssnLast4: "5512", emergency: "Carlos Fuentes · (870) 555-0111" },
    { id: "e7", firstName: "Kenji", lastName: "Tanaka", role: "housekeeping", title: "Room Attendant", email: "kenji.t@hotelops.demo", phone: "(870) 555-0112", propertyId: "p1", propertyAccess: ["p1"], hourlyRate: 15.75, hireDate: "2024-09-18", status: "active", ssnLast4: "1108", emergency: "Y. Tanaka · (870) 555-0113" },
    { id: "e8", firstName: "Beatrice", lastName: "Okonkwo", role: "front_desk", title: "Night Auditor", email: "beatrice.o@hotelops.demo", phone: "(501) 555-0114", propertyId: "p2", propertyAccess: ["p2"], hourlyRate: 20.50, hireDate: "2022-08-29", status: "active", ssnLast4: "6644", emergency: "C. Okonkwo · (501) 555-0115" },
    { id: "e9", firstName: "Robert", lastName: "Hayes", role: "maintenance", title: "Chief Engineer", email: "robert.h@hotelops.demo", phone: "(501) 555-0116", propertyId: "p2", propertyAccess: ["p2"], hourlyRate: 26.00, hireDate: "2018-04-12", status: "active", ssnLast4: "3398", emergency: "L. Hayes · (501) 555-0117" },
    { id: "e10", firstName: "Chloe", lastName: "Martin", role: "housekeeping", title: "Room Attendant", email: "chloe.m@hotelops.demo", phone: "(501) 555-0118", propertyId: "p2", propertyAccess: ["p2"], hourlyRate: 16.00, hireDate: "2024-02-06", status: "active", ssnLast4: "0091", emergency: "P. Martin · (501) 555-0119" },
    { id: "e11", firstName: "Devon", lastName: "Carter", role: "front_desk", title: "Front Desk Agent", email: "devon.c@hotelops.demo", phone: "(501) 555-0120", propertyId: "p2", propertyAccess: ["p2"], hourlyRate: 17.00, hireDate: "2023-10-30", status: "active", ssnLast4: "8821", emergency: "T. Carter · (501) 555-0121" },
    { id: "e12", firstName: "Linda", lastName: "Zhao", role: "housekeeping", title: "Room Attendant", email: "linda.z@hotelops.demo", phone: "(501) 555-0122", propertyId: "p2", propertyAccess: ["p2"], hourlyRate: 15.75, hireDate: "2024-06-14", status: "active", ssnLast4: "4477", emergency: "W. Zhao · (501) 555-0123" },
  ],
  shifts: [], // generated below
  schedule: [], // generated below
  writeups: [
    { id: "w1", employeeId: "e12", type: "verbal", date: iso(addDays(TODAY, -18)), issue: "Tardiness", description: "Arrived 32 minutes late to scheduled 8:00 AM shift without prior notification.", actionTaken: "Verbal counseling on attendance policy. Reviewed expectations.", issuedBy: "e3", acknowledged: true, acknowledgedDate: iso(addDays(TODAY, -18)) },
    { id: "w2", employeeId: "e12", type: "written", date: iso(addDays(TODAY, -4)), issue: "Repeated Tardiness", description: "Second tardiness incident within 30 days. Arrived 18 minutes late.", actionTaken: "Written warning. Next incident will result in final warning per attendance policy section 4.2.", issuedBy: "e3", acknowledged: false, acknowledgedDate: null },
    { id: "w3", employeeId: "e7", type: "verbal", date: iso(addDays(TODAY, -45)), issue: "Uniform Compliance", description: "Reported to shift without name badge.", actionTaken: "Verbal reminder of uniform standards.", issuedBy: "e2", acknowledged: true, acknowledgedDate: iso(addDays(TODAY, -45)) },
  ],
  documents: [
    { id: "d1", employeeId: "e2", name: "I-9 Employment Eligibility.pdf", category: "Onboarding", uploadDate: "2022-03-15", size: "342 KB" },
    { id: "d2", employeeId: "e2", name: "W-4 Federal Tax Withholding.pdf", category: "Tax Forms", uploadDate: "2022-03-15", size: "188 KB" },
    { id: "d3", employeeId: "e2", name: "Direct Deposit Authorization.pdf", category: "Payroll", uploadDate: "2022-03-15", size: "94 KB" },
    { id: "d4", employeeId: "e2", name: "Employee Handbook Acknowledgment.pdf", category: "Onboarding", uploadDate: "2022-03-15", size: "112 KB" },
    { id: "d5", employeeId: "e2", name: "2024 Annual Review.pdf", category: "Performance", uploadDate: "2024-12-10", size: "267 KB" },
    { id: "d6", employeeId: "e4", name: "I-9 Employment Eligibility.pdf", category: "Onboarding", uploadDate: "2023-01-22", size: "338 KB" },
    { id: "d7", employeeId: "e4", name: "W-4 Federal Tax Withholding.pdf", category: "Tax Forms", uploadDate: "2023-01-22", size: "192 KB" },
    { id: "d8", employeeId: "e4", name: "Front Desk Certification.pdf", category: "Training", uploadDate: "2023-04-08", size: "421 KB" },
    { id: "d9", employeeId: "e12", name: "I-9 Employment Eligibility.pdf", category: "Onboarding", uploadDate: "2024-06-14", size: "344 KB" },
    { id: "d10", employeeId: "e12", name: "W-4 Federal Tax Withholding.pdf", category: "Tax Forms", uploadDate: "2024-06-14", size: "186 KB" },
    { id: "d11", employeeId: "e6", name: "Executive Housekeeper Contract.pdf", category: "Onboarding", uploadDate: "2020-11-04", size: "512 KB" },
    { id: "d12", employeeId: "e9", name: "HVAC Certification.pdf", category: "Training", uploadDate: "2018-05-22", size: "289 KB" },
  ],
  reports: [], // generated below
  budgets: [], // generated below
  activity: [], // generated below — audit log
  closedPeriods: [], // [{ propertyId, month, closedAt, closedBy, notes }]
  ptoRequests: [], // generated below — PTO / time-off requests
  vendors: [
    { id: "v1", name: "Sysco Foods", category: "Food & Beverage", terms: "Net 30", contact: "ar@sysco.com" },
    { id: "v2", name: "Cintas Uniforms", category: "Operations", terms: "Net 30", contact: "billing@cintas.com" },
    { id: "v3", name: "American Hotel Register", category: "Guest Supplies", terms: "Net 30", contact: "ap@ahr.com" },
    { id: "v4", name: "Pine Bluff Power & Water", category: "Utilities", terms: "Net 15", contact: "billing@pbpw.org" },
    { id: "v5", name: "Otis Elevator Service", category: "Maintenance", terms: "Net 30", contact: "service@otis.com" },
    { id: "v6", name: "Ecolab Sanitation", category: "Operations", terms: "Net 30", contact: "ar@ecolab.com" },
    { id: "v7", name: "Comcast Business", category: "Utilities", terms: "Net 30", contact: "biz@comcast.com" },
    { id: "v8", name: "Riverbend Linen Co.", category: "Housekeeping", terms: "Net 30", contact: "ap@rblc.com" },
  ],
  invoices: [], // generated below
};

// Generate shifts (last 14 days)
(function generateShifts() {
  const hourlyEmployees = SEED.employees.filter(e => e.hourlyRate > 0);
  let id = 1;
  for (let day = 14; day >= 1; day--) {
    const date = addDays(TODAY, -day);
    hourlyEmployees.forEach(emp => {
      // ~85% likelihood of working any given day
      if (Math.random() > 0.15) {
        const startHour = emp.role === "front_desk" && emp.title.includes("Night") ? 23 : (Math.random() < 0.5 ? 7 : 15);
        const startMin = Math.floor(Math.random() * 15);
        const shiftLen = 7.5 + Math.random() * 1.5;
        const inDate = new Date(date);
        inDate.setHours(startHour, startMin, Math.floor(Math.random()*60));
        const outDate = new Date(inDate.getTime() + shiftLen * 3600 * 1000);
        SEED.shifts.push({
          id: `s${id++}`,
          employeeId: emp.id,
          propertyId: emp.propertyId,
          clockIn: inDate.toISOString(),
          clockOut: outDate.toISOString(),
          breakMinutes: 30,
          notes: "",
          edited: false,
          editedBy: null,
        });
      }
    });
  }
})();

// Generate schedule (this week + next week)
(function generateSchedule() {
  const day = TODAY.getDay();
  const startOfWeek = addDays(TODAY, -day);
  const hourlyEmployees = SEED.employees.filter(e => e.hourlyRate > 0);
  let id = 1;
  for (let w = 0; w < 2; w++) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(startOfWeek, w*7 + d);
      hourlyEmployees.forEach(emp => {
        if (Math.random() > 0.25) {
          const isNight = emp.title.includes("Night");
          const startTime = isNight ? "23:00" : (Math.random() < 0.5 ? "07:00" : "15:00");
          const endTime = isNight ? "07:00" : (startTime === "07:00" ? "15:00" : "23:00");
          SEED.schedule.push({
            id: `sc${id++}`,
            employeeId: emp.id,
            propertyId: emp.propertyId,
            date: iso(date),
            startTime,
            endTime,
            position: emp.title,
          });
        }
      });
    }
  }
})();

// Generate daily reports (last 30 days)
(function generateReports() {
  let id = 1;
  SEED.properties.forEach(prop => {
    for (let day = 30; day >= 1; day--) {
      const date = addDays(TODAY, -day);
      const isWeekend = [5,6].includes(date.getDay());
      const occBase = isWeekend ? 0.78 : 0.65;
      const occupancy = Math.min(0.98, occBase + (Math.random() - 0.5) * 0.25);
      const roomsSold = Math.round(prop.rooms * occupancy);
      const adr = prop.type === "Full Service" ? 165 + Math.random()*45 : 118 + Math.random()*28;
      const roomRevenue = roomsSold * adr;
      const fbRevenue = prop.type === "Full Service" ? roomsSold * (28 + Math.random()*22) : roomsSold * (4 + Math.random()*8);
      const otherRevenue = roomsSold * (3 + Math.random()*8);
      SEED.reports.push({
        id: `r${id++}`,
        date: iso(date),
        propertyId: prop.id,
        roomsSold,
        roomsAvailable: prop.rooms,
        occupancy: roomsSold / prop.rooms,
        adr: Math.round(adr * 100) / 100,
        revpar: Math.round((roomRevenue / prop.rooms) * 100) / 100,
        roomRevenue: Math.round(roomRevenue * 100) / 100,
        fbRevenue: Math.round(fbRevenue * 100) / 100,
        otherRevenue: Math.round(otherRevenue * 100) / 100,
        totalRevenue: Math.round((roomRevenue + fbRevenue + otherRevenue) * 100) / 100,
        notes: "",
      });
    }
  });
})();

// Auto-seed forward-looking budgets from the seeded report history
SEED.budgets = _autoSeedBudgets(SEED.properties, SEED.reports, 0.06, 3);

// Generate a few PTO requests so the module has data on first run
(function generatePto() {
  let id = 1;
  const hourly = SEED.employees.filter(e => e.hourlyRate > 0);
  // 3 historical (mix of approved/denied), 2 upcoming (pending), 1 upcoming approved
  const seedReqs = [
    { offset: -10, days: 3, status: "approved", reason: "Family event" },
    { offset: -25, days: 5, status: "approved", reason: "Vacation" },
    { offset: -40, days: 2, status: "denied", reason: "Personal time" },
    { offset: 12, days: 4, status: "pending", reason: "Vacation — already booked flights" },
    { offset: 30, days: 2, status: "pending", reason: "Wedding out of state" },
    { offset: 18, days: 5, status: "approved", reason: "Anniversary trip" },
  ];
  seedReqs.forEach((r, i) => {
    const emp = hourly[i % hourly.length];
    const start = addDays(TODAY, r.offset);
    const end = addDays(start, r.days - 1);
    SEED.ptoRequests.push({
      id: `pto${id++}`,
      employeeId: emp.id,
      startDate: iso(start),
      endDate: iso(end),
      hours: r.days * 8,
      type: "vacation",
      reason: r.reason,
      status: r.status,
      requestedAt: iso(addDays(TODAY, r.offset - 7)),
      reviewedBy: r.status !== "pending" ? SEED.employees.find(e => e.role === "manager" && e.propertyId === emp.propertyId)?.id : null,
      reviewedAt: r.status !== "pending" ? iso(addDays(TODAY, r.offset - 5)) : null,
      reviewNotes: r.status === "denied" ? "Holiday weekend — cannot approve, please re-submit for a different date." : null,
    });
  });
})();

// Generate sample invoices over the last 60 days for AP module realism
(function generateInvoices() {
  let id = 1;
  const today = TODAY;
  SEED.properties.forEach(prop => {
    SEED.vendors.forEach(v => {
      // Each vendor invoices 1-3 times across the window
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const daysAgo = Math.floor(Math.random() * 60);
        const issued = addDays(today, -daysAgo);
        const termsDays = v.terms === "Net 15" ? 15 : 30;
        const dueDate = addDays(issued, termsDays);
        const baseAmount =
          v.category === "Food & Beverage" ? 800 + Math.random() * 4500 :
          v.category === "Utilities" ? 1200 + Math.random() * 3500 :
          v.category === "Maintenance" ? 350 + Math.random() * 2200 :
          v.category === "Housekeeping" ? 600 + Math.random() * 1800 :
          v.category === "Operations" ? 250 + Math.random() * 900 :
          v.category === "Guest Supplies" ? 400 + Math.random() * 1600 :
          200 + Math.random() * 600;
        const amount = Math.round(baseAmount * 100) / 100;
        // Status: 60% paid (random past), 30% open, 10% overdue
        const r = Math.random();
        let status = "open";
        let paidDate = null;
        if (r < 0.55 && daysAgo > 5) {
          status = "paid";
          paidDate = iso(addDays(issued, Math.min(termsDays - 1, Math.floor(Math.random() * termsDays))));
        } else if (dueDate < today) {
          status = "overdue";
        }
        SEED.invoices.push({
          id: `inv${id++}`,
          vendorId: v.id,
          propertyId: prop.id,
          number: `${v.id.toUpperCase()}-${prop.id.toUpperCase()}-${1000 + id}`,
          issuedDate: iso(issued),
          dueDate: iso(dueDate),
          paidDate,
          amount,
          status, // open | paid | overdue | approved | rejected
          glAccount: v.category === "Food & Beverage" ? "5210" :
                     v.category === "Utilities" ? "5350" :
                     v.category === "Maintenance" ? "5410" :
                     v.category === "Housekeeping" ? "5320" :
                     v.category === "Operations" ? "5520" :
                     v.category === "Guest Supplies" ? "5310" : "5900",
          memo: "",
          approvalState: r < 0.85 ? "approved" : "pending",
          createdAt: issued.toISOString(),
        });
      }
    });
  });
})();

/* =========================================================================
   STORAGE LAYER
   ========================================================================= */
const STORAGE_KEY = "hotelops:state:v1";

const loadState = async () => {
  try {
    const r = await window.storage.get(STORAGE_KEY);
    if (r && r.value) return JSON.parse(r.value);
  } catch (e) { /* not found */ }
  return null;
};

const saveState = async (state) => {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Save failed", e);
  }
};

/* =========================================================================
   UTILITIES
   ========================================================================= */
const fmtMoney = (n) => `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtMoneyShort = (n) => {
  if (n >= 1000000) return `$${(n/1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n/1000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};
const fmtPct = (n) => `${(n*100).toFixed(1)}%`;
const fmtTime = (isoStr) => {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const fmtDate = (isoStr) => {
  if (!isoStr) return "—";
  const d = isoStr instanceof Date ? isoStr : new Date(isoStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const fmtDateShort = (isoStr) => {
  if (!isoStr) return "—";
  const d = isoStr instanceof Date ? isoStr : new Date(isoStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const fmtDayName = (isoStr) => {
  const d = isoStr instanceof Date ? isoStr : new Date(isoStr);
  return d.toLocaleDateString("en-US", { weekday: "short" });
};
const hoursBetween = (inIso, outIso, breakMin = 0) => {
  if (!inIso || !outIso) return 0;
  const ms = new Date(outIso) - new Date(inIso);
  return Math.max(0, ms / 3600000 - (breakMin / 60));
};
const initials = (emp) => `${emp.firstName[0]}${emp.lastName[0]}`.toUpperCase();
const fullName = (emp) => `${emp.firstName} ${emp.lastName}`;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;

const ROLE_LABEL = {
  admin: "Administrator",
  manager: "Property Manager",
  front_desk: "Front Desk",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
};

const ROLE_PERMS = {
  admin: { all: true, properties: "all", canEditAll: true, canRunPayroll: true, canManageUsers: true, canIssueWriteups: true, canEditAnyShift: true, canViewAllReports: true },
  manager: { all: false, properties: "own", canEditAll: false, canRunPayroll: true, canManageUsers: true, canIssueWriteups: true, canEditAnyShift: true, canViewAllReports: true },
  front_desk: { all: false, properties: "self", canEditAll: false, canRunPayroll: false, canManageUsers: false, canIssueWriteups: false, canEditAnyShift: false, canViewAllReports: false },
  housekeeping: { all: false, properties: "self", canEditAll: false, canRunPayroll: false, canManageUsers: false, canIssueWriteups: false, canEditAnyShift: false, canViewAllReports: false },
  maintenance: { all: false, properties: "self", canEditAll: false, canRunPayroll: false, canManageUsers: false, canIssueWriteups: false, canEditAnyShift: false, canViewAllReports: false },
};

/* =========================================================================
   UI PRIMITIVES
   ========================================================================= */
const Button = ({ children, onClick, variant = "primary", size = "md", disabled, type, className = "" }) => {
  const variants = {
    primary: "bg-stone-900 text-white hover:bg-stone-800 disabled:bg-stone-300",
    secondary: "bg-white text-stone-900 border border-stone-300 hover:bg-stone-50",
    accent: "bg-amber-700 text-white hover:bg-amber-800 disabled:bg-stone-300",
    ghost: "text-stone-700 hover:bg-stone-100",
    danger: "bg-rose-700 text-white hover:bg-rose-800",
    success: "bg-emerald-700 text-white hover:bg-emerald-800",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-sm",
  };
  return (
    <button
      onClick={onClick} disabled={disabled} type={type || "button"}
      className={`${variants[variant]} ${sizes[size]} font-medium rounded-md transition-colors inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed font-body ${className}`}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className = "", style }) => (
  <div className={`bg-white border border-stone-200 rounded-lg ${className}`} style={style}>{children}</div>
);

const Badge = ({ children, color = "stone" }) => {
  const colors = {
    stone: "bg-stone-100 text-stone-700 border-stone-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
    rose: "bg-rose-50 text-rose-800 border-rose-200",
    sky: "bg-sky-50 text-sky-800 border-sky-200",
    violet: "bg-violet-50 text-violet-800 border-violet-200",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[color]} font-body`}>{children}</span>;
};

const Modal = ({ open, onClose, title, children, size = "md" }) => {
  if (!open) return null;
  const sizes = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900 bg-opacity-50" onClick={onClose}>
      <div className={`bg-white rounded-lg shadow-2xl w-full ${sizes[size]} max-h-screen overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-xl text-stone-900">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={20} /></button>
        </div>
        <div className="px-6 py-5 overflow-y-auto scroll-thin font-body">{children}</div>
      </div>
    </div>
  );
};

const Input = ({ label, value, onChange, type = "text", placeholder, required, className = "" }) => (
  <label className={`block font-body ${className}`}>
    {label && <span className="block text-xs uppercase tracking-wider text-stone-500 mb-1.5 font-medium">{label}</span>}
    <input
      type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
    />
  </label>
);

const Select = ({ label, value, onChange, options, className = "" }) => (
  <label className={`block font-body ${className}`}>
    {label && <span className="block text-xs uppercase tracking-wider text-stone-500 mb-1.5 font-medium">{label}</span>}
    <select
      value={value ?? ""} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>
);

const Textarea = ({ label, value, onChange, rows = 3, placeholder, className = "" }) => (
  <label className={`block font-body ${className}`}>
    {label && <span className="block text-xs uppercase tracking-wider text-stone-500 mb-1.5 font-medium">{label}</span>}
    <textarea
      value={value ?? ""} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700 resize-y"
    />
  </label>
);

const Avatar = ({ employee, size = 32, onShift = false }) => (
  <div className="relative inline-flex" style={{ width: size, height: size }}>
    {onShift && (
      <span
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: "0 0 0 2px rgba(16,185,129,0.65)",
          animation: "avatar-pulse 1.8s ease-in-out infinite",
        }}
      />
    )}
    <div
      className="rounded-full bg-gradient-to-br from-amber-700 to-stone-800 text-white flex items-center justify-center font-medium font-body relative"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(employee)}
    </div>
    {onShift && (
      <span
        className="absolute bottom-0 right-0 rounded-full bg-emerald-500 ring-2 ring-white"
        style={{ width: Math.max(8, size * 0.25), height: Math.max(8, size * 0.25) }}
      />
    )}
    <style>{`@keyframes avatar-pulse { 0%, 100% { box-shadow: 0 0 0 2px rgba(16,185,129,0.65); } 50% { box-shadow: 0 0 0 4px rgba(16,185,129,0.18); } }`}</style>
  </div>
);

const Empty = ({ icon: Icon, title, message }) => (
  <div className="text-center py-12 font-body">
    <div className="inline-flex w-12 h-12 rounded-full bg-stone-100 items-center justify-center text-stone-400 mb-3">
      <Icon size={20} />
    </div>
    <p className="font-display text-lg text-stone-900">{title}</p>
    <p className="text-sm text-stone-500 mt-1">{message}</p>
  </div>
);

/* =========================================================================
   MAIN APP
   ========================================================================= */
export default function HotelOps() {
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState({
    properties: SEED.properties,
    employees: SEED.employees,
    shifts: SEED.shifts,
    schedule: SEED.schedule,
    writeups: SEED.writeups,
    documents: SEED.documents,
    reports: SEED.reports,
    budgets: SEED.budgets,
    activity: SEED.activity,
    closedPeriods: SEED.closedPeriods,
    vendors: SEED.vendors,
    invoices: SEED.invoices,
    ptoRequests: SEED.ptoRequests,
  });
  const [currentUserId, setCurrentUserId] = useState(null);
  const [activeProperty, setActiveProperty] = useState("p1");
  const [view, setView] = useState("dashboard");
  const [theme, setTheme] = useState(() => (typeof window !== "undefined" && localStorage.getItem("hotelops:theme")) || "light");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const toast = _useToast();

  // Load from storage on mount — backfill any new state keys added since last save
  useEffect(() => {
    (async () => {
      const saved = await loadState();
      if (saved && saved.state) {
        const merged = {
          ...state, // baseline includes seed defaults for any new keys
          ...saved.state, // user's persisted data takes precedence
        };
        // If the user's reports exist but budgets are empty, auto-seed budgets from their history
        if ((!merged.budgets || merged.budgets.length === 0) && merged.reports?.length) {
          merged.budgets = _autoSeedBudgets(merged.properties, merged.reports, 0.06, 3);
        }
        if (!merged.activity) merged.activity = [];
        if (!merged.closedPeriods) merged.closedPeriods = [];
        if (!merged.vendors) merged.vendors = SEED.vendors;
        if (!merged.invoices) merged.invoices = SEED.invoices;
        if (!merged.ptoRequests) merged.ptoRequests = SEED.ptoRequests;
        setState(merged);
        setCurrentUserId(saved.currentUserId || null);
        setActiveProperty(saved.activeProperty || "p1");
        setView(saved.view || "dashboard");
      }
      setLoaded(true);
    })();
  }, []);

  // Apply theme
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("hotelops:theme", theme); } catch {}
  }, [theme]);

  // First-run hint: discover ⌘K + onboarding wizard
  useEffect(() => {
    if (!loaded || !currentUserId || !toast) return;
    try {
      if (!localStorage.getItem("hotelops:hintSeen")) {
        const isMac = navigator.userAgent.includes("Mac");
        setTimeout(() => {
          toast.push(`Tip: press ${isMac ? "⌘K" : "Ctrl+K"} to jump anywhere · "g d" goes to Dashboard`, {
            tone: "info", duration: 6500,
          });
        }, 800);
        localStorage.setItem("hotelops:hintSeen", "1");
      }
      // Auto-show onboarding for fresh installs (no reports + not yet onboarded)
      if (!localStorage.getItem("hotelops:onboarded") && state.reports.length === 0) {
        setTimeout(() => setShowOnboarding(true), 400);
      }
    } catch {}
  }, [loaded, currentUserId, toast, state.reports.length]);

  // Wire the command palette into the app shell
  useEffect(() => {
    const off = _commandBus.subscribe((cmd, payload) => {
      if (cmd === "navigate" && payload) setView(payload);
      else if (cmd === "ingest:open") setView("accounting");
      else if (cmd === "flash:open") setView("accounting");
      else if (cmd === "portfolio:open") setView("accounting");
      else if (cmd === "theme:toggle") setTheme(t => t === "dark" ? "light" : "dark");
      else if (cmd === "open:employee" && payload) { setView("employees"); _commandBus.emit("employee:focus", payload); }
      else if (cmd === "open:property" && payload) { setActiveProperty(payload); setView("dashboard"); }
      else if (cmd === "open:vendor" && payload) { setView("accounting"); /* AP modal flow */ }
      else if (cmd === "data:reset") {
        if (confirm("Clear all local data and restore demo seed?")) {
          (async () => { try { await window.storage.delete(STORAGE_KEY); } catch {}; window.location.reload(); })();
        }
      }
      else if (cmd === "onboarding:open") setShowOnboarding(true);
    });
    return off;
  }, []);

  // Register dynamic global-search commands (employees, vendors, properties)
  useEffect(() => {
    if (!loaded || !currentUser) return;
    state.employees.forEach(e => {
      _commandBus.register(`emp:${e.id}`, {
        label: `Open ${fullName(e)}`, group: "Employees", hint: e.title,
        emit: ["open:employee", e.id],
      });
    });
    state.vendors?.forEach(v => {
      _commandBus.register(`vendor:${v.id}`, {
        label: `Open vendor: ${v.name}`, group: "Vendors", hint: v.category,
        emit: ["open:vendor", v.id],
      });
    });
    state.properties.forEach(p => {
      _commandBus.register(`prop:${p.id}`, {
        label: `Switch to ${p.name}`, group: "Properties", hint: p.location,
        emit: ["open:property", p.id],
      });
    });
    return () => {
      state.employees.forEach(e => _commandBus.unregister(`emp:${e.id}`));
      state.vendors?.forEach(v => _commandBus.unregister(`vendor:${v.id}`));
      state.properties.forEach(p => _commandBus.unregister(`prop:${p.id}`));
    };
  }, [loaded, currentUser, state.employees, state.vendors, state.properties]);

  // Persist state changes — surface a small autosave signal on the top bar
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus("saving");
    let cancelled = false;
    saveState({ state, currentUserId, activeProperty, view }).then(() => {
      if (cancelled) return;
      setSaveStatus("saved");
      setTimeout(() => !cancelled && setSaveStatus("idle"), 1400);
    });
    return () => { cancelled = true; };
  }, [state, currentUserId, activeProperty, view, loaded]);

  const currentUser = state.employees.find(e => e.id === currentUserId);
  const perms = currentUser ? ROLE_PERMS[currentUser.role] : null;

  // Derived: properties accessible to current user
  const accessibleProperties = useMemo(() => {
    if (!currentUser) return [];
    if (perms.properties === "all") return state.properties;
    return state.properties.filter(p => currentUser.propertyAccess.includes(p.id));
  }, [currentUser, state.properties]);

  // State mutators
  const update = (partial) => setState(s => ({ ...s, ...partial }));

  if (!loaded) {
    return (
      <>
        <GlobalStyle />
        <div className="min-h-screen flex bg-stone-50 font-body">
          {/* Sidebar skeleton */}
          <div className="w-64 flex-shrink-0" style={{ background: "#1c1917" }}>
            <div className="px-5 py-5 border-b border-stone-800 flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-amber-700/60" />
              <div className="h-4 w-24 rounded bg-stone-700/60" />
            </div>
            <div className="px-3 py-3 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 rounded-md bg-stone-800/40" />
              ))}
            </div>
          </div>
          {/* Main skeleton */}
          <div className="flex-1 p-8 space-y-6">
            <div className="h-10 w-64 rounded bg-stone-200" />
            <div className="grid grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 rounded-lg bg-white border border-stone-200">
                  <div className="m-4 h-3 w-20 rounded bg-stone-100" />
                  <div className="mx-4 h-7 w-32 rounded bg-stone-200 mt-2" />
                </div>
              ))}
            </div>
            <div className="h-72 rounded-lg bg-white border border-stone-200">
              <div className="shimmer-bg h-full w-full rounded-lg" />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!currentUserId || !currentUser) {
    return (
      <>
        <GlobalStyle />
        <LoginScreen
          employees={state.employees}
          properties={state.properties}
          onLogin={(id) => {
            const emp = state.employees.find(e => e.id === id);
            setCurrentUserId(id);
            setActiveProperty(emp.propertyAccess[0]);
            setView("dashboard");
          }}
        />
      </>
    );
  }

  const ctx = {
    state, update, currentUser, perms, activeProperty, setActiveProperty,
    accessibleProperties, view, setView,
    theme, setTheme, toast, saveStatus,
  };

  return (
    <>
      <GlobalStyle />
      <div className="min-h-screen flex bg-stone-50 font-body text-stone-900">
        <Sidebar ctx={ctx} onLogout={() => { setCurrentUserId(null); }} />
        <main className="flex-1 min-w-0 flex flex-col">
          <TopBar ctx={ctx} />
          <div className="flex-1 overflow-y-auto scroll-thin">
            <ModuleRouter ctx={ctx} />
          </div>
        </main>
      </div>
      {showOnboarding && <OnboardingWizard ctx={ctx} onClose={() => setShowOnboarding(false)} />}
    </>
  );
}

/* =========================================================================
   ONBOARDING WIZARD — first-run setup
   ========================================================================= */
function OnboardingWizard({ ctx, onClose }) {
  const { state, update, currentUser, toast } = ctx;
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [rooms, setRooms] = useState(80);
  const [type, setType] = useState("Limited Service");
  const [sampleResult, setSampleResult] = useState(null);
  const [sampleProcessing, setSampleProcessing] = useState(false);

  const finish = () => {
    try { localStorage.setItem("hotelops:onboarded", "1"); } catch {}
    onClose();
  };

  const addProperty = () => {
    const newProp = { id: newId("p"), name: name.trim(), location: location.trim(), rooms: Number(rooms) || 50, type, aliases: [] };
    update({ properties: [...state.properties, newProp] });
    pushActivity(ctx, "property.create", { propertyId: newProp.id, name: newProp.name });
    setStep(2);
    toast?.push(`Added ${newProp.name}`, { tone: "success" });
  };

  const tryParser = async () => {
    setSampleProcessing(true);
    const sample = SAMPLE_AUDITS[0];
    const result = await _extractAudit({ text: sample, file: null, properties: state.properties });
    setSampleResult(result);
    setSampleProcessing(false);
  };

  const steps = [
    {
      title: "Welcome to HotelOps",
      body: (
        <div className="space-y-3">
          <p className="text-stone-700">
            Built for hotel operators who want one platform for daily accounting, payroll, scheduling, and night-audit ingestion —
            without paying $12,000 a year for legacy software.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {[
              ["Drop any audit", "Smart Ingest reads any PMS night-audit format. No templates. No mapping setup."],
              ["USALI-aligned", "P&L, GL chart, taxes, A/R, A/P — all USALI 11th-edition standard."],
              ["Forecast & budget", "OLS + day-of-week seasonality projection · plan-vs-actual on every line."],
              ["SOX-grade", "Append-only activity log, period locking, full audit trail."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-lg border border-stone-200 p-3">
                <div className="font-semibold text-stone-900 text-sm">{t}</div>
                <div className="text-xs text-stone-500 mt-1">{b}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-stone-500 mt-3">
            Already explored the demo? Press <kbd className="text-[10px] px-1 rounded bg-stone-100 border border-stone-200 font-mono">Esc</kbd> or "Skip" to dismiss this guide.
          </p>
        </div>
      ),
      next: "Set up a property →",
      canNext: () => true,
      onNext: () => setStep(1),
    },
    {
      title: "Add a property",
      body: (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">Hotels live at the property level. You can add unlimited properties later from Settings.</p>
          <Input label="Property name" value={name} onChange={setName} placeholder="e.g. Marina Bay Suites" />
          <Input label="Location" value={location} onChange={setLocation} placeholder="e.g. Charleston, SC" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Total rooms" type="number" value={rooms} onChange={v => setRooms(v)} />
            <Select label="Service tier" value={type} onChange={setType} options={[
              { value: "Limited Service", label: "Limited Service" },
              { value: "Select Service", label: "Select Service" },
              { value: "Full Service", label: "Full Service" },
              { value: "Extended Stay", label: "Extended Stay" },
              { value: "Resort", label: "Resort" },
            ]} />
          </div>
        </div>
      ),
      next: "Add property →",
      canNext: () => name.trim() && location.trim(),
      onNext: addProperty,
    },
    {
      title: "Try the AI audit parser",
      body: (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">
            HotelOps can read any night-audit format. Click below to run a sample through the parser — no API key needed for text. (Add one in Settings later for PDF/image OCR.)
          </p>
          <div className="rounded-lg border border-stone-200 bg-stone-50/40 p-3 text-xs font-mono text-stone-700 max-h-40 overflow-y-auto whitespace-pre-wrap">
            {SAMPLE_AUDITS[0]}
          </div>
          {!sampleResult ? (
            <Button variant="accent" disabled={sampleProcessing} onClick={tryParser} className="w-full">
              {sampleProcessing ? "Parsing…" : "✨ Run sample"}
            </Button>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 space-y-2">
              <div className="text-sm font-semibold text-stone-900">Parsed in {sampleProcessing ? "…" : "0.4s"}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-stone-500">Date:</span> <strong className="tabular text-stone-900">{sampleResult.date}</strong></div>
                <div><span className="text-stone-500">Property:</span> <strong className="text-stone-900">{sampleResult.propertyName || "—"}</strong></div>
                <div><span className="text-stone-500">Rooms sold:</span> <strong className="tabular text-stone-900">{sampleResult.rooms?.sold} of {sampleResult.rooms?.available}</strong></div>
                <div><span className="text-stone-500">Confidence:</span> <strong className="tabular text-emerald-700">{((sampleResult.confidence || 0) * 100).toFixed(0)}%</strong></div>
                <div><span className="text-stone-500">Room rev:</span> <strong className="tabular text-stone-900">{fmtMoney(sampleResult.revenue?.rooms)}</strong></div>
                <div><span className="text-stone-500">F&B:</span> <strong className="tabular text-stone-900">{fmtMoney(sumFb(sampleResult))}</strong></div>
              </div>
              <div className="text-xs text-stone-500 italic mt-2">{sampleResult.insights?.[0]}</div>
            </div>
          )}
        </div>
      ),
      next: sampleResult ? "Finish setup →" : "Skip & finish",
      canNext: () => true,
      onNext: () => setStep(3),
    },
    {
      title: "You're all set",
      body: (
        <div className="space-y-4">
          <div className="text-center py-6">
            <div className="inline-flex w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 items-center justify-center mb-3">
              <CheckCircle2 size={28} />
            </div>
            <h4 className="font-display text-2xl text-stone-900">Ready to operate.</h4>
            <p className="text-sm text-stone-600 mt-2">A few things to know:</p>
          </div>
          <ul className="space-y-2 text-sm text-stone-700">
            <li className="flex gap-2"><span className="text-amber-600">→</span><kbd className="text-[10px] px-1 rounded bg-stone-100 border border-stone-200 font-mono">⌘K</kbd> opens the command palette to jump anywhere</li>
            <li className="flex gap-2"><span className="text-amber-600">→</span><kbd className="text-[10px] px-1 rounded bg-stone-100 border border-stone-200 font-mono">g</kbd> then a letter (d/t/s/e/p/a) jumps to a section</li>
            <li className="flex gap-2"><span className="text-amber-600">→</span>Smart Ingest is in Accounting → drag PDF/image or paste text from any PMS</li>
            <li className="flex gap-2"><span className="text-amber-600">→</span>Settings → Backup &amp; Restore captures a JSON snapshot of all your data</li>
            <li className="flex gap-2"><span className="text-amber-600">→</span>Press <kbd className="text-[10px] px-1 rounded bg-stone-100 border border-stone-200 font-mono">\</kbd> to collapse the sidebar</li>
          </ul>
        </div>
      ),
      next: "Open Dashboard",
      canNext: () => true,
      onNext: finish,
    },
  ];

  const s = steps[step];
  return (
    <Modal open onClose={onClose} title={s.title} size="lg">
      <div className="space-y-4">
        {/* Progress */}
        <div className="flex items-center gap-1.5 mb-2">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 rounded-full flex-1 ${i <= step ? "bg-amber-700" : "bg-stone-200"}`} />
          ))}
        </div>
        {s.body}
        <div className="flex justify-between items-center pt-3 border-t border-stone-200">
          {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={14} />Back</Button> : <Button variant="ghost" onClick={finish}>Skip</Button>}
          <Button variant="accent" disabled={!s.canNext()} onClick={s.onNext}>{s.next}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================================
   LOGIN
   ========================================================================= */
function LoginScreen({ employees, properties, onLogin }) {
  const [hover, setHover] = useState(null);
  const featuredIds = ["e1", "e2", "e3", "e4", "e8", "e12"];
  const featured = featuredIds.map(id => employees.find(e => e.id === id)).filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #1c1917 0%, #292524 50%, #44403c 100%)" }}>
      {/* Cinematic background — animated revenue line + grid */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40" preserveAspectRatio="none" viewBox="0 0 1200 800">
        <defs>
          <linearGradient id="login-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b45309" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#b45309" stopOpacity="0" />
          </linearGradient>
          <pattern id="login-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(168,162,158,0.05)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#login-grid)" />
        <path d="M0,520 C150,460 280,580 420,500 C580,410 720,560 840,470 C960,400 1080,510 1200,440 L1200,800 L0,800 Z" fill="url(#login-area)">
          <animate attributeName="d" dur="14s" repeatCount="indefinite"
            values="M0,520 C150,460 280,580 420,500 C580,410 720,560 840,470 C960,400 1080,510 1200,440 L1200,800 L0,800 Z;
                    M0,500 C160,540 290,440 430,520 C590,580 720,420 850,500 C970,560 1080,440 1200,500 L1200,800 L0,800 Z;
                    M0,520 C150,460 280,580 420,500 C580,410 720,560 840,470 C960,400 1080,510 1200,440 L1200,800 L0,800 Z" />
        </path>
        <path d="M0,520 C150,460 280,580 420,500 C580,410 720,560 840,470 C960,400 1080,510 1200,440" fill="none" stroke="#f59e0b" strokeWidth="2" opacity="0.7">
          <animate attributeName="d" dur="14s" repeatCount="indefinite"
            values="M0,520 C150,460 280,580 420,500 C580,410 720,560 840,470 C960,400 1080,510 1200,440;
                    M0,500 C160,540 290,440 430,520 C590,580 720,420 850,500 C970,560 1080,440 1200,500;
                    M0,520 C150,460 280,580 420,500 C580,410 720,560 840,470 C960,400 1080,510 1200,440" />
        </path>
      </svg>

      {/* Floating live KPI bubbles */}
      <div className="absolute top-10 left-10 hidden lg:block opacity-60 anim-fade-up">
        <div className="font-display text-amber-500 text-xs uppercase tracking-[0.3em] mb-1">Live · Portfolio</div>
        <div className="font-display number-display text-white text-4xl font-semibold">$847K</div>
        <div className="text-xs text-stone-400">Revenue this month</div>
      </div>
      <div className="absolute top-10 right-10 hidden lg:block opacity-60 text-right anim-fade-up delay-200">
        <div className="font-display text-amber-500 text-xs uppercase tracking-[0.3em] mb-1">Properties</div>
        <div className="font-display number-display text-white text-4xl font-semibold">{properties.length}</div>
        <div className="text-xs text-stone-400">{properties.reduce((s, p) => s + p.rooms, 0)} rooms total</div>
      </div>

      <div className="max-w-2xl w-full relative z-10">
        <div className="text-center mb-10 anim-fade-up">
          <div className="inline-flex items-center gap-2 mb-5">
            <div className="w-10 h-10 rounded-md bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center shadow-lg shadow-amber-900/30">
              <Building2 className="text-white" size={22} />
            </div>
            <span className="font-display text-3xl text-white tracking-tight">HotelOps</span>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-700/15 border border-amber-700/30 text-amber-300 text-[10px] font-bold tracking-widest uppercase mb-4">
            <span className="w-1 h-1 rounded-full bg-emerald-400 anim-pulse-soft" />
            All systems operational
          </div>
          <h1 className="font-display text-5xl text-white mb-3 leading-tight tracking-tight">
            One platform for the<br />
            <span className="italic text-amber-400">whole operation.</span>
          </h1>
          <p className="text-stone-400 text-sm max-w-md mx-auto">
            Daily accounting · payroll · scheduling · workforce records.
            Sign in below to enter the demo as any role.
          </p>
        </div>

        <div className="bg-stone-900/70 backdrop-blur-md rounded-xl border border-stone-700/80 p-6 shadow-2xl shadow-black/50">
          <p className="text-xs uppercase tracking-widest text-stone-400 mb-4 font-medium">Choose a profile</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {featured.map(emp => {
              const prop = properties.find(p => p.id === emp.propertyId);
              const propLabel = emp.propertyAccess.length > 1 ? `${emp.propertyAccess.length} properties` : prop?.name;
              return (
                <button
                  key={emp.id}
                  onClick={() => onLogin(emp.id)}
                  onMouseEnter={() => setHover(emp.id)}
                  onMouseLeave={() => setHover(null)}
                  className="flex items-center gap-3 p-3 rounded-md border border-transparent hover:border-amber-700 hover:bg-stone-800 transition-all text-left"
                >
                  <Avatar employee={emp} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium text-sm truncate">{fullName(emp)}</div>
                    <div className="text-stone-400 text-xs truncate">{emp.title} · {propLabel}</div>
                  </div>
                  <ChevronRight size={16} className={`transition-opacity ${hover === emp.id ? "text-amber-500 opacity-100" : "text-stone-600 opacity-50"}`} />
                </button>
              );
            })}
          </div>
          <div className="mt-5 pt-5 border-t border-stone-700 flex items-center justify-between text-xs text-stone-500">
            <span>v1.0 · Build 2026.05</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> All systems operational</span>
          </div>
        </div>

        <p className="text-center text-stone-500 text-xs mt-6 font-body">
          Tip: try Marcus (admin) for the full multi-property view, Sarah (manager) for property-level access, or Aisha (front desk) for the staff view.
        </p>
      </div>
    </div>
  );
}

/* =========================================================================
   SIDEBAR + TOP BAR
   ========================================================================= */
function Sidebar({ ctx, onLogout }) {
  const { currentUser, perms, accessibleProperties, activeProperty, setActiveProperty, view, setView } = ctx;
  const [propOpen, setPropOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("hotelops:sidebar") === "collapsed"; } catch { return false; }
  });
  const activeProp = accessibleProperties.find(p => p.id === activeProperty) || accessibleProperties[0];

  // Toggle with backslash
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || e.target?.isContentEditable) return;
      if (e.key === "\\") {
        setCollapsed(c => {
          const next = !c;
          try { localStorage.setItem("hotelops:sidebar", next ? "collapsed" : "expanded"); } catch {}
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem("hotelops:sidebar", next ? "collapsed" : "expanded"); } catch {}
      return next;
    });
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { id: "scorecard", label: "Scorecard", icon: TrendingUp, show: perms.canViewAllReports },
    { id: "timeclock", label: "Time Clock", icon: Clock, show: true },
    { id: "schedule", label: "Schedule", icon: Calendar, show: true },
    { id: "employees", label: "Employees", icon: Users, show: true },
    { id: "payroll", label: "Payroll", icon: DollarSign, show: perms.canRunPayroll },
    { id: "accounting", label: "Accounting", icon: BarChart3, show: perms.canViewAllReports },
    { id: "settings", label: "Settings", icon: SettingsIcon, show: perms.canManageUsers || currentUser.role === "admin" },
  ].filter(i => i.show);

  return (
    <aside className={`${collapsed ? "w-16" : "w-64"} flex-shrink-0 flex flex-col text-stone-200 transition-all duration-200`} style={{ background: "#1c1917" }}>
      {/* Brand */}
      <div className={`${collapsed ? "px-3" : "px-5"} py-5 border-b border-stone-800 flex items-center justify-between`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-md bg-amber-700 flex items-center justify-center flex-shrink-0">
            <Building2 size={18} className="text-white" />
          </div>
          {!collapsed && <span className="font-display text-xl tracking-tight text-white truncate">HotelOps</span>}
        </div>
        {!collapsed && (
          <button onClick={toggle} title="Collapse sidebar (\\)" className="text-stone-500 hover:text-white p-1 rounded hover:bg-stone-800">
            <ArrowLeft size={14} />
          </button>
        )}
      </div>

      {/* Property switcher */}
      <div className="px-3 py-3 border-b border-stone-800">
        <button
          onClick={() => accessibleProperties.length > 1 && setPropOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-md hover:bg-stone-800 text-left"
          disabled={accessibleProperties.length <= 1}
          title={collapsed ? activeProp?.name : ""}
        >
          <div className="flex items-center gap-2 min-w-0">
            <BedDouble size={16} className="text-amber-600 flex-shrink-0" />
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wider text-stone-500">Property</div>
                <div className="text-sm font-medium text-white truncate">{activeProp?.name}</div>
              </div>
            )}
          </div>
          {!collapsed && accessibleProperties.length > 1 && <ChevronDown size={14} className={`text-stone-500 transition-transform ${propOpen ? "rotate-180" : ""}`} />}
        </button>
        {propOpen && (
          <div className="mt-1 space-y-0.5">
            {accessibleProperties.length > 1 && perms.properties === "all" && (
              <button
                onClick={() => { setView("accounting"); _commandBus.emit("portfolio:open"); setPropOpen(false); }}
                className="w-full text-left px-3 py-2 rounded-md text-sm text-amber-500 hover:bg-stone-800 hover:text-amber-400 inline-flex items-center gap-2"
              >
                <Building2 size={12} /> Portfolio view (all)
              </button>
            )}
            {accessibleProperties.map(p => (
              <button
                key={p.id}
                onClick={() => { setActiveProperty(p.id); setPropOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm ${p.id === activeProperty ? "bg-stone-800 text-white" : "text-stone-400 hover:bg-stone-800 hover:text-white"}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto scroll-thin">
        {navItems.map(item => {
          const active = view === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              title={collapsed ? item.label : ""}
              className={`w-full flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-3"} py-2 rounded-md text-sm font-medium transition-colors ${active ? "bg-amber-700 text-white" : "text-stone-400 hover:bg-stone-800 hover:text-white"}`}
            >
              <Icon size={16} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* User card */}
      <div className="px-3 py-3 border-t border-stone-800">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Avatar employee={currentUser} size={32} />
            <button onClick={onLogout} className="text-stone-500 hover:text-white p-1.5 rounded-md hover:bg-stone-800" title="Sign out">
              <LogOut size={14} />
            </button>
            <button onClick={toggle} title="Expand sidebar (\\)" className="text-stone-500 hover:text-white p-1.5 rounded-md hover:bg-stone-800">
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar employee={currentUser} size={36} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{fullName(currentUser)}</div>
              <div className="text-xs text-stone-500 truncate">{ROLE_LABEL[currentUser.role]}</div>
            </div>
            <button onClick={onLogout} className="text-stone-500 hover:text-white p-1.5 rounded-md hover:bg-stone-800" title="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function TopBar({ ctx }) {
  const { view, currentUser, accessibleProperties, activeProperty, theme, setTheme, saveStatus, state, perms, setView } = ctx;
  const activeProp = accessibleProperties.find(p => p.id === activeProperty);

  // Auto-update status (only when running in Electron)
  const [updateStatus, setUpdateStatus] = useState(null);
  const [appVersion, setAppVersion] = useState(null);
  useEffect(() => {
    if (typeof window === "undefined" || !window.hotelops?.isElectron) return;
    window.hotelops.getVersion().then(v => setAppVersion(v)).catch(() => {});
    const off = window.hotelops.onUpdateStatus(payload => setUpdateStatus(payload));
    return off;
  }, []);
  const saveStyle = {
    saving: { dot: "bg-amber-500 anim-pulse-soft", text: "Saving…", color: "text-amber-700" },
    saved:  { dot: "bg-emerald-500", text: "All saved", color: "text-emerald-700" },
    idle:   { dot: "bg-stone-300", text: "Up to date", color: "text-stone-500" },
  }[saveStatus] || { dot: "bg-stone-300", text: "", color: "text-stone-500" };
  const [notifOpen, setNotifOpen] = useState(false);

  // Compute notifications
  const notifications = useMemo(() => {
    const out = [];
    // Unack write-ups assigned to me
    state.writeups?.filter(w => w.employeeId === currentUser.id && !w.acknowledged).forEach(w => {
      out.push({
        id: `wu_${w.id}`, kind: "writeup", severity: "high",
        title: "Write-up requires acknowledgment",
        body: `${w.issue} · ${fmtDate(w.date)}`,
        action: () => setView("employees"),
      });
    });
    // @-mentions in flash comments
    state.reports?.forEach(r => {
      (r.comments || []).forEach(c => {
        if ((c.mentions || []).includes(currentUser.id) && c.by !== currentUser.id) {
          // ignore acknowledged ones
          if (c.readBy?.includes(currentUser.id)) return;
          const who = state.employees.find(e => e.id === c.by);
          out.push({
            id: `mention_${c.id}`, kind: "mention", severity: "medium",
            title: `${who ? fullName(who) : "Someone"} mentioned you`,
            body: `Flash report · ${fmtDate(r.date)} — "${c.text.slice(0, 60)}${c.text.length > 60 ? "…" : ""}"`,
            action: () => { ctx.setActiveProperty(r.propertyId); setView("accounting"); _commandBus.emit("flash:open"); },
          });
        }
      });
    });
    if (perms?.canEditAnyShift) {
      // Pending PTO requests assigned to me to review
      const myPropIds = perms.properties === "all" ? state.properties.map(p => p.id) : currentUser.propertyAccess;
      const teamIds = state.employees.filter(e => myPropIds.includes(e.propertyId)).map(e => e.id);
      state.ptoRequests?.filter(r => r.status === "pending" && teamIds.includes(r.employeeId) && r.employeeId !== currentUser.id).forEach(r => {
        const emp = state.employees.find(e => e.id === r.employeeId);
        out.push({
          id: `pto_${r.id}`, kind: "pto", severity: "medium",
          title: `PTO request awaiting your review`,
          body: `${emp ? fullName(emp) : "Someone"} · ${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}`,
          action: () => setView("schedule"),
        });
      });
    }
    if (perms?.canViewAllReports) {
      // Missing audits in the last 3 days
      const myProps = perms.properties === "all" ? state.properties : accessibleProperties;
      myProps.forEach(p => {
        const propRep = state.reports.filter(r => r.propertyId === p.id);
        const seen = new Set(propRep.map(r => r.date));
        for (let d = 3; d >= 1; d--) {
          const dt = iso(addDays(TODAY, -d));
          if (!seen.has(dt)) {
            out.push({
              id: `miss_${p.id}_${dt}`, kind: "missing", severity: "high",
              title: "Missing audit",
              body: `${p.name} · ${fmtDate(dt)} not posted`,
              action: () => { ctx.setActiveProperty(p.id); setView("accounting"); _commandBus.emit("ingest:open"); },
            });
          }
        }
      });
      // Period close prompts (prior month not closed and we're past day 5)
      const today = new Date();
      if (today.getDate() >= 5) {
        const priorMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const m = `${priorMonth.getFullYear()}-${String(priorMonth.getMonth() + 1).padStart(2, "0")}`;
        myProps.forEach(p => {
          const closed = state.closedPeriods?.find(c => c.propertyId === p.id && c.month === m);
          if (!closed) {
            out.push({
              id: `close_${p.id}_${m}`, kind: "close", severity: "medium",
              title: "Month-end close pending",
              body: `${p.name} · ${m} not yet closed`,
              action: () => setView("accounting"),
            });
          }
        });
      }
    }
    return out;
  }, [state.writeups, state.reports, state.closedPeriods, state.properties, currentUser, perms, accessibleProperties]);
  const titles = {
    dashboard: "Dashboard",
    scorecard: "Scorecard",
    timeclock: "Time Clock",
    schedule: "Schedule",
    employees: "Employees",
    payroll: "Payroll",
    reports: "Accounting",
    accounting: "Accounting",
    settings: "Settings",
  };
  const subtitles = {
    dashboard: "At-a-glance overview of property performance and operations",
    scorecard: "Your morning briefing — KPIs vs target, exceptions, action items",
    timeclock: "Clock in and out, view shift history, and manage time entries",
    schedule: "Build and publish weekly schedules across positions and properties",
    employees: "Personnel records, write-ups, documents, and time history",
    payroll: "Calculate, review, and process pay periods",
    reports: "AI-powered audit ingestion, variance analysis, and revenue insight",
    accounting: "AI-powered audit ingestion, variance analysis, and revenue insight",
    settings: "Properties, pay rates, and user management",
  };

  return (
    <div className="bg-white border-b border-stone-200 px-8 py-5 flex items-center justify-between">
      <div>
        <h1 className="font-display text-3xl text-stone-900 leading-tight">{titles[view]}</h1>
        <p className="text-sm text-stone-500 mt-0.5">{subtitles[view]}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className={`hidden md:inline-flex items-center gap-1.5 text-[11px] ${saveStyle.color}`} title="Auto-save status">
          <span className={`w-1.5 h-1.5 rounded-full ${saveStyle.dot}`} />
          <span>{saveStyle.text}</span>
        </div>
        {updateStatus && (updateStatus.state === "downloading" || updateStatus.state === "available" || updateStatus.state === "ready") && (
          <button
            onClick={() => updateStatus.state === "ready" ? window.hotelops.installUpdateNow() : null}
            className={`hidden md:inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border ${
              updateStatus.state === "ready"
                ? "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                : "bg-amber-50 border-amber-300 text-amber-800"
            }`}
            title={updateStatus.state === "ready" ? "Click to restart and install" : ""}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              updateStatus.state === "ready" ? "bg-emerald-500" : "bg-amber-500 anim-pulse-soft"
            }`} />
            {updateStatus.state === "available" && `Update available · v${updateStatus.version}`}
            {updateStatus.state === "downloading" && `Downloading update · ${Math.round(updateStatus.percent || 0)}%`}
            {updateStatus.state === "ready" && `Restart to install v${updateStatus.version}`}
          </button>
        )}
        <div className="hidden md:flex items-center gap-2 text-xs text-stone-500">
          <MapPin size={12} />
          <span>{activeProp?.name} · {activeProp?.location}</span>
        </div>
        <button
          onClick={() => {
            // synthesize ⌘K so the global handler in CommandPalette opens it
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
          }}
          className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-stone-500 hover:text-stone-900 border border-stone-200 hover:border-stone-300 bg-white"
          title="Open command palette (⌘K)"
        >
          <Search size={12} />
          <span>Search · Jump…</span>
          <kbd className="text-[10px] px-1 rounded bg-stone-100 border border-stone-200">⌘K</kbd>
        </button>
        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setNotifOpen(o => !o)}
            className="relative text-stone-500 hover:text-stone-900 p-2 rounded-md hover:bg-stone-100"
            title="Notifications"
          >
            <span style={{ fontSize: 16 }}>🔔</span>
            {notifications.length > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
            )}
          </button>
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
              <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl border border-stone-200 shadow-2xl z-40 overflow-hidden"
                style={{ animation: "cp-pop 0.18s cubic-bezier(0.16, 1, 0.3, 1) both" }}>
                <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
                  <h3 className="font-display text-base text-stone-900">Notifications</h3>
                  <span className="text-xs text-stone-500">{notifications.length}</span>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-12 text-center">
                      <CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-2" />
                      <p className="text-sm text-stone-700 font-medium">You're all caught up</p>
                      <p className="text-xs text-stone-400 mt-1">No pending alerts.</p>
                    </div>
                  ) : (
                    notifications.map(n => {
                      const sevColor = { high: "rose", medium: "amber", low: "stone" }[n.severity];
                      return (
                        <button key={n.id} onClick={() => { n.action?.(); setNotifOpen(false); }}
                          className="w-full px-4 py-3 text-left flex gap-3 hover:bg-stone-50 border-b border-stone-100 last:border-b-0">
                          <span className={`mt-1 w-2 h-2 rounded-full bg-${sevColor}-500 flex-shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-stone-900">{n.title}</div>
                            <div className="text-xs text-stone-500 mt-0.5">{n.body}</div>
                          </div>
                          <ChevronRight size={14} className="text-stone-300 flex-shrink-0 mt-1" />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="text-stone-500 hover:text-stone-900 p-2 rounded-md hover:bg-stone-100"
          title="Toggle dark mode (⌘⇧D)"
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
        <Badge color="amber">{ROLE_LABEL[currentUser.role]}</Badge>
      </div>
    </div>
  );
}

/* =========================================================================
   MODULE ROUTER
   ========================================================================= */
/* =========================================================================
   GM SCORECARD — single-page morning briefing for property leaders
   ========================================================================= */
function ScorecardModule({ ctx }) {
  const { state, currentUser, perms, activeProperty, accessibleProperties, setView, setActiveProperty } = ctx;
  const propsAll = perms.properties === "all" ? accessibleProperties : accessibleProperties.filter(p => p.id === activeProperty);
  const [propId, setPropId] = useState(activeProperty || propsAll[0]?.id);
  const property = state.properties.find(p => p.id === propId);
  const today = new Date();
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const yesterday = iso(addDays(TODAY, -1));

  const enrichedReports = useMemo(() => state.reports.filter(r => r.propertyId === propId).map(enrichReport), [state.reports, propId]);
  const yReport = enrichedReports.find(r => r.date === yesterday);
  const last7 = enrichedReports.filter(r => new Date(r.date) >= addDays(TODAY, -7));
  const last30 = enrichedReports.filter(r => new Date(r.date) >= addDays(TODAY, -30));
  const baseline7 = last7.length ? last7.reduce((s, r) => s + r.totalRevenue, 0) / last7.length : 0;
  const baseline30 = last30.length ? last30.reduce((s, r) => s + r.totalRevenue, 0) / last30.length : 0;
  const occ7 = last7.length ? last7.reduce((s, r) => s + r.occupancy, 0) / last7.length : 0;
  const adr7 = last7.length ? last7.reduce((s, r) => s + r.adr, 0) / last7.length : 0;

  // Budget targets
  const budget = state.budgets.find(b => b.propertyId === propId && b.month === month);
  const monthActual = _actualsFor(enrichedReports, propId, month);
  const monthPace = _pacing(monthActual, budget);

  // Action items
  const actions = useMemo(() => {
    const out = [];
    // missing audits last 3 days
    for (let d = 3; d >= 1; d--) {
      const dt = iso(addDays(TODAY, -d));
      if (!enrichedReports.some(r => r.date === dt)) {
        out.push({ severity: d <= 1 ? "high" : "medium", title: `Missing audit · ${fmtDate(dt)}`, action: "ingest", payload: dt });
      }
    }
    // overdue invoices for this property
    const overdueAr = state.invoices?.filter(i => i.propertyId === propId && i.status === "overdue") || [];
    if (overdueAr.length > 0) {
      const total = overdueAr.reduce((s, i) => s + i.amount, 0);
      out.push({ severity: "high", title: `${overdueAr.length} A/P invoice${overdueAr.length === 1 ? "" : "s"} overdue · ${fmtMoney(total)}`, action: "ap" });
    }
    // pending approvals
    const pending = state.invoices?.filter(i => i.propertyId === propId && i.approvalState === "pending") || [];
    if (pending.length > 0) {
      out.push({ severity: "medium", title: `${pending.length} invoice${pending.length === 1 ? "" : "s"} awaiting approval`, action: "ap" });
    }
    // Pace below plan
    if (monthPace && monthPace.variance < 0 && Math.abs(monthPace.variancePct) > 0.05) {
      out.push({ severity: "high", title: `Behind plan · ${(monthPace.variancePct * 100).toFixed(1)}% (${fmtMoney(monthPace.variance)})`, action: "budget" });
    }
    // Pending write-up acknowledgments
    const myProps = state.employees.filter(e => e.propertyId === propId).map(e => e.id);
    const pendingWriteups = state.writeups.filter(w => myProps.includes(w.employeeId) && !w.acknowledged);
    if (pendingWriteups.length > 0) {
      out.push({ severity: "low", title: `${pendingWriteups.length} write-up${pendingWriteups.length === 1 ? "" : "s"} pending acknowledgment`, action: "employees" });
    }
    return out.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]);
  }, [enrichedReports, state.invoices, state.writeups, state.employees, propId, monthPace]);

  // Trend sparkline
  const sparkData = last30.map(r => ({ date: r.date, v: r.totalRevenue })).sort((a, b) => a.date.localeCompare(b.date));

  // Comments awaiting response
  const recentComments = state.reports
    .filter(r => r.propertyId === propId && r.comments && r.comments.length > 0)
    .flatMap(r => r.comments.map(c => ({ ...c, reportDate: r.date })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);

  const Score = ({ label, value, target, fmt = (v) => v, inverse }) => {
    const ratio = target ? (Number(value) / Number(target)) : null;
    const pct = ratio != null ? (ratio - 1) * 100 : null;
    const tone = ratio == null ? "stone" :
      Math.abs(pct) < 2 ? "stone" :
      (pct > 0) === !inverse ? "emerald" : "rose";
    const colors = { stone: "text-stone-500", emerald: "text-emerald-700", rose: "text-rose-700" };
    return (
      <div className="p-5 rounded-lg border border-stone-200 bg-white">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">{label}</div>
        <div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmt(value)}</div>
        <div className={`text-xs mt-1 ${colors[tone]}`}>
          {target ? <>vs target {fmt(target)} · {pct >= 0 ? "+" : ""}{pct?.toFixed(1)}%</> : "—"}
        </div>
      </div>
    );
  };

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      {/* Hero */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-stone-500">Good morning, {currentUser.firstName}.</p>
          <h2 className="font-display text-4xl text-stone-900 leading-tight tracking-tight">
            {property?.name} <span className="italic text-amber-700">scorecard.</span>
          </h2>
          <p className="text-sm text-stone-500 mt-1">As of {fmtDate(TODAY)} · {today.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>
        </div>
        {accessibleProperties.length > 1 && (
          <select value={propId} onChange={e => setPropId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium">
            {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {/* Scorecard tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Score label="Yesterday Revenue" value={yReport?.totalRevenue || 0} target={baseline30} fmt={fmtMoneyShort} />
        <Score label="Occupancy (yest.)" value={(yReport?.occupancy || 0) * 100} target={occ7 * 100} fmt={v => `${v.toFixed(1)}%`} />
        <Score label="ADR (yest.)" value={yReport?.adr || 0} target={adr7} fmt={fmtMoney} />
        <Score label="MTD vs Plan" value={monthPace?.variance || 0} target={0} fmt={v => `${v >= 0 ? "+" : ""}${fmtMoneyShort(v)}`} />
      </div>

      {/* Action items */}
      <Card>
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-display text-lg text-stone-900">Action items {actions.length > 0 && `· ${actions.length}`}</h3>
          {actions.length === 0 && <Badge color="emerald">All clear</Badge>}
        </div>
        {actions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-2" />
            <p className="text-sm text-stone-700 font-medium">Nothing demands your attention right now.</p>
            <p className="text-xs text-stone-400 mt-1">Audits posted, plan on track, no pending approvals.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {actions.map((a, i) => {
              const sevColor = { high: "rose", medium: "amber", low: "stone" }[a.severity];
              const onClick = () => {
                if (a.action === "ingest") { setActiveProperty(propId); setView("accounting"); _commandBus.emit("ingest:open"); }
                else if (a.action === "ap") { setActiveProperty(propId); setView("accounting"); _commandBus.emit("navigate:ap"); }
                else if (a.action === "budget") { setActiveProperty(propId); setView("accounting"); }
                else if (a.action === "employees") setView("employees");
              };
              return (
                <button key={i} onClick={onClick} className="w-full px-6 py-3 text-left flex items-center gap-3 hover:bg-stone-50">
                  <span className={`w-2 h-2 rounded-full bg-${sevColor}-500 flex-shrink-0`} />
                  <span className="flex-1 text-sm text-stone-900">{a.title}</span>
                  <ChevronRight size={14} className="text-stone-300" />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Trend + comments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6">
          <h3 className="font-display text-lg text-stone-900 mb-4">30-day revenue trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={sparkData}>
              <defs>
                <linearGradient id="sc-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#b45309" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#b45309" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={false} />
              <YAxis tick={{ fontSize: 10, fill: "#78716c" }} stroke="#d6d3d1" tickFormatter={v => fmtMoneyShort(v)} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={v => fmtMoney(v)} labelFormatter={l => fmtDate(l)} />
              <Area type="monotone" dataKey="v" stroke="#b45309" strokeWidth={2} fill="url(#sc-grad)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <div className="px-5 py-3 border-b border-stone-200">
            <h3 className="font-display text-base text-stone-900">Latest discussion</h3>
          </div>
          {recentComments.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-stone-400">No recent comments on flash reports.</div>
          ) : (
            <div className="divide-y divide-stone-100 max-h-[180px] overflow-y-auto">
              {recentComments.map(c => {
                const who = state.employees.find(e => e.id === c.by);
                return (
                  <div key={c.id} className="px-4 py-2.5 text-xs">
                    <div className="text-stone-500 mb-0.5">{who ? fullName(who) : "Unknown"} · {fmtDate(c.reportDate)}</div>
                    <div className="text-stone-700 line-clamp-2">{c.text}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ModuleRouter({ ctx }) {
  switch (ctx.view) {
    case "dashboard": return <Dashboard ctx={ctx} />;
    case "scorecard": return <ScorecardModule ctx={ctx} />;
    case "timeclock": return <TimeClockModule ctx={ctx} />;
    case "schedule": return <ScheduleModule ctx={ctx} />;
    case "employees": return <EmployeesModule ctx={ctx} />;
    case "payroll": return <PayrollModule ctx={ctx} />;
    case "reports": return <AccountingModule ctx={ctx} />;
    case "accounting": return <AccountingModule ctx={ctx} />;
    case "settings": return <SettingsModule ctx={ctx} />;
    default: return <Dashboard ctx={ctx} />;
  }
}

/* =========================================================================
   MODULES (placeholder stubs - filled in next step)
   ========================================================================= */
function Dashboard({ ctx }) {
  const { state, currentUser, perms, activeProperty, accessibleProperties, setView } = ctx;
  const isStaff = !perms.canRunPayroll;

  // Staff dashboard
  if (isStaff) {
    const myShifts = state.shifts.filter(s => s.employeeId === currentUser.id);
    const activeShift = myShifts.find(s => !s.clockOut);
    const myWeekShifts = myShifts.filter(s => {
      const d = new Date(s.clockIn);
      return d >= addDays(TODAY, -7);
    });
    const weekHours = myWeekShifts.reduce((sum, s) => sum + hoursBetween(s.clockIn, s.clockOut, s.breakMinutes), 0);
    const weekEarnings = weekHours * (currentUser.hourlyRate || 0);
    const myUpcoming = state.schedule
      .filter(sc => sc.employeeId === currentUser.id && new Date(sc.date) >= addDays(TODAY, -1))
      .sort((a,b) => a.date.localeCompare(b.date))
      .slice(0, 5);
    const myWriteups = state.writeups.filter(w => w.employeeId === currentUser.id);
    const unackWriteups = myWriteups.filter(w => !w.acknowledged);

    return (
      <div className="p-8 space-y-6 max-w-6xl">
        {/* Greeting */}
        <div>
          <p className="text-sm text-stone-500">Welcome back,</p>
          <h2 className="font-display text-3xl text-stone-900">{currentUser.firstName}</h2>
        </div>

        {/* Status card */}
        <Card className={`p-6 ${activeShift ? "border-emerald-300 bg-emerald-50" : ""}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${activeShift ? "bg-emerald-500" : "bg-stone-400"}`} />
                <span className="text-xs uppercase tracking-wider text-stone-600 font-medium">{activeShift ? "On the clock" : "Off the clock"}</span>
              </div>
              <p className="font-display text-2xl text-stone-900">
                {activeShift ? `Clocked in at ${fmtTime(activeShift.clockIn)}` : "Ready to start your shift?"}
              </p>
            </div>
            <Button variant="accent" size="lg" onClick={() => setView("timeclock")}>
              <Clock size={16} />{activeShift ? "Manage Shift" : "Clock In"}
            </Button>
          </div>
        </Card>

        {/* This week stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Hours This Week" value={weekHours.toFixed(1)} icon={Clock} />
          <StatCard label="Estimated Earnings" value={fmtMoney(weekEarnings)} icon={DollarSign} />
          <StatCard label="Hourly Rate" value={fmtMoney(currentUser.hourlyRate)} icon={Hash} />
        </div>

        {/* Upcoming schedule */}
        <Card>
          <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-display text-lg text-stone-900">Your Upcoming Shifts</h3>
            <button onClick={() => setView("schedule")} className="text-xs text-amber-700 hover:text-amber-800 font-medium">View schedule →</button>
          </div>
          {myUpcoming.length === 0 ? (
            <Empty icon={Calendar} title="No shifts scheduled" message="Check back later or speak with your manager." />
          ) : (
            <div className="divide-y divide-stone-100">
              {myUpcoming.map(sc => {
                const prop = state.properties.find(p => p.id === sc.propertyId);
                const isToday = sc.date === iso(TODAY);
                return (
                  <div key={sc.id} className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 text-center">
                        <div className="text-xs text-stone-500 uppercase">{fmtDayName(sc.date)}</div>
                        <div className="font-display text-xl text-stone-900">{new Date(sc.date).getDate()}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-stone-900">{sc.startTime} – {sc.endTime}</div>
                        <div className="text-xs text-stone-500">{sc.position} · {prop?.name}</div>
                      </div>
                    </div>
                    {isToday && <Badge color="amber">Today</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Write-ups requiring acknowledgment */}
        {unackWriteups.length > 0 && (
          <Card className="border-amber-300 bg-amber-50">
            <div className="px-6 py-4 flex items-start gap-3">
              <AlertCircle size={20} className="text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-display text-lg text-stone-900">Action required</h3>
                <p className="text-sm text-stone-700 mt-1">
                  You have {unackWriteups.length} {unackWriteups.length === 1 ? "document" : "documents"} requiring acknowledgment.
                </p>
                <button onClick={() => setView("employees")} className="text-sm text-amber-800 hover:text-amber-900 font-medium mt-2">Review now →</button>
              </div>
            </div>
          </Card>
        )}
      </div>
    );
  }

  // Admin/manager dashboard
  const propsToShow = perms.properties === "all" ? accessibleProperties : accessibleProperties.filter(p => p.id === activeProperty);
  const propIds = propsToShow.map(p => p.id);

  // Today's data
  const todayStr = iso(TODAY);
  const yesterdayStr = iso(addDays(TODAY, -1));
  const yesterdayReports = state.reports.filter(r => r.date === yesterdayStr && propIds.includes(r.propertyId));
  const todayRevenue = yesterdayReports.reduce((s, r) => s + r.totalRevenue, 0);
  const totalRooms = propsToShow.reduce((s, p) => s + p.rooms, 0);
  const totalSold = yesterdayReports.reduce((s, r) => s + r.roomsSold, 0);
  const occupancy = totalRooms ? totalSold / totalRooms : 0;
  const adr = totalSold ? yesterdayReports.reduce((s, r) => s + r.roomRevenue, 0) / totalSold : 0;

  // Staff currently clocked in
  const clockedIn = state.shifts.filter(s => !s.clockOut && propIds.includes(s.propertyId));
  // Today's scheduled
  const todaySchedule = state.schedule.filter(sc => sc.date === todayStr && propIds.includes(sc.propertyId));

  // Last 14 days revenue chart
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = iso(addDays(TODAY, -i));
    const dayReports = state.reports.filter(r => r.date === d && propIds.includes(r.propertyId));
    last14.push({
      date: fmtDateShort(d),
      revenue: dayReports.reduce((s, r) => s + r.totalRevenue, 0),
      occupancy: dayReports.length ? dayReports.reduce((s, r) => s + r.occupancy, 0) / dayReports.length * 100 : 0,
    });
  }

  // Pending write-ups
  const unackWriteups = state.writeups.filter(w => !w.acknowledged);

  // Labor cost % of revenue (last 7 days)
  const labor = useMemo(() => {
    const cutoff = addDays(TODAY, -7);
    const myEmps = state.employees.filter(e => propIds.includes(e.propertyId));
    const empMap = Object.fromEntries(myEmps.map(e => [e.id, e]));
    const recentShifts = state.shifts.filter(s => s.clockOut && new Date(s.clockIn) >= cutoff && propIds.includes(s.propertyId));
    let totalHours = 0, totalWages = 0, totalOT = 0;
    recentShifts.forEach(s => {
      const e = empMap[s.employeeId];
      if (!e) return;
      const h = hoursBetween(s.clockIn, s.clockOut, s.breakMinutes);
      totalHours += h;
      // Simple OT estimate: if any single shift > 8h, the excess is OT
      const ot = Math.max(0, h - 8);
      totalOT += ot;
      const reg = h - ot;
      totalWages += reg * (e.hourlyRate || 0) + ot * (e.hourlyRate || 0) * 1.5;
    });
    const recentRev = state.reports
      .filter(r => propIds.includes(r.propertyId) && new Date(r.date) >= cutoff)
      .reduce((s, r) => s + r.totalRevenue, 0);
    return {
      hours: totalHours,
      wages: totalWages,
      ratio: recentRev ? totalWages / recentRev : 0,
      otPct: totalHours ? totalOT / totalHours : 0,
      activeStaff: myEmps.filter(e => e.status === "active" && e.hourlyRate > 0).length,
    };
  }, [state.shifts, state.employees, state.reports, propIds]);

  // Anomaly scan — flag last-7-day reports whose total revenue is > 2σ from the
  // 30-day mean for that property.
  const anomalies = useMemo(() => {
    const out = [];
    propsToShow.forEach(p => {
      const propRep = state.reports.filter(r => r.propertyId === p.id).sort((a,b) => a.date.localeCompare(b.date));
      const last30 = propRep.slice(-30);
      if (last30.length < 7) return;
      const mean = last30.reduce((s, r) => s + r.totalRevenue, 0) / last30.length;
      const sd = Math.sqrt(last30.reduce((s, r) => s + Math.pow(r.totalRevenue - mean, 2), 0) / last30.length);
      const recent = propRep.slice(-7);
      recent.forEach(r => {
        const z = sd > 0 ? (r.totalRevenue - mean) / sd : 0;
        if (Math.abs(z) >= 2) {
          out.push({
            propertyName: p.name,
            date: r.date,
            revenue: r.totalRevenue,
            mean,
            z,
            direction: z > 0 ? "above" : "below",
          });
        }
      });
    });
    return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 4);
  }, [state.reports, propsToShow]);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <LiveTicker propIds={propIds} state={state} />
      {/* Quick actions strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickAction
          icon={Upload} label="Ingest Audit" hint="⌘I"
          tone="amber"
          onClick={() => { setView("accounting"); _commandBus.emit("ingest:open"); }}
        />
        <QuickAction
          icon={DollarSign} label="Run Payroll" hint={perms.canRunPayroll ? "" : "Manager+"}
          tone="emerald"
          onClick={() => perms.canRunPayroll && setView("payroll")}
          disabled={!perms.canRunPayroll}
        />
        <QuickAction
          icon={Users} label="Add Employee" hint=""
          tone="violet"
          onClick={() => setView("employees")}
        />
        <QuickAction
          icon={Calendar} label="Build Schedule" hint=""
          tone="sky"
          onClick={() => setView("schedule")}
        />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Yesterday Revenue" value={fmtMoneyShort(todayRevenue)} sub={fmtMoney(todayRevenue)} trend="+8.2%" trendUp />
        <KpiCard label="Occupancy" value={fmtPct(occupancy)} sub={`${totalSold} of ${totalRooms} rooms`} trend="+3.1%" trendUp />
        <KpiCard label="ADR" value={fmtMoney(adr)} sub="Average daily rate" trend="-1.4%" />
        <KpiCard label="On Shift Now" value={clockedIn.length} sub={`${todaySchedule.length} scheduled today`} />
      </div>

      {/* Labor & productivity */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <LaborTile label="Labor Cost % (7d)" value={`${(labor.ratio * 100).toFixed(1)}%`} ratio={labor.ratio} />
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Hours Logged · 7d</div>
          <div className="font-display number-display text-2xl text-stone-900 font-semibold">{labor.hours.toFixed(0)}h</div>
          <div className="text-xs text-stone-500 mt-1">Across {labor.activeStaff} active staff</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Total Wages · 7d</div>
          <div className="font-display number-display text-2xl text-stone-900 font-semibold">{fmtMoneyShort(labor.wages)}</div>
          <div className="text-xs text-stone-500 mt-1">{fmtMoney(labor.wages)} estimated</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">OT Share</div>
          <div className={`font-display number-display text-2xl font-semibold ${labor.otPct > 0.1 ? "text-rose-700" : labor.otPct > 0.05 ? "text-amber-700" : "text-stone-900"}`}>
            {(labor.otPct * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-stone-500 mt-1">{labor.otPct > 0.1 ? "Above target" : labor.otPct > 0.05 ? "Watch" : "On target"}</div>
        </Card>
      </div>

      {/* Anomaly alerts */}
      {anomalies.length > 0 && (
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white anim-fade-up">
          <div className="px-6 py-4 border-b border-amber-100 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
              <AlertCircle size={16} />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-lg text-stone-900">Outlier alert</h3>
              <p className="text-xs text-stone-600">Days from the last week that fell outside ±2σ of the property's 30-day mean.</p>
            </div>
            <button onClick={() => setView("accounting")} className="text-xs text-amber-700 hover:text-amber-900 font-semibold">Investigate →</button>
          </div>
          <div className="divide-y divide-amber-100">
            {anomalies.map((a, i) => (
              <div key={i} className="px-6 py-3 flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full ${a.direction === "above" ? "bg-emerald-500" : "bg-rose-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-900">{a.propertyName} · {fmtDate(a.date)}</div>
                  <div className="text-xs text-stone-500">
                    {fmtMoney(a.revenue)} — {a.direction} 30-day mean ({fmtMoney(a.mean)}) by {Math.abs(a.z).toFixed(1)}σ
                  </div>
                </div>
                <Badge color={a.direction === "above" ? "emerald" : "rose"}>{a.direction === "above" ? "↑" : "↓"} {Math.abs(a.z).toFixed(1)}σ</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg text-stone-900">Revenue · Last 14 days</h3>
            <button onClick={() => setView("accounting")} className="text-xs text-amber-700 hover:text-amber-800 font-medium">Open accounting →</button>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={last14} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#b45309" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#b45309" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" />
              <YAxis tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" tickFormatter={v => fmtMoneyShort(v)} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={(v) => fmtMoney(v)} />
              <Area type="monotone" dataKey="revenue" stroke="#b45309" strokeWidth={2} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="font-display text-lg text-stone-900 mb-4">Occupancy Trend</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={last14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#78716c" }} stroke="#d6d3d1" />
              <YAxis tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" tickFormatter={v => `${Math.round(v)}%`} domain={[40, 100]} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={(v) => `${v.toFixed(1)}%`} />
              <Line type="monotone" dataKey="occupancy" stroke="#b45309" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Currently on shift */}
        <Card>
          <div className="px-6 py-4 border-b border-stone-200">
            <h3 className="font-display text-lg text-stone-900">Currently On Shift</h3>
          </div>
          {clockedIn.length === 0 ? (
            <Empty icon={Clock} title="Nobody clocked in" message="Staff appear here in real time when they clock in." />
          ) : (
            <div className="divide-y divide-stone-100">
              {clockedIn.slice(0,6).map(s => {
                const emp = state.employees.find(e => e.id === s.employeeId);
                if (!emp) return null;
                const elapsed = (Date.now() - new Date(s.clockIn).getTime()) / 3600000;
                return (
                  <div key={s.id} className="px-6 py-3 flex items-center gap-3">
                    <Avatar employee={emp} size={36} onShift />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-stone-900">{fullName(emp)}</div>
                      <div className="text-xs text-stone-500">{emp.title}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-stone-900 tabular">{elapsed.toFixed(1)}h</div>
                      <div className="text-xs text-stone-500">since {fmtTime(s.clockIn)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Recent write-ups */}
        <Card>
          <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-display text-lg text-stone-900">Recent Write-ups</h3>
            <button onClick={() => setView("employees")} className="text-xs text-amber-700 hover:text-amber-800 font-medium">View all →</button>
          </div>
          {state.writeups.length === 0 ? (
            <Empty icon={FileWarning} title="No write-ups on file" message="Documented incidents and corrective actions appear here." />
          ) : (
            <div className="divide-y divide-stone-100">
              {state.writeups.slice(0, 5).map(w => {
                const emp = state.employees.find(e => e.id === w.employeeId);
                if (!emp) return null;
                const colors = { verbal: "amber", written: "rose", final: "rose", termination: "rose" };
                return (
                  <div key={w.id} className="px-6 py-3 flex items-start gap-3">
                    <Avatar employee={emp} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-stone-900">{fullName(emp)}</span>
                        <Badge color={colors[w.type]}>{w.type}</Badge>
                        {!w.acknowledged && <Badge color="amber">Pending ack</Badge>}
                      </div>
                      <div className="text-xs text-stone-500 mt-0.5">{w.issue} · {fmtDate(w.date)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label, hint, tone = "amber", onClick, disabled }) {
  const tones = {
    amber:   { ring: "hover:border-amber-400 hover:shadow-amber-100",   icon: "text-amber-700 bg-amber-50",   accent: "text-amber-700" },
    emerald: { ring: "hover:border-emerald-400 hover:shadow-emerald-100", icon: "text-emerald-700 bg-emerald-50", accent: "text-emerald-700" },
    violet:  { ring: "hover:border-violet-400 hover:shadow-violet-100",   icon: "text-violet-700 bg-violet-50",   accent: "text-violet-700" },
    sky:     { ring: "hover:border-sky-400 hover:shadow-sky-100",         icon: "text-sky-700 bg-sky-50",         accent: "text-sky-700" },
  };
  const c = tones[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative bg-white border border-stone-200 rounded-lg p-4 text-left transition-all ${disabled ? "opacity-50 cursor-not-allowed" : `${c.ring} hover:shadow-md hover:-translate-y-0.5 cursor-pointer`}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg ${c.icon} flex items-center justify-center transition-transform ${disabled ? "" : "group-hover:scale-110"}`}>
          <Icon size={16} />
        </div>
        {hint && <span className="text-[10px] font-mono text-stone-400">{hint}</span>}
      </div>
      <div className="text-sm font-semibold text-stone-900">{label}</div>
      <div className={`text-xs mt-0.5 ${c.accent} opacity-70 group-hover:opacity-100 transition-opacity`}>
        {disabled ? "Permission required" : "Open →"}
      </div>
    </button>
  );
}

function LiveTicker({ propIds, state }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const yesterdayRev = state.reports
    .filter(r => propIds.includes(r.propertyId) && r.date === iso(addDays(TODAY, -1)))
    .reduce((s, r) => s + r.totalRevenue, 0);
  const onShift = state.shifts.filter(s => !s.clockOut && propIds.includes(s.propertyId)).length;
  const liveDate = new Date(now);

  return (
    <div className="flex items-center justify-between gap-4 p-3 px-4 rounded-lg bg-gradient-to-r from-stone-900 to-stone-800 text-stone-200 border border-stone-800">
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-emerald-400 anim-pulse-soft" />
        <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold">Live</span>
        <span className="font-display text-lg tabular text-white">
          {liveDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </span>
        <span className="text-xs text-stone-500 hidden md:inline">
          {liveDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </span>
      </div>
      <div className="flex items-center gap-5 text-xs">
        <div className="hidden sm:block">
          <span className="text-stone-500 uppercase tracking-wider">Yesterday</span>{" "}
          <span className="font-display tabular text-amber-400 font-semibold">{fmtMoneyShort(yesterdayRev)}</span>
        </div>
        <div>
          <span className="text-stone-500 uppercase tracking-wider">On shift</span>{" "}
          <span className="font-display tabular text-white font-semibold">{onShift}</span>
        </div>
        <div className="hidden md:block">
          <span className="text-stone-500 uppercase tracking-wider">Reports</span>{" "}
          <span className="font-display tabular text-white font-semibold">{state.reports.filter(r => propIds.includes(r.propertyId)).length}</span>
        </div>
      </div>
    </div>
  );
}

function LaborTile({ label, value, ratio }) {
  // Hospitality benchmark: 25-35% is healthy; 35-45% watch; 45+ alarm
  const tone = ratio < 0.30 ? "emerald" : ratio < 0.40 ? "amber" : "rose";
  const colors = {
    emerald: { text: "text-emerald-700", bar: "bg-emerald-500", note: "Below benchmark · efficient" },
    amber: { text: "text-amber-700", bar: "bg-amber-500", note: "Within range" },
    rose: { text: "text-rose-700", bar: "bg-rose-600", note: "Above benchmark · review staffing" },
  };
  const c = colors[tone];
  // Bar represents ratio against a 50% scale max
  const barPct = Math.min(100, ratio * 100 * 2);
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">{label}</div>
      <div className={`font-display number-display text-2xl font-semibold ${c.text}`}>{value}</div>
      <div className="mt-2 h-1.5 rounded-full bg-stone-100 overflow-hidden relative">
        <div className={`h-full ${c.bar}`} style={{ width: `${barPct}%` }} />
        <div className="absolute inset-y-0 w-px bg-stone-700" style={{ left: "60%" }} title="30% benchmark" />
        <div className="absolute inset-y-0 w-px bg-stone-700" style={{ left: "80%" }} title="40% benchmark" />
      </div>
      <div className="text-xs text-stone-500 mt-1.5">{c.note}</div>
    </Card>
  );
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-stone-500 font-medium">{label}</span>
        <Icon size={16} className="text-stone-400" />
      </div>
      <div className="font-display text-2xl text-stone-900 tabular">{value}</div>
    </Card>
  );
}

function KpiCard({ label, value, sub, trend, trendUp }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl text-stone-900 tabular">{value}</span>
        {trend && (
          <span className={`text-xs font-medium ${trendUp ? "text-emerald-700" : "text-rose-700"}`}>
            {trend}
          </span>
        )}
      </div>
      {sub && <div className="text-xs text-stone-500 mt-1.5 tabular">{sub}</div>}
    </Card>
  );
}
function TimeClockModule({ ctx }) {
  const { state, update, currentUser, perms, activeProperty, accessibleProperties, toast } = ctx;
  const [now, setNow] = useState(Date.now());
  const [editShift, setEditShift] = useState(null);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const myActiveShift = state.shifts.find(s => s.employeeId === currentUser.id && !s.clockOut);
  const myRecent = state.shifts
    .filter(s => s.employeeId === currentUser.id && s.clockOut)
    .sort((a,b) => new Date(b.clockIn) - new Date(a.clockIn))
    .slice(0, 10);

  const propIds = perms.canEditAnyShift
    ? (perms.properties === "all" ? state.properties.map(p=>p.id) : currentUser.propertyAccess)
    : [];
  const onShiftNow = state.shifts.filter(s => !s.clockOut && propIds.includes(s.propertyId));

  const clockIn = () => {
    const newShift = {
      id: newId("s"),
      employeeId: currentUser.id,
      propertyId: activeProperty,
      clockIn: new Date().toISOString(),
      clockOut: null,
      breakMinutes: 0,
      notes: "",
      edited: false,
      editedBy: null,
    };
    update({ shifts: [...state.shifts, newShift] });
    pushActivity(ctx, "shift.clockIn", { shiftId: newShift.id, employeeId: currentUser.id, propertyId: activeProperty });
    const propName = state.properties.find(p => p.id === activeProperty)?.name;
    toast?.push(`Clocked in at ${propName}`, { tone: "success" });
  };

  const clockOut = () => {
    const elapsedH = (Date.now() - new Date(myActiveShift.clockIn).getTime()) / 3600000;
    const earnings = elapsedH * (currentUser.hourlyRate || 0);
    const updated = state.shifts.map(s =>
      s.id === myActiveShift.id ? { ...s, clockOut: new Date().toISOString() } : s
    );
    update({ shifts: updated });
    pushActivity(ctx, "shift.clockOut", { shiftId: myActiveShift.id, employeeId: currentUser.id, hours: +elapsedH.toFixed(2) });
    toast?.push(`Clocked out · ${elapsedH.toFixed(2)}h${earnings ? ` · ${fmtMoney(earnings)} earned` : ""}`, { tone: "success" });
  };

  const elapsed = myActiveShift ? (now - new Date(myActiveShift.clockIn).getTime()) / 3600000 : 0;
  const elapsedH = Math.floor(elapsed);
  const elapsedM = Math.floor((elapsed - elapsedH) * 60);
  const elapsedS = Math.floor(((elapsed - elapsedH) * 60 - elapsedM) * 60);

  return (
    <div className="p-8 space-y-6 max-w-6xl">
      {/* Clock card */}
      <Card className="p-8" style={myActiveShift ? { background: "linear-gradient(135deg, #ecfdf5, #ffffff)" } : {}}>
        <div className="flex items-center justify-between flex-wrap gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${myActiveShift ? "bg-emerald-500" : "bg-stone-400"}`} />
              <span className="text-xs uppercase tracking-widest text-stone-600 font-medium">
                {myActiveShift ? "On the clock" : "Off the clock"}
              </span>
            </div>
            {myActiveShift ? (
              <>
                <div className="font-display text-5xl text-stone-900 tabular">
                  {String(elapsedH).padStart(2,"0")}:{String(elapsedM).padStart(2,"0")}:{String(elapsedS).padStart(2,"0")}
                </div>
                <p className="text-sm text-stone-500 mt-2">
                  Started at {fmtTime(myActiveShift.clockIn)} · {state.properties.find(p => p.id === myActiveShift.propertyId)?.name}
                </p>
              </>
            ) : (
              <>
                <div className="font-display text-5xl text-stone-900 tabular">
                  {new Date(now).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                </div>
                <p className="text-sm text-stone-500 mt-2">
                  {new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </p>
              </>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {myActiveShift ? (
              <Button variant="danger" size="lg" onClick={clockOut}>
                <Pause size={18} />Clock Out
              </Button>
            ) : (
              <Button variant="success" size="lg" onClick={clockIn}>
                <Play size={18} />Clock In
              </Button>
            )}
            {accessibleProperties.length > 1 && !myActiveShift && (
              <p className="text-xs text-stone-500 text-right">Will clock in at <strong>{state.properties.find(p => p.id === activeProperty)?.name}</strong></p>
            )}
          </div>
        </div>
      </Card>

      {/* Currently on shift (admin/manager) */}
      {perms.canEditAnyShift && (
        <Card>
          <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-display text-lg text-stone-900">Currently On Shift</h3>
            <Badge color="emerald">{onShiftNow.length} active</Badge>
          </div>
          {onShiftNow.length === 0 ? (
            <Empty icon={Clock} title="No active shifts" message="Staff currently clocked in will appear here." />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-6 py-3 font-medium">Employee</th>
                  <th className="text-left px-6 py-3 font-medium">Property</th>
                  <th className="text-left px-6 py-3 font-medium">Clock In</th>
                  <th className="text-left px-6 py-3 font-medium">Elapsed</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {onShiftNow.map(s => {
                  const emp = state.employees.find(e => e.id === s.employeeId);
                  const prop = state.properties.find(p => p.id === s.propertyId);
                  if (!emp) return null;
                  const e = (now - new Date(s.clockIn).getTime()) / 3600000;
                  return (
                    <tr key={s.id} className="hover:bg-stone-50">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar employee={emp} size={32} onShift />
                          <div>
                            <div className="font-medium text-stone-900">{fullName(emp)}</div>
                            <div className="text-xs text-stone-500">{emp.title}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-stone-600">{prop?.name}</td>
                      <td className="px-6 py-3 tabular">{fmtTime(s.clockIn)}</td>
                      <td className="px-6 py-3 tabular font-medium">{e.toFixed(2)}h</td>
                      <td className="px-6 py-3 text-right">
                        <button onClick={() => setEditShift(s)} className="text-stone-500 hover:text-stone-900"><Edit2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* My recent shifts */}
      <Card>
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Your Recent Shifts</h3>
        </div>
        {myRecent.length === 0 ? (
          <Empty icon={Clock} title="No shift history yet" message="Your completed shifts will appear here." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Date</th>
                <th className="text-left px-6 py-3 font-medium">Property</th>
                <th className="text-left px-6 py-3 font-medium">In</th>
                <th className="text-left px-6 py-3 font-medium">Out</th>
                <th className="text-left px-6 py-3 font-medium">Break</th>
                <th className="text-right px-6 py-3 font-medium">Hours</th>
                <th className="text-right px-6 py-3 font-medium">Earnings</th>
                {perms.canEditAnyShift && <th className="px-6 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {myRecent.map(s => {
                const prop = state.properties.find(p => p.id === s.propertyId);
                const h = hoursBetween(s.clockIn, s.clockOut, s.breakMinutes);
                return (
                  <tr key={s.id} className="hover:bg-stone-50">
                    <td className="px-6 py-3 text-stone-900">{fmtDate(s.clockIn)} {s.edited && <Badge color="amber">edited</Badge>}</td>
                    <td className="px-6 py-3 text-stone-600">{prop?.name}</td>
                    <td className="px-6 py-3 tabular">{fmtTime(s.clockIn)}</td>
                    <td className="px-6 py-3 tabular">{fmtTime(s.clockOut)}</td>
                    <td className="px-6 py-3 tabular text-stone-500">{s.breakMinutes}m</td>
                    <td className="px-6 py-3 tabular text-right font-medium">{h.toFixed(2)}</td>
                    <td className="px-6 py-3 tabular text-right">{fmtMoney(h * (currentUser.hourlyRate || 0))}</td>
                    {perms.canEditAnyShift && (
                      <td className="px-6 py-3 text-right">
                        <button onClick={() => setEditShift(s)} className="text-stone-500 hover:text-stone-900"><Edit2 size={14} /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Edit shift modal */}
      {editShift && (
        <ShiftEditModal
          shift={editShift}
          state={state}
          currentUser={currentUser}
          onClose={() => setEditShift(null)}
          onSave={(updates, reason) => {
            const updated = state.shifts.map(s =>
              s.id === editShift.id ? { ...s, ...updates, edited: true, editedBy: currentUser.id, editReason: reason } : s
            );
            update({ shifts: updated });
            setEditShift(null);
          }}
          onDelete={() => {
            update({ shifts: state.shifts.filter(s => s.id !== editShift.id) });
            setEditShift(null);
          }}
        />
      )}
    </div>
  );
}

function ShiftEditModal({ shift, state, currentUser, onClose, onSave, onDelete }) {
  const emp = state.employees.find(e => e.id === shift.employeeId);
  const [clockIn, setClockIn] = useState(shift.clockIn ? shift.clockIn.slice(0, 16) : "");
  const [clockOut, setClockOut] = useState(shift.clockOut ? shift.clockOut.slice(0, 16) : "");
  const [breakMinutes, setBreakMinutes] = useState(shift.breakMinutes);
  const [notes, setNotes] = useState(shift.notes || "");
  const [reason, setReason] = useState("");

  const hours = hoursBetween(
    clockIn ? new Date(clockIn).toISOString() : null,
    clockOut ? new Date(clockOut).toISOString() : null,
    Number(breakMinutes) || 0
  );

  return (
    <Modal open onClose={onClose} title={`Edit Shift · ${emp ? fullName(emp) : ""}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Clock In" type="datetime-local" value={clockIn} onChange={setClockIn} />
          <Input label="Clock Out" type="datetime-local" value={clockOut} onChange={setClockOut} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Break (minutes)" type="number" value={breakMinutes} onChange={v => setBreakMinutes(Number(v))} />
          <div className="flex items-end">
            <div className="text-sm">
              <span className="text-xs uppercase tracking-wider text-stone-500 block mb-1.5">Total Hours</span>
              <span className="font-display text-2xl tabular text-stone-900">{hours.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <Textarea label="Notes" value={notes} onChange={setNotes} />
        <Input label="Reason for edit (audit log)" value={reason} onChange={setReason} placeholder="e.g. Forgot to clock out" />
        <div className="flex items-center justify-between pt-3 border-t border-stone-200">
          <Button variant="danger" size="sm" onClick={onDelete}><Trash2 size={14} />Delete shift</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => onSave({
              clockIn: new Date(clockIn).toISOString(),
              clockOut: clockOut ? new Date(clockOut).toISOString() : null,
              breakMinutes: Number(breakMinutes) || 0,
              notes,
            }, reason)}><Save size={14} />Save Changes</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
function ScheduleModule({ ctx }) {
  const { state, update, currentUser, perms, activeProperty, toast } = ctx;
  const canEdit = perms.canEditAnyShift;
  const isStaff = !canEdit;
  const [tab, setTab] = useState("schedule");
  const [weekOffset, setWeekOffset] = useState(0);
  const [editing, setEditing] = useState(null); // shift entry or {employeeId, date, isNew:true}

  if (tab === "timeoff") {
    return (
      <div>
        <div className="px-8 pt-6 pb-2">
          <div className="flex items-center gap-1 border-b border-stone-200 -mb-px">
            {[
              { id: "schedule", label: "Schedule", icon: Calendar },
              { id: "timeoff", label: "Time Off", icon: Coffee },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-5 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 transition-all ${tab === t.id ? "border-amber-700 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
                <t.icon size={14} />{t.label}
              </button>
            ))}
          </div>
        </div>
        <TimeOffPane ctx={ctx} />
      </div>
    );
  }

  // Compute week range
  const startOfWeek = useMemo(() => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - d.getDay() + weekOffset * 7);
    d.setHours(0,0,0,0);
    return d;
  }, [weekOffset]);
  const days = Array.from({length: 7}, (_, i) => addDays(startOfWeek, i));

  // Filter employees
  const visibleEmployees = useMemo(() => {
    if (isStaff) return state.employees.filter(e => e.id === currentUser.id);
    return state.employees
      .filter(e => e.propertyId === activeProperty && e.hourlyRate > 0 && e.status === "active")
      .sort((a,b) => a.lastName.localeCompare(b.lastName));
  }, [state.employees, activeProperty, isStaff, currentUser.id]);

  const getShift = (empId, date) => state.schedule.find(sc => sc.employeeId === empId && sc.date === iso(date));
  const getPto = (empId, date) => state.ptoRequests?.find(r =>
    r.employeeId === empId
    && r.status === "approved"
    && iso(date) >= r.startDate
    && iso(date) <= r.endDate
  );

  const totalHoursPerEmployee = (empId) => {
    return days.reduce((sum, d) => {
      const s = getShift(empId, d);
      if (!s) return sum;
      const [sh, sm] = s.startTime.split(":").map(Number);
      const [eh, em] = s.endTime.split(":").map(Number);
      let hrs = (eh*60 + em) - (sh*60 + sm);
      if (hrs < 0) hrs += 24*60;
      return sum + hrs / 60;
    }, 0);
  };

  return (
    <div>
      <div className="px-8 pt-6 pb-2">
        <div className="flex items-center gap-1 border-b border-stone-200 -mb-px">
          {[
            { id: "schedule", label: "Schedule", icon: Calendar },
            { id: "timeoff", label: "Time Off", icon: Coffee, badge: state.ptoRequests?.filter(r => r.status === "pending").length || null },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 transition-all ${tab === t.id ? "border-amber-700 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
              <t.icon size={14} />{t.label}
              {t.badge ? <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-700 text-white">{t.badge}</span> : null}
            </button>
          ))}
        </div>
      </div>
    <div className="p-8 space-y-5 max-w-7xl">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWeekOffset(o => o - 1)}><ArrowLeft size={14} /></Button>
          <div className="px-4 py-1.5 text-sm font-medium text-stone-900 min-w-48 text-center">
            {fmtDate(days[0])} – {fmtDate(days[6])}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setWeekOffset(o => o + 1)}><ArrowRight size={14} /></Button>
          {weekOffset !== 0 && <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>Today</Button>}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="secondary"
              onClick={() => {
                const priorStart = addDays(startOfWeek, -7);
                const priorEnd = addDays(startOfWeek, -1);
                const priorShifts = state.schedule.filter(sc => {
                  const d = new Date(sc.date);
                  return d >= priorStart && d <= priorEnd && sc.propertyId === activeProperty;
                });
                if (!priorShifts.length) {
                  toast?.push("No shifts found in the prior week to copy.", { tone: "warn" });
                  return;
                }
                // Skip employees who already have shifts in this week to avoid duplicates
                const newEntries = priorShifts.map(sc => {
                  const newDate = iso(addDays(new Date(sc.date), 7));
                  if (state.schedule.some(x => x.employeeId === sc.employeeId && x.date === newDate)) return null;
                  return { ...sc, id: newId("sc"), date: newDate };
                }).filter(Boolean);
                if (!newEntries.length) {
                  toast?.push("This week is already fully scheduled.", { tone: "info" });
                  return;
                }
                update({ schedule: [...state.schedule, ...newEntries] });
                toast?.push(`Copied ${newEntries.length} shifts from last week`, { tone: "success" });
              }}
            >
              <Calendar size={14} />Repeat last week
            </Button>
          )}
          {canEdit && (
            <Button variant="accent" onClick={() => setEditing({ isNew: true, employeeId: visibleEmployees[0]?.id, date: iso(days[0]) })}>
              <Plus size={14} />Add Shift
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <th className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-stone-500 sticky left-0 bg-stone-50 z-10 w-56">
                  Employee
                </th>
                {days.map((d, i) => {
                  const isToday = iso(d) === iso(TODAY);
                  return (
                    <th key={i} className={`text-center px-2 py-3 font-medium text-xs uppercase tracking-wider min-w-32 ${isToday ? "bg-amber-50 text-amber-800" : "text-stone-500"}`}>
                      <div>{fmtDayName(d)}</div>
                      <div className={`font-display text-base ${isToday ? "text-amber-900" : "text-stone-700"}`}>{d.getDate()}</div>
                    </th>
                  );
                })}
                <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-stone-500 w-24">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visibleEmployees.length === 0 && (
                <tr><td colSpan={9}><Empty icon={Users} title="No employees" message="Add hourly employees to start scheduling." /></td></tr>
              )}
              {visibleEmployees.map(emp => {
                const totalH = totalHoursPerEmployee(emp.id);
                return (
                  <tr key={emp.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 sticky left-0 bg-white z-10">
                      <div className="flex items-center gap-3">
                        <Avatar employee={emp} size={32} />
                        <div className="min-w-0">
                          <div className="font-medium text-stone-900 truncate">{fullName(emp)}</div>
                          <div className="text-xs text-stone-500 truncate">{emp.title}</div>
                        </div>
                      </div>
                    </td>
                    {days.map((d, i) => {
                      const sc = getShift(emp.id, d);
                      const pto = getPto(emp.id, d);
                      const isToday = iso(d) === iso(TODAY);
                      return (
                        <td key={i} className={`px-1.5 py-1.5 text-center align-top ${isToday ? "bg-amber-50/30" : ""}`}>
                          {pto ? (
                            <div className="w-full px-2 py-2 rounded text-xs bg-violet-100 text-violet-900 border border-violet-200" title={`Approved time off: ${pto.reason || pto.type}`}>
                              <div className="font-medium">PTO</div>
                              <div className="text-violet-700 mt-0.5 truncate text-[10px]">{pto.type}</div>
                            </div>
                          ) : sc ? (
                            <button
                              onClick={() => canEdit && setEditing(sc)}
                              disabled={!canEdit}
                              className={`w-full px-2 py-2 rounded text-xs ${canEdit ? "hover:ring-2 hover:ring-amber-700 cursor-pointer" : "cursor-default"} bg-amber-100 text-amber-900 border border-amber-200`}
                            >
                              <div className="font-medium tabular">{sc.startTime}–{sc.endTime}</div>
                              <div className="text-amber-700 mt-0.5 truncate">{sc.position}</div>
                            </button>
                          ) : canEdit ? (
                            <button
                              onClick={() => setEditing({ isNew: true, employeeId: emp.id, date: iso(d) })}
                              className="w-full py-2 rounded text-xs text-stone-400 border border-dashed border-stone-200 hover:border-amber-700 hover:text-amber-700"
                            >
                              <Plus size={12} className="inline" />
                            </button>
                          ) : (
                            <span className="text-stone-300 text-xs">·</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right tabular font-medium text-stone-900">{totalH.toFixed(1)}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <ScheduleEditModal
          entry={editing}
          state={state}
          activeProperty={activeProperty}
          onClose={() => setEditing(null)}
          onSave={(data) => {
            if (editing.isNew) {
              const newEntry = { id: newId("sc"), ...data };
              update({ schedule: [...state.schedule, newEntry] });
            } else {
              const updated = state.schedule.map(sc => sc.id === editing.id ? { ...sc, ...data } : sc);
              update({ schedule: updated });
            }
            setEditing(null);
          }}
          onDelete={() => {
            update({ schedule: state.schedule.filter(sc => sc.id !== editing.id) });
            setEditing(null);
          }}
        />
      )}
    </div>
    </div>
  );
}

function ScheduleEditModal({ entry, state, activeProperty, onClose, onSave, onDelete }) {
  const isNew = entry.isNew;
  const [employeeId, setEmployeeId] = useState(entry.employeeId || "");
  const [date, setDate] = useState(entry.date || iso(TODAY));
  const [startTime, setStartTime] = useState(entry.startTime || "08:00");
  const [endTime, setEndTime] = useState(entry.endTime || "16:00");
  const [position, setPosition] = useState(entry.position || "");

  const employees = state.employees.filter(e => e.propertyId === activeProperty && e.hourlyRate > 0);
  const employeeOptions = employees.map(e => ({ value: e.id, label: `${fullName(e)} (${e.title})` }));
  const positions = ["Front Desk Agent", "Front Desk Lead", "Night Auditor", "Room Attendant", "Executive Housekeeper", "Maintenance", "Chief Engineer"];

  return (
    <Modal open onClose={onClose} title={isNew ? "Add Shift" : "Edit Shift"}>
      <div className="space-y-4">
        <Select label="Employee" value={employeeId} onChange={setEmployeeId} options={[{ value: "", label: "Select employee…" }, ...employeeOptions]} />
        <Input label="Date" type="date" value={date} onChange={setDate} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Start Time" type="time" value={startTime} onChange={setStartTime} />
          <Input label="End Time" type="time" value={endTime} onChange={setEndTime} />
        </div>
        <Select label="Position" value={position} onChange={setPosition} options={[{ value: "", label: "Select position…" }, ...positions.map(p => ({ value: p, label: p }))]} />
        <div className="flex items-center justify-between pt-3 border-t border-stone-200">
          {!isNew ? (
            <Button variant="danger" size="sm" onClick={onDelete}><Trash2 size={14} />Remove</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!employeeId || !position}
              onClick={() => onSave({
                employeeId, date, startTime, endTime, position,
                propertyId: state.employees.find(e => e.id === employeeId)?.propertyId || activeProperty,
              })}>
              <Save size={14} />Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
/* =========================================================================
   TIME OFF PANE — PTO / time-off request workflow
   ========================================================================= */
function TimeOffPane({ ctx }) {
  const { state, update, currentUser, perms, toast } = ctx;
  const isManager = perms.canEditAnyShift;
  const [showRequest, setShowRequest] = useState(false);
  const [draft, setDraft] = useState({ startDate: iso(addDays(TODAY, 14)), endDate: iso(addDays(TODAY, 14)), type: "vacation", reason: "" });

  const myRequests = (state.ptoRequests || []).filter(r => r.employeeId === currentUser.id);
  // Manager view: requests for employees at properties they oversee
  const teamRequests = useMemo(() => {
    if (!isManager) return [];
    const myProps = perms.properties === "all" ? state.properties.map(p => p.id) : currentUser.propertyAccess;
    const teamIds = state.employees.filter(e => myProps.includes(e.propertyId)).map(e => e.id);
    return state.ptoRequests
      .filter(r => teamIds.includes(r.employeeId) && r.employeeId !== currentUser.id)
      .sort((a, b) => {
        // pending first
        if (a.status !== b.status) {
          if (a.status === "pending") return -1;
          if (b.status === "pending") return 1;
        }
        return b.startDate.localeCompare(a.startDate);
      });
  }, [state.ptoRequests, state.employees, currentUser, perms, isManager]);

  const submitRequest = () => {
    const days = Math.max(1, Math.round((new Date(draft.endDate) - new Date(draft.startDate)) / (24 * 3600 * 1000)) + 1);
    const req = {
      id: newId("pto"),
      employeeId: currentUser.id,
      startDate: draft.startDate, endDate: draft.endDate,
      hours: days * 8,
      type: draft.type, reason: draft.reason,
      status: "pending",
      requestedAt: new Date().toISOString(),
    };
    update({ ptoRequests: [req, ...state.ptoRequests] });
    pushActivity(ctx, "pto.request", { ptoId: req.id, days });
    toast?.push("Time-off request submitted", { tone: "success" });
    setShowRequest(false);
    setDraft({ startDate: iso(addDays(TODAY, 14)), endDate: iso(addDays(TODAY, 14)), type: "vacation", reason: "" });
  };

  const review = (id, status, notes = null) => {
    const updated = state.ptoRequests.map(r => r.id === id ? {
      ...r, status, reviewedBy: currentUser.id, reviewedAt: new Date().toISOString(), reviewNotes: notes,
    } : r);
    update({ ptoRequests: updated });
    pushActivity(ctx, status === "approved" ? "pto.approve" : "pto.deny", { ptoId: id });
    toast?.push(status === "approved" ? "Approved" : "Denied", { tone: status === "approved" ? "success" : "warn" });
  };

  // Balance — simple model: 80h base, minus approved + pending
  const usedHours = myRequests.filter(r => r.status === "approved").reduce((s, r) => s + r.hours, 0);
  const pendingHours = myRequests.filter(r => r.status === "pending").reduce((s, r) => s + r.hours, 0);
  const balance = 80 - usedHours;

  const StatusPill = ({ s }) => {
    const map = { pending: "amber", approved: "emerald", denied: "rose" };
    return <Badge color={map[s] || "stone"}>{s.charAt(0).toUpperCase() + s.slice(1)}</Badge>;
  };

  const Row = ({ r, showEmployee, allowReview }) => {
    const emp = state.employees.find(e => e.id === r.employeeId);
    const days = Math.max(1, Math.round((new Date(r.endDate) - new Date(r.startDate)) / (24 * 3600 * 1000)) + 1);
    return (
      <tr className="hover:bg-stone-50">
        {showEmployee && (
          <td className="px-6 py-3">
            <div className="flex items-center gap-2">
              <Avatar employee={emp} size={28} />
              <div>
                <div className="text-sm font-medium text-stone-900">{fullName(emp)}</div>
                <div className="text-xs text-stone-500">{emp?.title}</div>
              </div>
            </div>
          </td>
        )}
        <td className="px-6 py-3 tabular text-stone-700">{fmtDateShort(r.startDate)} – {fmtDateShort(r.endDate)}</td>
        <td className="px-6 py-3 text-stone-700 text-xs">{r.type}</td>
        <td className="px-6 py-3 tabular text-right">{days}d / {r.hours}h</td>
        <td className="px-6 py-3 text-xs text-stone-500 max-w-xs truncate" title={r.reason}>{r.reason || "—"}</td>
        <td className="px-6 py-3"><StatusPill s={r.status} /></td>
        <td className="px-6 py-3 text-right">
          {allowReview && r.status === "pending" ? (
            <div className="flex justify-end gap-1.5">
              <button onClick={() => review(r.id, "approved")} className="text-xs px-2 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800">Approve</button>
              <button onClick={() => {
                const notes = prompt("Reason for denial (optional):");
                review(r.id, "denied", notes || null);
              }} className="text-xs px-2 py-1 rounded border border-stone-300 text-stone-700 hover:bg-stone-100">Deny</button>
            </div>
          ) : r.reviewNotes ? (
            <span className="text-xs text-stone-500 italic" title={r.reviewNotes}>📝 note</span>
          ) : (
            <span className="text-xs text-stone-400">—</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="p-8 space-y-5 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-3xl text-stone-900">Time Off</h2>
          <p className="text-sm text-stone-500 mt-1">
            Submit, track, and approve PTO. Approved requests are visible on the schedule grid so you don't double-book.
          </p>
        </div>
        <Button variant="accent" onClick={() => setShowRequest(true)}><Plus size={14} />New Request</Button>
      </div>

      {/* Balance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Available Balance</div>
          <div className="font-display number-display text-3xl text-stone-900 font-semibold">{balance}h</div>
          <div className="text-xs text-stone-500 mt-1">{(balance / 8).toFixed(1)} days remaining</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Used (approved)</div>
          <div className="font-display number-display text-3xl text-stone-900 font-semibold">{usedHours}h</div>
          <div className="text-xs text-stone-500 mt-1">{myRequests.filter(r => r.status === "approved").length} request(s)</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Pending</div>
          <div className="font-display number-display text-3xl text-amber-700 font-semibold">{pendingHours}h</div>
          <div className="text-xs text-stone-500 mt-1">{myRequests.filter(r => r.status === "pending").length} awaiting review</div>
        </Card>
      </div>

      {/* My requests */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Your requests</h3>
        </div>
        {myRequests.length === 0 ? (
          <Empty icon={Coffee} title="No requests yet" message="Submit a new request — managers see them in their queue right away." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Dates</th>
                <th className="text-left px-6 py-3 font-medium">Type</th>
                <th className="text-right px-6 py-3 font-medium">Duration</th>
                <th className="text-left px-6 py-3 font-medium">Reason</th>
                <th className="text-left px-6 py-3 font-medium">Status</th>
                <th className="text-right px-6 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {myRequests.sort((a, b) => b.startDate.localeCompare(a.startDate)).map(r => (
                <Row key={r.id} r={r} showEmployee={false} allowReview={false} />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Manager queue */}
      {isManager && teamRequests.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-display text-lg text-stone-900">Team requests</h3>
            <Badge color="amber">{teamRequests.filter(r => r.status === "pending").length} pending</Badge>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Employee</th>
                <th className="text-left px-6 py-3 font-medium">Dates</th>
                <th className="text-left px-6 py-3 font-medium">Type</th>
                <th className="text-right px-6 py-3 font-medium">Duration</th>
                <th className="text-left px-6 py-3 font-medium">Reason</th>
                <th className="text-left px-6 py-3 font-medium">Status</th>
                <th className="text-right px-6 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {teamRequests.map(r => <Row key={r.id} r={r} showEmployee={true} allowReview={true} />)}
            </tbody>
          </table>
        </Card>
      )}

      {/* Request modal */}
      {showRequest && (
        <Modal open onClose={() => setShowRequest(false)} title="Request time off">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Start date" type="date" value={draft.startDate} onChange={v => setDraft(d => ({ ...d, startDate: v }))} />
              <Input label="End date" type="date" value={draft.endDate} onChange={v => setDraft(d => ({ ...d, endDate: v }))} />
            </div>
            <Select label="Type" value={draft.type} onChange={v => setDraft(d => ({ ...d, type: v }))} options={[
              { value: "vacation", label: "Vacation" },
              { value: "sick", label: "Sick" },
              { value: "personal", label: "Personal" },
              { value: "bereavement", label: "Bereavement" },
              { value: "jury", label: "Jury Duty" },
            ]} />
            <Textarea label="Reason (optional but encouraged)" value={draft.reason} onChange={v => setDraft(d => ({ ...d, reason: v }))} rows={3} />
            <div className="text-xs text-stone-500">
              Manager will be notified instantly. Approved requests block scheduling on those dates.
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
              <Button variant="secondary" onClick={() => setShowRequest(false)}>Cancel</Button>
              <Button variant="primary" onClick={submitRequest} disabled={!draft.startDate || !draft.endDate}><Save size={14} />Submit Request</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EmployeesModule({ ctx }) {
  const { state, update, currentUser, perms } = ctx;
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const isStaff = !perms.canManageUsers;

  // Staff can only see themselves
  const employees = isStaff
    ? state.employees.filter(e => e.id === currentUser.id)
    : state.employees;

  const filtered = employees.filter(e => {
    if (e.status === "inactive" && filterRole !== "inactive") return false;
    if (filterRole === "inactive" && e.status !== "inactive") return false;
    if (filterRole !== "all" && filterRole !== "inactive" && e.role !== filterRole) return false;
    if (perms.properties === "own" && !currentUser.propertyAccess.includes(e.propertyId)) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return fullName(e).toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.title.toLowerCase().includes(q);
  }).sort((a,b) => a.lastName.localeCompare(b.lastName));

  // Auto-select for staff users
  useEffect(() => {
    if (isStaff && !selectedId) setSelectedId(currentUser.id);
  }, [isStaff, currentUser.id]);

  const selected = state.employees.find(e => e.id === selectedId);

  if (selected) {
    return (
      <EmployeeDetail
        employee={selected}
        ctx={ctx}
        onBack={() => !isStaff && setSelectedId(null)}
        canBack={!isStaff}
      />
    );
  }

  return (
    <div className="p-8 space-y-5 max-w-7xl">
      {/* Filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-1 max-w-2xl">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employees by name, email, or title…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
            />
          </div>
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:border-amber-700 focus:outline-none">
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="front_desk">Front Desk</option>
            <option value="housekeeping">Housekeeping</option>
            <option value="maintenance">Maintenance</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {perms.canManageUsers && (
          <Button variant="accent" onClick={() => setShowAddModal(true)}>
            <Plus size={14} />Add Employee
          </Button>
        )}
      </div>

      <Card>
        {filtered.length === 0 ? (
          <Empty icon={Users} title="No employees match your filters" message="Try adjusting your search or filter." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Employee</th>
                <th className="text-left px-6 py-3 font-medium">Role</th>
                <th className="text-left px-6 py-3 font-medium">Property</th>
                <th className="text-left px-6 py-3 font-medium">Hired</th>
                <th className="text-left px-6 py-3 font-medium">Pay</th>
                <th className="text-left px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map(emp => {
                const prop = state.properties.find(p => p.id === emp.propertyId);
                const writeupCount = state.writeups.filter(w => w.employeeId === emp.id).length;
                return (
                  <tr key={emp.id} onClick={() => setSelectedId(emp.id)} className="hover:bg-stone-50 cursor-pointer">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar employee={emp} size={36} />
                        <div>
                          <div className="font-medium text-stone-900">{fullName(emp)}</div>
                          <div className="text-xs text-stone-500">{emp.title}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3"><Badge color={emp.role === "admin" ? "violet" : emp.role === "manager" ? "sky" : "stone"}>{ROLE_LABEL[emp.role]}</Badge></td>
                    <td className="px-6 py-3 text-stone-600">{emp.propertyAccess.length > 1 ? "Multi-property" : prop?.name}</td>
                    <td className="px-6 py-3 text-stone-600 tabular">{fmtDate(emp.hireDate)}</td>
                    <td className="px-6 py-3 tabular">{emp.hourlyRate > 0 ? `${fmtMoney(emp.hourlyRate)}/hr` : `${fmtMoney(emp.salary || 0)} salary`}</td>
                    <td className="px-6 py-3">
                      <div className="flex gap-1.5">
                        <Badge color={emp.status === "active" ? "emerald" : "stone"}>{emp.status}</Badge>
                        {writeupCount > 0 && <Badge color="amber">{writeupCount} write-up{writeupCount > 1 ? "s" : ""}</Badge>}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right text-stone-400"><ChevronRight size={16} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {showAddModal && (
        <AddEmployeeModal
          ctx={ctx}
          onClose={() => setShowAddModal(false)}
          onSave={(emp) => {
            update({ employees: [...state.employees, emp] });
            setShowAddModal(false);
            setSelectedId(emp.id);
          }}
        />
      )}
    </div>
  );
}

function EmployeeDetail({ employee, ctx, onBack, canBack }) {
  const { state, update, currentUser, perms } = ctx;
  const [tab, setTab] = useState("profile");
  const isOwn = employee.id === currentUser.id;
  const canEdit = perms.canManageUsers;

  const myShifts = state.shifts.filter(s => s.employeeId === employee.id && s.clockOut)
    .sort((a,b) => new Date(b.clockIn) - new Date(a.clockIn));
  const myWriteups = state.writeups.filter(w => w.employeeId === employee.id)
    .sort((a,b) => b.date.localeCompare(a.date));
  const myDocs = state.documents.filter(d => d.employeeId === employee.id);

  return (
    <div className="p-8 max-w-6xl">
      {canBack && (
        <button onClick={onBack} className="text-sm text-stone-600 hover:text-stone-900 inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={14} />All employees
        </button>
      )}

      {/* Header */}
      <Card className="p-6 mb-5">
        <div className="flex items-start gap-5">
          <Avatar employee={employee} size={72} />
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display text-3xl text-stone-900">{fullName(employee)}</h2>
              <Badge color={employee.status === "active" ? "emerald" : "stone"}>{employee.status}</Badge>
            </div>
            <p className="text-stone-600 mt-1">{employee.title} · {ROLE_LABEL[employee.role]}</p>
            <div className="flex items-center gap-5 mt-3 text-sm text-stone-500 flex-wrap">
              <span className="inline-flex items-center gap-1.5"><Mail size={13} />{employee.email}</span>
              <span className="inline-flex items-center gap-1.5"><Phone size={13} />{employee.phone}</span>
              <span className="inline-flex items-center gap-1.5"><Briefcase size={13} />Hired {fmtDate(employee.hireDate)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex border-b border-stone-200 mb-5">
        {[
          { id: "profile", label: "Profile", icon: UserCircle2 },
          { id: "documents", label: `Documents (${myDocs.length})`, icon: Paperclip },
          { id: "writeups", label: `Write-ups (${myWriteups.length})`, icon: FileWarning },
          { id: "time", label: "Time History", icon: Clock },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 transition-colors ${tab === t.id ? "border-amber-700 text-amber-800" : "border-transparent text-stone-500 hover:text-stone-700"}`}
          >
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfileTab employee={employee} ctx={ctx} canEdit={canEdit} />}
      {tab === "documents" && <DocumentsTab employee={employee} docs={myDocs} ctx={ctx} canEdit={canEdit} />}
      {tab === "writeups" && <WriteupsTab employee={employee} writeups={myWriteups} ctx={ctx} canEdit={perms.canIssueWriteups} isOwn={isOwn} />}
      {tab === "time" && <TimeHistoryTab employee={employee} shifts={myShifts} ctx={ctx} />}
    </div>
  );
}

function ProfileTab({ employee, ctx, canEdit }) {
  const { state, update } = ctx;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(employee);

  const property = state.properties.find(p => p.id === employee.propertyId);

  if (editing) {
    return (
      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="First Name" value={draft.firstName} onChange={v => setDraft({...draft, firstName: v})} />
          <Input label="Last Name" value={draft.lastName} onChange={v => setDraft({...draft, lastName: v})} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Email" value={draft.email} onChange={v => setDraft({...draft, email: v})} />
          <Input label="Phone" value={draft.phone} onChange={v => setDraft({...draft, phone: v})} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Title" value={draft.title} onChange={v => setDraft({...draft, title: v})} />
          <Select label="Role" value={draft.role} onChange={v => setDraft({...draft, role: v})}
            options={Object.entries(ROLE_LABEL).map(([k,l]) => ({ value: k, label: l }))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Hourly Rate ($)" type="number" value={draft.hourlyRate} onChange={v => setDraft({...draft, hourlyRate: Number(v)})} />
          <Input label="Salary ($, annual)" type="number" value={draft.salary || 0} onChange={v => setDraft({...draft, salary: Number(v)})} />
        </div>
        <Input label="Emergency Contact" value={draft.emergency} onChange={v => setDraft({...draft, emergency: v})} />
        <div className="flex gap-2 justify-end pt-3 border-t border-stone-200">
          <Button variant="secondary" onClick={() => { setDraft(employee); setEditing(false); }}>Cancel</Button>
          <Button variant="primary" onClick={() => {
            update({ employees: state.employees.map(e => e.id === employee.id ? draft : e) });
            setEditing(false);
          }}><Save size={14} />Save</Button>
        </div>
      </Card>
    );
  }

  const fields = [
    ["Email", employee.email],
    ["Phone", employee.phone],
    ["Property", employee.propertyAccess.length > 1 ? "Multi-property access" : property?.name],
    ["Role", ROLE_LABEL[employee.role]],
    ["Hire Date", fmtDate(employee.hireDate)],
    ["Compensation", employee.hourlyRate > 0 ? `${fmtMoney(employee.hourlyRate)}/hour` : `${fmtMoney(employee.salary || 0)}/year`],
    ["SSN (last 4)", `●●●–●●–${employee.ssnLast4}`],
    ["Emergency Contact", employee.emergency],
  ];

  return (
    <Card>
      <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
        <h3 className="font-display text-lg text-stone-900">Personal Information</h3>
        {canEdit && <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Edit2 size={14} />Edit</Button>}
      </div>
      <dl className="grid grid-cols-1 md:grid-cols-2">
        {fields.map(([label, val]) => (
          <div key={label} className="px-6 py-4 border-b border-stone-100">
            <dt className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-1">{label}</dt>
            <dd className="text-sm text-stone-900">{val || "—"}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function DocumentsTab({ employee, docs, ctx, canEdit }) {
  const { state, update } = ctx;
  const [showUpload, setShowUpload] = useState(false);

  const categories = ["Onboarding", "Tax Forms", "Payroll", "Performance", "Training", "Discipline", "Medical", "Other"];
  const grouped = docs.reduce((acc, d) => {
    if (!acc[d.category]) acc[d.category] = [];
    acc[d.category].push(d);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <Card>
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-display text-lg text-stone-900">Document File</h3>
          {canEdit && <Button variant="accent" size="sm" onClick={() => setShowUpload(true)}><Upload size={14} />Upload Document</Button>}
        </div>
        {docs.length === 0 ? (
          <Empty icon={Paperclip} title="No documents on file" message="Upload onboarding paperwork, tax forms, certifications, and more." />
        ) : (
          <div className="divide-y divide-stone-100">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <div className="px-6 py-2 bg-stone-50 text-xs uppercase tracking-wider text-stone-500 font-medium">{cat}</div>
                {items.map(doc => (
                  <div key={doc.id} className="px-6 py-3 flex items-center gap-4 hover:bg-stone-50">
                    <div className="w-9 h-9 rounded bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center text-xs font-bold">PDF</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-900 truncate">{doc.name}</div>
                      <div className="text-xs text-stone-500">Uploaded {fmtDate(doc.uploadDate)} · {doc.size}</div>
                    </div>
                    <button className="text-stone-500 hover:text-stone-900 p-1.5"><Eye size={14} /></button>
                    <button className="text-stone-500 hover:text-stone-900 p-1.5"><Download size={14} /></button>
                    {canEdit && (
                      <button onClick={() => update({ documents: state.documents.filter(d => d.id !== doc.id) })} className="text-stone-500 hover:text-rose-700 p-1.5"><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <FileCheck2 size={18} className="text-amber-700 mt-0.5" />
          <div className="text-sm text-stone-700">
            <strong className="text-stone-900">Document scanning:</strong> In a production deployment this would connect to a desktop scanner via WIA/TWAIN drivers or a mobile camera (with auto-edge-detection and OCR) to digitize signed paperwork. The demo simulates uploads.
          </div>
        </div>
      </Card>

      {showUpload && (
        <UploadDocModal
          employee={employee}
          categories={categories}
          onClose={() => setShowUpload(false)}
          onSave={(doc) => {
            update({ documents: [...state.documents, { ...doc, id: newId("d"), employeeId: employee.id, uploadDate: iso(TODAY) }] });
            setShowUpload(false);
          }}
        />
      )}
    </div>
  );
}

function UploadDocModal({ employee, categories, onClose, onSave }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Onboarding");
  const [size, setSize] = useState("");

  return (
    <Modal open onClose={onClose} title={`Upload Document · ${fullName(employee)}`}>
      <div className="space-y-4">
        <div className="border-2 border-dashed border-stone-300 rounded-lg p-8 text-center bg-stone-50">
          <Upload size={32} className="mx-auto text-stone-400 mb-2" />
          <p className="text-sm text-stone-600">Drop file here or click to browse</p>
          <p className="text-xs text-stone-400 mt-1">PDF, JPG, PNG up to 10 MB · Demo simulates the upload</p>
        </div>
        <Input label="Document Name" value={name} onChange={setName} placeholder="e.g. 2026 W-4 Form.pdf" />
        <Select label="Category" value={category} onChange={setCategory} options={categories.map(c => ({ value: c, label: c }))} />
        <Input label="File size (display only)" value={size} onChange={setSize} placeholder="e.g. 312 KB" />
        <div className="flex gap-2 justify-end pt-3 border-t border-stone-200">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name} onClick={() => onSave({ name, category, size: size || "0 KB" })}>
            <Save size={14} />Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function WriteupsTab({ employee, writeups, ctx, canEdit, isOwn }) {
  const { state, update, currentUser } = ctx;
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-5">
      <Card>
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-display text-lg text-stone-900">Disciplinary Record</h3>
          {canEdit && <Button variant="accent" size="sm" onClick={() => setShowAdd(true)}><Plus size={14} />New Write-up</Button>}
        </div>
        {writeups.length === 0 ? (
          <Empty icon={FileCheck2} title="Clean record" message="No disciplinary actions on file." />
        ) : (
          <div className="divide-y divide-stone-100">
            {writeups.map(w => {
              const issuer = state.employees.find(e => e.id === w.issuedBy);
              const colors = { verbal: "amber", written: "rose", final: "rose", termination: "rose" };
              const labels = { verbal: "Verbal Warning", written: "Written Warning", final: "Final Warning", termination: "Termination" };
              return (
                <div key={w.id} className="px-6 py-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge color={colors[w.type]}>{labels[w.type]}</Badge>
                      <span className="text-sm font-medium text-stone-900">{w.issue}</span>
                      <span className="text-xs text-stone-500">{fmtDate(w.date)}</span>
                    </div>
                    {!w.acknowledged && <Badge color="amber">Pending acknowledgment</Badge>}
                  </div>
                  <p className="text-sm text-stone-700 mb-2"><strong className="text-stone-500 uppercase text-xs tracking-wider mr-2">Description</strong>{w.description}</p>
                  <p className="text-sm text-stone-700 mb-3"><strong className="text-stone-500 uppercase text-xs tracking-wider mr-2">Action Taken</strong>{w.actionTaken}</p>
                  <div className="flex items-center justify-between text-xs text-stone-500">
                    <span>Issued by {issuer ? fullName(issuer) : "—"}</span>
                    {isOwn && !w.acknowledged && (
                      <Button size="sm" variant="primary" onClick={() => {
                        update({ writeups: state.writeups.map(x => x.id === w.id ? { ...x, acknowledged: true, acknowledgedDate: iso(TODAY) } : x) });
                      }}><CheckCircle2 size={14} />Acknowledge</Button>
                    )}
                    {w.acknowledged && <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={12} />Acknowledged {fmtDate(w.acknowledgedDate)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {showAdd && (
        <AddWriteupModal
          employee={employee}
          currentUser={currentUser}
          onClose={() => setShowAdd(false)}
          onSave={(w) => {
            update({ writeups: [...state.writeups, { ...w, id: newId("w"), employeeId: employee.id, issuedBy: currentUser.id, acknowledged: false, acknowledgedDate: null }] });
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AddWriteupModal({ employee, currentUser, onClose, onSave }) {
  const [type, setType] = useState("verbal");
  const [date, setDate] = useState(iso(TODAY));
  const [issue, setIssue] = useState("");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");

  return (
    <Modal open onClose={onClose} title={`New Write-up · ${fullName(employee)}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Type" value={type} onChange={setType} options={[
            { value: "verbal", label: "Verbal Warning" },
            { value: "written", label: "Written Warning" },
            { value: "final", label: "Final Warning" },
            { value: "termination", label: "Termination" },
          ]} />
          <Input label="Date" type="date" value={date} onChange={setDate} />
        </div>
        <Input label="Issue Summary" value={issue} onChange={setIssue} placeholder="e.g. Tardiness, Policy Violation" />
        <Textarea label="Description of Incident" value={description} onChange={setDescription} rows={4} placeholder="Describe what happened, including dates, times, and witnesses." />
        <Textarea label="Corrective Action" value={actionTaken} onChange={setActionTaken} rows={3} placeholder="Describe the action taken and expectations going forward." />
        <div className="flex gap-2 justify-end pt-3 border-t border-stone-200">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!issue || !description} onClick={() => onSave({ type, date, issue, description, actionTaken })}>
            <Save size={14} />Issue Write-up
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TimeHistoryTab({ employee, shifts, ctx }) {
  const last30 = shifts.filter(s => new Date(s.clockIn) >= addDays(TODAY, -30));
  const totalH = last30.reduce((sum, s) => sum + hoursBetween(s.clockIn, s.clockOut, s.breakMinutes), 0);
  const totalEarn = totalH * (employee.hourlyRate || 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Shifts (30 days)" value={last30.length} icon={Clock} />
        <StatCard label="Hours (30 days)" value={totalH.toFixed(1)} icon={Clock} />
        <StatCard label="Gross Earnings" value={fmtMoney(totalEarn)} icon={DollarSign} />
      </div>
      <Card>
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Recent Shifts</h3>
        </div>
        {shifts.length === 0 ? (
          <Empty icon={Clock} title="No shifts recorded" message="Completed shifts will appear here." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Date</th>
                <th className="text-left px-6 py-3 font-medium">In</th>
                <th className="text-left px-6 py-3 font-medium">Out</th>
                <th className="text-left px-6 py-3 font-medium">Break</th>
                <th className="text-right px-6 py-3 font-medium">Hours</th>
                <th className="text-right px-6 py-3 font-medium">Earnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shifts.slice(0, 30).map(s => {
                const h = hoursBetween(s.clockIn, s.clockOut, s.breakMinutes);
                return (
                  <tr key={s.id} className="hover:bg-stone-50">
                    <td className="px-6 py-2.5">{fmtDate(s.clockIn)}{s.edited && <span className="text-xs text-amber-600 ml-2">(edited)</span>}</td>
                    <td className="px-6 py-2.5 tabular">{fmtTime(s.clockIn)}</td>
                    <td className="px-6 py-2.5 tabular">{fmtTime(s.clockOut)}</td>
                    <td className="px-6 py-2.5 tabular text-stone-500">{s.breakMinutes}m</td>
                    <td className="px-6 py-2.5 tabular text-right font-medium">{h.toFixed(2)}</td>
                    <td className="px-6 py-2.5 tabular text-right">{fmtMoney(h * (employee.hourlyRate || 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function AddEmployeeModal({ ctx, onClose, onSave }) {
  const { state } = ctx;
  const [draft, setDraft] = useState({
    firstName: "", lastName: "", role: "front_desk", title: "Front Desk Agent",
    email: "", phone: "", propertyId: state.properties[0]?.id || "p1",
    propertyAccess: [state.properties[0]?.id || "p1"],
    hourlyRate: 16.00, salary: 0, hireDate: iso(TODAY), status: "active",
    ssnLast4: "0000", emergency: ""
  });

  const handle = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <Modal open onClose={onClose} title="Add New Employee" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="First Name" value={draft.firstName} onChange={v => handle("firstName", v)} required />
          <Input label="Last Name" value={draft.lastName} onChange={v => handle("lastName", v)} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Email" value={draft.email} onChange={v => handle("email", v)} type="email" />
          <Input label="Phone" value={draft.phone} onChange={v => handle("phone", v)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Job Title" value={draft.title} onChange={v => handle("title", v)} />
          <Select label="Role" value={draft.role} onChange={v => handle("role", v)}
            options={Object.entries(ROLE_LABEL).map(([k,l]) => ({ value: k, label: l }))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Home Property" value={draft.propertyId} onChange={v => handle("propertyId", v)}
            options={state.properties.map(p => ({ value: p.id, label: p.name }))} />
          <Input label="Hire Date" type="date" value={draft.hireDate} onChange={v => handle("hireDate", v)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Hourly Rate ($)" type="number" value={draft.hourlyRate} onChange={v => handle("hourlyRate", Number(v))} />
          <Input label="Salary ($, annual)" type="number" value={draft.salary} onChange={v => handle("salary", Number(v))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="SSN (last 4)" value={draft.ssnLast4} onChange={v => handle("ssnLast4", v)} />
          <Input label="Emergency Contact" value={draft.emergency} onChange={v => handle("emergency", v)} />
        </div>
        <div className="flex gap-2 justify-end pt-3 border-t border-stone-200">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!draft.firstName || !draft.lastName}
            onClick={() => onSave({ ...draft, id: newId("e"), propertyAccess: [draft.propertyId] })}>
            <Save size={14} />Add Employee
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function PayrollInsights({ employees, calcPay }) {
  const enriched = employees.map(e => ({ emp: e, ...calcPay(e) }));
  const topEarners = [...enriched].sort((a, b) => b.gross - a.gross).slice(0, 3);
  const topOT = [...enriched].filter(x => x.overtime > 0).sort((a, b) => b.overtime - a.overtime).slice(0, 3);
  const topHours = [...enriched].sort((a, b) => (b.regular + b.overtime) - (a.regular + a.overtime)).slice(0, 3);

  if (!enriched.length) return null;

  const Section = ({ title, list, valueOf, fmt }) => (
    <Card className="p-5">
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">{title}</h4>
      <div className="space-y-2">
        {list.length === 0 ? <p className="text-sm text-stone-400">—</p> : list.map((x, i) => (
          <div key={x.emp.id} className="flex items-center gap-3">
            <span className="font-display text-stone-400 text-sm w-4">{i + 1}.</span>
            <Avatar employee={x.emp} size={28} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-stone-900 truncate">{fullName(x.emp)}</div>
              <div className="text-xs text-stone-500">{x.emp.title}</div>
            </div>
            <div className="text-right tabular text-sm font-semibold text-stone-900">{fmt(valueOf(x))}</div>
          </div>
        ))}
      </div>
    </Card>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Section title="Top earners" list={topEarners} valueOf={x => x.gross} fmt={fmtMoney} />
      <Section title="Most overtime" list={topOT} valueOf={x => x.overtime} fmt={v => `${v.toFixed(1)} h`} />
      <Section title="Most hours worked" list={topHours} valueOf={x => x.regular + x.overtime} fmt={v => `${v.toFixed(1)} h`} />
    </div>
  );
}

function PayrollModule({ ctx }) {
  const { state, currentUser, perms, activeProperty } = ctx;
  const [periodOffset, setPeriodOffset] = useState(0);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runComplete, setRunComplete] = useState(false);

  // Pay periods are 2-week, ending on Saturday
  const periodEnd = useMemo(() => {
    const d = new Date(TODAY);
    const dayOfWeek = d.getDay();
    d.setDate(d.getDate() - dayOfWeek - 1 + (periodOffset * 14)); // last Saturday + offset
    d.setHours(23, 59, 59, 999);
    return d;
  }, [periodOffset]);
  const periodStart = useMemo(() => {
    const d = addDays(periodEnd, -13);
    d.setHours(0,0,0,0);
    return d;
  }, [periodEnd]);

  const employees = useMemo(() => {
    const list = perms.properties === "all"
      ? state.employees
      : state.employees.filter(e => e.propertyId === activeProperty);
    return list.filter(e => e.status === "active" && e.hourlyRate > 0)
      .sort((a,b) => a.lastName.localeCompare(b.lastName));
  }, [state.employees, activeProperty, perms.properties]);

  const calcPay = (emp) => {
    const empShifts = state.shifts.filter(s =>
      s.employeeId === emp.id && s.clockOut &&
      new Date(s.clockIn) >= periodStart && new Date(s.clockIn) <= periodEnd
    );
    // group by week to apply OT (>40 hrs/week)
    const weekHours = [0, 0];
    empShifts.forEach(s => {
      const d = new Date(s.clockIn);
      const week = d < addDays(periodStart, 7) ? 0 : 1;
      weekHours[week] += hoursBetween(s.clockIn, s.clockOut, s.breakMinutes);
    });
    const regular = weekHours.reduce((sum, h) => sum + Math.min(h, 40), 0);
    const overtime = weekHours.reduce((sum, h) => sum + Math.max(0, h - 40), 0);
    const gross = regular * emp.hourlyRate + overtime * emp.hourlyRate * 1.5;
    // Demo-only tax estimates — not real
    const fed = gross * 0.10;
    const fica = gross * 0.0765;
    const state_ = gross * 0.04;
    const totalTax = fed + fica + state_;
    const net = gross - totalTax;
    return { regular, overtime, gross, fed, fica, state: state_, totalTax, net, shifts: empShifts.length };
  };

  const periodTotals = employees.reduce((acc, emp) => {
    const p = calcPay(emp);
    return {
      gross: acc.gross + p.gross,
      net: acc.net + p.net,
      hours: acc.hours + p.regular + p.overtime,
      ot: acc.ot + p.overtime,
      tax: acc.tax + p.totalTax,
    };
  }, { gross: 0, net: 0, hours: 0, ot: 0, tax: 0 });

  return (
    <div className="p-8 space-y-5 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPeriodOffset(o => o - 1)}><ArrowLeft size={14} /></Button>
          <div className="px-4 py-1.5 text-sm font-medium text-stone-900 min-w-72 text-center">
            <div className="text-xs text-stone-500 uppercase tracking-wider">Pay Period</div>
            <div className="font-display text-base">{fmtDate(periodStart)} – {fmtDate(periodEnd)}</div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setPeriodOffset(o => o + 1)} disabled={periodOffset >= 0}><ArrowRight size={14} /></Button>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary"><Download size={14} />Export CSV</Button>
          <Button variant="accent" onClick={() => setShowRunModal(true)} disabled={runComplete}><Receipt size={14} />{runComplete ? "Period Closed" : "Run Payroll"}</Button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Gross Pay" value={fmtMoneyShort(periodTotals.gross)} sub={fmtMoney(periodTotals.gross)} />
        <KpiCard label="Net Pay" value={fmtMoneyShort(periodTotals.net)} sub={fmtMoney(periodTotals.net)} />
        <KpiCard label="Total Hours" value={periodTotals.hours.toFixed(1)} sub={`${employees.length} employees`} />
        <KpiCard label="OT Hours" value={periodTotals.ot.toFixed(1)} sub={fmtMoney(periodTotals.ot * 0)} />
        <KpiCard label="Estimated Tax" value={fmtMoneyShort(periodTotals.tax)} sub={fmtMoney(periodTotals.tax)} />
      </div>

      {/* Top employee insights */}
      <PayrollInsights employees={employees} calcPay={calcPay} />


      <Card>
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Pay Period Detail</h3>
        </div>
        {employees.length === 0 ? (
          <Empty icon={DollarSign} title="No hourly employees" message="Pay calculations appear here once active employees are added." />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-6 py-3 font-medium">Employee</th>
                  <th className="text-right px-3 py-3 font-medium">Rate</th>
                  <th className="text-right px-3 py-3 font-medium">Reg Hrs</th>
                  <th className="text-right px-3 py-3 font-medium">OT Hrs</th>
                  <th className="text-right px-3 py-3 font-medium">Gross</th>
                  <th className="text-right px-3 py-3 font-medium">Fed Tax</th>
                  <th className="text-right px-3 py-3 font-medium">FICA</th>
                  <th className="text-right px-3 py-3 font-medium">State</th>
                  <th className="text-right px-6 py-3 font-medium">Net Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {employees.map(emp => {
                  const p = calcPay(emp);
                  return (
                    <tr key={emp.id} className="hover:bg-stone-50">
                      <td className="px-6 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar employee={emp} size={28} />
                          <div>
                            <div className="font-medium text-stone-900">{fullName(emp)}</div>
                            <div className="text-xs text-stone-500">{emp.title}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">{fmtMoney(emp.hourlyRate)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{p.regular.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{p.overtime > 0 ? <span className="text-amber-700 font-medium">{p.overtime.toFixed(2)}</span> : <span className="text-stone-400">—</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular font-medium">{fmtMoney(p.gross)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-stone-500">{fmtMoney(p.fed)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-stone-500">{fmtMoney(p.fica)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-stone-500">{fmtMoney(p.state)}</td>
                      <td className="px-6 py-2.5 text-right tabular font-bold text-stone-900">{fmtMoney(p.net)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-stone-50 font-medium">
                <tr>
                  <td className="px-6 py-3" colSpan={2}>Period Totals</td>
                  <td className="px-3 py-3 text-right tabular">{(periodTotals.hours - periodTotals.ot).toFixed(2)}</td>
                  <td className="px-3 py-3 text-right tabular">{periodTotals.ot.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right tabular">{fmtMoney(periodTotals.gross)}</td>
                  <td className="px-3 py-3 text-right tabular" colSpan={3}>{fmtMoney(periodTotals.tax)}</td>
                  <td className="px-6 py-3 text-right tabular font-bold">{fmtMoney(periodTotals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5 bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-700 mt-0.5" />
          <div className="text-sm text-stone-700">
            <strong className="text-stone-900">Demo tax calculations.</strong> Tax withholding shown uses simplified flat percentages (Federal 10%, FICA 7.65%, State 4%). A production system requires actual federal/state tax tables, W-4 elections, locality taxes, garnishments, pre/post-tax deductions, and ACH file generation.
          </div>
        </div>
      </Card>

      <Modal open={showRunModal} onClose={() => setShowRunModal(false)} title="Run Payroll for Period">
        <div className="space-y-4">
          <p className="text-sm text-stone-700">
            You're about to lock the pay period <strong>{fmtDate(periodStart)} – {fmtDate(periodEnd)}</strong>.
            Once run, time entries in this period cannot be edited without a payroll adjustment.
          </p>
          <div className="bg-stone-50 rounded-md p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-stone-500">Employees:</span><strong>{employees.length}</strong></div>
            <div className="flex justify-between"><span className="text-stone-500">Total hours:</span><strong className="tabular">{periodTotals.hours.toFixed(2)}</strong></div>
            <div className="flex justify-between"><span className="text-stone-500">Gross pay:</span><strong className="tabular">{fmtMoney(periodTotals.gross)}</strong></div>
            <div className="flex justify-between border-t border-stone-200 pt-2 mt-2"><span className="text-stone-700 font-medium">Total disbursement:</span><strong className="tabular text-lg">{fmtMoney(periodTotals.net)}</strong></div>
          </div>
          <div className="flex gap-2 justify-end pt-3 border-t border-stone-200">
            <Button variant="secondary" onClick={() => setShowRunModal(false)}>Cancel</Button>
            <Button variant="success" onClick={() => { setRunComplete(true); setShowRunModal(false); }}><CheckCircle2 size={14} />Confirm & Run</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
/* =========================================================================
   EXPORT HELPERS — flash report → downloadable JSON / CSV
   ========================================================================= */
function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportFlashJson(report, property) {
  const payload = {
    schema: "hotelops.flash.v1",
    exportedAt: new Date().toISOString(),
    property: { id: property?.id, name: property?.name, location: property?.location, rooms: property?.rooms },
    date: report.date,
    summary: {
      totalRevenue: report.totalRevenue,
      roomRevenue: report.roomRevenue,
      fbRevenue: report.fbRevenue,
      otherRevenue: report.otherRevenue,
      occupancy: report.occupancy,
      adr: report.adr,
      revpar: report.revpar,
    },
    breakdown: report.breakdown,
    ingestion: report.ingestion || null,
  };
  const fname = `flash_${property?.id || "report"}_${report.date}.json`;
  downloadBlob(fname, JSON.stringify(payload, null, 2), "application/json");
}

function exportFlashCsv(report, property) {
  const b = report.breakdown || {};
  // GL-friendly journal-entry layout
  const lines = [
    `account,description,debit,credit,date,property,reference`,
    `4110,Transient Room Revenue,,${(b.revenue?.rooms || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `4210,Restaurant Revenue,,${(b.revenue?.fb?.restaurant || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `4220,Banquet Revenue,,${(b.revenue?.fb?.banquet || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `4230,Bar / Lounge Revenue,,${(b.revenue?.fb?.bar || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `4310,Telephone Revenue,,${(b.revenue?.other?.telephone || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `4320,Parking Revenue,,${(b.revenue?.other?.parking || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `4330,Spa / Wellness Revenue,,${(b.revenue?.other?.spa || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `4340,Gift Shop / Sundry,,${(b.revenue?.other?.misc || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `2210,Occupancy Tax Liability,,${(b.taxes?.occupancy || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `2220,Sales Tax Liability,,${(b.taxes?.sales || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `2230,Tourism Tax Liability,,${(b.taxes?.tourism || 0).toFixed(2)},${report.date},${property?.name || ""},${report.id}`,
    `1110,Cash Receipts,${(b.payments?.cash || 0).toFixed(2)},,${report.date},${property?.name || ""},${report.id}`,
    `1115,Credit Card Receivable,${(b.payments?.creditCard || 0).toFixed(2)},,${report.date},${property?.name || ""},${report.id}`,
    `1120,City Ledger / Direct Bill,${(b.payments?.directBill || 0).toFixed(2)},,${report.date},${property?.name || ""},${report.id}`,
  ];
  const fname = `journal_${property?.id || "report"}_${report.date}.csv`;
  downloadBlob(fname, lines.join("\n"), "text/csv");
}

/* =========================================================================
   ACCOUNTING MODULE — PREMIUM AI-POWERED AUDIT WORKSPACE
   ========================================================================= */

// Three deliberately different audit formats so users can stress-test the parser.
const SAMPLE_AUDITS = [
`NIGHT AUDIT — Riverbend Inn — March 14, 2026

Rooms Available:        84   (3 OOO)
Rooms Sold:             67   (61 transient, 6 group)
Comp Rooms:             1
Walk-ins:               2
No-shows:               1

ADR:                    $148.20
Room Revenue:           $9,929.40
Restaurant:             $812.50
Bar / Lounge:           $245.00
Banquet:                $0.00
Parking:                $182.00
Misc:                   $54.00

Occupancy Tax:          $1,142.00
Sales Tax:              $785.00
Tourism Tax:            $148.00

Credit Card:            $9,840.00
Cash:                   $448.00
Direct Bill:            $865.00
Other:                  $20.00

Guests in House:        116
Total Revenue:          $11,222.90`,
`Cypress Point Lodge — Daily Flash Report
Date: 2026/03/13 (Friday)

Inventory:                142 rooms
Out of Order:             4
Occupied Rooms:           128
Group Block:              22
Transient:                104
Walk Ins:                 2
ADR:                      $187.45
Room Rev:                 $23,993.60
Food Revenue:             $4,820.10
Beverage:                 $1,950.40
Catering:                 $3,440.00
Spa:                      $640.00
Valet Parking:            $312.00
Resort Fee:               $1,920.00
Telephone Revenue:        $0.00
Sales Tax (6.95%):        $2,488.30
Lodging Tax (11.5%):      $2,759.26
Visa/MC/Amex:             $34,888.00
Cash Receipts:            $410.00
City Ledger:              $1,508.00
Guest Count:              218`,
`Riverbend Inn / 03-12-2026 / NA
rooms inv 84 ooo 2 sold 70 comp 0 walkins 1
adr 142.85
room rev 9999.50
restaurant 720.00 bar 198.00
parking 165 misc 38
occ tax 1149 sales tax 762 tourism 142
cc 9870 cash 280 db 580 other 0
guests 121 checkins 30 checkouts 26`,
// 4: a 3-day batch with hard separators — exercises batch ingest
`NIGHT AUDIT — Riverbend Inn — March 10 2026
Rooms Available: 84 (1 OOO)
Rooms Sold: 62
ADR: $141.50
Room Revenue: $8,773.00
Restaurant: $688.00  Bar: $202.00
Parking: $144  Misc: $32
Sales Tax: $702  Occupancy Tax: $1,008  Tourism Tax: $131
CC: $9,210  Cash: $312  DB: $448
Guests: 108

---

NIGHT AUDIT — Riverbend Inn — March 11 2026
Rooms Available: 84 (1 OOO)
Rooms Sold: 71
ADR: $145.85
Room Revenue: $10,355.35
Restaurant: $792.00  Bar: $238.00
Parking: $174  Misc: $41
Sales Tax: $812  Occupancy Tax: $1,191  Tourism Tax: $155
CC: $10,810  Cash: $375  DB: $618
Guests: 124

---

NIGHT AUDIT — Riverbend Inn — March 12 2026
Rooms Available: 84 (1 OOO)
Rooms Sold: 78
ADR: $151.20
Room Revenue: $11,793.60
Restaurant: $895.00  Bar: $284.00
Parking: $198  Misc: $58
Sales Tax: $922  Occupancy Tax: $1,356  Tourism Tax: $176
CC: $12,408  Cash: $402  DB: $418
Guests: 138`,
];

// Hotel-industry GL chart for revenue mapping (USALI-aligned)
const GL_CHART = [
  { code: "4110", name: "Transient Room Revenue", category: "rooms", path: ["revenue","rooms"] },
  { code: "4120", name: "Group Room Revenue", category: "rooms", path: ["revenue","rooms"] },
  { code: "4210", name: "Restaurant Revenue", category: "fb", path: ["revenue","fb","restaurant"] },
  { code: "4220", name: "Banquet Revenue", category: "fb", path: ["revenue","fb","banquet"] },
  { code: "4230", name: "Bar / Lounge Revenue", category: "fb", path: ["revenue","fb","bar"] },
  { code: "4310", name: "Telephone Revenue", category: "other", path: ["revenue","other","telephone"] },
  { code: "4320", name: "Parking Revenue", category: "other", path: ["revenue","other","parking"] },
  { code: "4330", name: "Spa / Wellness Revenue", category: "other", path: ["revenue","other","spa"] },
  { code: "4340", name: "Gift Shop / Sundry", category: "other", path: ["revenue","other","misc"] },
  { code: "2210", name: "Occupancy Tax Liability", category: "tax", path: ["taxes","occupancy"] },
  { code: "2220", name: "Sales Tax Liability", category: "tax", path: ["taxes","sales"] },
  { code: "2230", name: "Tourism Tax Liability", category: "tax", path: ["taxes","tourism"] },
];

// Backfill missing structured fields from the legacy flat shape
function enrichReport(r) {
  if (!r) return null;
  const breakdown = r.breakdown || {
    rooms: { available: r.roomsAvailable, sold: r.roomsSold, comp: 0, occupied: r.roomsSold, transient: r.roomsSold, group: 0, walkIns: 0, noShows: 0, outOfOrder: 0 },
    revenue: {
      rooms: r.roomRevenue || 0,
      fb: { restaurant: r.fbRevenue || 0, banquet: 0, bar: 0 },
      other: { telephone: 0, parking: 0, spa: 0, misc: r.otherRevenue || 0 },
    },
    taxes: {
      occupancy: Math.round((r.roomRevenue || 0) * 0.115 * 100) / 100,
      sales: Math.round((r.totalRevenue || 0) * 0.0695 * 100) / 100,
      tourism: Math.round((r.roomRevenue || 0) * 0.015 * 100) / 100,
    },
    payments: {
      cash: Math.round((r.totalRevenue || 0) * 0.04 * 100) / 100,
      creditCard: Math.round((r.totalRevenue || 0) * 0.88 * 100) / 100,
      directBill: Math.round((r.totalRevenue || 0) * 0.07 * 100) / 100,
      other: Math.round((r.totalRevenue || 0) * 0.01 * 100) / 100,
    },
    adjustments: { comps: 0, rebates: 0, allowances: 0 },
    guests: { totalGuests: Math.round((r.roomsSold || 0) * 1.7), newCheckIns: 0, checkOuts: 0, stayovers: 0 },
  };
  return { ...r, breakdown };
}

const sumFb = (b) => (b?.revenue?.fb?.restaurant || 0) + (b?.revenue?.fb?.banquet || 0) + (b?.revenue?.fb?.bar || 0);
const sumOther = (b) => (b?.revenue?.other?.telephone || 0) + (b?.revenue?.other?.parking || 0) + (b?.revenue?.other?.spa || 0) + (b?.revenue?.other?.misc || 0);
const sumTax = (b) => (b?.taxes?.occupancy || 0) + (b?.taxes?.sales || 0) + (b?.taxes?.tourism || 0);

// Compute baseline averages for a property up to (but not including) date
function computeBaseline(reports, beforeDate, propertyId) {
  const before = new Date(beforeDate);
  const propReports = reports
    .filter(r => r.propertyId === propertyId && new Date(r.date) < before)
    .sort((a,b) => b.date.localeCompare(a.date));
  const last7 = propReports.slice(0, 7).map(enrichReport);
  const last30 = propReports.slice(0, 30).map(enrichReport);
  const sameDow = propReports.filter(r => new Date(r.date).getDay() === before.getDay()).slice(0, 4).map(enrichReport);
  const avg = (arr, fn) => arr.length ? arr.reduce((s, r) => s + (fn(r) || 0), 0) / arr.length : 0;
  return {
    last7: {
      revenue: avg(last7, r => r.totalRevenue),
      occupancy: avg(last7, r => r.occupancy),
      adr: avg(last7, r => r.adr),
      revpar: avg(last7, r => r.revpar),
    },
    last30: {
      revenue: avg(last30, r => r.totalRevenue),
      occupancy: avg(last30, r => r.occupancy),
      adr: avg(last30, r => r.adr),
      revpar: avg(last30, r => r.revpar),
    },
    sameDow: {
      revenue: avg(sameDow, r => r.totalRevenue),
      occupancy: avg(sameDow, r => r.occupancy),
      adr: avg(sameDow, r => r.adr),
      revpar: avg(sameDow, r => r.revpar),
    },
    yesterday: propReports[0] ? enrichReport(propReports[0]) : null,
  };
}

// Variance helpers
const variance = (actual, baseline) => {
  if (!baseline || baseline === 0) return null;
  return (actual - baseline) / baseline;
};
const fmtVar = (v) => {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${(v * 100).toFixed(1)}%`;
};
const varColor = (v, inverse = false) => {
  if (v === null || v === undefined || Math.abs(v) < 0.005) return "stone";
  const positive = inverse ? v < 0 : v > 0;
  return positive ? "emerald" : "rose";
};

// ============== AI EXTRACTION ==============
function buildExtractionPrompt(properties) {
  const propList = properties.map(p => `  - "${p.name}" (id ${p.id}, ${p.rooms} rooms, ${p.location})`).join("\n");
  return `You are a senior hotel accounting specialist trained on USALI (Uniform System of Accounts for the Lodging Industry) standards. Extract structured data from a night audit / daily flash report.

PROPERTIES IN THIS PORTFOLIO:
${propList}

Match the report to ONE property by name or context clues. Return its id (e.g. "p1").

OUTPUT REQUIREMENTS:
Return ONLY a single JSON object. No markdown fences, no preamble, no explanation. Use null for fields not present in the source. Numbers must be numeric (no currency symbols, no commas).

SCHEMA:
{
  "date": "YYYY-MM-DD",
  "propertyId": "p1" | "p2" | ...,
  "propertyName": "string (echo back what you matched)",
  "rooms": {
    "available": number,
    "outOfOrder": number,
    "sold": number,
    "comp": number,
    "occupied": number,
    "transient": number,
    "group": number,
    "walkIns": number,
    "noShows": number
  },
  "revenue": {
    "rooms": number,
    "fb": { "restaurant": number, "banquet": number, "bar": number },
    "other": { "telephone": number, "parking": number, "spa": number, "misc": number }
  },
  "taxes": { "occupancy": number, "sales": number, "tourism": number },
  "payments": { "cash": number, "creditCard": number, "directBill": number, "other": number },
  "adjustments": { "comps": number, "rebates": number, "allowances": number },
  "guests": { "totalGuests": number, "newCheckIns": number, "checkOuts": number, "stayovers": number },
  "confidence": number,
  "warnings": [ "string describing any ambiguity, calculated value, or assumption made" ],
  "insights": [
    "Plain-English observation about this day's performance (3-5 short, sharp insights with specific numbers when possible)"
  ]
}

EXTRACTION RULES:
- If ADR isn't given but room revenue and rooms sold are, you can compute it but flag in warnings.
- Map any "Food", "Restaurant", "Café" line to revenue.fb.restaurant. "Bar", "Lounge", "Beverage" to revenue.fb.bar. "Banquet", "Catering", "Events" to revenue.fb.banquet.
- Map "Telephone", "Parking", "Resort fee", "Internet", "Spa", "Gift shop" to the appropriate other.* bucket. Anything genuinely miscellaneous goes to other.misc.
- Confidence is 0.0–1.0 reflecting how certain you are about the extraction. Be honest: missing critical fields lower confidence.
- Generate 3-5 INSIGHTS — these are the magic. Comment on occupancy strength, ADR vs rev split, F&B capture rate, walk-ins, anything notable. Be specific and use numbers.

If the input is genuinely not a hotel audit report, set confidence to 0 and explain in warnings.`;
}

// Adaptive extraction — local parser first, optional Claude API enrichment.
// Implementation lives in src/lib/auditParser.js so it can be unit-tested
// and reused (e.g. from the command palette / batch ingest).
async function callExtractionAPI({ text, file, properties }) {
  // file may be { raw, name, size } from the upload zone
  return _extractAudit({ text, file, properties });
}
const fileToBase64 = _fileToBase64;

/* =========================================================================
   ACCOUNTING — TOP-LEVEL
   ========================================================================= */
function AccountingModule({ ctx }) {
  const [tab, setTab] = useState("flash");

  useEffect(() => {
    const off = _commandBus.subscribe((cmd) => {
      if (cmd === "ingest:open") setTab("ingest");
      else if (cmd === "flash:open") setTab("flash");
      else if (cmd === "portfolio:open") setTab("portfolio");
    });
    return off;
  }, []);

  return (
    <div className="accounting-bg min-h-full">
      <div className="px-8 pt-6 pb-2">
        <div className="flex items-center gap-1 border-b border-stone-200 -mb-px">
          {[
            { id: "flash", label: "Flash Report", icon: BarChart3 },
            { id: "ingest", label: "Smart Ingest", icon: Upload, badge: "AI" },
            { id: "budget", label: "Budget", icon: DollarSign },
            { id: "pnl", label: "P&L", icon: Receipt },
            { id: "ar", label: "A/R Aging", icon: Receipt },
            { id: "ap", label: "A/P", icon: Receipt },
            { id: "tax", label: "Tax Calendar", icon: Calendar },
            { id: "compset", label: "Compset", icon: TrendingUp },
            { id: "portfolio", label: "Portfolio", icon: Building2 },
            { id: "trends", label: "Trends", icon: TrendingUp },
            { id: "forecast", label: "Forecast", icon: TrendingUp },
            { id: "reconcile", label: "Reconcile", icon: FileCheck2 },
            { id: "reports", label: "Reports", icon: ClipboardList },
            { id: "departments", label: "Departments", icon: Hash },
            { id: "gl", label: "GL Mapping", icon: Hash },
          ].map(t => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-5 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 transition-all ${active ? "border-amber-700 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
                <Icon size={14} />{t.label}
                {t.badge && (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gradient-to-br from-amber-600 to-amber-800 text-white tracking-wider">
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "flash" && <FlashReportPane ctx={ctx} setTab={setTab} />}
      {tab === "ingest" && <IngestPane ctx={ctx} setTab={setTab} />}
      {tab === "budget" && <BudgetPane ctx={ctx} />}
      {tab === "pnl" && <PnlPane ctx={ctx} />}
      {tab === "ap" && <ApPane ctx={ctx} />}
      {tab === "ar" && <ArAgingPane ctx={ctx} />}
      {tab === "tax" && <TaxCalendarPane ctx={ctx} />}
      {tab === "compset" && <CompsetPane ctx={ctx} />}
      {tab === "portfolio" && <PortfolioPane ctx={ctx} setTab={setTab} />}
      {tab === "trends" && <TrendsPane ctx={ctx} />}
      {tab === "forecast" && <ForecastPane ctx={ctx} />}
      {tab === "reconcile" && <ReconcilePane ctx={ctx} setTab={setTab} />}
      {tab === "reports" && <CustomReportsPane ctx={ctx} />}
      {tab === "departments" && <DepartmentsPane ctx={ctx} />}
      {tab === "gl" && <GLMappingPane ctx={ctx} />}
    </div>
  );
}

/* =========================================================================
   FLASH REPORT PANE — the daily showcase
   ========================================================================= */
function FlashReportPane({ ctx, setTab }) {
  const { state, perms, activeProperty, accessibleProperties } = ctx;
  const propsAll = perms.properties === "all" ? accessibleProperties : accessibleProperties.filter(p => p.id === activeProperty);
  const [selectedDate, setSelectedDate] = useState(null);
  const [compareDate, setCompareDate] = useState(null);
  const [selectedPropId, setSelectedPropId] = useState(propsAll[0]?.id || activeProperty);

  // Reports for selected property, newest first
  const propReports = useMemo(() =>
    state.reports
      .filter(r => r.propertyId === selectedPropId)
      .map(enrichReport)
      .sort((a,b) => b.date.localeCompare(a.date)),
    [state.reports, selectedPropId]
  );

  const focusReport = useMemo(() => {
    if (!propReports.length) return null;
    if (selectedDate) return propReports.find(r => r.date === selectedDate) || propReports[0];
    return propReports[0]; // most recent
  }, [propReports, selectedDate]);

  const baseline = useMemo(() => {
    if (!focusReport) return null;
    return computeBaseline(state.reports, focusReport.date, focusReport.propertyId);
  }, [focusReport, state.reports]);

  const property = state.properties.find(p => p.id === selectedPropId);
  const reportMonth = focusReport ? focusReport.date.slice(0, 7) : null;
  const isLocked = !!state.closedPeriods?.find(c => c.propertyId === selectedPropId && c.month === reportMonth);

  if (!focusReport) {
    return (
      <div className="p-8">
        <Card className="p-12 text-center">
          <BarChart3 size={28} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-display text-xl text-stone-900">No reports yet for this property</h3>
          <p className="text-sm text-stone-500 mt-2 mb-4">Drop a night audit into Smart Ingest and we'll do the rest.</p>
          <Button variant="accent" onClick={() => setTab("ingest")}><Upload size={14} />Open Smart Ingest</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Closed-period banner */}
      {isLocked && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-lg border border-stone-300 bg-gradient-to-r from-stone-100 to-stone-50">
          <div className="w-7 h-7 rounded-full bg-stone-700 text-white flex items-center justify-center">
            <Shield size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-stone-900">Period {reportMonth} is closed</div>
            <div className="text-xs text-stone-600">Reports for this month are locked. Re-open from Reconcile → Month-End Close to make changes.</div>
          </div>
          <Badge color="stone">Locked</Badge>
        </div>
      )}

      {/* Header strip */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {propsAll.length > 1 && (
            <select value={selectedPropId} onChange={e => { setSelectedPropId(e.target.value); setSelectedDate(null); setCompareDate(null); }}
              className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium">
              {propsAll.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={focusReport.date} onChange={e => setSelectedDate(e.target.value)}
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white tabular">
            {propReports.slice(0, 60).map(r => {
              const mark = r.ingestion ? "✨ " : "";
              return <option key={r.date} value={r.date}>{mark}{fmtDate(r.date)} · {fmtDayName(r.date)}</option>;
            })}
          </select>
          <span className="text-stone-300">·</span>
          <span className="text-xs text-stone-500">vs</span>
          <select value={compareDate || ""} onChange={e => setCompareDate(e.target.value || null)}
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white tabular">
            <option value="">— select to compare —</option>
            {propReports.filter(r => r.date !== focusReport.date).slice(0, 60).map(r => {
              const mark = r.ingestion ? "✨ " : "";
              return <option key={r.date} value={r.date}>{mark}{fmtDate(r.date)} · {fmtDayName(r.date)}</option>;
            })}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportFlashJson(focusReport, property)}><Download size={13} />JSON</Button>
          <Button variant="secondary" size="sm" onClick={() => exportFlashCsv(focusReport, property)}><Download size={13} />CSV</Button>
          <Button variant="accent" size="sm" onClick={() => setTab("ingest")}><Upload size={13} />Ingest New</Button>
        </div>
      </div>

      {/* Diff view (when a compare date is selected) */}
      {compareDate && propReports.find(r => r.date === compareDate) && (
        <FlashCompare a={focusReport} b={propReports.find(r => r.date === compareDate)} property={property} onClear={() => setCompareDate(null)} />
      )}

      {/* HERO BLOCK — the moneymaker */}
      <FlashHero report={focusReport} baseline={baseline} property={property} />

      {/* Variance metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <VarianceMetric label="Occupancy" actual={fmtPct(focusReport.occupancy)} baseline={baseline?.last30.occupancy} actualNum={focusReport.occupancy} sub="vs 30-day avg" />
        <VarianceMetric label="ADR" actual={fmtMoney(focusReport.adr)} baseline={baseline?.last30.adr} actualNum={focusReport.adr} sub="vs 30-day avg" />
        <VarianceMetric label="RevPAR" actual={fmtMoney(focusReport.revpar)} baseline={baseline?.last30.revpar} actualNum={focusReport.revpar} sub="vs 30-day avg" />
        <VarianceMetric label="Same-day-of-week" actual={fmtMoney(focusReport.totalRevenue)} baseline={baseline?.sameDow.revenue} actualNum={focusReport.totalRevenue} sub={`vs avg ${fmtDayName(focusReport.date)}`} />
      </div>

      {/* STAR-style indices */}
      {baseline?.last30 && (
        <div className="grid grid-cols-3 gap-4">
          <IndexTile label="Occ Index" value={baseline.last30.occupancy ? (focusReport.occupancy / baseline.last30.occupancy) * 100 : null} hint="100 = property's own 30-day average" />
          <IndexTile label="ADR Index" value={baseline.last30.adr ? (focusReport.adr / baseline.last30.adr) * 100 : null} hint="100 = property's own 30-day average" />
          <IndexTile label="RevPAR Index" value={baseline.last30.revpar ? (focusReport.revpar / baseline.last30.revpar) * 100 : null} hint="100 = property's own 30-day average" highlight />
        </div>
      )}

      {/* Revenue composition */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DepartmentTile
          title="Rooms"
          icon={BedDouble}
          color="amber"
          value={focusReport.breakdown.revenue.rooms}
          total={focusReport.totalRevenue}
          sub={`${focusReport.breakdown.rooms.sold} of ${focusReport.breakdown.rooms.available} rooms · ADR ${fmtMoney(focusReport.adr)}`}
          extra={[
            ["Transient", focusReport.breakdown.rooms.transient],
            ["Group", focusReport.breakdown.rooms.group],
            ["Comp", focusReport.breakdown.rooms.comp],
            ["Out of Order", focusReport.breakdown.rooms.outOfOrder],
          ]}
        />
        <DepartmentTile
          title="Food &amp; Beverage"
          icon={Coffee}
          color="violet"
          value={sumFb(focusReport.breakdown)}
          total={focusReport.totalRevenue}
          sub={`Capture rate ${focusReport.breakdown.rooms.sold > 0 ? fmtPct(sumFb(focusReport.breakdown) / focusReport.breakdown.revenue.rooms) : "—"}`}
          extra={[
            ["Restaurant", focusReport.breakdown.revenue.fb.restaurant],
            ["Bar / Lounge", focusReport.breakdown.revenue.fb.bar],
            ["Banquet", focusReport.breakdown.revenue.fb.banquet],
          ]}
          isMoney
        />
        <DepartmentTile
          title="Other"
          icon={Hash}
          color="sky"
          value={sumOther(focusReport.breakdown)}
          total={focusReport.totalRevenue}
          sub="Telephone, parking, spa, sundry"
          extra={[
            ["Parking", focusReport.breakdown.revenue.other.parking],
            ["Spa", focusReport.breakdown.revenue.other.spa],
            ["Telephone", focusReport.breakdown.revenue.other.telephone],
            ["Misc", focusReport.breakdown.revenue.other.misc],
          ]}
          isMoney
        />
      </div>

      {/* Two-column: insights + tax/payment summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <InsightsPanel report={focusReport} baseline={baseline} property={property} />
        </div>
        <TaxPaymentSummary report={focusReport} />
      </div>

      {/* Comments thread */}
      <FlashComments report={focusReport} ctx={ctx} locked={isLocked} />

      {/* Audit trail */}
      <AuditTrailFooter report={focusReport} ctx={ctx} />
    </div>
  );
}

/* ============== FLASH COMPARE — side-by-side diff of two flash days ============== */
function FlashCompare({ a, b, property, onClear }) {
  const rows = [
    ["Total Revenue", a.totalRevenue, b.totalRevenue, true, false],
    ["Room Revenue", a.breakdown.revenue.rooms, b.breakdown.revenue.rooms, true, false],
    ["F&B Revenue", sumFb(a.breakdown), sumFb(b.breakdown), true, false],
    ["Other Revenue", sumOther(a.breakdown), sumOther(b.breakdown), true, false],
    ["Rooms Sold", a.breakdown.rooms.sold, b.breakdown.rooms.sold, false, false],
    ["Occupancy", a.occupancy * 100, b.occupancy * 100, false, true],
    ["ADR", a.adr, b.adr, true, false],
    ["RevPAR", a.revpar, b.revpar, true, false],
    ["OOO Rooms", a.breakdown.rooms.outOfOrder || 0, b.breakdown.rooms.outOfOrder || 0, false, false, true],
    ["Walk-ins", a.breakdown.rooms.walkIns || 0, b.breakdown.rooms.walkIns || 0, false, false],
    ["No-shows", a.breakdown.rooms.noShows || 0, b.breakdown.rooms.noShows || 0, false, false, true],
    ["Occupancy Tax", a.breakdown.taxes.occupancy || 0, b.breakdown.taxes.occupancy || 0, true, false],
    ["Sales Tax", a.breakdown.taxes.sales || 0, b.breakdown.taxes.sales || 0, true, false],
  ];
  return (
    <Card className="overflow-hidden anim-fade-up">
      <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-gradient-to-r from-stone-50 to-white">
        <div>
          <div className="text-xs uppercase tracking-widest text-amber-700 font-bold">Diff View</div>
          <div className="text-sm text-stone-700 mt-1">
            Comparing <strong className="font-semibold">{fmtDate(a.date)}</strong> ({fmtDayName(a.date)})
            {" · "}vs{" · "}
            <strong className="font-semibold">{fmtDate(b.date)}</strong> ({fmtDayName(b.date)})
            {" · "}{property?.name}
          </div>
        </div>
        <button onClick={onClear} className="text-stone-500 hover:text-stone-900 p-1.5 rounded hover:bg-stone-100">
          <X size={16} />
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left px-6 py-3 font-medium">Metric</th>
            <th className="text-right px-6 py-3 font-medium">{fmtDateShort(a.date)}</th>
            <th className="text-right px-6 py-3 font-medium">{fmtDateShort(b.date)}</th>
            <th className="text-right px-6 py-3 font-medium">Δ Absolute</th>
            <th className="text-right px-6 py-3 font-medium">Δ Percent</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map(([label, av, bv, isMoney, isPct, inverse]) => {
            const diff = (av || 0) - (bv || 0);
            const pct = bv ? diff / bv : null;
            const positive = inverse ? diff < 0 : diff > 0;
            const dirColor = Math.abs(diff) < 0.01 ? "text-stone-500" : positive ? "text-emerald-700" : "text-rose-700";
            const fmt = (v) => isMoney ? fmtMoney(v) : isPct ? `${v.toFixed(1)}%` : v;
            return (
              <tr key={label} className="hover:bg-stone-50">
                <td className="px-6 py-2.5 text-stone-700">{label}</td>
                <td className="px-6 py-2.5 text-right tabular font-medium">{fmt(av)}</td>
                <td className="px-6 py-2.5 text-right tabular text-stone-500">{fmt(bv)}</td>
                <td className={`px-6 py-2.5 text-right tabular font-semibold ${dirColor}`}>
                  {Math.abs(diff) < 0.01 ? "—" : `${diff > 0 ? "+" : ""}${fmt(diff)}`}
                </td>
                <td className={`px-6 py-2.5 text-right tabular font-semibold ${dirColor}`}>
                  {pct === null || isNaN(pct) ? "—" : `${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/* Animated count-up for hero numbers — eases to the target value over ~900ms. */
function useCountUp(target, duration = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target == null || isNaN(target)) { setV(0); return; }
    let raf;
    const start = performance.now();
    const from = 0;
    const to = target;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / duration);
      // easeOutCubic
      const e = 1 - Math.pow(1 - k, 3);
      setV(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

/* ============== FLASH HERO — bold, dramatic, premium ============== */
function FlashHero({ report, baseline, property }) {
  const totalVar = variance(report.totalRevenue, baseline?.yesterday?.totalRevenue);
  const isWeekend = [5,6].includes(new Date(report.date).getDay());
  const heroVal = useCountUp(report.totalRevenue);

  return (
    <div className="relative overflow-hidden rounded-2xl hero-glow grain anim-fade-up"
      style={{ background: "linear-gradient(135deg, #1c1917 0%, #292524 50%, #44403c 100%)" }}>
      <div className="relative z-10 px-8 py-10 md:px-12 md:py-14">
        <div className="flex items-start justify-between flex-wrap gap-6">
          <div>
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="text-amber-500 text-xs uppercase tracking-[0.25em] font-semibold">Daily Flash · {property?.name}</span>
              {isWeekend && <Badge color="violet">Weekend</Badge>}
            </div>
            <h2 className="font-display text-stone-300 text-2xl mb-1">{fmtDayName(report.date)}, {fmtDate(report.date)}</h2>
            <div className="flex items-baseline gap-4 flex-wrap mt-4">
              <div>
                <div className="text-amber-500 text-[11px] uppercase tracking-widest mb-2 font-semibold">Total Revenue</div>
                <div className="font-display number-display text-white text-7xl md:text-8xl font-semibold leading-none anim-count">
                  {fmtMoney(heroVal).replace(".00","")}
                </div>
              </div>
              {totalVar !== null && (
                <div className={`mb-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${
                  totalVar >= 0 ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                }`}>
                  {totalVar >= 0 ? "↑" : "↓"} {fmtVar(totalVar)} <span className="text-stone-400 font-normal">vs prior day</span>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 anim-fade-up delay-200">
            <HeroStat label="Occupancy" value={fmtPct(report.occupancy)} sub={`${report.breakdown.rooms.sold}/${report.breakdown.rooms.available}`} />
            <HeroStat label="ADR" value={fmtMoney(report.adr)} sub="avg daily rate" />
            <HeroStat label="RevPAR" value={fmtMoney(report.revpar)} sub="rev per room" />
          </div>
        </div>
        {report.ingestion && (
          <div className="mt-8 pt-6 border-t border-stone-800/60 flex items-center gap-3 text-xs text-stone-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pulse-soft" />
              {report.ingestion.source === "ai_paste" ? "AI-extracted from text" : report.ingestion.source === "ai_upload" ? `AI-extracted from ${report.ingestion.fileName || "document"}` : "Manually entered"}
            </span>
            {report.ingestion.confidence !== undefined && (
              <span>· {(report.ingestion.confidence * 100).toFixed(0)}% confidence</span>
            )}
            {report.ingestion.ingestedAt && <span>· ingested {fmtDate(report.ingestion.ingestedAt)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function HeroStat({ label, value, sub }) {
  return (
    <div>
      <div className="text-amber-500/80 text-[10px] uppercase tracking-widest mb-1.5 font-semibold">{label}</div>
      <div className="font-display number-display text-white text-3xl md:text-4xl font-medium leading-tight">{value}</div>
      <div className="text-stone-400 text-xs mt-1">{sub}</div>
    </div>
  );
}

/* ============== STAR-style INDEX TILE ============== */
function IndexTile({ label, value, hint, highlight }) {
  if (value == null || isNaN(value)) {
    return (
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">{label}</div>
        <div className="font-display text-3xl text-stone-300">—</div>
        <div className="text-xs text-stone-400 mt-1">Not enough history</div>
      </Card>
    );
  }
  const v = Number(value);
  const tone = v >= 105 ? "emerald" : v >= 95 ? "stone" : "rose";
  const colors = {
    emerald: { text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500" },
    stone: { text: "text-stone-700", bg: "bg-stone-50", dot: "bg-stone-400" },
    rose: { text: "text-rose-700", bg: "bg-rose-50", dot: "bg-rose-500" },
  }[tone];
  return (
    <Card className={`p-5 ${highlight ? colors.bg : ""} anim-fade-up`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">{label}</div>
        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
      </div>
      <div className={`font-display number-display text-4xl font-semibold ${colors.text}`}>{v.toFixed(1)}</div>
      <div className="mt-2 h-1 rounded-full bg-stone-100 overflow-hidden relative">
        <div className={`h-full ${tone === "emerald" ? "bg-emerald-500" : tone === "rose" ? "bg-rose-500" : "bg-stone-500"}`} style={{ width: `${Math.min(100, v / 1.5)}%` }} />
        <div className="absolute inset-y-0 w-px bg-stone-700" style={{ left: "66.6%" }} title="100 = baseline" />
      </div>
      <div className="text-xs text-stone-500 mt-1.5">{hint}</div>
    </Card>
  );
}

/* ============== VARIANCE METRIC TILE ============== */
function VarianceMetric({ label, actual, baseline, actualNum, sub }) {
  const v = variance(actualNum, baseline);
  const color = varColor(v);
  const colors = {
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
    rose: "text-rose-700 bg-rose-50 border-rose-200",
    stone: "text-stone-600 bg-stone-50 border-stone-200",
  };
  return (
    <Card className="p-5 anim-fade-up">
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">{label}</div>
      <div className="flex items-baseline gap-3 mb-2">
        <span className="font-display number-display text-3xl text-stone-900 font-semibold">{actual}</span>
        {v !== null && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${colors[color]}`}>
            {v >= 0 ? "↑" : "↓"} {fmtVar(v)}
          </span>
        )}
      </div>
      <div className="text-xs text-stone-500">{sub}</div>
    </Card>
  );
}

/* ============== DEPARTMENT TILE ============== */
function DepartmentTile({ title, icon: Icon, color, value, total, sub, extra = [], isMoney }) {
  const pct = total > 0 ? value / total : 0;
  const colors = {
    amber: { bar: "bg-amber-600", border: "border-amber-200", icon: "text-amber-700 bg-amber-50" },
    violet: { bar: "bg-violet-600", border: "border-violet-200", icon: "text-violet-700 bg-violet-50" },
    sky: { bar: "bg-sky-600", border: "border-sky-200", icon: "text-sky-700 bg-sky-50" },
  };
  const c = colors[color];
  return (
    <Card className={`p-6 anim-fade-up ${c.border}`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-lg ${c.icon} flex items-center justify-center`}>
          <Icon size={18} />
        </div>
        <span className="text-xs text-stone-500 font-medium tabular">{fmtPct(pct)} of total</span>
      </div>
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1">{title}</div>
      <div className="font-display number-display text-3xl text-stone-900 font-semibold mb-1">{fmtMoney(value)}</div>
      <div className="text-xs text-stone-500 mb-4">{sub}</div>
      {/* Composition bar */}
      <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden mb-4">
        <div className={`h-full ${c.bar} rounded-full transition-all`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <dl className="space-y-1.5 text-xs">
        {extra.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-stone-500">{k}</dt>
            <dd className="tabular text-stone-900 font-medium">{isMoney ? fmtMoney(v) : v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* ============== INSIGHTS PANEL ============== */
function InsightsPanel({ report, baseline, property }) {
  const aiInsights = report.ingestion?.insights || [];

  // Auto-generated observations from local data
  const computed = useMemo(() => {
    const out = [];
    if (baseline?.last30?.occupancy) {
      const v = variance(report.occupancy, baseline.last30.occupancy);
      if (v !== null && Math.abs(v) > 0.05) {
        out.push({
          tone: v > 0 ? "positive" : "warning",
          icon: v > 0 ? TrendingUp : AlertCircle,
          title: `Occupancy ${v > 0 ? "above" : "below"} 30-day average`,
          body: `Sold ${report.breakdown.rooms.sold} of ${report.breakdown.rooms.available} rooms — ${fmtPct(report.occupancy)}, a ${fmtVar(v)} variance from the 30-day baseline of ${fmtPct(baseline.last30.occupancy)}.`,
        });
      }
    }
    if (baseline?.last30?.adr) {
      const v = variance(report.adr, baseline.last30.adr);
      if (v !== null && Math.abs(v) > 0.04) {
        out.push({
          tone: v > 0 ? "positive" : "neutral",
          icon: DollarSign,
          title: `ADR ${v > 0 ? "premium" : "compression"} of ${fmtVar(v)}`,
          body: `${fmtMoney(report.adr)} achieved against a 30-day mix average of ${fmtMoney(baseline.last30.adr)}. ${v > 0 ? "Pricing power is holding." : "Watch for rate erosion patterns."}`,
        });
      }
    }
    const fbCapture = report.breakdown.revenue.rooms > 0 ? sumFb(report.breakdown) / report.breakdown.revenue.rooms : 0;
    if (sumFb(report.breakdown) > 0 && fbCapture < 0.18 && property?.type === "Full Service") {
      out.push({
        tone: "warning",
        icon: AlertCircle,
        title: "F&B capture rate below benchmark",
        body: `${fmtPct(fbCapture)} F&B-to-rooms capture is under the 25–35% range typical for full-service properties. Worth a conversation with the F&B team.`,
      });
    }
    if (report.breakdown.rooms.outOfOrder > 0) {
      out.push({
        tone: "neutral",
        icon: AlertCircle,
        title: `${report.breakdown.rooms.outOfOrder} rooms out of order`,
        body: `That's ${fmtMoney(report.breakdown.rooms.outOfOrder * report.adr)} of theoretical revenue parked. Confirm engineering tickets are open.`,
      });
    }
    return out;
  }, [report, baseline, property]);

  return (
    <Card className="p-6 h-full">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-600 to-amber-800 text-white flex items-center justify-center">
          <span className="text-xs font-bold">AI</span>
        </div>
        <div>
          <h3 className="font-display text-lg text-stone-900 leading-tight">Smart Insights</h3>
          <p className="text-xs text-stone-500">Auto-generated commentary on this period's performance</p>
        </div>
      </div>

      {aiInsights.length === 0 && computed.length === 0 ? (
        <div className="text-center py-8 text-sm text-stone-500">No notable variances detected for this period.</div>
      ) : (
        <div className="space-y-3">
          {aiInsights.map((insight, i) => (
            <InsightCard key={`ai-${i}`} tone="positive" icon={TrendingUp} body={insight} fromAI />
          ))}
          {computed.map((c, i) => (
            <InsightCard key={`c-${i}`} tone={c.tone} icon={c.icon} title={c.title} body={c.body} />
          ))}
        </div>
      )}
    </Card>
  );
}

function InsightCard({ tone = "neutral", icon: Icon = AlertCircle, title, body, fromAI }) {
  const tones = {
    positive: { bg: "bg-emerald-50/60", border: "border-emerald-200", icon: "text-emerald-700 bg-emerald-100", title: "text-emerald-900" },
    warning: { bg: "bg-amber-50/60", border: "border-amber-200", icon: "text-amber-700 bg-amber-100", title: "text-amber-900" },
    neutral: { bg: "bg-stone-50", border: "border-stone-200", icon: "text-stone-600 bg-stone-100", title: "text-stone-900" },
  };
  const t = tones[tone];
  return (
    <div className={`flex gap-3 p-3 rounded-lg border ${t.bg} ${t.border} anim-fade-up`}>
      <div className={`w-7 h-7 rounded ${t.icon} flex items-center justify-center flex-shrink-0`}>
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        {title && <div className={`text-sm font-semibold ${t.title} leading-snug`}>{title}</div>}
        <div className="text-sm text-stone-700 leading-snug mt-0.5">{body}</div>
        {fromAI && <div className="text-[10px] text-stone-400 uppercase tracking-wider mt-1.5 font-semibold">AI commentary</div>}
      </div>
    </div>
  );
}

/* ============== TAX & PAYMENT SUMMARY ============== */
function TaxPaymentSummary({ report }) {
  const taxes = report.breakdown.taxes;
  const pmts = report.breakdown.payments;
  const totalTax = sumTax(report.breakdown);
  const totalPmt = pmts.cash + pmts.creditCard + pmts.directBill + pmts.other;

  return (
    <Card className="p-6 h-full">
      <h3 className="font-display text-lg text-stone-900 mb-5">Tax &amp; Settlement</h3>

      <div className="mb-5">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Tax Liability</div>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-stone-600">Occupancy</dt><dd className="tabular font-medium">{fmtMoney(taxes.occupancy)}</dd></div>
          <div className="flex justify-between"><dt className="text-stone-600">Sales</dt><dd className="tabular font-medium">{fmtMoney(taxes.sales)}</dd></div>
          <div className="flex justify-between"><dt className="text-stone-600">Tourism</dt><dd className="tabular font-medium">{fmtMoney(taxes.tourism)}</dd></div>
          <div className="flex justify-between pt-1.5 border-t border-stone-200">
            <dt className="font-semibold text-stone-900">Total</dt>
            <dd className="tabular font-bold">{fmtMoney(totalTax)}</dd>
          </div>
        </dl>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Settlement Mix</div>
        <div className="space-y-2">
          {[
            ["Credit Card", pmts.creditCard, "bg-amber-600"],
            ["Cash", pmts.cash, "bg-emerald-600"],
            ["Direct Bill", pmts.directBill, "bg-sky-600"],
            ["Other", pmts.other, "bg-stone-500"],
          ].map(([label, val, color]) => {
            const pct = totalPmt > 0 ? val / totalPmt : 0;
            return (
              <div key={label}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-xs text-stone-600">{label}</span>
                  <span className="text-xs tabular font-medium">{fmtMoney(val)} <span className="text-stone-400">· {fmtPct(pct)}</span></span>
                </div>
                <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                  <div className={`h-full ${color}`} style={{ width: `${pct*100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function FlashComments({ report, ctx, locked }) {
  const { state, update, currentUser, toast } = ctx;
  const [text, setText] = useState("");
  const [mentionState, setMentionState] = useState(null); // { query, position }
  const taRef = useRef(null);
  const comments = (report.comments || []).slice().sort((a, b) => a.at.localeCompare(b.at));
  const empById = Object.fromEntries(state.employees.map(e => [e.id, e]));

  // Detect "@..." while typing
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart;
    const before = v.slice(0, caret);
    const m = before.match(/@(\w*)$/);
    if (m) setMentionState({ query: m[1].toLowerCase(), caret, len: m[0].length });
    else setMentionState(null);
  };

  const insertMention = (emp) => {
    if (!mentionState) return;
    const before = text.slice(0, mentionState.caret - mentionState.len);
    const after = text.slice(mentionState.caret);
    const inserted = `@${emp.firstName}${emp.lastName[0]} `;
    setText(before + inserted + after);
    setMentionState(null);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const matchedMentions = mentionState
    ? state.employees
        .filter(e => e.id !== currentUser.id && e.status === "active")
        .filter(e => fullName(e).toLowerCase().includes(mentionState.query))
        .slice(0, 5)
    : [];

  // Extract @-mentions out of the body to record them on the comment
  const extractMentions = (body) => {
    const out = new Set();
    const re = /@(\w+)/g;
    let m;
    while ((m = re.exec(body))) {
      const tag = m[1].toLowerCase();
      const match = state.employees.find(e =>
        `${e.firstName}${e.lastName[0]}`.toLowerCase() === tag
        || e.firstName.toLowerCase() === tag
      );
      if (match) out.add(match.id);
    }
    return [...out];
  };

  const post = () => {
    if (!text.trim()) return;
    const mentions = extractMentions(text);
    const next = [...comments, {
      id: newId("c"), at: new Date().toISOString(), by: currentUser.id, text: text.trim(), mentions,
    }];
    const updated = state.reports.map(r => r.id === report.id ? { ...r, comments: next } : r);
    update({ reports: updated });
    if (mentions.length > 0) {
      toast?.push(`Mentioned ${mentions.length} ${mentions.length === 1 ? "person" : "people"}`, { tone: "info" });
    }
    setText("");
  };

  // Render mention tokens highlighted
  const renderBody = (body) => {
    const parts = [];
    let last = 0;
    const re = /@(\w+)/g;
    let m;
    while ((m = re.exec(body))) {
      if (m.index > last) parts.push(body.slice(last, m.index));
      const tag = m[1].toLowerCase();
      const match = state.employees.find(e =>
        `${e.firstName}${e.lastName[0]}`.toLowerCase() === tag
        || e.firstName.toLowerCase() === tag
      );
      parts.push(
        match
          ? <span key={m.index} className="bg-amber-100 text-amber-900 rounded px-1 font-medium">@{match.firstName} {match.lastName}</span>
          : <span key={m.index} className="text-stone-500">@{m[1]}</span>
      );
      last = m.index + m[0].length;
    }
    if (last < body.length) parts.push(body.slice(last));
    return parts;
  };

  return (
    <Card>
      <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
        <h3 className="font-display text-lg text-stone-900">Comments &amp; sign-off</h3>
        <span className="text-xs text-stone-500">{comments.length} {comments.length === 1 ? "note" : "notes"}</span>
      </div>
      <div className="px-6 py-4 space-y-4">
        {comments.length === 0 && <p className="text-sm text-stone-400 italic">No comments yet — leave the first note for the GM or regional team.</p>}
        {comments.map(c => {
          const who = empById[c.by];
          const mentioned = (c.mentions || []).map(id => empById[id]).filter(Boolean);
          return (
            <div key={c.id} className="flex gap-3">
              {who ? <Avatar employee={who} size={32} /> : <div className="w-8 h-8 rounded-full bg-stone-200" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-stone-900">{who ? fullName(who) : "Unknown"}</span>
                  <span className="text-xs text-stone-400 tabular">{new Date(c.at).toLocaleString()}</span>
                  {mentioned.length > 0 && (
                    <span className="text-[10px] text-stone-400">— mentioned {mentioned.map(m => m.firstName).join(", ")}</span>
                  )}
                </div>
                <p className="text-sm text-stone-700 mt-0.5 whitespace-pre-wrap">{renderBody(c.text)}</p>
              </div>
            </div>
          );
        })}
        {!locked && (
          <div className="flex gap-3 items-start pt-2">
            <Avatar employee={currentUser} size={32} />
            <div className="flex-1 relative">
              <textarea
                ref={taRef}
                value={text} onChange={onChange}
                placeholder="Add a note — adjustment, follow-up, sign-off… type @ to mention someone"
                rows={2}
                onKeyDown={(e) => {
                  if (mentionState && matchedMentions.length > 0) {
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(matchedMentions[0]); return; }
                    if (e.key === "Escape") { setMentionState(null); return; }
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") post();
                }}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700 resize-y"
              />
              {/* Mention autocomplete */}
              {mentionState && matchedMentions.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-white border border-stone-200 rounded-md shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto">
                  {matchedMentions.map((emp, i) => (
                    <button key={emp.id} onClick={() => insertMention(emp)}
                      className={`w-full px-3 py-2 flex items-center gap-2 text-left ${i === 0 ? "bg-amber-50" : "hover:bg-stone-50"}`}>
                      <Avatar employee={emp} size={24} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-stone-900">{fullName(emp)}</div>
                        <div className="text-[10px] text-stone-500">{emp.title}</div>
                      </div>
                      <span className="text-[10px] text-stone-400 font-mono">@{emp.firstName}{emp.lastName[0]}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-stone-400">⌘↵ to post · @ to mention</span>
                <Button variant="primary" size="sm" disabled={!text.trim()} onClick={post}>Post comment</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function AuditTrailFooter({ report, ctx }) {
  const { state } = ctx;
  const ingestor = report.ingestion?.ingestedBy ? state.employees.find(e => e.id === report.ingestion.ingestedBy) : null;
  return (
    <Card className="px-6 py-4 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3 text-xs text-stone-600">
        <FileCheck2 size={14} className="text-stone-400" />
        <span>
          Source:{" "}
          <strong className="text-stone-900">
            {report.ingestion?.source === "ai_paste" ? "AI text extraction" :
             report.ingestion?.source === "ai_upload" ? `AI document extraction (${report.ingestion.fileName || "file"})` :
             "Manual entry"}
          </strong>
        </span>
        {ingestor && <span>· by {fullName(ingestor)}</span>}
        {report.ingestion?.ingestedAt && <span>· {new Date(report.ingestion.ingestedAt).toLocaleString()}</span>}
      </div>
      <Badge color={report.status === "posted" ? "emerald" : "amber"}>
        {report.status === "posted" ? "Posted to GL" : "Draft"}
      </Badge>
    </Card>
  );
}

/* =========================================================================
   INGEST PANE — the AI-powered audit ingest experience
   ========================================================================= */
function IngestPane({ ctx, setTab }) {
  const { state, update, currentUser, perms, accessibleProperties, toast } = ctx;
  const [mode, setMode] = useState("paste"); // paste | upload
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | processing | review | batchReview | error
  const [extracted, setExtracted] = useState(null);
  const [batch, setBatch] = useState(null); // array of extracted reports
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const fileInput = useRef(null);

  // Detect batch input live so we can show the user a chip
  const batchPreview = useMemo(() => {
    if (mode !== "paste" || text.trim().length < 30) return null;
    const chunks = _splitAuditBatch(text);
    return chunks.length > 1 ? chunks.length : null;
  }, [text, mode]);

  const recentIngests = state.reports
    .filter(r => r.ingestion && (perms.properties === "all" || currentUser.propertyAccess.includes(r.propertyId)))
    .sort((a,b) => (b.ingestion?.ingestedAt || "").localeCompare(a.ingestion?.ingestedAt || ""))
    .slice(0, 5);

  const startExtraction = async () => {
    setPhase("processing");
    setError(null);
    setProgress(0);

    // Animate progress bar — vibe only, real call is below
    const tick = setInterval(() => setProgress(p => Math.min(p + Math.random() * 12, 92)), 300);

    try {
      // BATCH branch — only for paste mode where we can split locally
      if (mode === "paste" && batchPreview && batchPreview > 1) {
        const results = _parseAuditBatch(text, accessibleProperties);
        clearInterval(tick);
        setProgress(100);
        setTimeout(() => {
          setBatch(results.map(r => ({ ...r, _include: true, _mode: "paste" })));
          setPhase("batchReview");
        }, 350);
        return;
      }

      let fileData = null;
      if (mode === "upload" && file) {
        // pass raw + base64 — parser uses raw (for text files), Claude uses base64
        const base64 = await fileToBase64(file.raw);
        fileData = { raw: file.raw, base64, mediaType: file.raw.type, name: file.name };
      }
      const result = await callExtractionAPI({
        text: mode === "paste" ? text : "",
        file: fileData,
        properties: accessibleProperties,
      });
      clearInterval(tick);
      setProgress(100);
      // Brief pause for the satisfying snap to 100%
      setTimeout(() => {
        setExtracted({ ...result, _rawText: text, _fileName: fileData?.name, _mode: mode });
        setPhase("review");
      }, 350);
    } catch (e) {
      clearInterval(tick);
      setError(e.message || "Extraction failed");
      setPhase("error");
    }
  };

  const postBatch = () => {
    if (!batch || !batch.length) return;
    const toPost = batch.filter(b => b._include && b.propertyId && b.date);
    const newReports = toPost.map(extracted => {
      const property = accessibleProperties.find(p => p.id === extracted.propertyId);
      const breakdown = {
        rooms: extracted.rooms || {},
        revenue: extracted.revenue || {},
        taxes: extracted.taxes || {},
        payments: extracted.payments || {},
        adjustments: extracted.adjustments || {},
        guests: extracted.guests || {},
        segments: extracted.segments || {},
        channels: extracted.channels || {},
      };
      const roomRev = breakdown.revenue.rooms || 0;
      const fb = sumFb(breakdown);
      const other = sumOther(breakdown);
      const total = roomRev + fb + other;
      const sold = breakdown.rooms.sold || 0;
      const avail = breakdown.rooms.available || (property?.rooms ?? 0);
      return {
        id: newId("r"),
        date: extracted.date,
        propertyId: extracted.propertyId,
        roomsSold: sold,
        roomsAvailable: avail,
        occupancy: avail ? sold / avail : 0,
        adr: sold ? roomRev / sold : 0,
        revpar: avail ? roomRev / avail : 0,
        roomRevenue: roomRev,
        fbRevenue: fb,
        otherRevenue: other,
        totalRevenue: total,
        notes: "",
        breakdown,
        status: "posted",
        ingestion: {
          source: "ai_batch",
          confidence: extracted.confidence ?? 0.9,
          warnings: extracted.warnings || [],
          insights: extracted.insights || [],
          ingestedAt: new Date().toISOString(),
          ingestedBy: currentUser.id,
        },
      };
    });
    update({ reports: [...state.reports, ...newReports] });
    newReports.forEach(nr => pushActivity(ctx, "report.post", { reportId: nr.id, propertyId: nr.propertyId, date: nr.date, total: nr.totalRevenue, batch: true }));
    reset();
    setTab("flash");
    toast?.push(`Posted ${newReports.length} reports in batch`, { tone: "success" });
  };

  const reset = () => {
    setText(""); setFile(null); setExtracted(null); setBatch(null); setError(null); setPhase("idle"); setProgress(0);
  };

  const postReport = () => {
    if (!extracted || !extracted.propertyId) return;
    const property = accessibleProperties.find(p => p.id === extracted.propertyId);
    if (!property) return;
    const breakdown = {
      rooms: extracted.rooms || {},
      revenue: extracted.revenue || {},
      taxes: extracted.taxes || {},
      payments: extracted.payments || {},
      adjustments: extracted.adjustments || {},
      guests: extracted.guests || {},
      segments: extracted.segments || {},
      channels: extracted.channels || {},
    };
    const roomRev = breakdown.revenue.rooms || 0;
    const fb = sumFb(breakdown);
    const other = sumOther(breakdown);
    const total = roomRev + fb + other;
    const sold = breakdown.rooms.sold || 0;
    const avail = breakdown.rooms.available || property.rooms;
    const newReport = {
      id: newId("r"),
      date: extracted.date,
      propertyId: extracted.propertyId,
      roomsSold: sold,
      roomsAvailable: avail,
      occupancy: avail ? sold / avail : 0,
      adr: sold ? roomRev / sold : 0,
      revpar: avail ? roomRev / avail : 0,
      roomRevenue: roomRev,
      fbRevenue: fb,
      otherRevenue: other,
      totalRevenue: total,
      notes: "",
      breakdown,
      status: "posted",
      ingestion: {
        source: extracted._mode === "upload" ? "ai_upload" : "ai_paste",
        rawText: extracted._mode === "paste" ? extracted._rawText : null,
        fileName: extracted._fileName || null,
        confidence: extracted.confidence ?? 0.9,
        warnings: extracted.warnings || [],
        insights: extracted.insights || [],
        ingestedAt: new Date().toISOString(),
        ingestedBy: currentUser.id,
      },
    };
    update({ reports: [...state.reports, newReport] });
    pushActivity(ctx, "report.post", { reportId: newReport.id, propertyId: extracted.propertyId, date: extracted.date, total });
    reset();
    setTab("flash");
    toast?.push(`Posted ${property.name} flash for ${fmtDate(extracted.date)} · ${fmtMoney(total)}`, { tone: "success" });
  };

  // ==== UI ====
  if (phase === "processing") {
    return <IngestProcessing progress={progress} mode={mode} fileName={file?.name} />;
  }

  if (phase === "review" && extracted) {
    return <IngestReview extracted={extracted} ctx={ctx} onPost={postReport} onReset={reset} setExtracted={setExtracted} />;
  }

  if (phase === "batchReview" && batch) {
    return <BatchReview batch={batch} setBatch={setBatch} ctx={ctx} onPost={postBatch} onReset={reset} />;
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      {/* Hero introduction */}
      <div className="text-center py-6 anim-fade-up">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 anim-pulse-soft" />
          AI-POWERED · CLAUDE SONNET 4
        </div>
        <h2 className="font-display text-5xl md:text-6xl text-stone-900 leading-tight tracking-tight mb-3">
          Drop your audit.<br />
          <span className="italic text-amber-700">We'll do the rest.</span>
        </h2>
        <p className="text-stone-600 max-w-2xl mx-auto">
          Paste a PMS report dump, upload a PDF night audit, or attach a photo of a printed flash report.
          The system reads any format, maps every line to your GL chart, flags variances, and produces commentary in seconds.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex justify-center gap-1 p-1 rounded-lg bg-stone-100 w-fit mx-auto">
        {[
          { id: "paste", label: "Paste Text", icon: FileText },
          { id: "upload", label: "Upload Document", icon: Upload },
        ].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md inline-flex items-center gap-2 transition-all ${mode === m.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}>
            <m.icon size={14} />{m.label}
          </button>
        ))}
      </div>

      {/* Drop / paste zone */}
      <Card className="p-2 anim-fade-up delay-200">
        {mode === "paste" ? (
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={14}
            placeholder={`Paste your audit report here. Try something like:

NIGHT AUDIT — Riverbend Inn — March 14
Rooms available: 84 (3 OOO)
Rooms sold: 67 (61 transient, 6 group, 1 comp, 2 walk-ins, 1 no-show)
ADR: $148.20
Room revenue: $9,929.40
Restaurant: $812.50  Bar: $245.00  Banquet: $0
Parking: $182.00  Misc: $54.00
Tax — Occupancy: $1,142  Sales: $785  Tourism: $148
CC: $9,840  Cash: $448  DB: $865  Other: $20
Guests in house: 116`}
            className="w-full p-5 text-sm font-mono border-0 rounded-md resize-none focus:outline-none scroll-thin bg-stone-50/40"
          />
        ) : (
          <UploadDropZone file={file} setFile={setFile} fileInput={fileInput} />
        )}
      </Card>

      {/* Sample loader */}
      {mode === "paste" && !text && (
        <div className="text-center -mt-2 anim-fade-up delay-200">
          <button
            onClick={() => setText(SAMPLE_AUDITS[Math.floor(Math.random() * SAMPLE_AUDITS.length)])}
            className="text-xs text-amber-700 hover:text-amber-900 font-semibold underline decoration-dotted underline-offset-4"
          >
            ✨ Try a sample audit
          </button>
          <span className="text-xs text-stone-400 ml-2">— or paste multiple days at once for batch mode</span>
        </div>
      )}

      {/* Batch detection chip */}
      {batchPreview && (
        <div className="text-center -mt-2 anim-fade-up">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 anim-pulse-soft" />
            Detected {batchPreview} separate audits — ready for batch ingest
          </span>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs text-stone-500 max-w-md">
          <span className="font-semibold text-stone-700">How it works:</span> the local parser reads any format — no API needed.
          Add a Claude API key in Settings → System to enable PDF / image OCR enrichment.
        </div>
        <div className="flex items-center gap-2">
          {(text || file) && <Button variant="ghost" onClick={reset}>Clear</Button>}
          <Button variant="accent" size="lg"
            disabled={mode === "paste" ? text.trim().length < 20 : !file}
            onClick={startExtraction}>
            <span className="inline-flex items-center gap-2">
              Extract Audit
              <span className="opacity-60">→</span>
            </span>
          </Button>
        </div>
      </div>

      {/* Recent ingestions */}
      {recentIngests.length > 0 && (
        <Card className="anim-fade-up delay-300">
          <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-display text-lg text-stone-900">Recent Ingestions</h3>
            <button onClick={() => setTab("flash")} className="text-xs text-amber-700 font-medium hover:text-amber-800">View all flash reports →</button>
          </div>
          <div className="divide-y divide-stone-100">
            {recentIngests.map(r => {
              const prop = state.properties.find(p => p.id === r.propertyId);
              return (
                <div key={r.id} className="px-6 py-3 flex items-center gap-4">
                  <div className="w-8 h-8 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center">
                    {r.ingestion.source === "ai_upload" ? <Paperclip size={14} className="text-amber-700" /> : <FileText size={14} className="text-amber-700" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-stone-900">{prop?.name} · {fmtDate(r.date)}</div>
                    <div className="text-xs text-stone-500 truncate">{r.ingestion.fileName || "Pasted text"} · {fmtMoney(r.totalRevenue)} total revenue</div>
                  </div>
                  <Badge color="emerald">{(r.ingestion.confidence * 100).toFixed(0)}% conf.</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function UploadDropZone({ file, setFile, fileInput }) {
  const [drag, setDrag] = useState(false);
  const handleFile = (f) => {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { alert("File too large (max 8MB)"); return; }
    setFile({ raw: f, name: f.name, size: f.size });
  };
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
      className={`p-12 rounded-md border-2 border-dashed text-center transition-colors ${drag ? "border-amber-700 bg-amber-50" : "border-stone-300 bg-stone-50/40"}`}>
      <input ref={fileInput} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => handleFile(e.target.files[0])} />
      {file ? (
        <div className="space-y-2">
          <div className="w-12 h-12 rounded-lg bg-amber-100 text-amber-800 mx-auto flex items-center justify-center">
            <FileCheck2 size={22} />
          </div>
          <div className="font-medium text-stone-900">{file.name}</div>
          <div className="text-xs text-stone-500">{(file.size / 1024).toFixed(1)} KB · ready to extract</div>
          <button onClick={() => setFile(null)} className="text-xs text-stone-500 hover:text-stone-900 underline">Remove</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="w-12 h-12 rounded-lg bg-white border border-stone-200 mx-auto flex items-center justify-center">
            <Upload size={22} className="text-stone-500" />
          </div>
          <div>
            <div className="font-medium text-stone-900 mb-1">Drop a PDF or image here</div>
            <div className="text-xs text-stone-500">Or <button onClick={() => fileInput.current?.click()} className="text-amber-700 font-medium hover:underline">browse files</button></div>
          </div>
          <div className="text-[11px] text-stone-400">PDF · PNG · JPG · up to 8 MB</div>
        </div>
      )}
    </div>
  );
}

function IngestProcessing({ progress, mode, fileName }) {
  const stages = [
    { at: 0, label: "Reading source" },
    { at: 25, label: "Identifying revenue lines" },
    { at: 50, label: "Mapping to GL chart" },
    { at: 75, label: "Computing variance vs baseline" },
    { at: 95, label: "Generating insights" },
  ];
  const activeStage = stages.filter(s => progress >= s.at).pop() || stages[0];
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Card className="p-12 text-center grain hero-glow"
        style={{ background: "linear-gradient(135deg, #fafaf9 0%, #f5f5f4 100%)" }}>
        <div className="relative mb-8">
          <div className="w-24 h-24 mx-auto rounded-full border-4 border-amber-700/15 anim-spin-slow" style={{ borderTopColor: "#b45309" }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-display text-2xl font-bold text-amber-700 tabular">{Math.round(progress)}%</span>
          </div>
        </div>
        <h3 className="font-display text-3xl text-stone-900 mb-2">{activeStage.label}</h3>
        <p className="text-stone-600 mb-6">
          {mode === "upload" ? `Reading "${fileName || "document"}"…` : "Parsing audit text…"}
        </p>
        <div className="max-w-md mx-auto h-1.5 bg-stone-200 rounded-full overflow-hidden mb-6">
          <div className="h-full bg-gradient-to-r from-amber-600 to-amber-800 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-center gap-2 flex-wrap text-xs">
          {stages.map((s, i) => {
            const done = progress >= s.at + 5;
            const active = activeStage === s;
            return (
              <span key={i} className={`px-2 py-1 rounded ${done ? "text-emerald-700" : active ? "text-amber-700 font-semibold" : "text-stone-400"}`}>
                {done ? "✓" : active ? "•" : "○"} {s.label}
              </span>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function IngestReview({ extracted, ctx, onPost, onReset, setExtracted }) {
  const { accessibleProperties } = ctx;
  const property = accessibleProperties.find(p => p.id === extracted.propertyId);
  const conf = extracted.confidence ?? 0.9;
  const confColor = conf >= 0.85 ? "emerald" : conf >= 0.6 ? "amber" : "rose";

  // Update a top-level field in extracted
  const setField = (path, val) => {
    setExtracted(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let cur = copy;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] = cur[keys[i]] || {};
      cur[keys[keys.length - 1]] = val;
      return copy;
    });
  };

  const breakdown = {
    rooms: extracted.rooms || {},
    revenue: extracted.revenue || {},
  };
  const totalRev = (breakdown.revenue.rooms || 0) + sumFb(breakdown) + sumOther(breakdown);

  return (
    <div className="p-8 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 anim-fade-up">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-emerald-700 font-bold">✓ Extracted</span>
            <Badge color={confColor}>{(conf * 100).toFixed(0)}% confidence</Badge>
          </div>
          <h2 className="font-display text-3xl text-stone-900">Review &amp; post</h2>
          <p className="text-sm text-stone-500 mt-1">Editable fields below — adjust anything that looks off, then post to the ledger.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onReset}>Discard</Button>
          <Button variant="success" size="lg" onClick={onPost}><CheckCircle2 size={16} />Post to GL</Button>
        </div>
      </div>

      {/* Warnings */}
      {extracted.warnings && extracted.warnings.length > 0 && (
        <Card className="p-5 bg-amber-50 border-amber-200 anim-fade-up delay-100">
          <div className="flex gap-3">
            <AlertCircle size={18} className="text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-stone-900 mb-1">Things to verify</h4>
              <ul className="text-sm text-stone-700 space-y-0.5">
                {extracted.warnings.map((w, i) => <li key={i}>· {w}</li>)}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Header strip */}
      <Card className="p-6 anim-fade-up delay-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Select label="Property" value={extracted.propertyId || ""} onChange={v => setField("propertyId", v)}
            options={[{ value: "", label: "Select…" }, ...accessibleProperties.map(p => ({ value: p.id, label: p.name }))]} />
          <Input label="Date" type="date" value={extracted.date || ""} onChange={v => setField("date", v)} />
          <div>
            <span className="block text-xs uppercase tracking-wider text-stone-500 mb-1.5 font-medium">Total Revenue (computed)</span>
            <div className="font-display text-3xl tabular text-stone-900">{fmtMoney(totalRev)}</div>
          </div>
        </div>
      </Card>

      {/* Editable sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 anim-fade-up delay-300">
        <ReviewSection title="Rooms">
          <ReviewField label="Available" value={extracted.rooms?.available} onChange={v => setField("rooms.available", v)} />
          <ReviewField label="Sold" value={extracted.rooms?.sold} onChange={v => setField("rooms.sold", v)} />
          <ReviewField label="Comp" value={extracted.rooms?.comp} onChange={v => setField("rooms.comp", v)} />
          <ReviewField label="Out of Order" value={extracted.rooms?.outOfOrder} onChange={v => setField("rooms.outOfOrder", v)} />
          <ReviewField label="Transient" value={extracted.rooms?.transient} onChange={v => setField("rooms.transient", v)} />
          <ReviewField label="Group" value={extracted.rooms?.group} onChange={v => setField("rooms.group", v)} />
          <ReviewField label="Walk-ins" value={extracted.rooms?.walkIns} onChange={v => setField("rooms.walkIns", v)} />
          <ReviewField label="No-shows" value={extracted.rooms?.noShows} onChange={v => setField("rooms.noShows", v)} />
        </ReviewSection>
        <ReviewSection title="Revenue">
          <ReviewField label="Rooms" value={extracted.revenue?.rooms} onChange={v => setField("revenue.rooms", v)} money />
          <ReviewField label="Restaurant" value={extracted.revenue?.fb?.restaurant} onChange={v => setField("revenue.fb.restaurant", v)} money />
          <ReviewField label="Bar / Lounge" value={extracted.revenue?.fb?.bar} onChange={v => setField("revenue.fb.bar", v)} money />
          <ReviewField label="Banquet" value={extracted.revenue?.fb?.banquet} onChange={v => setField("revenue.fb.banquet", v)} money />
          <ReviewField label="Parking" value={extracted.revenue?.other?.parking} onChange={v => setField("revenue.other.parking", v)} money />
          <ReviewField label="Spa" value={extracted.revenue?.other?.spa} onChange={v => setField("revenue.other.spa", v)} money />
          <ReviewField label="Telephone" value={extracted.revenue?.other?.telephone} onChange={v => setField("revenue.other.telephone", v)} money />
          <ReviewField label="Misc" value={extracted.revenue?.other?.misc} onChange={v => setField("revenue.other.misc", v)} money />
        </ReviewSection>
        <ReviewSection title="Taxes">
          <ReviewField label="Occupancy Tax" value={extracted.taxes?.occupancy} onChange={v => setField("taxes.occupancy", v)} money />
          <ReviewField label="Sales Tax" value={extracted.taxes?.sales} onChange={v => setField("taxes.sales", v)} money />
          <ReviewField label="Tourism Tax" value={extracted.taxes?.tourism} onChange={v => setField("taxes.tourism", v)} money />
        </ReviewSection>
        <ReviewSection title="Settlement">
          <ReviewField label="Credit Card" value={extracted.payments?.creditCard} onChange={v => setField("payments.creditCard", v)} money />
          <ReviewField label="Cash" value={extracted.payments?.cash} onChange={v => setField("payments.cash", v)} money />
          <ReviewField label="Direct Bill" value={extracted.payments?.directBill} onChange={v => setField("payments.directBill", v)} money />
          <ReviewField label="Other" value={extracted.payments?.other} onChange={v => setField("payments.other", v)} money />
        </ReviewSection>
      </div>

      {/* AI insights preview */}
      {extracted.insights && extracted.insights.length > 0 && (
        <Card className="p-6 anim-fade-up delay-400">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-600 to-amber-800 text-white flex items-center justify-center">
              <span className="text-[10px] font-bold">AI</span>
            </div>
            <h3 className="font-display text-lg text-stone-900">Generated insights</h3>
          </div>
          <ul className="space-y-2 text-sm text-stone-700">
            {extracted.insights.map((ins, i) => (
              <li key={i} className="flex gap-3"><span className="text-amber-600 mt-0.5">→</span>{ins}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BatchReview({ batch, setBatch, ctx, onPost, onReset }) {
  const { accessibleProperties } = ctx;
  const includedCount = batch.filter(b => b._include).length;
  const totalRev = batch.filter(b => b._include).reduce((s, r) => {
    const roomRev = r.revenue?.rooms || 0;
    const fb = sumFb(r);
    const other = sumOther(r);
    return s + roomRev + fb + other;
  }, 0);
  const updateOne = (idx, patch) => setBatch(prev => prev.map((b, i) => i === idx ? { ...b, ...patch } : b));

  return (
    <div className="p-8 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 anim-fade-up">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-emerald-700 font-bold">✓ Batch parsed</span>
            <Badge color="amber">{batch.length} audits</Badge>
          </div>
          <h2 className="font-display text-3xl text-stone-900">Review &amp; post {batch.length} reports</h2>
          <p className="text-sm text-stone-500 mt-1">Uncheck any that look wrong — only checked reports will post. Total revenue across selected: <strong className="tabular text-stone-900">{fmtMoney(totalRev)}</strong></p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onReset}>Discard all</Button>
          <Button variant="success" size="lg" onClick={onPost} disabled={!includedCount}>
            <CheckCircle2 size={16} />Post {includedCount} {includedCount === 1 ? "report" : "reports"}
          </Button>
        </div>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 w-10"></th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Property</th>
              <th className="text-right px-4 py-3 font-medium">Sold / Avail</th>
              <th className="text-right px-4 py-3 font-medium">Room Rev</th>
              <th className="text-right px-4 py-3 font-medium">F&amp;B + Other</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-center px-4 py-3 font-medium">Conf.</th>
              <th className="text-left px-4 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {batch.map((r, idx) => {
              const roomRev = r.revenue?.rooms || 0;
              const fb = sumFb(r);
              const other = sumOther(r);
              const total = roomRev + fb + other;
              const conf = r.confidence ?? 0;
              const confColor = conf >= 0.85 ? "text-emerald-700" : conf >= 0.6 ? "text-amber-700" : "text-rose-700";
              return (
                <tr key={idx} className={r._include ? "" : "opacity-40"}>
                  <td className="px-4 py-2.5 text-center">
                    <input type="checkbox" checked={!!r._include} onChange={e => updateOne(idx, { _include: e.target.checked })} />
                  </td>
                  <td className="px-4 py-2.5">
                    <input type="date" value={r.date || ""} onChange={e => updateOne(idx, { date: e.target.value })}
                      className="px-2 py-1 text-xs tabular border border-stone-200 rounded bg-white" />
                  </td>
                  <td className="px-4 py-2.5">
                    <select value={r.propertyId || ""} onChange={e => updateOne(idx, { propertyId: e.target.value })}
                      className="px-2 py-1 text-xs border border-stone-200 rounded bg-white">
                      <option value="">—</option>
                      {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular text-stone-700">{r.rooms?.sold ?? "—"} / {r.rooms?.available ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular">{fmtMoney(roomRev)}</td>
                  <td className="px-4 py-2.5 text-right tabular text-stone-600">{fmtMoney(fb + other)}</td>
                  <td className="px-4 py-2.5 text-right tabular font-semibold">{fmtMoney(total)}</td>
                  <td className={`px-4 py-2.5 text-center text-xs font-semibold tabular ${confColor}`}>{(conf * 100).toFixed(0)}%</td>
                  <td className="px-4 py-2.5 text-xs text-stone-500 max-w-[200px] truncate" title={(r.warnings || []).join(" · ")}>
                    {(r.warnings || []).slice(0, 1).join(", ") || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ReviewSection({ title, children }) {
  return (
    <Card className="p-5">
      <h3 className="font-display text-lg text-stone-900 mb-4 pb-2 border-b border-stone-100">{title}</h3>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </Card>
  );
}

function ReviewField({ label, value, onChange, money }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1 font-semibold">{label}</span>
      <div className="relative">
        {money && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>}
        <input type="number" value={value ?? ""} onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={`w-full ${money ? "pl-7" : "pl-3"} pr-3 py-2 text-sm tabular border border-stone-200 rounded-md bg-white focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700`} />
      </div>
    </label>
  );
}

/* =========================================================================
   BUDGET PANE — Plan vs Actual matrix (signature M3 / Innflow feature)
   ========================================================================= */
function BudgetPane({ ctx }) {
  const { state, update, perms, activeProperty, accessibleProperties, currentUser, toast } = ctx;
  const [propId, setPropId] = useState(perms.properties === "all" ? accessibleProperties[0]?.id : activeProperty);
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);

  const property = state.properties.find(p => p.id === propId);
  const budget = useMemo(() => {
    return state.budgets.find(b => b.propertyId === propId && b.month === month) || _emptyBudget(propId, month);
  }, [state.budgets, propId, month]);

  const enrichedReports = useMemo(() => state.reports.map(enrichReport), [state.reports]);
  const actual = useMemo(() => _actualsFor(enrichedReports, propId, month), [enrichedReports, propId, month]);
  const pace = useMemo(() => _pacing(actual, budget), [actual, budget]);
  const totalBudget = _budgetTotal(budget);

  // Prior 6 months (for the "history" mini-rows)
  const monthOptions = useMemo(() => {
    const months = new Set(state.budgets.filter(b => b.propertyId === propId).map(b => b.month));
    const reportMonths = new Set(state.reports.filter(r => r.propertyId === propId).map(r => _monthOf(r.date)));
    [...reportMonths].forEach(m => months.add(m));
    months.add(defaultMonth);
    return [...months].sort().reverse();
  }, [state.budgets, state.reports, propId]);

  const saveBudget = (next) => {
    const others = state.budgets.filter(b => !(b.propertyId === propId && b.month === month));
    const stored = state.budgets.find(b => b.propertyId === propId && b.month === month);
    const merged = { ...(stored || _emptyBudget(propId, month)), ...next, autoSeeded: false, updatedAt: new Date().toISOString(), updatedBy: currentUser.id };
    update({ budgets: [...others, merged] });
    pushActivity(ctx, "budget.update", { propertyId: propId, month, total: _budgetTotal(merged) });
  };

  const setField = (path, val) => {
    const next = JSON.parse(JSON.stringify(budget));
    const keys = path.split(".");
    let cur = next;
    for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] = cur[keys[i]] || {};
    cur[keys[keys.length - 1]] = Number(val) || 0;
    saveBudget(next);
  };

  // Variance row helper
  const Row = ({ label, b, a, isPct, indent }) => {
    const v = (a || 0) - (b || 0);
    const vPct = b ? v / b : null;
    const dir = Math.abs(v) < 0.01 ? "stone" : v > 0 ? "emerald" : "rose";
    const dirColor = { stone: "text-stone-500", emerald: "text-emerald-700", rose: "text-rose-700" }[dir];
    const fmt = (x) => isPct ? `${(x * 100).toFixed(1)}%` : fmtMoney(x);
    return (
      <tr className="hover:bg-stone-50">
        <td className={`px-6 py-2.5 text-stone-700 ${indent ? "pl-10 text-stone-500" : "font-medium"}`}>{label}</td>
        <td className="px-6 py-2.5 text-right tabular text-stone-900">{fmt(b)}</td>
        <td className="px-6 py-2.5 text-right tabular text-stone-900">{fmt(a)}</td>
        <td className={`px-6 py-2.5 text-right tabular font-semibold ${dirColor}`}>
          {Math.abs(v) < 0.01 ? "—" : `${v > 0 ? "+" : ""}${fmt(v)}`}
        </td>
        <td className={`px-6 py-2.5 text-right tabular font-semibold ${dirColor}`}>
          {vPct === null ? "—" : `${vPct >= 0 ? "+" : ""}${(vPct * 100).toFixed(1)}%`}
        </td>
      </tr>
    );
  };

  const editable = !state.closedPeriods?.some(c => c.propertyId === propId && c.month === month);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Budget · Plan vs Actual</span>
            {!editable && <Badge color="stone">Period closed</Badge>}
            {budget.autoSeeded && <Badge color="amber">Auto-seeded</Badge>}
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name}</h2>
          <p className="text-sm text-stone-500 mt-1">
            Budget total: <strong className="tabular text-stone-900">{fmtMoney(totalBudget)}</strong>
            {" · "}Actuals: <strong className="tabular text-stone-900">{fmtMoney(actual?.totalRevenue || 0)}</strong>
            {actual && ` (${actual.days} of ${pace?.daysInMonth || ""} days posted)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accessibleProperties.length > 1 && (
            <select value={propId} onChange={e => setPropId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium">
              {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium tabular">
            {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Pacing tile */}
      {pace && totalBudget > 0 && (
        <Card className="p-6 anim-fade-up">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Month-to-Date</div>
              <div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(pace.actualToDate)}</div>
              <div className="text-xs text-stone-500 mt-1">Day {pace.dayInMonth} of {pace.daysInMonth}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Pacing Target</div>
              <div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(pace.expectedToDate)}</div>
              <div className="text-xs text-stone-500 mt-1">Prorated to today</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Variance to Pace</div>
              <div className={`font-display number-display text-3xl font-semibold ${pace.variance >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {pace.variance >= 0 ? "+" : ""}{fmtMoneyShort(pace.variance)}
              </div>
              <div className={`text-xs mt-1 ${pace.variance >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {pace.variance >= 0 ? "↑" : "↓"} {Math.abs(pace.variancePct * 100).toFixed(1)}% {pace.variance >= 0 ? "ahead" : "behind"} plan
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Full Month Budget</div>
              <div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(totalBudget)}</div>
              <div className="text-xs text-stone-500 mt-1">{((pace.actualToDate / totalBudget) * 100).toFixed(0)}% achieved</div>
            </div>
          </div>
          {/* Pacing bar */}
          <div className="mt-5 h-2 rounded-full bg-stone-100 overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-600 to-amber-700 rounded-full transition-all"
              style={{ width: `${Math.min(100, (pace.actualToDate / totalBudget) * 100)}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-stone-700"
              style={{ left: `${Math.min(100, (pace.expectedToDate / totalBudget) * 100)}%` }}
              title="Pacing target" />
          </div>
          <div className="flex justify-between mt-2 text-[10px] uppercase tracking-wider text-stone-400">
            <span>Start of {month}</span>
            <span>End of month</span>
          </div>
        </Card>
      )}

      {/* Plan vs Actual table */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-display text-lg text-stone-900">Plan vs Actual · {month}</h3>
          {editable && <span className="text-xs text-stone-500">Click any budget value to edit</span>}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-medium">Revenue line</th>
              <th className="text-right px-6 py-3 font-medium">Budget</th>
              <th className="text-right px-6 py-3 font-medium">Actual MTD</th>
              <th className="text-right px-6 py-3 font-medium">Variance $</th>
              <th className="text-right px-6 py-3 font-medium">Variance %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            <BudgetEditableRow label="Rooms Revenue" path="rooms.revenue" budget={budget} actual={actual?.rooms?.revenue || 0} editable={editable} setField={setField} />
            <BudgetEditableRow label="Restaurant" path="fb.restaurant" budget={budget} actual={actual?.fb?.restaurant || 0} editable={editable} setField={setField} indent />
            <BudgetEditableRow label="Bar / Lounge" path="fb.bar" budget={budget} actual={actual?.fb?.bar || 0} editable={editable} setField={setField} indent />
            <BudgetEditableRow label="Banquet" path="fb.banquet" budget={budget} actual={actual?.fb?.banquet || 0} editable={editable} setField={setField} indent />
            <BudgetEditableRow label="Parking" path="other.parking" budget={budget} actual={actual?.other?.parking || 0} editable={editable} setField={setField} indent />
            <BudgetEditableRow label="Spa" path="other.spa" budget={budget} actual={actual?.other?.spa || 0} editable={editable} setField={setField} indent />
            <BudgetEditableRow label="Telephone" path="other.telephone" budget={budget} actual={actual?.other?.telephone || 0} editable={editable} setField={setField} indent />
            <BudgetEditableRow label="Misc / Sundry" path="other.misc" budget={budget} actual={actual?.other?.misc || 0} editable={editable} setField={setField} indent />
            <tr className="bg-stone-50 font-semibold">
              <td className="px-6 py-3 text-stone-900">Total Operating Revenue</td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtMoney(totalBudget)}</td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtMoney(actual?.totalRevenue || 0)}</td>
              <td className={`px-6 py-3 text-right tabular ${(actual?.totalRevenue || 0) - totalBudget >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {((actual?.totalRevenue || 0) - totalBudget) >= 0 ? "+" : ""}{fmtMoney((actual?.totalRevenue || 0) - totalBudget)}
              </td>
              <td className={`px-6 py-3 text-right tabular ${(actual?.totalRevenue || 0) - totalBudget >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {totalBudget ? `${((actual?.totalRevenue || 0) - totalBudget >= 0 ? "+" : "")}${(((actual?.totalRevenue || 0) - totalBudget) / totalBudget * 100).toFixed(1)}%` : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card className="p-5 bg-stone-50 border-stone-200 text-xs text-stone-600">
        <strong className="text-stone-900">USALI alignment:</strong> revenue lines are mapped to the Uniform System of Accounts for the Lodging Industry (11th edition).
        Budgets persist locally per property/month. Use Settings → Backup &amp; Restore to snapshot before quarter close.
      </Card>
    </div>
  );
}

function BudgetEditableRow({ label, path, budget, actual, editable, setField, indent }) {
  const get = () => path.split(".").reduce((o, k) => (o == null ? null : o[k]), budget);
  const v = (actual || 0) - (get() || 0);
  const vPct = get() ? v / get() : null;
  const dirColor = Math.abs(v) < 0.01 ? "text-stone-500" : v > 0 ? "text-emerald-700" : "text-rose-700";
  return (
    <tr className="hover:bg-stone-50">
      <td className={`px-6 py-2.5 text-stone-700 ${indent ? "pl-10 text-stone-600" : "font-medium text-stone-900"}`}>{label}</td>
      <td className="px-6 py-2.5 text-right tabular">
        {editable ? (
          <input
            type="number"
            value={get() || 0}
            onChange={e => setField(path, e.target.value)}
            className="px-2 py-1 text-xs tabular border border-stone-200 rounded bg-white text-right w-32 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
          />
        ) : <span className="text-stone-900">{fmtMoney(get())}</span>}
      </td>
      <td className="px-6 py-2.5 text-right tabular text-stone-900">{fmtMoney(actual)}</td>
      <td className={`px-6 py-2.5 text-right tabular font-semibold ${dirColor}`}>
        {Math.abs(v) < 0.01 ? "—" : `${v > 0 ? "+" : ""}${fmtMoney(v)}`}
      </td>
      <td className={`px-6 py-2.5 text-right tabular font-semibold ${dirColor}`}>
        {vPct === null || isNaN(vPct) ? "—" : `${vPct >= 0 ? "+" : ""}${(vPct * 100).toFixed(1)}%`}
      </td>
    </tr>
  );
}

/* =========================================================================
   CUSTOM REPORTS PANE — flexible column picker + filtered export (M3-style)
   ========================================================================= */
const REPORT_COLUMNS = [
  { id: "date",        label: "Date",          get: r => r.date,                          fmt: v => fmtDate(v) },
  { id: "property",    label: "Property",      get: (r, props) => props[r.propertyId]?.name || r.propertyId },
  { id: "dow",         label: "Day",           get: r => fmtDayName(r.date) },
  { id: "available",   label: "Avail",         get: r => r.roomsAvailable,                isNum: true },
  { id: "sold",        label: "Sold",          get: r => r.roomsSold,                     isNum: true },
  { id: "ooo",         label: "OOO",           get: r => r.breakdown?.rooms?.outOfOrder || 0, isNum: true },
  { id: "occupancy",   label: "Occ %",         get: r => r.occupancy,                     fmt: v => `${(v * 100).toFixed(1)}%` },
  { id: "adr",         label: "ADR",           get: r => r.adr,                           fmt: fmtMoney },
  { id: "revpar",      label: "RevPAR",        get: r => r.revpar,                        fmt: fmtMoney },
  { id: "roomRev",     label: "Room Rev",      get: r => r.roomRevenue,                   fmt: fmtMoney },
  { id: "fbRev",       label: "F&B Rev",       get: r => sumFb(r.breakdown),              fmt: fmtMoney },
  { id: "otherRev",    label: "Other Rev",     get: r => sumOther(r.breakdown),           fmt: fmtMoney },
  { id: "totalRev",    label: "Total Rev",     get: r => r.totalRevenue,                  fmt: fmtMoney },
  { id: "occTax",      label: "Occ Tax",       get: r => r.breakdown?.taxes?.occupancy || 0, fmt: fmtMoney },
  { id: "salesTax",    label: "Sales Tax",     get: r => r.breakdown?.taxes?.sales || 0,  fmt: fmtMoney },
  { id: "tourismTax",  label: "Tourism Tax",   get: r => r.breakdown?.taxes?.tourism || 0, fmt: fmtMoney },
  { id: "cash",        label: "Cash",          get: r => r.breakdown?.payments?.cash || 0, fmt: fmtMoney },
  { id: "cc",          label: "Credit Card",   get: r => r.breakdown?.payments?.creditCard || 0, fmt: fmtMoney },
  { id: "directBill",  label: "Direct Bill",   get: r => r.breakdown?.payments?.directBill || 0, fmt: fmtMoney },
  { id: "guests",      label: "Guests",        get: r => r.breakdown?.guests?.totalGuests || 0, isNum: true },
  { id: "transient",   label: "Transient",     get: r => r.breakdown?.rooms?.transient || 0, isNum: true },
  { id: "group",       label: "Group",         get: r => r.breakdown?.rooms?.group || 0,   isNum: true },
  { id: "comp",        label: "Comp",          get: r => r.breakdown?.rooms?.comp || 0,    isNum: true },
  { id: "walkIns",     label: "Walk-ins",      get: r => r.breakdown?.rooms?.walkIns || 0, isNum: true },
  { id: "noShows",     label: "No-shows",      get: r => r.breakdown?.rooms?.noShows || 0, isNum: true },
  { id: "ingestionSrc",label: "Source",        get: r => r.ingestion?.source || "manual" },
];
const DEFAULT_COLS = ["date", "property", "occupancy", "adr", "revpar", "roomRev", "fbRev", "totalRev"];

// Built-in report templates — M3 / Innflow-style canned report library.
const BUILTIN_TEMPLATES = [
  { id: "daily-flash",     name: "Daily Flash",          range: 30,  cols: ["date", "property", "occupancy", "adr", "revpar", "roomRev", "fbRev", "totalRev"] },
  { id: "occupancy-pace",  name: "Occupancy Pace",       range: 60,  cols: ["date", "property", "available", "sold", "occupancy", "transient", "group", "walkIns", "noShows"] },
  { id: "revenue-mix",     name: "Revenue Mix",          range: 30,  cols: ["date", "property", "roomRev", "fbRev", "otherRev", "totalRev"] },
  { id: "tax-detail",      name: "Tax Detail",           range: 30,  cols: ["date", "property", "occTax", "salesTax", "tourismTax"] },
  { id: "settlement",      name: "Settlement Audit",     range: 14,  cols: ["date", "property", "totalRev", "cash", "cc", "directBill"] },
  { id: "guest-flow",      name: "Guest Flow",           range: 14,  cols: ["date", "property", "guests", "transient", "group", "comp", "walkIns", "noShows"] },
];

function CustomReportsPane({ ctx }) {
  const { state, perms, accessibleProperties, activeProperty, toast } = ctx;
  const [propId, setPropId] = useState("all");
  const [range, setRange] = useState(30);
  const [cols, setCols] = useState(() => {
    try { return JSON.parse(localStorage.getItem("hotelops:reportCols") || "null") || DEFAULT_COLS; }
    catch { return DEFAULT_COLS; }
  });
  const [savedTemplates, setSavedTemplates] = useState(() => {
    try { return JSON.parse(localStorage.getItem("hotelops:reportTemplates") || "[]"); }
    catch { return []; }
  });
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [sortBy, setSortBy] = useState({ id: "date", dir: "desc" });

  const persistTemplates = (next) => {
    setSavedTemplates(next);
    try { localStorage.setItem("hotelops:reportTemplates", JSON.stringify(next)); } catch {}
  };
  const saveTemplate = () => {
    if (!newTemplateName.trim()) return;
    const t = { id: newId("rt"), name: newTemplateName.trim(), cols: [...cols], range };
    persistTemplates([...savedTemplates, t]);
    setActiveTemplate(t.id);
    setShowSaveModal(false);
    setNewTemplateName("");
    toast?.push(`Saved template: ${t.name}`, { tone: "success" });
  };
  const applyTemplate = (t) => {
    setCols(t.cols);
    setRange(t.range);
    setActiveTemplate(t.id);
    try { localStorage.setItem("hotelops:reportCols", JSON.stringify(t.cols)); } catch {}
  };
  const deleteTemplate = (id) => {
    persistTemplates(savedTemplates.filter(t => t.id !== id));
    if (activeTemplate === id) setActiveTemplate(null);
  };

  const propsAll = perms.properties === "all" ? accessibleProperties : accessibleProperties.filter(p => p.id === activeProperty);
  const propsById = Object.fromEntries(state.properties.map(p => [p.id, p]));
  const propIds = propId === "all" ? propsAll.map(p => p.id) : [propId];

  const data = useMemo(() => {
    const cutoff = addDays(TODAY, -range);
    return state.reports
      .filter(r => propIds.includes(r.propertyId) && new Date(r.date) >= cutoff)
      .map(enrichReport)
      .sort((a, b) => {
        const colDef = REPORT_COLUMNS.find(c => c.id === sortBy.id);
        const av = colDef ? colDef.get(a, propsById) : a[sortBy.id];
        const bv = colDef ? colDef.get(b, propsById) : b[sortBy.id];
        const cmp = typeof av === "number" ? av - bv : String(av || "").localeCompare(String(bv || ""));
        return sortBy.dir === "asc" ? cmp : -cmp;
      });
  }, [state.reports, propIds, range, sortBy]);

  const toggle = (id) => {
    setCols(c => {
      const next = c.includes(id) ? c.filter(x => x !== id) : [...c, id];
      try { localStorage.setItem("hotelops:reportCols", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const exportCsv = () => {
    const activeCols = cols.map(id => REPORT_COLUMNS.find(c => c.id === id)).filter(Boolean);
    const header = activeCols.map(c => `"${c.label}"`).join(",");
    const rows = data.map(r =>
      activeCols.map(c => {
        const v = c.get(r, propsById);
        if (v == null) return "";
        if (typeof v === "number") return v;
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(",")
    );
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(`hotelops-report-${stamp}.csv`, [header, ...rows].join("\n"), "text/csv");
  };

  const totals = useMemo(() => {
    const t = {};
    REPORT_COLUMNS.forEach(c => {
      if (c.id === "date" || c.id === "property" || c.id === "dow" || c.id === "ingestionSrc") return;
      t[c.id] = data.reduce((s, r) => {
        const v = c.get(r, propsById);
        return s + (typeof v === "number" ? v : 0);
      }, 0);
    });
    return t;
  }, [data]);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Custom Reports</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">Pick columns. Filter. Export.</h2>
          <p className="text-sm text-stone-500 mt-1">{data.length} rows · {cols.length} columns selected</p>
        </div>
        <div className="flex items-center gap-2">
          {propsAll.length > 1 && (
            <select value={propId} onChange={e => setPropId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium">
              <option value="all">All properties</option>
              {propsAll.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={range} onChange={e => setRange(Number(e.target.value))} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 365 days</option>
          </select>
          <Button variant="secondary" onClick={() => setShowSaveModal(true)}><Save size={14} />Save Template</Button>
          <Button variant="primary" onClick={exportCsv}><Download size={14} />Export CSV</Button>
        </div>
      </div>

      {/* Templates row */}
      <Card className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase tracking-wider text-stone-500 font-semibold mr-2">Templates:</span>
          {BUILTIN_TEMPLATES.map(t => (
            <button key={t.id} onClick={() => applyTemplate(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeTemplate === t.id ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-700 border-stone-300 hover:border-stone-400"}`}>
              {t.name}
            </button>
          ))}
          {savedTemplates.length > 0 && <span className="text-stone-300">·</span>}
          {savedTemplates.map(t => (
            <span key={t.id} className={`inline-flex items-center rounded-full text-xs font-medium border ${activeTemplate === t.id ? "bg-amber-700 text-white border-amber-800" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
              <button onClick={() => applyTemplate(t)} className="px-3 py-1.5">{t.name}</button>
              <button onClick={() => deleteTemplate(t.id)} className="px-2 py-1.5 hover:opacity-70" title="Delete template">×</button>
            </span>
          ))}
        </div>
      </Card>

      {/* Column picker */}
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">Columns</div>
        <div className="flex flex-wrap gap-1.5">
          {REPORT_COLUMNS.map(c => {
            const active = cols.includes(c.id);
            return (
              <button key={c.id} onClick={() => toggle(c.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? "bg-amber-700 text-white border-amber-800" : "bg-white text-stone-600 border-stone-300 hover:border-amber-400"}`}>
                {active ? "✓ " : "+ "}{c.label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Save template modal */}
      {showSaveModal && (
        <Modal open onClose={() => setShowSaveModal(false)} title="Save report template">
          <div className="space-y-4">
            <p className="text-sm text-stone-600">
              Saves the current column selection ({cols.length} columns) and date range ({range} days) as a reusable template.
            </p>
            <Input
              label="Template name"
              value={newTemplateName}
              onChange={setNewTemplateName}
              placeholder="e.g. Weekly Operator Pack, Monthly Tax Audit"
            />
            <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
              <Button variant="secondary" onClick={() => setShowSaveModal(false)}>Cancel</Button>
              <Button variant="primary" disabled={!newTemplateName.trim()} onClick={saveTemplate}>
                <Save size={14} />Save Template
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Data table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                {cols.map(id => {
                  const c = REPORT_COLUMNS.find(x => x.id === id);
                  if (!c) return null;
                  const active = sortBy.id === id;
                  return (
                    <th key={id} className={`text-${c.isNum || c.fmt === fmtMoney ? "right" : "left"} px-4 py-3 font-medium cursor-pointer hover:text-stone-900`}
                      onClick={() => setSortBy(s => ({ id, dir: s.id === id && s.dir === "desc" ? "asc" : "desc" }))}>
                      {c.label} {active && (sortBy.dir === "desc" ? "↓" : "↑")}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.map(r => (
                <tr key={r.id} className="hover:bg-stone-50">
                  {cols.map(id => {
                    const c = REPORT_COLUMNS.find(x => x.id === id);
                    if (!c) return null;
                    const v = c.get(r, propsById);
                    const display = c.fmt ? c.fmt(v) : v;
                    const isMoney = c.fmt === fmtMoney;
                    return (
                      <td key={id} className={`px-4 py-2 ${c.isNum || isMoney ? "text-right tabular" : ""}`}>
                        {display ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {data.length > 0 && (
                <tr className="bg-stone-50 font-semibold">
                  {cols.map((id, i) => {
                    const c = REPORT_COLUMNS.find(x => x.id === id);
                    if (!c) return null;
                    const v = totals[id];
                    return (
                      <td key={id} className={`px-4 py-3 ${c.isNum || c.fmt === fmtMoney ? "text-right tabular" : ""}`}>
                        {i === 0 ? "Total" : (v != null && (c.fmt || c.isNum) ? (c.fmt ? c.fmt(v) : v) : "")}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* =========================================================================
   COMPSET PANE — STR-style competitive set benchmark
   ========================================================================= */
// Deterministic synthetic compset: each compset hotel's number is your number
// scaled by a fixed factor based on a hash of (propertyId + hotel name + day).
// Stable across reloads, varied across days/properties.
const COMPSET_HOTELS = [
  { name: "Holiday Glade Inn",   bias: 0.94 },
  { name: "Cedar Hollow Lodge",  bias: 1.06 },
  { name: "Bayside Suites",      bias: 1.12 },
  { name: "Pinecrest Hotel",     bias: 0.88 },
  { name: "Magnolia Park Inn",   bias: 1.02 },
];
function compsetVariation(seed, spread = 0.10) {
  // tiny deterministic PRNG
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h) + seed.charCodeAt(i) | 0;
  const r = Math.abs(Math.sin(h)) % 1;
  return 1 + (r - 0.5) * 2 * spread;
}

function CompsetPane({ ctx }) {
  const { state, perms, activeProperty, accessibleProperties } = ctx;
  const [propId, setPropId] = useState(perms.properties === "all" ? accessibleProperties[0]?.id : activeProperty);
  const [range, setRange] = useState(30);

  const property = state.properties.find(p => p.id === propId);
  const reports = useMemo(() =>
    state.reports.filter(r => r.propertyId === propId).map(enrichReport)
      .filter(r => new Date(r.date) >= addDays(TODAY, -range))
      .sort((a, b) => a.date.localeCompare(b.date))
  , [state.reports, propId, range]);

  // Aggregate "you" + "compset"
  const myAdr = reports.length ? reports.reduce((s, r) => s + r.adr, 0) / reports.length : 0;
  const myOcc = reports.length ? reports.reduce((s, r) => s + r.occupancy, 0) / reports.length : 0;
  const myRevpar = reports.length ? reports.reduce((s, r) => s + r.revpar, 0) / reports.length : 0;

  // Compset = average across the synthetic hotels
  const compsetAdr = COMPSET_HOTELS.reduce((s, h) => s + myAdr * h.bias * compsetVariation(propId + h.name, 0.04), 0) / COMPSET_HOTELS.length;
  const compsetOcc = COMPSET_HOTELS.reduce((s, h) => s + myOcc * (2 - h.bias) * compsetVariation(propId + h.name + "occ", 0.03), 0) / COMPSET_HOTELS.length;
  const compsetRevpar = compsetAdr * compsetOcc;

  const indices = {
    adr: compsetAdr ? (myAdr / compsetAdr) * 100 : 100,
    occ: compsetOcc ? (myOcc / compsetOcc) * 100 : 100,
    revpar: compsetRevpar ? (myRevpar / compsetRevpar) * 100 : 100,
  };

  const chartData = reports.map(r => {
    const yourRevpar = r.revpar;
    const compsetRevparDay = COMPSET_HOTELS.reduce((s, h) =>
      s + yourRevpar * h.bias * compsetVariation(propId + h.name + r.date, 0.06), 0) / COMPSET_HOTELS.length;
    return {
      date: fmtDateShort(r.date),
      you: yourRevpar,
      compset: compsetRevparDay,
    };
  });

  const compsetTable = COMPSET_HOTELS.map(h => ({
    name: h.name,
    adr: myAdr * h.bias * compsetVariation(propId + h.name, 0.04),
    occ: myOcc * (2 - h.bias) * compsetVariation(propId + h.name + "occ", 0.03),
    rooms: 60 + Math.round(Math.abs(Math.sin(h.bias * 100)) * 130),
  }));

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Compset · Market Position</span>
            <Badge color="amber">SYNTHESIZED</Badge>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name} vs Local Compset</h2>
          <p className="text-sm text-stone-500 mt-1">
            STR-style competitive set indices · Last {range} days
            {" · "}<span className="italic">Demo benchmark — wire to STR / Kalibri / OTA Insight in production for real data.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accessibleProperties.length > 1 && (
            <select value={propId} onChange={e => setPropId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium">
              {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={range} onChange={e => setRange(Number(e.target.value))} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Index hero */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <IndexHero label="Occupancy Index" value={indices.occ} you={fmtPct(myOcc)} compset={fmtPct(compsetOcc)} />
        <IndexHero label="ADR Index" value={indices.adr} you={fmtMoney(myAdr)} compset={fmtMoney(compsetAdr)} />
        <IndexHero label="RevPAR Index" value={indices.revpar} you={fmtMoney(myRevpar)} compset={fmtMoney(compsetRevpar)} highlight />
      </div>

      {/* Chart */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg text-stone-900">RevPAR · You vs Compset</h3>
          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-700" />Your RevPAR</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 bg-stone-700" style={{ borderTop: "1px dashed" }} />Compset average</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" />
            <YAxis tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" tickFormatter={v => fmtMoney(v)} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={v => fmtMoney(v)} />
            <Line type="monotone" dataKey="you" stroke="#b45309" strokeWidth={2.5} dot={false} name="Your RevPAR" />
            <Line type="monotone" dataKey="compset" stroke="#1c1917" strokeWidth={2} strokeDasharray="6 4" dot={false} name="Compset" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Compset breakdown */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Compset detail</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-medium">Hotel</th>
              <th className="text-right px-6 py-3 font-medium">Rooms</th>
              <th className="text-right px-6 py-3 font-medium">ADR</th>
              <th className="text-right px-6 py-3 font-medium">Occupancy</th>
              <th className="text-right px-6 py-3 font-medium">RevPAR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            <tr className="bg-amber-50/60 font-semibold">
              <td className="px-6 py-3 text-stone-900">{property?.name} <Badge color="amber">You</Badge></td>
              <td className="px-6 py-3 text-right tabular">{property?.rooms}</td>
              <td className="px-6 py-3 text-right tabular">{fmtMoney(myAdr)}</td>
              <td className="px-6 py-3 text-right tabular">{fmtPct(myOcc)}</td>
              <td className="px-6 py-3 text-right tabular">{fmtMoney(myRevpar)}</td>
            </tr>
            {compsetTable.map(h => (
              <tr key={h.name} className="hover:bg-stone-50">
                <td className="px-6 py-3 text-stone-700">{h.name}</td>
                <td className="px-6 py-3 text-right tabular text-stone-700">{h.rooms}</td>
                <td className="px-6 py-3 text-right tabular text-stone-700">{fmtMoney(h.adr)}</td>
                <td className="px-6 py-3 text-right tabular text-stone-700">{fmtPct(h.occ)}</td>
                <td className="px-6 py-3 text-right tabular text-stone-700">{fmtMoney(h.adr * h.occ)}</td>
              </tr>
            ))}
            <tr className="bg-stone-50 font-semibold">
              <td className="px-6 py-3 text-stone-900">Compset average</td>
              <td className="px-6 py-3 text-right tabular">{Math.round(compsetTable.reduce((s, h) => s + h.rooms, 0) / compsetTable.length)}</td>
              <td className="px-6 py-3 text-right tabular">{fmtMoney(compsetAdr)}</td>
              <td className="px-6 py-3 text-right tabular">{fmtPct(compsetOcc)}</td>
              <td className="px-6 py-3 text-right tabular">{fmtMoney(compsetRevpar)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function IndexHero({ label, value, you, compset, highlight }) {
  const tone = value >= 105 ? "emerald" : value >= 95 ? "stone" : "rose";
  const colors = {
    emerald: { text: "text-emerald-700", bg: "bg-emerald-50", note: "Outperforming compset" },
    stone:   { text: "text-stone-700", bg: "bg-stone-50", note: "Tracking compset" },
    rose:    { text: "text-rose-700", bg: "bg-rose-50", note: "Below compset" },
  };
  const c = colors[tone];
  return (
    <Card className={`p-6 ${highlight ? c.bg : ""}`}>
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">{label}</div>
      <div className={`font-display number-display text-5xl font-bold ${c.text}`}>{value.toFixed(1)}</div>
      <div className="text-xs text-stone-500 mt-1.5">{c.note}</div>
      <div className="mt-4 pt-4 border-t border-stone-200 text-xs space-y-1">
        <div className="flex justify-between"><span className="text-stone-500">You</span><span className="tabular font-medium text-stone-900">{you}</span></div>
        <div className="flex justify-between"><span className="text-stone-500">Compset</span><span className="tabular font-medium text-stone-700">{compset}</span></div>
      </div>
    </Card>
  );
}

/* =========================================================================
   TAX CALENDAR PANE — upcoming filings & accrued liabilities
   ========================================================================= */
function TaxCalendarPane({ ctx }) {
  const { state, perms, activeProperty, accessibleProperties } = ctx;
  const propsAll = perms.properties === "all" ? accessibleProperties : accessibleProperties.filter(p => p.id === activeProperty);
  const propIds = propsAll.map(p => p.id);

  // Compute liability per (property, month, taxType) from posted reports
  const liabilities = useMemo(() => {
    const map = {}; // key: propertyId|month|type
    state.reports.filter(r => propIds.includes(r.propertyId)).forEach(r => {
      const month = r.date.slice(0, 7);
      const occ = r.breakdown?.taxes?.occupancy || 0;
      const sales = r.breakdown?.taxes?.sales || 0;
      const tourism = r.breakdown?.taxes?.tourism || 0;
      ["occupancy", "sales", "tourism"].forEach((t, i) => {
        const v = i === 0 ? occ : i === 1 ? sales : tourism;
        if (v > 0) {
          const k = `${r.propertyId}|${month}|${t}`;
          map[k] = (map[k] || 0) + v;
        }
      });
    });
    return Object.entries(map).map(([k, v]) => {
      const [propertyId, month, type] = k.split("|");
      const [yy, mm] = month.split("-").map(Number);
      // Filing deadlines: Arkansas hotels file occupancy + sales tax by 20th of next month, tourism tax quarterly
      let dueDate;
      if (type === "tourism") {
        // Quarterly: end of month after quarter
        const quarter = Math.floor((mm - 1) / 3);
        const dueMonth = (quarter + 1) * 3 + 1; // first month of next quarter
        const dueYear = dueMonth > 12 ? yy + 1 : yy;
        const dueMonthNorm = dueMonth > 12 ? dueMonth - 12 : dueMonth;
        dueDate = `${dueYear}-${String(dueMonthNorm).padStart(2, "0")}-30`;
      } else {
        const dueMonth = mm + 1 > 12 ? 1 : mm + 1;
        const dueYear = mm + 1 > 12 ? yy + 1 : yy;
        dueDate = `${dueYear}-${String(dueMonth).padStart(2, "0")}-20`;
      }
      return {
        propertyId, propertyName: state.properties.find(p => p.id === propertyId)?.name,
        month, type, amount: v, dueDate,
        overdue: new Date(dueDate) < TODAY,
        daysToDue: Math.floor((new Date(dueDate) - TODAY) / (24 * 3600 * 1000)),
      };
    }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [state.reports, propIds, state.properties]);

  const upcoming = liabilities.filter(l => !l.overdue && l.daysToDue <= 60);
  const overdue = liabilities.filter(l => l.overdue);
  const totalUpcoming = upcoming.reduce((s, l) => s + l.amount, 0);
  const totalOverdue = overdue.reduce((s, l) => s + l.amount, 0);

  const labelFor = (t) => ({ occupancy: "Occupancy Tax", sales: "Sales Tax", tourism: "Tourism Tax" })[t];
  const TypeBadge = ({ t }) => {
    const map = { occupancy: "amber", sales: "violet", tourism: "sky" };
    return <Badge color={map[t]}>{labelFor(t)}</Badge>;
  };

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-2 mb-1">
          <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Tax Compliance · Calendar</span>
        </div>
        <h2 className="font-display text-3xl text-stone-900">{fmtMoney(totalUpcoming + totalOverdue)} accrued</h2>
        <p className="text-sm text-stone-500 mt-1">
          Upcoming filings (next 60 days) · monthly occupancy &amp; sales filed by the 20th, tourism tax quarterly.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue Filings</div><div className={`font-display number-display text-3xl font-semibold ${totalOverdue > 0 ? "text-rose-700" : "text-stone-400"}`}>{fmtMoneyShort(totalOverdue)}</div><div className="text-xs text-stone-500 mt-1">{overdue.length} {overdue.length === 1 ? "filing" : "filings"} past due</div></Card>
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Due Next 30 Days</div><div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(upcoming.filter(l => l.daysToDue <= 30).reduce((s, l) => s + l.amount, 0))}</div><div className="text-xs text-stone-500 mt-1">{upcoming.filter(l => l.daysToDue <= 30).length} filings</div></Card>
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Total Accrued</div><div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(totalUpcoming + totalOverdue)}</div><div className="text-xs text-stone-500 mt-1">All open liability</div></Card>
      </div>

      {overdue.length > 0 && (
        <Card className="p-5 bg-rose-50 border-rose-200">
          <div className="flex gap-3">
            <AlertCircle size={18} className="text-rose-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-stone-900 mb-1">Past-due filings</h4>
              <p className="text-sm text-stone-700">
                {overdue.length} tax filing{overdue.length === 1 ? "" : "s"} totaling <strong className="tabular">{fmtMoney(totalOverdue)}</strong> are past their deadline.
                Most jurisdictions assess penalties &amp; interest after the filing date — prioritize these.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Filing schedule</h3>
        </div>
        {liabilities.length === 0 ? (
          <Empty icon={Calendar} title="No tax liability accrued" message="Tax obligations show up here once flash reports include taxes." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Status</th>
                <th className="text-left px-6 py-3 font-medium">Property</th>
                <th className="text-left px-6 py-3 font-medium">Period</th>
                <th className="text-left px-6 py-3 font-medium">Tax Type</th>
                <th className="text-left px-6 py-3 font-medium">Due By</th>
                <th className="text-right px-6 py-3 font-medium">Days</th>
                <th className="text-right px-6 py-3 font-medium">Liability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {liabilities.slice(0, 80).map((l, i) => (
                <tr key={i} className={`${l.overdue ? "bg-rose-50/40" : ""} hover:bg-stone-50`}>
                  <td className="px-6 py-2.5">
                    {l.overdue
                      ? <Badge color="rose">Overdue</Badge>
                      : l.daysToDue <= 7 ? <Badge color="amber">Due soon</Badge> : <Badge color="stone">Upcoming</Badge>}
                  </td>
                  <td className="px-6 py-2.5 text-stone-700">{l.propertyName}</td>
                  <td className="px-6 py-2.5 tabular text-stone-700">{l.month}</td>
                  <td className="px-6 py-2.5"><TypeBadge t={l.type} /></td>
                  <td className="px-6 py-2.5 tabular text-stone-700">{fmtDate(l.dueDate)}</td>
                  <td className={`px-6 py-2.5 text-right tabular ${l.overdue ? "text-rose-700 font-semibold" : "text-stone-700"}`}>
                    {l.overdue ? `${Math.abs(l.daysToDue)}d late` : `${l.daysToDue}d`}
                  </td>
                  <td className="px-6 py-2.5 text-right tabular font-semibold">{fmtMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* =========================================================================
   ACCOUNTS PAYABLE PANE — vendor invoices, approval, payment, AP aging
   ========================================================================= */
function ApPane({ ctx }) {
  const { state, update, currentUser, perms, activeProperty, accessibleProperties, toast } = ctx;
  const propsAll = perms.properties === "all" ? accessibleProperties : accessibleProperties.filter(p => p.id === activeProperty);
  const propIds = propsAll.map(p => p.id);
  const [filter, setFilter] = useState("all"); // all | open | overdue | paid | pending-approval
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [showVendorList, setShowVendorList] = useState(false);

  const visibleInvoices = useMemo(() => {
    return state.invoices.filter(inv => propIds.includes(inv.propertyId));
  }, [state.invoices, propIds]);

  const filtered = useMemo(() => {
    let r = visibleInvoices;
    if (filter === "open") r = r.filter(i => i.status === "open" || i.status === "overdue");
    else if (filter === "overdue") r = r.filter(i => i.status === "overdue");
    else if (filter === "paid") r = r.filter(i => i.status === "paid");
    else if (filter === "pending-approval") r = r.filter(i => i.approvalState === "pending");
    return [...r].sort((a, b) => b.issuedDate.localeCompare(a.issuedDate));
  }, [visibleInvoices, filter]);

  // Aging buckets
  const aging = useMemo(() => {
    const o = { current: 0, b30: 0, b60: 0, b90: 0, total: 0 };
    visibleInvoices.filter(i => i.status === "open" || i.status === "overdue").forEach(i => {
      const days = Math.max(0, Math.floor((TODAY - new Date(i.dueDate)) / (24 * 3600 * 1000)));
      const bucket = days <= 0 ? "current" : days < 30 ? "b30" : days < 60 ? "b60" : "b90";
      o[bucket] += i.amount;
      o.total += i.amount;
    });
    return o;
  }, [visibleInvoices]);

  // Spend by category (last 30d)
  const spendByCategory = useMemo(() => {
    const cutoff = addDays(TODAY, -30);
    const map = {};
    visibleInvoices
      .filter(i => i.status === "paid" && i.paidDate && new Date(i.paidDate) >= cutoff)
      .forEach(i => {
        const v = state.vendors.find(x => x.id === i.vendorId);
        const cat = v?.category || "Other";
        map[cat] = (map[cat] || 0) + i.amount;
      });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [visibleInvoices, state.vendors]);

  const totalSpend = spendByCategory.reduce((s, [, v]) => s + v, 0);

  const updateInvoice = (id, patch) => {
    update({ invoices: state.invoices.map(i => i.id === id ? { ...i, ...patch } : i) });
    pushActivity(ctx, "invoice.update", { invoiceId: id, ...patch });
  };
  const approveInvoice = (id) => {
    updateInvoice(id, { approvalState: "approved", approvedBy: currentUser.id, approvedAt: new Date().toISOString() });
    toast?.push("Invoice approved", { tone: "success" });
  };
  const markPaid = (id) => {
    updateInvoice(id, { status: "paid", paidDate: iso(TODAY), paidBy: currentUser.id });
    toast?.push("Marked as paid", { tone: "success" });
  };
  const saveInvoice = (draft) => {
    if (draft.id && state.invoices.find(i => i.id === draft.id)) {
      update({ invoices: state.invoices.map(i => i.id === draft.id ? { ...i, ...draft } : i) });
      pushActivity(ctx, "invoice.update", { invoiceId: draft.id });
      toast?.push("Invoice updated", { tone: "success" });
    } else {
      const newInv = { ...draft, id: newId("inv"), createdAt: new Date().toISOString(), createdBy: currentUser.id };
      update({ invoices: [...state.invoices, newInv] });
      pushActivity(ctx, "invoice.create", { invoiceId: newInv.id, amount: newInv.amount });
      toast?.push("Invoice posted", { tone: "success" });
    }
    setShowInvoiceModal(false);
    setEditingInvoice(null);
  };

  const Bucket = ({ label, value, color }) => {
    const pct = aging.total ? value / aging.total : 0;
    return (
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">{label}</div>
        <div className="font-display number-display text-2xl text-stone-900 font-semibold">{fmtMoneyShort(value)}</div>
        <div className="text-xs text-stone-500 mt-1">{(pct * 100).toFixed(0)}% of open</div>
        <div className="mt-2 h-1 rounded-full bg-stone-100 overflow-hidden">
          <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
        </div>
      </Card>
    );
  };

  const StatusPill = ({ inv }) => {
    if (inv.status === "paid") return <Badge color="emerald">Paid</Badge>;
    if (inv.status === "overdue") return <Badge color="rose">Overdue</Badge>;
    if (inv.approvalState === "pending") return <Badge color="amber">Pending approval</Badge>;
    return <Badge color="sky">Open</Badge>;
  };

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Accounts Payable</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{fmtMoney(aging.total)} open</h2>
          <p className="text-sm text-stone-500 mt-1">
            {visibleInvoices.length} invoices on file · {state.vendors.length} active vendors ·
            {visibleInvoices.filter(i => i.approvalState === "pending").length} awaiting approval
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowVendorList(true)}><Users size={14} />Vendors</Button>
          <Button variant="accent" onClick={() => { setEditingInvoice(null); setShowInvoiceModal(true); }}><Plus size={14} />New Invoice</Button>
        </div>
      </div>

      {/* Aging buckets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Bucket label="Current / Not due" value={aging.current} color="bg-emerald-500" />
        <Bucket label="1-29 past due" value={aging.b30} color="bg-amber-500" />
        <Bucket label="30-59 past due" value={aging.b60} color="bg-amber-700" />
        <Bucket label="60+ past due" value={aging.b90} color="bg-rose-600" />
      </div>

      {/* Filters + spend by category */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex items-center gap-2 flex-wrap">
          {[
            ["all", "All"],
            ["open", "Open"],
            ["overdue", "Overdue"],
            ["pending-approval", "Pending Approval"],
            ["paid", "Paid"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${filter === id ? "bg-amber-700 text-white border-amber-800" : "bg-white text-stone-600 border-stone-300 hover:border-amber-400"}`}>
              {label}
            </button>
          ))}
        </div>
        {spendByCategory.length > 0 && (
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">Last 30 days · spend by category</div>
            <div className="space-y-1.5">
              {spendByCategory.slice(0, 4).map(([cat, val]) => {
                const pct = totalSpend ? val / totalSpend : 0;
                return (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-stone-700">{cat}</span>
                      <span className="tabular text-stone-900 font-medium">{fmtMoneyShort(val)}</span>
                    </div>
                    <div className="h-1 rounded-full bg-stone-100 overflow-hidden">
                      <div className="h-full bg-amber-700" style={{ width: `${pct * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Invoice table */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Invoices · {filtered.length} {filter !== "all" ? `(${filter})` : ""}</h3>
        </div>
        {filtered.length === 0 ? (
          <Empty icon={Receipt} title="No invoices match" message="Try changing the filter or post a new invoice." />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium">Property</th>
                  <th className="text-left px-4 py-3 font-medium">Issued</th>
                  <th className="text-left px-4 py-3 font-medium">Due</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.slice(0, 100).map(inv => {
                  const v = state.vendors.find(x => x.id === inv.vendorId);
                  const p = state.properties.find(x => x.id === inv.propertyId);
                  return (
                    <tr key={inv.id} className="hover:bg-stone-50">
                      <td className="px-4 py-2.5 font-mono tabular text-xs text-stone-700">{inv.number}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-stone-900">{v?.name}</div>
                        <div className="text-xs text-stone-500">{v?.category}</div>
                      </td>
                      <td className="px-4 py-2.5 text-stone-700 text-xs">{p?.name}</td>
                      <td className="px-4 py-2.5 tabular text-stone-700">{fmtDateShort(inv.issuedDate)}</td>
                      <td className="px-4 py-2.5 tabular text-stone-700">{fmtDateShort(inv.dueDate)}</td>
                      <td className="px-4 py-2.5 text-right tabular font-semibold">{fmtMoney(inv.amount)}</td>
                      <td className="px-4 py-2.5"><StatusPill inv={inv} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          {inv.approvalState === "pending" && perms.canRunPayroll && (
                            <button onClick={() => approveInvoice(inv.id)} className="text-xs px-2 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800">Approve</button>
                          )}
                          {inv.status !== "paid" && inv.approvalState === "approved" && perms.canRunPayroll && (
                            <button onClick={() => markPaid(inv.id)} className="text-xs px-2 py-1 rounded bg-amber-700 text-white hover:bg-amber-800">Pay</button>
                          )}
                          <button onClick={() => { setEditingInvoice(inv); setShowInvoiceModal(true); }} className="text-stone-500 hover:text-stone-900 p-1">
                            <Edit2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showInvoiceModal && (
        <InvoiceModal
          invoice={editingInvoice}
          ctx={ctx}
          onSave={saveInvoice}
          onClose={() => { setShowInvoiceModal(false); setEditingInvoice(null); }}
        />
      )}

      {showVendorList && (
        <VendorListModal
          ctx={ctx}
          onClose={() => setShowVendorList(false)}
        />
      )}
    </div>
  );
}

function InvoiceModal({ invoice, ctx, onSave, onClose }) {
  const { state, accessibleProperties } = ctx;
  const today = iso(TODAY);
  const [draft, setDraft] = useState(invoice || {
    vendorId: state.vendors[0]?.id || "",
    propertyId: accessibleProperties[0]?.id || "",
    number: `INV-${Math.floor(Math.random() * 90000 + 10000)}`,
    issuedDate: today,
    dueDate: iso(addDays(TODAY, 30)),
    amount: 0,
    status: "open",
    glAccount: "5900",
    memo: "",
    approvalState: "pending",
  });
  const handle = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const valid = draft.vendorId && draft.propertyId && draft.amount > 0 && draft.issuedDate && draft.dueDate;

  return (
    <Modal open onClose={onClose} title={invoice ? "Edit Invoice" : "New Invoice"} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Vendor" value={draft.vendorId} onChange={v => handle("vendorId", v)}
            options={state.vendors.map(v => ({ value: v.id, label: `${v.name} · ${v.category}` }))} />
          <Select label="Property" value={draft.propertyId} onChange={v => handle("propertyId", v)}
            options={accessibleProperties.map(p => ({ value: p.id, label: p.name }))} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Invoice #" value={draft.number} onChange={v => handle("number", v)} />
          <Input label="Issued Date" type="date" value={draft.issuedDate} onChange={v => handle("issuedDate", v)} />
          <Input label="Due Date" type="date" value={draft.dueDate} onChange={v => handle("dueDate", v)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Amount ($)" type="number" value={draft.amount} onChange={v => handle("amount", Number(v))} />
          <Input label="GL Account" value={draft.glAccount} onChange={v => handle("glAccount", v)} placeholder="e.g. 5210" />
        </div>
        <Textarea label="Memo / Notes" value={draft.memo} onChange={v => handle("memo", v)} rows={3} placeholder="Description of goods/services or reference" />
        <div className="flex items-center justify-between pt-3 border-t border-stone-200">
          <span className="text-xs text-stone-500">Posting to GL · {fmtMoney(draft.amount)}</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!valid} onClick={() => onSave(draft)}><Save size={14} />{invoice ? "Save" : "Post Invoice"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function VendorListModal({ ctx, onClose }) {
  const { state, update, toast } = ctx;
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: "", category: "Operations", terms: "Net 30", contact: "" });
  const handle = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const addVendor = () => {
    if (!draft.name) return;
    const v = { ...draft, id: newId("v") };
    update({ vendors: [...state.vendors, v] });
    pushActivity(ctx, "vendor.create", { vendorId: v.id, name: v.name });
    toast?.push(`Vendor "${draft.name}" added`, { tone: "success" });
    setDraft({ name: "", category: "Operations", terms: "Net 30", contact: "" });
    setShowAdd(false);
  };

  return (
    <Modal open onClose={onClose} title={`Vendors · ${state.vendors.length}`} size="lg">
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button variant="accent" size="sm" onClick={() => setShowAdd(s => !s)}><Plus size={14} />{showAdd ? "Cancel" : "Add Vendor"}</Button>
        </div>
        {showAdd && (
          <Card className="p-4 bg-amber-50/40 border-amber-200">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Vendor Name" value={draft.name} onChange={v => handle("name", v)} placeholder="e.g. Sysco Foods" />
              <Select label="Category" value={draft.category} onChange={v => handle("category", v)} options={[
                { value: "Food & Beverage", label: "Food & Beverage" },
                { value: "Operations", label: "Operations" },
                { value: "Utilities", label: "Utilities" },
                { value: "Maintenance", label: "Maintenance" },
                { value: "Housekeeping", label: "Housekeeping" },
                { value: "Guest Supplies", label: "Guest Supplies" },
                { value: "Marketing", label: "Marketing" },
                { value: "Professional", label: "Professional Services" },
                { value: "Other", label: "Other" },
              ]} />
              <Select label="Payment Terms" value={draft.terms} onChange={v => handle("terms", v)} options={[
                { value: "Net 15", label: "Net 15" },
                { value: "Net 30", label: "Net 30" },
                { value: "Net 45", label: "Net 45" },
                { value: "Net 60", label: "Net 60" },
                { value: "Due on Receipt", label: "Due on Receipt" },
              ]} />
              <Input label="A/R Contact" value={draft.contact} onChange={v => handle("contact", v)} placeholder="ar@vendor.com" />
            </div>
            <div className="flex justify-end mt-3">
              <Button variant="primary" disabled={!draft.name} onClick={addVendor}><Save size={14} />Save</Button>
            </div>
          </Card>
        )}
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Vendor</th>
              <th className="text-left px-4 py-2.5 font-medium">Category</th>
              <th className="text-left px-4 py-2.5 font-medium">Terms</th>
              <th className="text-left px-4 py-2.5 font-medium">Contact</th>
              <th className="text-right px-4 py-2.5 font-medium">Open Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {state.vendors.map(v => {
              const open = state.invoices.filter(i => i.vendorId === v.id && (i.status === "open" || i.status === "overdue")).reduce((s, i) => s + i.amount, 0);
              return (
                <tr key={v.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium text-stone-900">{v.name}</td>
                  <td className="px-4 py-2.5 text-stone-700">{v.category}</td>
                  <td className="px-4 py-2.5 text-stone-700 tabular">{v.terms}</td>
                  <td className="px-4 py-2.5 text-stone-500 text-xs">{v.contact}</td>
                  <td className="px-4 py-2.5 text-right tabular font-semibold">{open ? fmtMoney(open) : <span className="text-stone-400">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* =========================================================================
   A/R AGING PANE — direct-bill (city ledger) aging buckets
   ========================================================================= */
function ArAgingPane({ ctx }) {
  const { state, perms, activeProperty, accessibleProperties } = ctx;
  const propsAll = perms.properties === "all" ? accessibleProperties : accessibleProperties.filter(p => p.id === activeProperty);
  const propIds = propsAll.map(p => p.id);

  // Each report's directBill becomes an A/R "invoice" aged from its date.
  // In real production this would be tied to actual guest folios — we treat each
  // day's DB total as a single ledger entry for the demo.
  const today = TODAY;
  const buckets = useMemo(() => {
    const out = { current: 0, b30: 0, b60: 0, b90: 0, b120: 0, total: 0, lines: [] };
    state.reports
      .filter(r => propIds.includes(r.propertyId))
      .map(enrichReport)
      .forEach(r => {
        const db = r.breakdown?.payments?.directBill || 0;
        if (!db) return;
        const days = Math.max(0, Math.floor((today - new Date(r.date)) / (24 * 3600 * 1000)));
        const prop = propsAll.find(p => p.id === r.propertyId);
        const line = {
          property: prop?.name,
          date: r.date,
          amount: db,
          days,
          bucket: days < 30 ? "current" : days < 60 ? "b30" : days < 90 ? "b60" : days < 120 ? "b90" : "b120",
        };
        out[line.bucket] += db;
        out.total += db;
        out.lines.push(line);
      });
    out.lines.sort((a, b) => b.days - a.days);
    return out;
  }, [state.reports, propIds]);

  const Bucket = ({ label, value, total, color }) => {
    const pct = total ? value / total : 0;
    return (
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">{label}</div>
        <div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(value)}</div>
        <div className="text-xs text-stone-500 mt-1">{(pct * 100).toFixed(1)}% of total A/R</div>
        <div className="mt-3 h-1.5 rounded-full bg-stone-100 overflow-hidden">
          <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
        </div>
      </Card>
    );
  };

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div>
        <div className="inline-flex items-center gap-2 mb-1">
          <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Accounts Receivable · City Ledger</span>
        </div>
        <h2 className="font-display text-3xl text-stone-900">{fmtMoney(buckets.total)} outstanding</h2>
        <p className="text-sm text-stone-500 mt-1">Aged direct-bill receivables across {propsAll.length} {propsAll.length === 1 ? "property" : "properties"}.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Bucket label="Current (0-29)" value={buckets.current} total={buckets.total} color="bg-emerald-500" />
        <Bucket label="30-59 days" value={buckets.b30} total={buckets.total} color="bg-amber-400" />
        <Bucket label="60-89 days" value={buckets.b60} total={buckets.total} color="bg-amber-600" />
        <Bucket label="90-119 days" value={buckets.b90} total={buckets.total} color="bg-rose-500" />
        <Bucket label="120+ days" value={buckets.b120} total={buckets.total} color="bg-rose-700" />
      </div>

      {buckets.b90 + buckets.b120 > 0 && (
        <Card className="p-5 bg-rose-50 border-rose-200">
          <div className="flex gap-3">
            <AlertCircle size={18} className="text-rose-700 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-stone-900 mb-1">Collection focus needed</h4>
              <p className="text-sm text-stone-700">
                <strong className="tabular">{fmtMoney(buckets.b90 + buckets.b120)}</strong> is over 90 days old —
                ~{(((buckets.b90 + buckets.b120) / Math.max(1, buckets.total)) * 100).toFixed(0)}% of your A/R book.
                These accounts are the highest write-off risk.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Detail · {buckets.lines.length} entries</h3>
        </div>
        {buckets.lines.length === 0 ? (
          <Empty icon={Receipt} title="No A/R outstanding" message="Direct-bill activity will appear here once posted." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Property</th>
                <th className="text-left px-6 py-3 font-medium">Posted</th>
                <th className="text-right px-6 py-3 font-medium">Age</th>
                <th className="text-right px-6 py-3 font-medium">Bucket</th>
                <th className="text-right px-6 py-3 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {buckets.lines.slice(0, 80).map((l, i) => {
                const colors = { current: "emerald", b30: "amber", b60: "amber", b90: "rose", b120: "rose" };
                const labels = { current: "Current", b30: "30+", b60: "60+", b90: "90+", b120: "120+" };
                return (
                  <tr key={i} className="hover:bg-stone-50">
                    <td className="px-6 py-2.5 text-stone-700">{l.property}</td>
                    <td className="px-6 py-2.5 tabular text-stone-700">{fmtDate(l.date)}</td>
                    <td className="px-6 py-2.5 text-right tabular text-stone-700">{l.days}d</td>
                    <td className="px-6 py-2.5 text-right"><Badge color={colors[l.bucket]}>{labels[l.bucket]}</Badge></td>
                    <td className="px-6 py-2.5 text-right tabular font-semibold">{fmtMoney(l.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* =========================================================================
   PORTFOLIO PANE — multi-property roll-up (admin / multi-property managers)
   ========================================================================= */
function PortfolioPane({ ctx, setTab }) {
  const { state, accessibleProperties, setActiveProperty } = ctx;
  const [range, setRange] = useState(30);

  const propsAll = accessibleProperties;
  const enrichedReports = useMemo(() => state.reports.map(enrichReport), [state.reports]);
  const cutoff = addDays(TODAY, -range);

  const rows = propsAll.map(p => {
    const rs = enrichedReports.filter(r => r.propertyId === p.id && new Date(r.date) >= cutoff);
    const totalRev = rs.reduce((s, r) => s + r.totalRevenue, 0);
    const roomRev = rs.reduce((s, r) => s + (r.breakdown?.revenue?.rooms || 0), 0);
    const fbRev = rs.reduce((s, r) => s + sumFb(r.breakdown), 0);
    const otherRev = rs.reduce((s, r) => s + sumOther(r.breakdown), 0);
    const sold = rs.reduce((s, r) => s + r.roomsSold, 0);
    const avail = rs.reduce((s, r) => s + r.roomsAvailable, 0);
    return {
      property: p,
      days: rs.length,
      totalRev,
      roomRev, fbRev, otherRev,
      occupancy: avail ? sold / avail : 0,
      adr: sold ? roomRev / sold : 0,
      revpar: avail ? roomRev / avail : 0,
    };
  }).sort((a, b) => b.totalRev - a.totalRev);

  const grand = rows.reduce((acc, r) => ({
    rev: acc.rev + r.totalRev,
    sold: acc.sold + r.property.rooms * r.occupancy * r.days,
    avail: acc.avail + r.property.rooms * r.days,
    rooms: acc.rooms + r.roomRev,
  }), { rev: 0, sold: 0, avail: 0, rooms: 0 });
  const portfolioOcc = grand.avail ? grand.sold / grand.avail : 0;
  const portfolioAdr = grand.sold ? grand.rooms / grand.sold : 0;
  const portfolioRevpar = grand.avail ? grand.rooms / grand.avail : 0;

  const maxRev = Math.max(1, ...rows.map(r => r.totalRev));

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Portfolio Roll-up</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">All Properties · Last {range} days</h2>
          <p className="text-sm text-stone-500 mt-1">{propsAll.length} properties · {propsAll.reduce((s, p) => s + p.rooms, 0)} rooms total</p>
        </div>
        <select value={range} onChange={e => setRange(Number(e.target.value))} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Portfolio Revenue</div><div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(grand.rev)}</div><div className="text-xs text-stone-500 mt-1">{fmtMoney(grand.rev)}</div></Card>
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Avg Occupancy</div><div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtPct(portfolioOcc)}</div><div className="text-xs text-stone-500 mt-1">All properties</div></Card>
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Portfolio ADR</div><div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoney(portfolioAdr)}</div><div className="text-xs text-stone-500 mt-1">Weighted</div></Card>
        <Card className="p-5"><div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Portfolio RevPAR</div><div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoney(portfolioRevpar)}</div><div className="text-xs text-stone-500 mt-1">Weighted</div></Card>
      </div>

      <Card>
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Property contribution</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-medium">Property</th>
              <th className="text-left px-6 py-3 font-medium w-1/3">Share</th>
              <th className="text-right px-6 py-3 font-medium">Total Rev</th>
              <th className="text-right px-6 py-3 font-medium">Rooms</th>
              <th className="text-right px-6 py-3 font-medium">F&amp;B</th>
              <th className="text-right px-6 py-3 font-medium">Other</th>
              <th className="text-right px-6 py-3 font-medium">Occ</th>
              <th className="text-right px-6 py-3 font-medium">ADR</th>
              <th className="text-right px-6 py-3 font-medium">RevPAR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r, i) => {
              const sharePct = grand.rev ? r.totalRev / grand.rev : 0;
              return (
                <tr key={r.property.id} className="hover:bg-amber-50/40 cursor-pointer transition-colors"
                  onClick={() => { setActiveProperty(r.property.id); setTab("flash"); }}>
                  <td className="px-6 py-3">
                    <div className="font-medium text-stone-900 flex items-center gap-1.5">
                      {r.property.name}
                      <ChevronRight size={14} className="text-stone-400" />
                    </div>
                    <div className="text-xs text-stone-500">{r.property.location} · {r.property.rooms} rooms</div>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-600 to-amber-700" style={{ width: `${sharePct * 100}%` }} />
                      </div>
                      <span className="text-xs tabular text-stone-700 w-12 text-right">{(sharePct * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right tabular font-semibold">{fmtMoney(r.totalRev)}</td>
                  <td className="px-6 py-3 text-right tabular text-stone-700">{fmtMoneyShort(r.roomRev)}</td>
                  <td className="px-6 py-3 text-right tabular text-stone-700">{fmtMoneyShort(r.fbRev)}</td>
                  <td className="px-6 py-3 text-right tabular text-stone-700">{fmtMoneyShort(r.otherRev)}</td>
                  <td className="px-6 py-3 text-right tabular">{fmtPct(r.occupancy)}</td>
                  <td className="px-6 py-3 text-right tabular">{fmtMoney(r.adr)}</td>
                  <td className="px-6 py-3 text-right tabular">{fmtMoney(r.revpar)}</td>
                </tr>
              );
            })}
            <tr className="bg-stone-50 font-semibold">
              <td className="px-6 py-3 text-stone-900">Portfolio Total</td>
              <td className="px-6 py-3"></td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtMoney(grand.rev)}</td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtMoneyShort(grand.rooms)}</td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtMoneyShort(rows.reduce((s, r) => s + r.fbRev, 0))}</td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtMoneyShort(rows.reduce((s, r) => s + r.otherRev, 0))}</td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtPct(portfolioOcc)}</td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtMoney(portfolioAdr)}</td>
              <td className="px-6 py-3 text-right tabular text-stone-900">{fmtMoney(portfolioRevpar)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* =========================================================================
   P&L PANE — Schedule of Operating Revenue (USALI)
   ========================================================================= */
function PnlPane({ ctx }) {
  const { state, perms, activeProperty, accessibleProperties } = ctx;
  const [propId, setPropId] = useState(perms.properties === "all" ? accessibleProperties[0]?.id : activeProperty);
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);

  const property = state.properties.find(p => p.id === propId);
  const enrichedReports = useMemo(() => state.reports.map(enrichReport), [state.reports]);
  const actual = useMemo(() => _actualsFor(enrichedReports, propId, month) || {
    rooms: { revenue: 0 }, fb: {}, other: {}, taxes: {}, totalRevenue: 0, days: 0,
  }, [enrichedReports, propId, month]);
  const budget = useMemo(() =>
    state.budgets.find(b => b.propertyId === propId && b.month === month) || _emptyBudget(propId, month)
  , [state.budgets, propId, month]);

  // YTD
  const ytd = useMemo(() => {
    const yr = month.slice(0, 4);
    const ytdReports = enrichedReports.filter(r => r.propertyId === propId && r.date.startsWith(yr) && r.date <= `${month}-31`);
    const sumByPath = (path) => ytdReports.reduce((s, r) => {
      const v = path.split(".").reduce((o, k) => (o == null ? null : o[k]), r.breakdown);
      return s + (v || 0);
    }, 0);
    return {
      roomRev: ytdReports.reduce((s, r) => s + (r.roomRevenue || 0), 0),
      fbRest: sumByPath("revenue.fb.restaurant"),
      fbBar: sumByPath("revenue.fb.bar"),
      fbBanq: sumByPath("revenue.fb.banquet"),
      parking: sumByPath("revenue.other.parking"),
      spa: sumByPath("revenue.other.spa"),
      tele: sumByPath("revenue.other.telephone"),
      misc: sumByPath("revenue.other.misc"),
      occTax: sumByPath("taxes.occupancy"),
      salesTax: sumByPath("taxes.sales"),
      tourismTax: sumByPath("taxes.tourism"),
      total: ytdReports.reduce((s, r) => s + r.totalRevenue, 0),
    };
  }, [enrichedReports, propId, month]);

  const monthOptions = useMemo(() => {
    const months = new Set(state.reports.filter(r => r.propertyId === propId).map(r => _monthOf(r.date)));
    months.add(defaultMonth);
    return [...months].sort().reverse();
  }, [state.reports, propId]);

  const Row = ({ label, mtdActual, mtdBudget, ytdActual, indent, isTotal, isSubtotal, isNegative }) => {
    const variance = (mtdActual || 0) - (mtdBudget || 0);
    const vPct = mtdBudget ? variance / mtdBudget : null;
    const dirColor = Math.abs(variance) < 0.01 ? "text-stone-500" : (variance > 0) === !isNegative ? "text-emerald-700" : "text-rose-700";
    return (
      <tr className={`${isTotal ? "bg-stone-900 text-white font-semibold" : isSubtotal ? "bg-stone-50 font-semibold" : "hover:bg-stone-50"}`}>
        <td className={`px-6 py-2.5 ${indent ? "pl-10" : "font-medium"} ${isTotal ? "text-white" : isSubtotal ? "text-stone-900" : "text-stone-700"}`}>{label}</td>
        <td className={`px-6 py-2.5 text-right tabular ${isTotal ? "text-white" : "text-stone-900"}`}>{fmtMoney(mtdActual || 0)}</td>
        <td className={`px-6 py-2.5 text-right tabular ${isTotal ? "text-stone-300" : "text-stone-500"}`}>{fmtMoney(mtdBudget || 0)}</td>
        <td className={`px-6 py-2.5 text-right tabular font-semibold ${isTotal ? "text-emerald-300" : dirColor}`}>
          {Math.abs(variance) < 0.01 ? "—" : `${variance > 0 ? "+" : ""}${fmtMoney(variance)}`}
        </td>
        <td className={`px-6 py-2.5 text-right tabular font-semibold ${isTotal ? "text-emerald-300" : dirColor}`}>
          {vPct == null ? "—" : `${vPct >= 0 ? "+" : ""}${(vPct * 100).toFixed(1)}%`}
        </td>
        <td className={`px-6 py-2.5 text-right tabular ${isTotal ? "text-white" : "text-stone-700"}`}>{fmtMoney(ytdActual || 0)}</td>
      </tr>
    );
  };

  const fbActual = (actual.fb?.restaurant || 0) + (actual.fb?.bar || 0) + (actual.fb?.banquet || 0);
  const otherActual = (actual.other?.parking || 0) + (actual.other?.spa || 0) + (actual.other?.telephone || 0) + (actual.other?.misc || 0);
  const fbBudget = (budget.fb?.restaurant || 0) + (budget.fb?.bar || 0) + (budget.fb?.banquet || 0);
  const otherBudget = (budget.other?.parking || 0) + (budget.other?.spa || 0) + (budget.other?.telephone || 0) + (budget.other?.misc || 0);
  const totalActual = actual.totalRevenue || 0;
  const totalBudget = _budgetTotal(budget);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Schedule of Operating Revenue · USALI</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name}</h2>
          <p className="text-sm text-stone-500 mt-1">Period {month} · MTD with budget variance &amp; YTD comparison</p>
        </div>
        <div className="flex items-center gap-2">
          {accessibleProperties.length > 1 && (
            <select value={propId} onChange={e => setPropId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium">
              {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium tabular">
            {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-medium">Account</th>
              <th className="text-right px-6 py-3 font-medium">MTD Actual</th>
              <th className="text-right px-6 py-3 font-medium">MTD Budget</th>
              <th className="text-right px-6 py-3 font-medium">Variance $</th>
              <th className="text-right px-6 py-3 font-medium">Variance %</th>
              <th className="text-right px-6 py-3 font-medium">YTD Actual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            <tr className="bg-stone-50"><td colSpan={6} className="px-6 py-2 text-[11px] uppercase tracking-widest text-stone-500 font-bold">Operating Revenue</td></tr>
            <Row label="Rooms Revenue" mtdActual={actual.rooms?.revenue} mtdBudget={budget.rooms?.revenue} ytdActual={ytd.roomRev} />
            <Row label="Restaurant" mtdActual={actual.fb?.restaurant} mtdBudget={budget.fb?.restaurant} ytdActual={ytd.fbRest} indent />
            <Row label="Bar / Lounge" mtdActual={actual.fb?.bar} mtdBudget={budget.fb?.bar} ytdActual={ytd.fbBar} indent />
            <Row label="Banquet" mtdActual={actual.fb?.banquet} mtdBudget={budget.fb?.banquet} ytdActual={ytd.fbBanq} indent />
            <Row label="Total F&B Revenue" mtdActual={fbActual} mtdBudget={fbBudget} ytdActual={ytd.fbRest + ytd.fbBar + ytd.fbBanq} isSubtotal />
            <Row label="Parking" mtdActual={actual.other?.parking} mtdBudget={budget.other?.parking} ytdActual={ytd.parking} indent />
            <Row label="Spa / Wellness" mtdActual={actual.other?.spa} mtdBudget={budget.other?.spa} ytdActual={ytd.spa} indent />
            <Row label="Telephone" mtdActual={actual.other?.telephone} mtdBudget={budget.other?.telephone} ytdActual={ytd.tele} indent />
            <Row label="Misc / Sundry" mtdActual={actual.other?.misc} mtdBudget={budget.other?.misc} ytdActual={ytd.misc} indent />
            <Row label="Total Other Revenue" mtdActual={otherActual} mtdBudget={otherBudget} ytdActual={ytd.parking + ytd.spa + ytd.tele + ytd.misc} isSubtotal />
            <Row label="Total Operating Revenue" mtdActual={totalActual} mtdBudget={totalBudget} ytdActual={ytd.total} isTotal />
            <tr className="bg-stone-50"><td colSpan={6} className="px-6 py-2 text-[11px] uppercase tracking-widest text-stone-500 font-bold">Tax Liabilities (Pass-Through)</td></tr>
            <Row label="Occupancy Tax" mtdActual={actual.taxes?.occupancy} mtdBudget={0} ytdActual={ytd.occTax} indent isNegative />
            <Row label="Sales Tax" mtdActual={actual.taxes?.sales} mtdBudget={0} ytdActual={ytd.salesTax} indent isNegative />
            <Row label="Tourism Tax" mtdActual={actual.taxes?.tourism} mtdBudget={0} ytdActual={ytd.tourismTax} indent isNegative />
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* =========================================================================
   RECONCILE PANE — data quality & exception list
   ========================================================================= */
function ReconcilePane({ ctx, setTab }) {
  const { state, update, currentUser, perms, activeProperty, accessibleProperties, toast } = ctx;
  const propsAll = perms.properties === "all" ? accessibleProperties : accessibleProperties.filter(p => p.id === activeProperty);
  const propIds = propsAll.map(p => p.id);

  const enrichedReports = useMemo(() => state.reports.filter(r => propIds.includes(r.propertyId)).map(enrichReport), [state.reports, propIds]);
  const issues = useMemo(() => runReconciliation(enrichedReports, propsAll), [enrichedReports, propsAll]);

  // Cash deposit reconciliation: each day's posted cash vs deposit confirmed
  const recentCash = useMemo(() => {
    return enrichedReports
      .filter(r => new Date(r.date) >= addDays(TODAY, -14))
      .map(r => {
        const reportedCash = r.breakdown?.payments?.cash || 0;
        const depositConfirmed = r.cashDepositConfirmed != null ? r.cashDepositConfirmed : null;
        const variance = depositConfirmed != null ? depositConfirmed - reportedCash : null;
        return {
          report: r,
          property: state.properties.find(p => p.id === r.propertyId),
          reportedCash,
          depositConfirmed,
          variance,
          status: depositConfirmed == null ? "pending" :
            Math.abs(variance) < 0.01 ? "matched" :
            Math.abs(variance) < 5 ? "near" : "variance",
        };
      })
      .filter(r => r.reportedCash > 0)
      .sort((a, b) => b.report.date.localeCompare(a.report.date))
      .slice(0, 30);
  }, [enrichedReports]);

  const confirmDeposit = (reportId, amount) => {
    const updated = state.reports.map(r => r.id === reportId ? { ...r, cashDepositConfirmed: amount, cashDepositConfirmedAt: new Date().toISOString(), cashDepositConfirmedBy: currentUser.id } : r);
    update({ reports: updated });
    pushActivity(ctx, "cash.confirm", { reportId, amount });
    toast?.push("Deposit confirmed", { tone: "success" });
  };

  const today = new Date();
  // Default to PRIOR month for month-end close (it's what you actually close)
  const priorMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const defaultMonth = `${priorMonth.getFullYear()}-${String(priorMonth.getMonth() + 1).padStart(2, "0")}`;
  const [closeMonth, setCloseMonth] = useState(defaultMonth);
  const [closeProp, setCloseProp] = useState(propsAll[0]?.id || "");
  const isClosed = !!state.closedPeriods?.find(c => c.propertyId === closeProp && c.month === closeMonth);
  const monthIssues = issues.filter(i => i.date && i.date.startsWith(closeMonth) && propsAll.find(p => p.name === i.propertyName)?.id === closeProp);
  const monthReports = enrichedReports.filter(r => r.propertyId === closeProp && r.date.startsWith(closeMonth));
  const [yy, mm] = closeMonth.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const expectedDays = today.getFullYear() === yy && today.getMonth() === mm - 1 ? today.getDate() : daysInMonth;
  const postedDays = monthReports.length;
  const closeChecks = [
    { id: "days", ok: postedDays >= expectedDays, label: `All days posted`, detail: `${postedDays} of ${expectedDays} expected` },
    { id: "high", ok: monthIssues.filter(i => i.severity === "high").length === 0, label: `No high-severity reconciliation issues`, detail: `${monthIssues.filter(i => i.severity === "high").length} open` },
    { id: "med", ok: monthIssues.filter(i => i.severity === "medium").length === 0, label: `No medium-severity issues`, detail: `${monthIssues.filter(i => i.severity === "medium").length} open` },
    { id: "budget", ok: !!state.budgets.find(b => b.propertyId === closeProp && b.month === closeMonth), label: `Budget on file for the period`, detail: state.budgets.find(b => b.propertyId === closeProp && b.month === closeMonth) ? "Set" : "Missing" },
  ];
  const allClear = closeChecks.every(c => c.ok);

  const closePeriod = () => {
    if (!confirm(`Close ${closeMonth} for ${propsAll.find(p => p.id === closeProp)?.name}? Reports for the period will be locked.`)) return;
    const entry = { propertyId: closeProp, month: closeMonth, closedAt: new Date().toISOString(), closedBy: currentUser.id };
    update({ closedPeriods: [...(state.closedPeriods || []), entry] });
    pushActivity(ctx, "period.close", { propertyId: closeProp, month: closeMonth });
    toast?.push(`Period ${closeMonth} closed`, { tone: "success" });
  };
  const reopenPeriod = () => {
    if (!confirm(`Re-open ${closeMonth}? Reports will become editable again.`)) return;
    update({ closedPeriods: (state.closedPeriods || []).filter(c => !(c.propertyId === closeProp && c.month === closeMonth)) });
    pushActivity(ctx, "period.reopen", { propertyId: closeProp, month: closeMonth });
    toast?.push(`Period ${closeMonth} re-opened`, { tone: "warn" });
  };

  const Severity = ({ level }) => {
    const map = {
      high: { color: "rose", label: "High" },
      medium: { color: "amber", label: "Medium" },
      low: { color: "stone", label: "Low" },
    };
    const c = map[level] || map.low;
    return <Badge color={c.color}>{c.label}</Badge>;
  };

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Reconciliation · Data Quality</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{issues.length === 0 ? "All clear" : `${issues.length} ${issues.length === 1 ? "issue" : "issues"} to review`}</h2>
          <p className="text-sm text-stone-500 mt-1">Reports flagged for missing data, total mismatches, settlement variance, or unusual values.</p>
        </div>
        <Button variant="accent" onClick={() => setTab("ingest")}><Upload size={14} />Ingest Missing Day</Button>
      </div>

      {/* Cash deposit reconciliation */}
      {recentCash.length > 0 && (
        <Card className="overflow-hidden anim-fade-up">
          <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
            <div>
              <h3 className="font-display text-lg text-stone-900">Cash Deposit Reconciliation</h3>
              <p className="text-xs text-stone-500 mt-0.5">Match the cash reported on each night audit to the actual bank deposit confirmed.</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Matched</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" />Variance</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-stone-300" />Pending</span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Date</th>
                <th className="text-left px-6 py-3 font-medium">Property</th>
                <th className="text-right px-6 py-3 font-medium">Reported Cash</th>
                <th className="text-right px-6 py-3 font-medium">Deposit Confirmed</th>
                <th className="text-right px-6 py-3 font-medium">Variance</th>
                <th className="text-right px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {recentCash.slice(0, 15).map(c => (
                <CashRow key={c.report.id} c={c} onConfirm={confirmDeposit} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Month-end close workflow */}
      <Card className="overflow-hidden anim-fade-up">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between gap-3 flex-wrap bg-gradient-to-r from-stone-50 to-white">
          <div>
            <h3 className="font-display text-lg text-stone-900">Month-End Close</h3>
            <p className="text-xs text-stone-500 mt-0.5">Run pre-close checks, lock the books, and produce a sign-off audit trail.</p>
          </div>
          <div className="flex gap-2">
            {accessibleProperties.length > 1 && (
              <select value={closeProp} onChange={e => setCloseProp(e.target.value)} className="px-3 py-2 text-xs border border-stone-300 rounded-md bg-white font-medium">
                {propsAll.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <select value={closeMonth} onChange={e => setCloseMonth(e.target.value)} className="px-3 py-2 text-xs border border-stone-300 rounded-md bg-white tabular">
              {Array.from({ length: 12 }).map((_, i) => {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                return <option key={m} value={m}>{m}</option>;
              })}
            </select>
            {isClosed
              ? <Button variant="secondary" onClick={reopenPeriod}>Re-open period</Button>
              : <Button variant="success" disabled={!allClear} onClick={closePeriod}><CheckCircle2 size={14} />{allClear ? "Close period" : "Resolve checks first"}</Button>
            }
          </div>
        </div>
        <div className="px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {closeChecks.map(c => (
              <div key={c.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${c.ok ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center ${c.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {c.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-900">{c.label}</div>
                  <div className="text-xs text-stone-500">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
          {isClosed && (
            <div className="mt-4 p-3 rounded-lg border border-stone-300 bg-stone-50 text-xs text-stone-600">
              <strong className="text-stone-900">Period locked.</strong> Reports for {closeMonth} are read-only.
              Closed by {state.employees.find(e => e.id === state.closedPeriods.find(c => c.propertyId === closeProp && c.month === closeMonth)?.closedBy)?.firstName || "system"}
              {" on "}
              {fmtDate(state.closedPeriods.find(c => c.propertyId === closeProp && c.month === closeMonth)?.closedAt)}.
            </div>
          )}
        </div>
      </Card>

      {issues.length === 0 ? (
        <Card className="p-12 text-center">
          <CheckCircle2 size={32} className="mx-auto text-emerald-600 mb-3" />
          <h3 className="font-display text-xl text-stone-900">Books are clean</h3>
          <p className="text-sm text-stone-500 mt-2 max-w-md mx-auto">No outstanding data quality issues across the visible properties for the recent period.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3 font-medium">Severity</th>
                <th className="text-left px-6 py-3 font-medium">Property</th>
                <th className="text-left px-6 py-3 font-medium">Date</th>
                <th className="text-left px-6 py-3 font-medium">Issue</th>
                <th className="text-right px-6 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {issues.map((i, idx) => (
                <tr key={idx} className="hover:bg-stone-50">
                  <td className="px-6 py-3"><Severity level={i.severity} /></td>
                  <td className="px-6 py-3 text-stone-700">{i.propertyName}</td>
                  <td className="px-6 py-3 tabular text-stone-700">{i.date ? fmtDate(i.date) : "—"}</td>
                  <td className="px-6 py-3 text-stone-900 font-medium">{i.title}</td>
                  <td className="px-6 py-3 text-right text-xs text-stone-500 max-w-md">{i.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function CashRow({ c, onConfirm }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(c.depositConfirmed != null ? String(c.depositConfirmed) : String(c.reportedCash));
  const status = c.status;
  const colors = {
    matched: { dot: "bg-emerald-500", text: "text-emerald-700" },
    near: { dot: "bg-amber-400", text: "text-amber-700" },
    variance: { dot: "bg-rose-500", text: "text-rose-700" },
    pending: { dot: "bg-stone-300", text: "text-stone-500" },
  }[status];
  return (
    <tr className="hover:bg-stone-50">
      <td className="px-6 py-2.5 tabular text-stone-700">{fmtDate(c.report.date)}</td>
      <td className="px-6 py-2.5 text-stone-700">{c.property?.name}</td>
      <td className="px-6 py-2.5 text-right tabular font-medium">{fmtMoney(c.reportedCash)}</td>
      <td className="px-6 py-2.5 text-right">
        {editing ? (
          <div className="flex items-center gap-2 justify-end">
            <input type="number" value={val} onChange={e => setVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (() => { onConfirm(c.report.id, Number(val)); setEditing(false); })()}
              className="w-24 px-2 py-1 text-xs tabular border border-stone-300 rounded text-right" autoFocus />
            <button onClick={() => { onConfirm(c.report.id, Number(val)); setEditing(false); }} className="text-xs px-2 py-1 rounded bg-emerald-700 text-white">Save</button>
            <button onClick={() => setEditing(false)} className="text-xs text-stone-500">×</button>
          </div>
        ) : c.depositConfirmed != null ? (
          <button onClick={() => setEditing(true)} className="tabular text-stone-900 font-medium hover:underline">{fmtMoney(c.depositConfirmed)}</button>
        ) : (
          <button onClick={() => setEditing(true)} className="text-xs text-amber-700 font-medium hover:underline">+ Confirm</button>
        )}
      </td>
      <td className={`px-6 py-2.5 text-right tabular font-semibold ${c.variance == null ? "text-stone-400" : Math.abs(c.variance) < 0.01 ? "text-stone-500" : c.variance > 0 ? "text-emerald-700" : "text-rose-700"}`}>
        {c.variance == null ? "—" : Math.abs(c.variance) < 0.01 ? "✓" : `${c.variance > 0 ? "+" : ""}${fmtMoney(c.variance)}`}
      </td>
      <td className="px-6 py-2.5 text-right">
        <span className={`inline-flex items-center gap-1.5 text-xs ${colors.text}`}>
          <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
          {status === "matched" ? "Matched" : status === "near" ? "Near match" : status === "variance" ? "Variance" : "Pending"}
        </span>
      </td>
    </tr>
  );
}

function runReconciliation(reports, properties) {
  const issues = [];
  const propMap = Object.fromEntries(properties.map(p => [p.id, p]));
  // missing-day check (only for the last 14 days, ignore future dates)
  properties.forEach(p => {
    const propReports = reports.filter(r => r.propertyId === p.id);
    const seen = new Set(propReports.map(r => r.date));
    for (let d = 14; d >= 1; d--) {
      const dt = iso(addDays(TODAY, -d));
      if (!seen.has(dt)) {
        issues.push({
          severity: d <= 3 ? "high" : "medium",
          propertyName: p.name,
          date: dt,
          title: "Missing flash report",
          detail: `No audit posted for ${p.name} on ${fmtDate(dt)} (${fmtDayName(dt)}).`,
        });
      }
    }
  });
  // per-report integrity
  reports.forEach(r => {
    const p = propMap[r.propertyId];
    const b = r.breakdown || {};
    const roomRev = b.revenue?.rooms || 0;
    const fb = sumFb(b);
    const other = sumOther(b);
    const computed = roomRev + fb + other;
    const stated = r.totalRevenue || 0;
    if (stated > 0 && Math.abs(stated - computed) / stated > 0.03) {
      issues.push({
        severity: "high",
        propertyName: p?.name || r.propertyId,
        date: r.date,
        title: "Total ≠ sum of components",
        detail: `Stated total ${fmtMoney(stated)} differs from computed ${fmtMoney(computed)} by ${fmtMoney(Math.abs(stated - computed))}.`,
      });
    }
    // settlement total vs revenue
    const settlement = (b.payments?.cash || 0) + (b.payments?.creditCard || 0) + (b.payments?.directBill || 0) + (b.payments?.other || 0);
    if (settlement > 0 && stated > 0 && Math.abs(settlement - stated) / stated > 0.05) {
      issues.push({
        severity: "medium",
        propertyName: p?.name || r.propertyId,
        date: r.date,
        title: "Settlement variance",
        detail: `Payments ${fmtMoney(settlement)} vs revenue ${fmtMoney(stated)} — Δ ${fmtMoney(Math.abs(settlement - stated))}. Could indicate tip-out or A/R timing.`,
      });
    }
    // missing core fields
    if (!b.rooms?.available) {
      issues.push({ severity: "low", propertyName: p?.name || r.propertyId, date: r.date, title: "Missing rooms-available", detail: "Cannot compute occupancy without rooms-available." });
    }
    if (!b.taxes?.occupancy && roomRev > 0) {
      issues.push({ severity: "low", propertyName: p?.name || r.propertyId, date: r.date, title: "No occupancy tax", detail: "Room revenue posted with $0 occupancy tax — confirm tax exemptions." });
    }
  });

  return issues.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    return (b.date || "").localeCompare(a.date || "");
  }).slice(0, 60);
}

/* =========================================================================
   ACTIVITY LOG — append-only audit trail
   ========================================================================= */
let _pendingActivity = [];
let _activityCtxRef = null;
function pushActivity(ctx, kind, payload) {
  if (!ctx) return;
  const entry = {
    id: newId("a"),
    at: new Date().toISOString(),
    by: ctx.currentUser?.id || "system",
    kind, // dot.notation: "report.post", "shift.edit", "payroll.run", etc.
    payload,
  };
  if (ctx.update && ctx.state) {
    ctx.update({ activity: [entry, ...(ctx.state.activity || [])].slice(0, 1000) });
  } else {
    _pendingActivity.push(entry);
  }
}

/* =========================================================================
   TRENDS PANE
   ========================================================================= */
function TrendsPane({ ctx }) {
  const { state, perms, activeProperty, accessibleProperties } = ctx;
  const [range, setRange] = useState(30);
  const [propId, setPropId] = useState(perms.properties === "all" ? "all" : activeProperty);
  const propIds = propId === "all" ? accessibleProperties.map(p => p.id) : [propId];

  const chartData = useMemo(() => {
    const cutoff = addDays(TODAY, -range);
    const byDate = {};
    state.reports
      .filter(r => propIds.includes(r.propertyId) && new Date(r.date) >= cutoff)
      .forEach(r => {
        if (!byDate[r.date]) byDate[r.date] = { date: r.date, revenue: 0, rooms: 0, sold: 0, roomRev: 0 };
        byDate[r.date].revenue += r.totalRevenue;
        byDate[r.date].roomRev += r.roomRevenue;
        byDate[r.date].rooms += r.roomsAvailable;
        byDate[r.date].sold += r.roomsSold;
      });
    return Object.values(byDate)
      .sort((a,b) => a.date.localeCompare(b.date))
      .map(d => {
        // Daily budget target = sum of monthly budgets for this day's month, divided by days-in-month
        const month = d.date.slice(0, 7);
        const [yy, mm] = month.split("-").map(Number);
        const daysInMonth = new Date(yy, mm, 0).getDate();
        const monthBudgets = state.budgets.filter(b => propIds.includes(b.propertyId) && b.month === month);
        const monthBudget = monthBudgets.reduce((s, b) => s + _budgetTotal(b), 0);
        const dailyTarget = monthBudget ? monthBudget / daysInMonth : null;
        return {
          ...d,
          dateShort: fmtDateShort(d.date),
          occupancy: d.rooms ? (d.sold / d.rooms) * 100 : 0,
          adr: d.sold ? d.roomRev / d.sold : 0,
          revpar: d.rooms ? d.roomRev / d.rooms : 0,
          budget: dailyTarget,
        };
      });
  }, [state.reports, state.budgets, propIds, range]);

  const pacing = useMemo(() => {
    const half = Math.floor(chartData.length / 2);
    const recent = chartData.slice(half);
    const prior = chartData.slice(0, half);
    const sumRev = arr => arr.reduce((s, d) => s + d.revenue, 0);
    const avg = (arr, k) => arr.length ? arr.reduce((s, d) => s + d[k], 0) / arr.length : 0;
    return {
      revGrowth: prior.length && sumRev(prior) ? (sumRev(recent) - sumRev(prior)) / sumRev(prior) : 0,
      occChange: avg(recent, "occupancy") - avg(prior, "occupancy"),
      adrChange: avg(recent, "adr") - avg(prior, "adr"),
    };
  }, [chartData]);

  // Auto-commentary
  const commentary = useMemo(() => {
    if (chartData.length < 5) return [];
    const out = [];
    const sorted = [...chartData].sort((a, b) => b.revenue - a.revenue);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best && worst && best.revenue > worst.revenue) {
      out.push(`Best night was **${best.dateShort}** with ${fmtMoney(best.revenue)} — ${(best.revenue / Math.max(1, worst.revenue) * 100 - 100).toFixed(0)}% above your weakest day (${worst.dateShort}, ${fmtMoney(worst.revenue)}).`);
    }
    const weekendDays = chartData.filter(d => [5, 6].includes(new Date(d.date).getDay()));
    const weekdayDays = chartData.filter(d => ![5, 6].includes(new Date(d.date).getDay()));
    if (weekendDays.length && weekdayDays.length) {
      const weAvg = weekendDays.reduce((s, d) => s + d.revenue, 0) / weekendDays.length;
      const wdAvg = weekdayDays.reduce((s, d) => s + d.revenue, 0) / weekdayDays.length;
      if (wdAvg > 0) {
        const lift = (weAvg - wdAvg) / wdAvg;
        out.push(`Weekend lift: **${(lift * 100).toFixed(0)}%** (Fri/Sat avg ${fmtMoneyShort(weAvg)} vs weekday avg ${fmtMoneyShort(wdAvg)}).`);
      }
    }
    if (Math.abs(pacing.revGrowth) > 0.05) {
      out.push(pacing.revGrowth > 0
        ? `Revenue is **pacing up** ${(pacing.revGrowth * 100).toFixed(1)}% in the recent half of this window vs the prior half — momentum looks healthy.`
        : `Revenue has **softened** ${(Math.abs(pacing.revGrowth) * 100).toFixed(1)}% in the recent half vs the prior half. Worth a glance at channel mix.`);
    }
    return out.slice(0, 4);
  }, [chartData, pacing]);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={range} onChange={e => setRange(Number(e.target.value))} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
        </select>
        {perms.properties === "all" && (
          <select value={propId} onChange={e => setPropId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
            <option value="all">Portfolio (all properties)</option>
            {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {/* Pacing tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PacingTile label="Revenue Pacing" value={fmtVar(pacing.revGrowth)} sub={`Recent half vs prior half`} positive={pacing.revGrowth >= 0} />
        <PacingTile label="Occupancy Shift" value={`${pacing.occChange >= 0 ? "+" : ""}${pacing.occChange.toFixed(1)} pts`} sub="Recent vs prior" positive={pacing.occChange >= 0} />
        <PacingTile label="ADR Movement" value={`${pacing.adrChange >= 0 ? "+" : ""}${fmtMoney(pacing.adrChange).replace("$","$")}`} sub="Recent vs prior" positive={pacing.adrChange >= 0} />
      </div>

      {/* Auto-commentary */}
      {commentary.length > 0 && (
        <Card className="p-5 anim-fade-up">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-600 to-amber-800 text-white flex items-center justify-center">
              <span className="text-[10px] font-bold">AI</span>
            </div>
            <h3 className="font-display text-base text-stone-900">What this window tells us</h3>
          </div>
          <ul className="space-y-2 text-sm text-stone-700 ml-1">
            {commentary.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-amber-600 mt-0.5">→</span>
                <span dangerouslySetInnerHTML={{ __html: c.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-6">
        <h3 className="font-display text-lg text-stone-900 mb-4">Revenue &amp; Occupancy</h3>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="trev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#b45309" stopOpacity={0.45}/>
                <stop offset="95%" stopColor="#b45309" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="dateShort" tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" />
            <YAxis yAxisId="rev" tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" tickFormatter={v => fmtMoneyShort(v)} />
            <YAxis yAxisId="occ" orientation="right" tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" tickFormatter={v => `${Math.round(v)}%`} domain={[0, 100]} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke="#b45309" strokeWidth={2} fill="url(#trev)" name="Revenue" />
            <Line yAxisId="rev" type="monotone" dataKey="budget" stroke="#1c1917" strokeWidth={1.5} strokeDasharray="6 4" dot={false} name="Daily budget" />
            <Line yAxisId="occ" type="monotone" dataKey="occupancy" stroke="#0c4a6e" strokeWidth={2} dot={false} name="Occupancy %" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-display text-lg text-stone-900 mb-4">ADR &amp; RevPAR</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="dateShort" tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" />
              <YAxis tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" tickFormatter={v => fmtMoneyShort(v)} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={v => fmtMoney(v)} />
              <Line type="monotone" dataKey="adr" stroke="#92400e" strokeWidth={2} dot={false} name="ADR" />
              <Line type="monotone" dataKey="revpar" stroke="#b45309" strokeWidth={2} strokeDasharray="4 4" dot={false} name="RevPAR" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="font-display text-lg text-stone-900 mb-4">Daily Revenue Heatmap</h3>
          <DailyHeatmap data={chartData} />
        </Card>
      </div>
    </div>
  );
}

function PacingTile({ label, value, sub, positive }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">{label}</div>
      <div className={`font-display number-display text-3xl font-semibold ${positive ? "text-emerald-700" : "text-rose-700"}`}>
        {positive ? "↑ " : "↓ "}{value}
      </div>
      <div className="text-xs text-stone-500 mt-1">{sub}</div>
    </Card>
  );
}

function DailyHeatmap({ data }) {
  if (!data.length) return <Empty icon={BarChart3} title="No data" message="Heatmap appears once reports are ingested." />;
  const max = Math.max(...data.map(d => d.revenue));
  const min = Math.min(...data.map(d => d.revenue));
  const intensity = v => max === min ? 0.5 : (v - min) / (max - min);
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {["S","M","T","W","T","F","S"].map((d, i) => (
        <div key={i} className="text-center text-[10px] text-stone-500 font-medium uppercase mb-1">{d}</div>
      ))}
      {data.map((d, i) => {
        const dow = new Date(d.date).getDay();
        const intens = intensity(d.revenue);
        return (
          <div key={d.date}
            title={`${fmtDate(d.date)} · ${fmtMoney(d.revenue)}`}
            className="aspect-square rounded text-[9px] flex flex-col items-center justify-center cursor-help relative"
            style={{ background: `rgba(180, 83, 9, ${0.10 + intens * 0.85})` }}>
            <span className={`tabular font-semibold ${intens > 0.5 ? "text-white" : "text-stone-700"}`}>{new Date(d.date).getDate()}</span>
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================================
   FORECAST PANE — projection of next 7-14 days using OLS + DOW seasonality
   ========================================================================= */
function ForecastPane({ ctx }) {
  const { state, perms, activeProperty, accessibleProperties } = ctx;
  const [propId, setPropId] = useState(perms.properties === "all" ? accessibleProperties[0]?.id : activeProperty);
  const [horizon, setHorizon] = useState(14);

  const reports = useMemo(
    () => state.reports.filter(r => r.propertyId === propId).map(enrichReport),
    [state.reports, propId]
  );
  const { points, summary, _reason } = useMemo(() => _forecast(reports, horizon), [reports, horizon]);
  const property = state.properties.find(p => p.id === propId);

  if (!summary) {
    return (
      <div className="p-8">
        <Card className="p-12 text-center">
          <TrendingUp size={28} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-display text-xl text-stone-900">Not enough history yet</h3>
          <p className="text-sm text-stone-500 mt-2">{_reason || "Ingest at least seven days of audits to enable forecasting."}</p>
        </Card>
      </div>
    );
  }

  const chartData = points.map(p => ({
    date: fmtDateShort(p.date),
    actual: p.isForecast ? null : p.revenue,
    forecast: p.isForecast ? p.revenue : null,
    lower: p.isForecast ? p.lower : null,
    upper: p.isForecast ? p.upper : null,
  }));

  const trendArrow = summary.trendDirection === "up" ? "↑" : summary.trendDirection === "down" ? "↓" : "→";
  const trendColor = summary.trendDirection === "up" ? "text-emerald-700" : summary.trendDirection === "down" ? "text-rose-700" : "text-stone-500";

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Forecast</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gradient-to-br from-amber-600 to-amber-800 text-white tracking-wider">PROJECTION</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name}</h2>
          <p className="text-sm text-stone-500 mt-1">
            Linear-trend × day-of-week seasonality model · {(summary.confidence * 100).toFixed(0)}% confidence
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accessibleProperties.length > 1 && (
            <select value={propId} onChange={e => setPropId(e.target.value)}
              className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium">
              {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={horizon} onChange={e => setHorizon(Number(e.target.value))}
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
            <option value={7}>Next 7 days</option>
            <option value={14}>Next 14 days</option>
            <option value={30}>Next 30 days</option>
          </select>
        </div>
      </div>

      {/* Hero summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Projected Next 7</div>
          <div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(summary.total7)}</div>
          <div className={`text-xs mt-1 ${summary.vsLast7 >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {summary.vsLast7 >= 0 ? "↑" : "↓"} {(Math.abs(summary.vsLast7) * 100).toFixed(1)}% vs prior 7d actual
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Projected Next 14</div>
          <div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtMoneyShort(summary.total14)}</div>
          <div className="text-xs text-stone-500 mt-1">{fmtMoney(summary.total14)}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Avg Occupancy (7d)</div>
          <div className="font-display number-display text-3xl text-stone-900 font-semibold">{fmtPct(summary.avgOcc)}</div>
          <div className="text-xs text-stone-500 mt-1">Day-of-week weighted</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">Trend</div>
          <div className={`font-display number-display text-3xl font-semibold ${trendColor}`}>{trendArrow} {summary.trendDirection}</div>
          <div className="text-xs text-stone-500 mt-1">Avg ADR {fmtMoney(summary.avgAdr)}</div>
        </Card>
      </div>

      {/* Forecast chart */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg text-stone-900">Revenue forecast</h3>
          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 bg-stone-700" />Actual</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-700" style={{ borderTop: "1px dashed #b45309" }} />Forecast</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 bg-amber-200 rounded-sm" />95% band</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fcd34d" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#fcd34d" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" />
            <YAxis tick={{ fontSize: 11, fill: "#78716c" }} stroke="#d6d3d1" tickFormatter={v => fmtMoneyShort(v)} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} formatter={v => v == null ? "—" : fmtMoney(v)} />
            {/* Confidence band — drawn first so lines sit on top */}
            <Area type="monotone" dataKey="upper" stroke="none" fill="url(#band)" />
            <Area type="monotone" dataKey="lower" stroke="none" fill="#ffffff" />
            <Line type="monotone" dataKey="actual" stroke="#1c1917" strokeWidth={2.5} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="forecast" stroke="#b45309" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Day-by-day table */}
      <Card>
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-display text-lg text-stone-900">Day-by-day projection</h3>
          <span className="text-xs text-stone-500">Forecast horizon · {horizon} days</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-medium">Date</th>
              <th className="text-left px-6 py-3 font-medium">Day</th>
              <th className="text-right px-6 py-3 font-medium">Forecast Revenue</th>
              <th className="text-right px-6 py-3 font-medium">Range (95%)</th>
              <th className="text-right px-6 py-3 font-medium">Occupancy</th>
              <th className="text-right px-6 py-3 font-medium">ADR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {points.filter(p => p.isForecast).map(p => (
              <tr key={p.date} className="hover:bg-stone-50">
                <td className="px-6 py-2.5 text-stone-900 tabular">{fmtDate(p.date)}</td>
                <td className="px-6 py-2.5 text-stone-500">{fmtDayName(p.date)}</td>
                <td className="px-6 py-2.5 text-right tabular font-semibold">{fmtMoney(p.revenue)}</td>
                <td className="px-6 py-2.5 text-right tabular text-xs text-stone-500">{fmtMoneyShort(p.lower)} – {fmtMoneyShort(p.upper)}</td>
                <td className="px-6 py-2.5 text-right tabular">{fmtPct(p.occupancy)}</td>
                <td className="px-6 py-2.5 text-right tabular">{fmtMoney(p.adr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-5 bg-stone-50 border-stone-200 text-xs text-stone-600">
        <strong className="text-stone-900">Method:</strong> ordinary-least-squares regression on the last 30 days of total revenue
        produces a trend line; per-weekday multipliers correct for the fact that, e.g., Saturdays usually beat Tuesdays.
        The 95% confidence band widens with the horizon — short-term projections are tight, long-term ones less so.
        Production deployments would extend this with a Holt-Winters or Prophet model and channel-mix decomposition.
      </Card>
    </div>
  );
}

/* =========================================================================
   DEPARTMENTS PANE
   ========================================================================= */
function DepartmentsPane({ ctx }) {
  const { state, perms, activeProperty, accessibleProperties } = ctx;
  const [propId, setPropId] = useState(perms.properties === "all" ? accessibleProperties[0]?.id : activeProperty);

  const reports = useMemo(() =>
    state.reports.filter(r => r.propertyId === propId).map(enrichReport).sort((a,b) => a.date.localeCompare(b.date)),
    [state.reports, propId]
  );
  const last30 = reports.slice(-30);

  const dept = (key) => {
    const total = last30.reduce((s, r) => {
      if (key === "rooms") return s + r.breakdown.revenue.rooms;
      if (key === "fb") return s + sumFb(r.breakdown);
      if (key === "other") return s + sumOther(r.breakdown);
      return s;
    }, 0);
    const trend = last30.map(r => ({
      date: fmtDateShort(r.date),
      v: key === "rooms" ? r.breakdown.revenue.rooms : key === "fb" ? sumFb(r.breakdown) : sumOther(r.breakdown),
    }));
    return { total, trend };
  };

  const rooms = dept("rooms");
  const fb = dept("fb");
  const other = dept("other");
  const grand = rooms.total + fb.total + other.total;

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      {accessibleProperties.length > 1 && (
        <div className="flex items-center gap-2">
          <select value={propId} onChange={e => setPropId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-medium">
            {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="text-xs text-stone-500">Last 30 days</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DeptCard title="Rooms" subtitle="Transient + group + comp" total={rooms.total} grand={grand} trend={rooms.trend} color="#b45309" />
        <DeptCard title="Food &amp; Beverage" subtitle="Restaurant + bar + banquet" total={fb.total} grand={grand} trend={fb.trend} color="#7c3aed" />
        <DeptCard title="Other" subtitle="Parking, spa, telephone, misc" total={other.total} grand={grand} trend={other.trend} color="#0369a1" />
      </div>

      {/* Detail breakdown */}
      <Card className="p-6">
        <h3 className="font-display text-lg text-stone-900 mb-4">Sub-department detail (last 30 days)</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SubDeptList title="Rooms" items={[
            ["Transient", last30.reduce((s,r) => s + (r.breakdown.rooms.transient || 0) * (r.adr || 0), 0)],
            ["Group", last30.reduce((s,r) => s + (r.breakdown.rooms.group || 0) * (r.adr || 0), 0)],
          ]} />
          <SubDeptList title="Food &amp; Beverage" items={[
            ["Restaurant", last30.reduce((s,r) => s + (r.breakdown.revenue.fb.restaurant || 0), 0)],
            ["Bar / Lounge", last30.reduce((s,r) => s + (r.breakdown.revenue.fb.bar || 0), 0)],
            ["Banquet", last30.reduce((s,r) => s + (r.breakdown.revenue.fb.banquet || 0), 0)],
          ]} />
          <SubDeptList title="Other Revenue" items={[
            ["Parking", last30.reduce((s,r) => s + (r.breakdown.revenue.other.parking || 0), 0)],
            ["Spa", last30.reduce((s,r) => s + (r.breakdown.revenue.other.spa || 0), 0)],
            ["Telephone", last30.reduce((s,r) => s + (r.breakdown.revenue.other.telephone || 0), 0)],
            ["Misc / Sundry", last30.reduce((s,r) => s + (r.breakdown.revenue.other.misc || 0), 0)],
          ]} />
        </div>
      </Card>

      {/* Segmentation / channel mix (only if data available) */}
      <SegmentationCard reports={last30} />
    </div>
  );
}

function SegmentationCard({ reports }) {
  // Pull segment & channel data from any report that has it (from new ingestions)
  const segments = { transient: { rooms: 0, revenue: 0 }, group: { rooms: 0, revenue: 0 }, contract: { rooms: 0, revenue: 0 } };
  const channels = { direct: { rooms: 0, revenue: 0 }, gds: { rooms: 0, revenue: 0 }, ota: { rooms: 0, revenue: 0 }, wholesale: { rooms: 0, revenue: 0 } };
  let hasSeg = false, hasChan = false;
  reports.forEach(r => {
    const ing = r.ingestion;
    // Look in r.breakdown.segments / channels if we ever store them
    const seg = r.breakdown?.segments || r._segments;
    const chan = r.breakdown?.channels || r._channels;
    if (seg) {
      Object.entries(seg).forEach(([k, v]) => {
        if (segments[k] && (v.rooms || v.revenue)) {
          segments[k].rooms += v.rooms || 0;
          segments[k].revenue += v.revenue || 0;
          hasSeg = true;
        }
      });
    } else {
      // fall back: use plain transient/group counts from rooms breakdown
      if (r.breakdown?.rooms?.transient) { segments.transient.rooms += r.breakdown.rooms.transient; hasSeg = true; }
      if (r.breakdown?.rooms?.group) { segments.group.rooms += r.breakdown.rooms.group; hasSeg = true; }
    }
    if (chan) {
      Object.entries(chan).forEach(([k, v]) => {
        if (channels[k] && (v.rooms || v.revenue)) {
          channels[k].rooms += v.rooms || 0;
          channels[k].revenue += v.revenue || 0;
          hasChan = true;
        }
      });
    }
  });

  if (!hasSeg && !hasChan) {
    return (
      <Card className="p-6 border-dashed bg-stone-50/40">
        <div className="text-sm text-stone-600">
          <strong className="text-stone-900">Segmentation &amp; channel mix</strong>
          <p className="text-xs text-stone-500 mt-1">
            Ingest audits that include transient/group/OTA/direct breakdowns and they'll appear here.
            The parser already recognizes these labels — try pasting an audit with "Transient Revenue: $… / Group Revenue: $… / OTA Rooms: …".
          </p>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <h3 className="font-display text-lg text-stone-900 mb-4">Segmentation &amp; channel mix · last 30 days</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {hasSeg && (
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">Market Segment</div>
            <SubDeptList title="Rooms by segment" items={Object.entries(segments).filter(([, v]) => v.rooms > 0).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v.revenue || v.rooms])} />
          </div>
        )}
        {hasChan && (
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">Booking Channel</div>
            <SubDeptList title="Revenue by channel" items={Object.entries(channels).filter(([, v]) => v.revenue > 0 || v.rooms > 0).map(([k, v]) => [k.toUpperCase(), v.revenue || v.rooms])} />
          </div>
        )}
      </div>
    </Card>
  );
}

function DeptCard({ title, subtitle, total, grand, trend, color }) {
  const pct = grand > 0 ? total / grand : 0;
  return (
    <Card className="p-6">
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1">{title}</div>
      <div className="text-xs text-stone-500 mb-3">{subtitle}</div>
      <div className="font-display number-display text-4xl text-stone-900 font-semibold mb-1">{fmtMoney(total)}</div>
      <div className="text-xs text-stone-500 mb-4">{fmtPct(pct)} of departmental total</div>
      <ResponsiveContainer width="100%" height={70}>
        <AreaChart data={trend}>
          <defs>
            <linearGradient id={`dg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#dg-${color.replace("#","")})`} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

function SubDeptList({ title, items }) {
  const total = items.reduce((s, [,v]) => s + v, 0);
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">{title}</div>
      <div className="space-y-2">
        {items.map(([k, v]) => {
          const pct = total > 0 ? v / total : 0;
          return (
            <div key={k}>
              <div className="flex justify-between mb-1 text-sm">
                <span className="text-stone-700">{k}</span>
                <span className="tabular font-medium">{fmtMoney(v)}</span>
              </div>
              <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                <div className="h-full bg-stone-700" style={{ width: `${pct*100}%` }} />
              </div>
            </div>
          );
        })}
        <div className="pt-2 mt-2 border-t border-stone-200 flex justify-between text-sm">
          <span className="font-semibold text-stone-900">Total</span>
          <span className="tabular font-bold">{fmtMoney(total)}</span>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   GL MAPPING PANE
   ========================================================================= */
function GLMappingPane({ ctx }) {
  return (
    <div className="p-8 max-w-5xl mx-auto space-y-5">
      <Card className="p-6">
        <h3 className="font-display text-2xl text-stone-900 mb-1">General Ledger Chart</h3>
        <p className="text-sm text-stone-500 mb-5">Account codes used to auto-post AI-extracted audit data. USALI-aligned defaults shown — extend in production.</p>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
            <tr className="border-b border-stone-200">
              <th className="text-left pb-3 font-semibold">Code</th>
              <th className="text-left pb-3 font-semibold">Account Name</th>
              <th className="text-left pb-3 font-semibold">Category</th>
              <th className="text-left pb-3 font-semibold">Maps to (audit field)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {GL_CHART.map(g => {
              const catColors = { rooms: "amber", fb: "violet", other: "sky", tax: "rose" };
              return (
                <tr key={g.code} className="hover:bg-stone-50">
                  <td className="py-3 font-mono tabular text-stone-700">{g.code}</td>
                  <td className="py-3 text-stone-900 font-medium">{g.name}</td>
                  <td className="py-3"><Badge color={catColors[g.category]}>{g.category.toUpperCase()}</Badge></td>
                  <td className="py-3 text-xs font-mono text-stone-500">{g.path.join(".")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="p-5 bg-stone-50 border-stone-200">
        <div className="flex items-start gap-3">
          <FileCheck2 size={18} className="text-stone-600 mt-0.5" />
          <div className="text-sm text-stone-700">
            <strong className="text-stone-900">In production,</strong> this view supports drag-and-drop remapping, custom property-specific accounts, and direct integration with your accounting system (Sage Intacct, Oracle NetSuite, QuickBooks Online, Microsoft Dynamics) via standard journal entry formats. Posting hooks fire on every approved flash report.
          </div>
        </div>
      </Card>
    </div>
  );
}



function ApiKeyCard() {
  const [key, setKey] = useState(() => {
    try { return localStorage.getItem("hotelops:apiKey") || ""; } catch { return ""; }
  });
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => {
    try {
      if (key.trim()) localStorage.setItem("hotelops:apiKey", key.trim());
      else localStorage.removeItem("hotelops:apiKey");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {}
  };
  const masked = key ? `${key.slice(0, 8)}${"•".repeat(Math.max(0, key.length - 12))}${key.slice(-4)}` : "";

  return (
    <Card>
      <div className="px-6 py-4 border-b border-stone-200">
        <h3 className="font-display text-lg text-stone-900">AI Enrichment</h3>
        <p className="text-xs text-stone-500 mt-0.5">
          The local audit parser works without any key. Add a Claude API key below to also extract from PDF / image uploads. The key is stored only in your browser's localStorage.
        </p>
      </div>
      <div className="p-6 space-y-3">
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-stone-500 mb-1.5 font-medium">Anthropic API Key</span>
          <div className="flex gap-2">
            <input
              type={reveal ? "text" : "password"}
              value={reveal ? key : (key && !reveal ? masked : key)}
              onChange={e => { if (reveal || !key) setKey(e.target.value); }}
              onFocus={() => setReveal(true)}
              placeholder="sk-ant-…"
              className="flex-1 px-3 py-2 text-sm font-mono border border-stone-300 rounded-md bg-white focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
            />
            <Button variant="secondary" onClick={() => setReveal(r => !r)}>{reveal ? "Hide" : "Show"}</Button>
            <Button variant="primary" onClick={save}><Save size={14} />{saved ? "Saved" : "Save"}</Button>
          </div>
        </label>
        <p className="text-[11px] text-stone-400">
          Tip: HotelOps reaches the Anthropic API directly from this browser. For real production use, route through a backend proxy that holds the key server-side.
        </p>
      </div>
    </Card>
  );
}

/* ============== INTEGRATIONS TAB ============== */
const PMS_PROVIDERS = [
  { id: "opera",       name: "Oracle Opera",          tier: "Enterprise", category: "PMS" },
  { id: "mews",        name: "Mews",                  tier: "Cloud",      category: "PMS" },
  { id: "cloudbeds",   name: "Cloudbeds",             tier: "SMB",        category: "PMS" },
  { id: "stayntouch",  name: "Stayntouch",            tier: "Cloud",      category: "PMS" },
  { id: "maestro",     name: "Maestro PMS",           tier: "Mid-market", category: "PMS" },
  { id: "rms",         name: "RMS Cloud",             tier: "Cloud",      category: "PMS" },
  { id: "roomkey",     name: "RoomKeyPMS",            tier: "Mid-market", category: "PMS" },
  { id: "innroad",     name: "InnRoad",               tier: "SMB",        category: "PMS" },
];
const ACCT_PROVIDERS = [
  { id: "intacct",     name: "Sage Intacct",          tier: "Enterprise", category: "Accounting" },
  { id: "netsuite",    name: "Oracle NetSuite",       tier: "Enterprise", category: "Accounting" },
  { id: "qbo",         name: "QuickBooks Online",     tier: "SMB",        category: "Accounting" },
  { id: "dynamics",    name: "Microsoft Dynamics 365",tier: "Enterprise", category: "Accounting" },
  { id: "xero",        name: "Xero",                  tier: "SMB",        category: "Accounting" },
];
const COMM_PROVIDERS = [
  { id: "slack",       name: "Slack",                 tier: "—",          category: "Notifications" },
  { id: "teams",       name: "Microsoft Teams",       tier: "—",          category: "Notifications" },
  { id: "email",       name: "Email Digest (SMTP)",   tier: "—",          category: "Notifications" },
];

function IntegrationsTab({ ctx }) {
  const { state, update, currentUser, toast } = ctx;
  const [connecting, setConnecting] = useState(null);
  const [oauthStep, setOauthStep] = useState(0);

  const connections = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("hotelops:connections") || "{}"); } catch { return {}; }
  }, [oauthStep]);
  const persistConnection = (id, payload) => {
    const next = { ...connections, [id]: payload };
    try { localStorage.setItem("hotelops:connections", JSON.stringify(next)); } catch {}
  };
  const disconnect = (id) => {
    const next = { ...connections }; delete next[id];
    try { localStorage.setItem("hotelops:connections", JSON.stringify(next)); } catch {}
    setOauthStep(s => s + 1); // refresh
  };

  const startConnect = (provider) => {
    setConnecting(provider);
    setOauthStep(1);
  };
  const completeOauth = () => {
    setOauthStep(2);
    setTimeout(() => {
      // "Sync" — generate a few synthetic reports tagged with the integration
      const property = state.properties[0];
      const synthCount = 7;
      const synthReports = Array.from({ length: synthCount }).map((_, i) => {
        const date = iso(addDays(TODAY, -i - 1));
        const baseRev = 4500 + Math.random() * 8000;
        const sold = Math.round(property.rooms * (0.5 + Math.random() * 0.4));
        return {
          id: newId("r"),
          date, propertyId: property.id,
          roomsSold: sold, roomsAvailable: property.rooms,
          occupancy: sold / property.rooms,
          adr: baseRev / Math.max(1, sold),
          revpar: baseRev / property.rooms,
          roomRevenue: Math.round(baseRev * 100) / 100,
          fbRevenue: Math.round(baseRev * 0.18 * 100) / 100,
          otherRevenue: Math.round(baseRev * 0.05 * 100) / 100,
          totalRevenue: Math.round(baseRev * 1.23 * 100) / 100,
          notes: "",
          breakdown: {
            rooms: { available: property.rooms, sold, comp: 0, transient: sold, group: 0, walkIns: 0, noShows: 0, outOfOrder: 0 },
            revenue: { rooms: baseRev, fb: { restaurant: baseRev * 0.18, banquet: 0, bar: 0 }, other: { telephone: 0, parking: baseRev * 0.05, spa: 0, misc: 0 } },
            taxes: { occupancy: baseRev * 0.115, sales: baseRev * 0.0695, tourism: baseRev * 0.015 },
            payments: { cash: 0, creditCard: baseRev * 1.08, directBill: baseRev * 0.15, other: 0 },
          },
          status: "posted",
          ingestion: {
            source: `pms_sync_${connecting.id}`, confidence: 0.99, ingestedAt: new Date().toISOString(),
            ingestedBy: currentUser.id, warnings: [], insights: [`Auto-synced from ${connecting.name}`],
          },
        };
      });
      // skip dupes
      const existing = new Set(state.reports.map(r => `${r.propertyId}|${r.date}`));
      const fresh = synthReports.filter(r => !existing.has(`${r.propertyId}|${r.date}`));
      update({ reports: [...state.reports, ...fresh] });
      persistConnection(connecting.id, { connectedAt: new Date().toISOString(), provider: connecting.name, lastSync: new Date().toISOString() });
      pushActivity(ctx, "integration.connect", { providerId: connecting.id, providerName: connecting.name });
      toast?.push(`Connected to ${connecting.name} · ${fresh.length} days backfilled`, { tone: "success" });
      setOauthStep(3);
    }, 1400);
  };

  const closeOauth = () => { setConnecting(null); setOauthStep(0); };

  const Section = ({ title, providers }) => (
    <Card>
      <div className="px-6 py-4 border-b border-stone-200">
        <h3 className="font-display text-lg text-stone-900">{title}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-y divide-stone-100 md:divide-y-0">
        {providers.map(p => {
          const conn = connections[p.id];
          return (
            <div key={p.id} className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg border border-stone-200 bg-stone-50 flex items-center justify-center text-stone-700 font-display text-lg">
                {p.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-stone-900 text-sm">{p.name}</div>
                <div className="text-xs text-stone-500">
                  {p.tier} · {conn ? <span className="text-emerald-700">Connected · last sync {fmtDate(conn.lastSync)}</span> : <span>Not connected</span>}
                </div>
              </div>
              {conn ? (
                <Button variant="secondary" size="sm" onClick={() => disconnect(p.id)}>Disconnect</Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => startConnect(p)}>Connect</Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );

  return (
    <div className="space-y-5">
      <Card className="p-5 bg-gradient-to-r from-amber-50/40 to-stone-50 border-amber-200">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚡</span>
          <div className="flex-1">
            <h3 className="font-display text-lg text-stone-900">Connected operations</h3>
            <p className="text-sm text-stone-600 mt-1">
              Connect your PMS to auto-sync nightly. Connect your accounting platform to push GL journal entries on every approved flash report.
              In production these would use OAuth 2.0 with refresh tokens stored server-side; this demo emulates the flow locally.
            </p>
          </div>
        </div>
      </Card>

      <Section title="Property Management Systems (PMS)" providers={PMS_PROVIDERS} />
      <Section title="Accounting Systems" providers={ACCT_PROVIDERS} />
      <Section title="Notifications" providers={COMM_PROVIDERS} />

      {/* OAuth-style modal */}
      {connecting && (
        <Modal open onClose={closeOauth} title={`Connect to ${connecting.name}`}>
          {oauthStep === 1 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-stone-200 p-4 bg-stone-50">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Authorize HotelOps</div>
                <div className="text-sm text-stone-900 mb-3">HotelOps is requesting access to your <strong>{connecting.name}</strong> account:</div>
                <ul className="text-sm text-stone-700 space-y-1">
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span>Read daily transaction reports</li>
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span>Read folio &amp; payment data</li>
                  <li className="flex gap-2"><span className="text-emerald-600">✓</span>Read room status &amp; rate plans</li>
                  <li className="flex gap-2"><span className="text-stone-300">○</span>Write access (not requested)</li>
                </ul>
              </div>
              <p className="text-xs text-stone-500">
                In production, this would redirect to {connecting.name}'s OAuth consent page. For this demo, click below to simulate the consent flow.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeOauth}>Cancel</Button>
                <Button variant="primary" onClick={completeOauth}>Authorize &amp; sync</Button>
              </div>
            </div>
          )}
          {oauthStep === 2 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto rounded-full border-4 border-amber-700/15 anim-spin-slow mb-4" style={{ borderTopColor: "#b45309" }} />
              <h4 className="font-display text-xl text-stone-900">Syncing…</h4>
              <p className="text-sm text-stone-500 mt-1">Pulling the last 7 days of audit data from {connecting.name}.</p>
            </div>
          )}
          {oauthStep === 3 && (
            <div className="text-center py-8">
              <div className="inline-flex w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 items-center justify-center mb-3">
                <CheckCircle2 size={28} />
              </div>
              <h4 className="font-display text-xl text-stone-900">Connected</h4>
              <p className="text-sm text-stone-600 mt-1">{connecting.name} will sync nightly at 3:00 AM property local time.</p>
              <div className="mt-4">
                <Button variant="primary" onClick={closeOauth}>Done</Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ============== NOTIFICATIONS TAB (with daily digest preview) ============== */
function NotificationsTab({ ctx }) {
  const { state, currentUser, perms, accessibleProperties, toast } = ctx;
  const [recipient, setRecipient] = useState(currentUser.email);
  const [hour, setHour] = useState("08:00");

  const yesterday = iso(addDays(TODAY, -1));
  const yReports = state.reports.filter(r => r.date === yesterday && (perms.properties === "all" || currentUser.propertyAccess.includes(r.propertyId)));
  const yRev = yReports.reduce((s, r) => s + r.totalRevenue, 0);
  const yRoomsSold = yReports.reduce((s, r) => s + r.roomsSold, 0);
  const yRoomsAvail = yReports.reduce((s, r) => s + r.roomsAvailable, 0);
  const yOcc = yRoomsAvail ? yRoomsSold / yRoomsAvail : 0;
  const overdueAr = state.invoices?.filter(i => i.status === "overdue").length || 0;
  const lowConfReports = yReports.filter(r => r.ingestion?.confidence != null && r.ingestion.confidence < 0.8).length;
  const missing = (perms.properties === "all" ? state.properties : accessibleProperties).filter(p => !state.reports.some(r => r.propertyId === p.id && r.date === yesterday));

  return (
    <div className="space-y-5">
      <Card>
        <div className="px-6 py-4 border-b border-stone-200">
          <h3 className="font-display text-lg text-stone-900">Daily Digest</h3>
          <p className="text-xs text-stone-500 mt-0.5">Auto-emailed each morning. Configure recipients &amp; delivery time below, then preview.</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Recipient" value={recipient} onChange={setRecipient} placeholder="you@hotel.com" />
            <Input label="Delivery time (property local)" type="time" value={hour} onChange={setHour} />
          </div>
          <Button variant="secondary" onClick={() => toast?.push(`Digest scheduled for ${hour} daily to ${recipient}`, { tone: "success" })}>
            <Save size={14} />Save schedule
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg text-stone-900">Preview</h3>
            <p className="text-xs text-stone-500 mt-0.5">What your team would receive at {hour} tomorrow.</p>
          </div>
          <Badge color="amber">Demo · not actually sent</Badge>
        </div>
        {/* Email mock */}
        <div className="bg-stone-100 p-6">
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-100 bg-stone-50 text-xs">
              <div className="text-stone-500"><strong className="text-stone-900">From:</strong> HotelOps &lt;digest@hotelops.app&gt;</div>
              <div className="text-stone-500"><strong className="text-stone-900">To:</strong> {recipient}</div>
              <div className="text-stone-500"><strong className="text-stone-900">Subject:</strong> Morning Briefing · {fmtDate(yesterday)}</div>
            </div>
            <div className="p-8 space-y-6">
              <div>
                <div className="text-amber-700 text-[11px] uppercase tracking-widest font-bold mb-1">HotelOps · Daily Briefing</div>
                <h2 className="font-display text-3xl text-stone-900">{currentUser.firstName}, here's how yesterday went.</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-stone-50 border border-stone-200">
                  <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">Total Revenue</div>
                  <div className="font-display text-3xl tabular text-stone-900 mt-1">{fmtMoney(yRev)}</div>
                </div>
                <div className="p-4 rounded-lg bg-stone-50 border border-stone-200">
                  <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">Occupancy</div>
                  <div className="font-display text-3xl tabular text-stone-900 mt-1">{fmtPct(yOcc)}</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold">Things to know</div>
                <ul className="space-y-2 text-sm text-stone-700">
                  {missing.length > 0 && <li className="flex gap-2"><span className="text-rose-600">⚠</span>{missing.length} {missing.length === 1 ? "property has" : "properties have"} not posted yesterday's audit ({missing.map(p => p.name).join(", ")})</li>}
                  {overdueAr > 0 && <li className="flex gap-2"><span className="text-amber-600">→</span>{overdueAr} A/P {overdueAr === 1 ? "invoice is" : "invoices are"} past due</li>}
                  {lowConfReports > 0 && <li className="flex gap-2"><span className="text-amber-600">→</span>{lowConfReports} {lowConfReports === 1 ? "report has" : "reports have"} low parse confidence — review before close</li>}
                  {missing.length === 0 && overdueAr === 0 && lowConfReports === 0 && <li className="flex gap-2"><span className="text-emerald-600">✓</span>All audits posted, no exceptions to review</li>}
                </ul>
              </div>
              <div className="pt-4 border-t border-stone-100">
                <a href="#" className="inline-flex items-center gap-2 text-sm text-amber-700 font-semibold">Open dashboard <ChevronRight size={14} /></a>
              </div>
              <div className="text-[10px] text-stone-400 text-center pt-4 border-t border-stone-100">
                You're receiving this because you're a manager at the property listed above. Manage preferences in Settings → Notifications.
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ActivityLogTab({ ctx }) {
  const { state } = ctx;
  const [filter, setFilter] = useState("all");
  const items = useMemo(() => {
    const a = state.activity || [];
    if (filter === "all") return a;
    return a.filter(x => x.kind.startsWith(filter));
  }, [state.activity, filter]);

  const labelFor = (kind, payload) => {
    switch (kind) {
      case "report.post": return `Posted flash report${payload.batch ? " (batch)" : ""}`;
      case "shift.clockIn": return "Clocked in";
      case "shift.clockOut": return `Clocked out (${payload.hours}h)`;
      case "shift.edit": return "Edited a shift";
      case "shift.delete": return "Deleted a shift";
      case "budget.update": return "Updated budget";
      case "period.close": return "Closed accounting period";
      case "period.reopen": return "Re-opened accounting period";
      case "payroll.run": return "Ran payroll";
      case "writeup.create": return "Issued write-up";
      default: return kind;
    }
  };

  const empById = Object.fromEntries(state.employees.map(e => [e.id, e]));
  const propById = Object.fromEntries(state.properties.map(p => [p.id, p]));

  return (
    <Card>
      <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-display text-lg text-stone-900">Activity Log</h3>
          <p className="text-xs text-stone-500 mt-0.5">Append-only audit trail · who did what, when. Last 1,000 events retained.</p>
        </div>
        <div className="flex gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)} className="px-3 py-1.5 text-xs border border-stone-300 rounded-md bg-white">
            <option value="all">All events</option>
            <option value="report.">Reports</option>
            <option value="shift.">Shifts</option>
            <option value="budget.">Budgets</option>
            <option value="period.">Period close</option>
            <option value="payroll.">Payroll</option>
          </select>
        </div>
      </div>
      {items.length === 0 ? (
        <Empty icon={ClipboardList} title="No activity yet" message="Once your team starts using the system, every change shows up here for compliance review." />
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-medium">When</th>
              <th className="text-left px-6 py-3 font-medium">Who</th>
              <th className="text-left px-6 py-3 font-medium">Action</th>
              <th className="text-left px-6 py-3 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.slice(0, 200).map(e => {
              const who = empById[e.by];
              const prop = propById[e.payload?.propertyId];
              const detail = [
                prop ? prop.name : null,
                e.payload?.date ? fmtDate(e.payload.date) : null,
                e.payload?.total != null ? fmtMoney(e.payload.total) : null,
                e.payload?.month || null,
              ].filter(Boolean).join(" · ");
              return (
                <tr key={e.id} className="hover:bg-stone-50">
                  <td className="px-6 py-2.5 tabular text-xs text-stone-500">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-6 py-2.5">
                    {who ? (
                      <div className="flex items-center gap-2">
                        <Avatar employee={who} size={24} />
                        <span className="text-sm text-stone-900">{fullName(who)}</span>
                      </div>
                    ) : <span className="text-xs text-stone-500">{e.by}</span>}
                  </td>
                  <td className="px-6 py-2.5 text-stone-900">{labelFor(e.kind, e.payload || {})}</td>
                  <td className="px-6 py-2.5 text-xs text-stone-500">{detail || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CsvImportCard({ ctx }) {
  const { state, update, currentUser, toast } = ctx;
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  const exampleHeader = "date,property,roomsAvailable,roomsSold,roomRevenue,fbRevenue,otherRevenue";
  const examplePlaceholder = `${exampleHeader}
2026-04-01,Riverbend Inn,84,67,9929.40,1057.50,236
2026-04-02,Riverbend Inn,84,72,10650.00,1188.00,254
2026-04-03,Cypress Point Lodge,142,128,23993.60,10210.50,2872`;

  // Quote-aware CSV cell splitter — handles "Smith, Inc.", "with ""quotes""", etc.
  const splitCsvLine = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map(c => c.trim());
  };

  const parseCsv = (raw) => {
    const lines = raw.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("Need a header row + at least one data row.");
    const header = splitCsvLine(lines[0]).map(h => h.toLowerCase());
    const required = ["date", "property"];
    required.forEach(r => { if (!header.includes(r)) throw new Error(`Missing required column: ${r}`); });
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      if (cells.length < 2) continue;
      const obj = {};
      header.forEach((h, idx) => { obj[h] = cells[idx]; });
      const property = state.properties.find(p =>
        p.name.toLowerCase() === (obj.property || "").toLowerCase()
        || p.id === obj.property
        || (p.aliases || []).some(a => a.toLowerCase() === (obj.property || "").toLowerCase())
      );
      if (!property) {
        rows.push({ ok: false, error: `Property "${obj.property}" not found`, raw: obj });
        continue;
      }
      const date = obj.date;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        rows.push({ ok: false, error: `Invalid date "${date}" (use YYYY-MM-DD)`, raw: obj });
        continue;
      }
      const roomsAvailable = Number(obj.roomsavailable || obj.rooms_available || obj.available || property.rooms);
      const roomsSold = Number(obj.roomssold || obj.rooms_sold || obj.sold || 0);
      const roomRevenue = Number(obj.roomrevenue || obj.room_revenue || obj.rooms_revenue || 0);
      const fbRevenue = Number(obj.fbrevenue || obj.fb_revenue || obj.fb || 0);
      const otherRevenue = Number(obj.otherrevenue || obj.other_revenue || obj.other || 0);
      const totalRevenue = roomRevenue + fbRevenue + otherRevenue;
      rows.push({
        ok: true,
        report: {
          id: newId("r"),
          date, propertyId: property.id,
          roomsSold, roomsAvailable,
          occupancy: roomsAvailable ? roomsSold / roomsAvailable : 0,
          adr: roomsSold ? roomRevenue / roomsSold : 0,
          revpar: roomsAvailable ? roomRevenue / roomsAvailable : 0,
          roomRevenue, fbRevenue, otherRevenue, totalRevenue,
          notes: "Imported from CSV",
          breakdown: {
            rooms: { available: roomsAvailable, sold: roomsSold, comp: 0, transient: roomsSold, group: 0, walkIns: 0, noShows: 0, outOfOrder: 0 },
            revenue: { rooms: roomRevenue, fb: { restaurant: fbRevenue, banquet: 0, bar: 0 }, other: { telephone: 0, parking: 0, spa: 0, misc: otherRevenue } },
            taxes: {
              occupancy: Math.round(roomRevenue * 0.115 * 100) / 100,
              sales: Math.round(totalRevenue * 0.0695 * 100) / 100,
              tourism: Math.round(roomRevenue * 0.015 * 100) / 100,
            },
            payments: { cash: 0, creditCard: 0, directBill: 0, other: 0 },
            adjustments: {}, guests: {},
          },
          status: "posted",
          ingestion: {
            source: "csv_import", confidence: 0.95, ingestedAt: new Date().toISOString(),
            ingestedBy: currentUser.id, warnings: [], insights: [],
          },
        }
      });
    }
    return rows;
  };

  const generatePreview = () => {
    try {
      const rows = parseCsv(text);
      setPreview(rows);
    } catch (e) {
      toast?.push(`Parse error: ${e.message}`, { tone: "error" });
      setPreview(null);
    }
  };

  const commit = () => {
    if (!preview) return;
    const valid = preview.filter(r => r.ok).map(r => r.report);
    // Skip duplicates (same property + date)
    const existing = new Set(state.reports.map(r => `${r.propertyId}|${r.date}`));
    const fresh = valid.filter(r => !existing.has(`${r.propertyId}|${r.date}`));
    update({ reports: [...state.reports, ...fresh] });
    pushActivity(ctx, "report.import", { count: fresh.length, source: "csv" });
    toast?.push(`Imported ${fresh.length} reports${valid.length - fresh.length > 0 ? ` (${valid.length - fresh.length} duplicates skipped)` : ""}`, { tone: "success" });
    setText(""); setPreview(null);
  };

  const handleFile = async (file) => {
    if (!file) return;
    const t = await file.text();
    setText(t);
    setTimeout(() => generatePreview(), 0);
  };

  const validRows = preview ? preview.filter(r => r.ok).length : 0;
  const errorRows = preview ? preview.filter(r => !r.ok).length : 0;

  return (
    <Card>
      <div className="px-6 py-4 border-b border-stone-200">
        <h3 className="font-display text-lg text-stone-900">Bulk import historical reports</h3>
        <p className="text-xs text-stone-500 mt-0.5">
          Onboard a property's prior 6-12 months of data in one paste. Required columns: <code className="font-mono text-stone-700">date,property</code>.
          Optional: roomsAvailable, roomsSold, roomRevenue, fbRevenue, otherRevenue.
        </p>
      </div>
      <div className="p-6 space-y-4">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          placeholder={examplePlaceholder}
          className="w-full p-3 text-xs font-mono border border-stone-300 rounded-md bg-stone-50/40 focus:bg-white focus:border-amber-700 focus:outline-none"
        />
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { handleFile(e.target.files[0]); e.target.value = ""; }} />
        <div className="flex gap-2 items-center flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload size={13} />Pick CSV file</Button>
          <Button variant="secondary" size="sm" onClick={() => { setText(examplePlaceholder); setPreview(null); }}>Load example</Button>
          {(text || preview) && <Button variant="ghost" size="sm" onClick={() => { setText(""); setPreview(null); }}>Clear</Button>}
          <span className="ml-auto" />
          {!preview && text && <Button variant="primary" size="sm" onClick={generatePreview}>Preview rows</Button>}
          {preview && <Button variant="success" size="sm" disabled={validRows === 0} onClick={commit}><CheckCircle2 size={13} />Import {validRows} {validRows === 1 ? "row" : "rows"}</Button>}
        </div>
        {preview && (
          <div className="rounded-md border border-stone-200 overflow-hidden text-xs">
            <div className="px-4 py-2 bg-stone-50 flex items-center justify-between">
              <span className="font-medium text-stone-700">Preview · {validRows} valid · {errorRows} errors</span>
              <span className="text-stone-500">First 8 rows shown</span>
            </div>
            <table className="w-full">
              <thead className="bg-stone-50/50 text-stone-500 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-1.5 text-left">Status</th>
                  <th className="px-3 py-1.5 text-left">Date</th>
                  <th className="px-3 py-1.5 text-left">Property</th>
                  <th className="px-3 py-1.5 text-right">Total Rev</th>
                  <th className="px-3 py-1.5 text-left">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {preview.slice(0, 8).map((r, i) => (
                  <tr key={i} className={r.ok ? "" : "bg-rose-50/40"}>
                    <td className="px-3 py-1.5">{r.ok ? <Badge color="emerald">OK</Badge> : <Badge color="rose">Error</Badge>}</td>
                    <td className="px-3 py-1.5 tabular text-stone-700">{r.ok ? r.report.date : r.raw?.date || "—"}</td>
                    <td className="px-3 py-1.5 text-stone-700">{r.ok ? state.properties.find(p => p.id === r.report.propertyId)?.name : r.raw?.property || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular">{r.ok ? fmtMoney(r.report.totalRevenue) : "—"}</td>
                    <td className="px-3 py-1.5 text-stone-500">{r.ok ? "Ready" : r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function BackupRestoreCard({ ctx }) {
  const { state, update, toast } = ctx;
  const fileRef = useRef(null);

  const downloadBackup = () => {
    const payload = {
      schema: "hotelops.backup.v1",
      exportedAt: new Date().toISOString(),
      state,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(`hotelops-backup-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json");
    toast?.push("Backup downloaded", { tone: "success" });
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt);
      if (parsed.schema !== "hotelops.backup.v1" || !parsed.state) throw new Error("Not a HotelOps backup");
      if (!confirm(`Restore backup from ${parsed.exportedAt || "unknown date"}? This will overwrite all current local data.`)) return;
      update(parsed.state);
      toast?.push("Backup restored", { tone: "success" });
    } catch (e) {
      toast?.push(`Restore failed: ${e.message}`, { tone: "error" });
    }
  };

  return (
    <Card>
      <div className="px-6 py-4 border-b border-stone-200">
        <h3 className="font-display text-lg text-stone-900">Backup &amp; Restore</h3>
        <p className="text-xs text-stone-500 mt-0.5">Snapshot all local data to a JSON file, or restore from a previous backup.</p>
      </div>
      <div className="px-6 py-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={downloadBackup}><Download size={14} />Download backup</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={e => { handleFile(e.target.files[0]); e.target.value = ""; }} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={14} />Restore from file</Button>
        <span className="text-xs text-stone-500 ml-auto">
          Current size: {state.employees.length} employees · {state.shifts.length} shifts · {state.reports.length} reports
        </span>
      </div>
    </Card>
  );
}

function SettingsModule({ ctx }) {
  const { state, update, currentUser, perms } = ctx;
  const [tab, setTab] = useState("properties");
  const [editingProp, setEditingProp] = useState(null);
  const [showAddProp, setShowAddProp] = useState(false);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex border-b border-stone-200 mb-5">
        {[
          { id: "properties", label: "Properties", icon: Building2 },
          { id: "pay", label: "Pay Settings", icon: DollarSign },
          { id: "integrations", label: "Integrations", icon: Hash },
          { id: "notifications", label: "Notifications", icon: Mail },
          { id: "activity", label: "Activity Log", icon: ClipboardList },
          { id: "system", label: "System", icon: SettingsIcon },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 transition-colors ${tab === t.id ? "border-amber-700 text-amber-800" : "border-transparent text-stone-500 hover:text-stone-700"}`}
          >
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      {tab === "properties" && (
        <div className="space-y-5">
          <Card>
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg text-stone-900">Properties</h3>
                <p className="text-xs text-stone-500 mt-0.5">Hotels and lodging properties under management</p>
              </div>
              {currentUser.role === "admin" && (
                <Button variant="accent" size="sm" onClick={() => setShowAddProp(true)}><Plus size={14} />Add Property</Button>
              )}
            </div>
            <div className="divide-y divide-stone-100">
              {state.properties.map(p => {
                const empCount = state.employees.filter(e => e.propertyId === p.id && e.status === "active").length;
                return (
                  <div key={p.id} className="px-6 py-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center">
                      <BedDouble size={18} className="text-amber-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-stone-900">{p.name}</div>
                      <div className="text-xs text-stone-500 flex items-center gap-3 mt-0.5">
                        <span className="inline-flex items-center gap-1"><MapPin size={11} />{p.location}</span>
                        <span className="inline-flex items-center gap-1"><BedDouble size={11} />{p.rooms} rooms</span>
                        <span className="inline-flex items-center gap-1"><Users size={11} />{empCount} active staff</span>
                      </div>
                    </div>
                    <Badge color="stone">{p.type}</Badge>
                    {currentUser.role === "admin" && (
                      <button onClick={() => setEditingProp(p)} className="text-stone-500 hover:text-stone-900 p-1.5"><Edit2 size={14} /></button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {(editingProp || showAddProp) && (
            <PropertyEditModal
              property={editingProp}
              isNew={showAddProp}
              onClose={() => { setEditingProp(null); setShowAddProp(false); }}
              onSave={(p) => {
                if (showAddProp) {
                  update({ properties: [...state.properties, { ...p, id: newId("p") }] });
                } else {
                  update({ properties: state.properties.map(x => x.id === p.id ? p : x) });
                }
                setEditingProp(null); setShowAddProp(false);
              }}
              onDelete={() => {
                if (state.properties.length <= 1) return;
                update({ properties: state.properties.filter(x => x.id !== editingProp.id) });
                setEditingProp(null);
              }}
              canDelete={state.properties.length > 1}
            />
          )}
        </div>
      )}

      {tab === "pay" && (
        <div className="space-y-5">
          <Card>
            <div className="px-6 py-4 border-b border-stone-200">
              <h3 className="font-display text-lg text-stone-900">Pay Configuration</h3>
              <p className="text-xs text-stone-500 mt-0.5">Defaults applied to time and payroll calculations</p>
            </div>
            <dl className="divide-y divide-stone-100">
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <dt className="font-medium text-stone-900 text-sm">Overtime Threshold</dt>
                  <dd className="text-xs text-stone-500 mt-0.5">Hours per week before 1.5× pay applies</dd>
                </div>
                <div className="font-display text-xl tabular text-stone-900">40 <span className="text-sm text-stone-500">hrs/wk</span></div>
              </div>
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <dt className="font-medium text-stone-900 text-sm">Pay Period</dt>
                  <dd className="text-xs text-stone-500 mt-0.5">Length of each payroll cycle</dd>
                </div>
                <div className="font-display text-xl tabular text-stone-900">2 <span className="text-sm text-stone-500">weeks</span></div>
              </div>
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <dt className="font-medium text-stone-900 text-sm">Period End Day</dt>
                  <dd className="text-xs text-stone-500 mt-0.5">Day of the week each pay period closes</dd>
                </div>
                <div className="font-display text-xl text-stone-900">Saturday</div>
              </div>
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <dt className="font-medium text-stone-900 text-sm">Arkansas Minimum Wage</dt>
                  <dd className="text-xs text-stone-500 mt-0.5">Statutory floor for hourly pay</dd>
                </div>
                <div className="font-display text-xl tabular text-stone-900">$11.00 <span className="text-sm text-stone-500">/hr</span></div>
              </div>
            </dl>
          </Card>

          <Card>
            <div className="px-6 py-4 border-b border-stone-200">
              <h3 className="font-display text-lg text-stone-900">Tax Withholding (Demo Rates)</h3>
            </div>
            <dl className="divide-y divide-stone-100">
              {[
                ["Federal Income Tax", "10.00%", "Flat estimate · production uses W-4 + IRS tables"],
                ["FICA (Social Security + Medicare)", "7.65%", "6.2% SS + 1.45% Medicare"],
                ["Arkansas State Income Tax", "4.00%", "Flat estimate · production uses state withholding tables"],
              ].map(([label, val, sub]) => (
                <div key={label} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <dt className="font-medium text-stone-900 text-sm">{label}</dt>
                    <dd className="text-xs text-stone-500 mt-0.5">{sub}</dd>
                  </div>
                  <div className="font-display text-xl tabular text-stone-900">{val}</div>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      )}

      {tab === "integrations" && <IntegrationsTab ctx={ctx} />}
      {tab === "notifications" && <NotificationsTab ctx={ctx} />}
      {tab === "activity" && <ActivityLogTab ctx={ctx} />}
      {tab === "system" && (
        <div className="space-y-5">
          <ApiKeyCard />
          <CsvImportCard ctx={ctx} />
          <Card>
            <div className="px-6 py-4 border-b border-stone-200">
              <h3 className="font-display text-lg text-stone-900">System</h3>
            </div>
            <dl className="divide-y divide-stone-100">
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <dt className="font-medium text-stone-900 text-sm">Application Version</dt>
                  <dd className="text-xs text-stone-500 mt-0.5">HotelOps prototype</dd>
                </div>
                <Badge color="stone">v1.0 · 2026.05</Badge>
              </div>
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <dt className="font-medium text-stone-900 text-sm">Data Storage</dt>
                  <dd className="text-xs text-stone-500 mt-0.5">All data persists locally per user via window.storage</dd>
                </div>
                <Badge color="emerald">Active</Badge>
              </div>
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <dt className="font-medium text-stone-900 text-sm">Active Employees</dt>
                  <dd className="text-xs text-stone-500 mt-0.5">Across {state.properties.length} {state.properties.length === 1 ? "property" : "properties"}</dd>
                </div>
                <div className="font-display text-xl tabular text-stone-900">{state.employees.filter(e => e.status === "active").length}</div>
              </div>
            </dl>
          </Card>

          {currentUser.role === "admin" && (
            <BackupRestoreCard ctx={ctx} />
          )}
          {currentUser.role === "admin" && (
            <Card className="p-5 bg-rose-50 border-rose-200">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="text-rose-700 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-display text-base text-stone-900">Reset Demo Data</h3>
                  <p className="text-sm text-stone-700 mt-1">
                    Clear all locally-stored data and restore the seed dataset. This affects only your browser's storage.
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    className="mt-3"
                    onClick={async () => {
                      if (!confirm("Clear all data and restore demo seed?")) return;
                      try { await window.storage.delete(STORAGE_KEY); } catch (e) {}
                      window.location.reload();
                    }}
                  >
                    <Trash2 size={14} />Reset All Data
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function PropertyEditModal({ property, isNew, onClose, onSave, onDelete, canDelete }) {
  const [draft, setDraft] = useState(property || {
    name: "", location: "", rooms: 50, type: "Limited Service", aliases: [],
  });
  const [aliasText, setAliasText] = useState((draft.aliases || []).join(", "));
  const handle = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const commitAliases = (text) => {
    setAliasText(text);
    const list = text.split(",").map(s => s.trim()).filter(Boolean);
    handle("aliases", list);
  };

  return (
    <Modal open onClose={onClose} title={isNew ? "Add Property" : `Edit ${property?.name}`}>
      <div className="space-y-4">
        <Input label="Property Name" value={draft.name} onChange={v => handle("name", v)} placeholder="e.g. Riverbend Inn" />
        <Input label="Location" value={draft.location} onChange={v => handle("location", v)} placeholder="e.g. Pine Bluff, AR" />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Total Rooms" type="number" value={draft.rooms} onChange={v => handle("rooms", Number(v))} />
          <Select label="Service Type" value={draft.type} onChange={v => handle("type", v)} options={[
            { value: "Limited Service", label: "Limited Service" },
            { value: "Select Service", label: "Select Service" },
            { value: "Full Service", label: "Full Service" },
            { value: "Extended Stay", label: "Extended Stay" },
            { value: "Resort", label: "Resort" },
          ]} />
        </div>
        <div>
          <Input label="Parser Aliases (comma-separated)" value={aliasText} onChange={commitAliases} placeholder="e.g. RBI, Riverbend, Pine Bluff Lodge" />
          <p className="text-[11px] text-stone-500 mt-1">These names help Smart Ingest match audit reports to this property even when the report uses an abbreviation or older name.</p>
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-stone-200">
          {!isNew && canDelete ? (
            <Button variant="danger" size="sm" onClick={onDelete}><Trash2 size={14} />Remove</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!draft.name || !draft.location} onClick={() => onSave(draft)}>
              <Save size={14} />Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

