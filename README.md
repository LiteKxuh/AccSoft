# HotelOps

> Premium hotel accounting, daily flash, payroll, scheduling, and night-audit ingestion — built for multi-property operators.

[![Release](https://github.com/LiteKxuh/AccSoft/actions/workflows/release.yml/badge.svg)](https://github.com/LiteKxuh/AccSoft/actions/workflows/release.yml)

## What it does

| Module | What's inside |
|---|---|
| **Flash Report** | Hero day view · STAR-style indices · variance vs baselines · diff vs any other date · comments with @-mentions · JSON / CSV export · period-lock banner |
| **Smart Ingest** | Format-agnostic audit parser — paste any night-audit text, drop a PDF/image, or batch multiple days · USALI-aligned mapping · auto-generated insights |
| **Budget** | Monthly plan-vs-actual matrix · pacing tile · auto-seeded from history |
| **P&L** | Schedule of Operating Revenue (USALI 11th ed.) with MTD + budget + variance + YTD |
| **A/R Aging** | Direct-bill / city-ledger aging buckets |
| **A/P** | Vendor management · invoice approval workflow · AP aging |
| **Tax Calendar** | Per-property × per-month liability accrual with filing deadlines |
| **Portfolio** | Multi-property roll-up with drill-down |
| **Trends** | Revenue + occupancy + ADR/RevPAR with budget overlay & auto-commentary |
| **Forecast** | OLS + day-of-week seasonality projection with 95% confidence band |
| **Reconcile** | Data-quality issues · cash deposit reconciliation · **Month-End Close** workflow |
| **Reports** | Custom report builder with saved templates (M3-style canned reports) |
| **Compset** | STR-style competitive set indices |
| **Scorecard** | GM morning briefing — KPIs vs target + ranked action items |

Plus: time clock · schedule with PTO overlay · payroll · employees with documents & write-ups · activity log · backup/restore · PMS & accounting integrations · daily digest preview.

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

The installed app auto-updates from this repo's GitHub Releases on launch.

## Auto-update flow

1. User installs `HotelOps-Setup-x.x.x.exe`
2. App checks GitHub Releases on launch + every 30 min
3. New release → download in background → prompt to restart
4. On restart, the new version is applied

To ship a release, push a `vX.Y.Z` tag — GitHub Actions builds the installer and publishes it automatically.

## Tech

- React 18 + Vite + Tailwind 3 + Recharts
- Electron 33 + electron-builder + electron-updater
- IndexedDB for local persistence
- USALI-aligned chart of accounts
- Claude API (optional) for PDF/image OCR enrichment

## License

Proprietary · © 2026 HotelOps
