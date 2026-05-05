# HotelOps

> Premium hotel **back-office** suite — accounting, payroll, employees, taxes, W-2 / 1099, and night-audit ingestion. Built to sit *next to* your PMS, not replace it.

[![Release](https://github.com/LiteKxuh/AccSoft/actions/workflows/release.yml/badge.svg)](https://github.com/LiteKxuh/AccSoft/actions/workflows/release.yml)

## What it is — and isn't

HotelOps is **not** a property management system. It does not handle reservations, room inventory, rate management, or guest-facing operations.

What it does handle is everything that happens **after** the night-audit closes:

| Module | What's inside |
|---|---|
| **Smart Ingest** | Format-agnostic audit parser — paste any night-audit text, drop a PDF/image, or batch multiple days · USALI-aligned mapping · auto-generated insights |
| **Flash Report** | Hero day view · STAR-style indices · variance vs baselines · diff vs any other date · comments with @-mentions · JSON / CSV export · period-lock banner |
| **P&L** | Schedule of Operating Revenue (USALI 11th ed.) with MTD + budget + variance + YTD |
| **Budget** | Monthly plan-vs-actual matrix · pacing tile · auto-seeded from history |
| **A/R Aging** | Direct-bill / city-ledger aging buckets |
| **A/P** | Vendor management · invoice approval workflow · AP aging |
| **Tax Calendar** | Per-property × per-month liability accrual with filing deadlines |
| **W-2 / 1099** | YTD wage summary · federal/state/FICA withholding · 1099-NEC contractor tracking · year-end form preview |
| **Reconcile** | Data-quality issues · cash deposit reconciliation · **Month-End Close** workflow |
| **Reports** | Custom report builder with saved templates (M3-style canned reports) |
| **Trends** | Revenue + occupancy + ADR/RevPAR with budget overlay & auto-commentary |
| **Forecast** | OLS + day-of-week seasonality projection with 95% confidence band |
| **Compset** | STR-style competitive set indices |
| **Portfolio** | Multi-property roll-up with drill-down |

Plus the workforce side:

- **Employees** — profiles, documents (I-9, W-4, certifications), write-ups, time history
- **Time Clock** — punch in / out with break tracking
- **Schedule** — week-by-week shift planner with PTO overlay
- **Payroll** — gross-to-net with tax withholding feeding W-2s
- **Tax & W-2 / 1099** — year-end forms calculated from posted payroll
- **Scorecard** — GM morning briefing — KPIs vs target + ranked action items
- **Activity log** — append-only audit trail (SOX-grade)
- **Backup / restore** — local IndexedDB persistence with export

## First-run experience

Open the installed app and you'll see a three-step **Setup Wizard**:

1. **Welcome** — overview of what HotelOps covers
2. **Owner account** — name, email, role
3. **First property** — name, location, rooms, service type

That's it. From there you land in the dashboard with a guided checklist, and you can start adding employees, ingesting audits, and logging vendor invoices. Nothing is pre-populated with demo data — your data is your data from minute one.

## Run locally

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm run dev:electron # desktop app (Vite + Electron together)
```

## Build the desktop app

```bash
npm run dist        # builds Windows installer to ./release/
npm run publish     # builds AND publishes to GitHub Releases (needs GH_TOKEN)
```

## Auto-update flow

1. User installs `HotelOps-Setup-x.x.x.exe`
2. App checks GitHub Releases on launch + every 30 min
3. New release → download in background → prompt to restart
4. On restart, the new version is applied

To ship a release: `npm version patch && git push --tags` — GitHub Actions builds the installer and publishes it automatically. Every installed copy picks up the new version on its next launch.

## Tech

- React 18 + Vite + Tailwind 3 + Recharts
- Electron 33 + electron-builder + electron-updater
- IndexedDB for local persistence (no server, your data never leaves the machine)
- USALI-aligned chart of accounts
- Claude API (optional) for PDF/image OCR enrichment in Smart Ingest

## License

Proprietary · © 2026 HotelOps
