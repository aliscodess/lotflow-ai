# LotFlow AI

**AI-powered dealership operations from the lot to the service bay.**

> Speak what you see. LotFlow handles the rest.

LotFlow turns real-world dealership observations into structured inventory updates, proactive service actions, operational recommendations and customer communication. A lot associate walks the lot with a phone, describes what they see, optionally snaps a photo, and LotFlow updates the vehicle, opens an inspection, finds a bay and technician, resolves missing parts across stores, alerts the manager and keeps the customer informed, live.

Built for **Tekion's Tek Qubit challenge**.

---

## Contents

1. [Problem](#problem)
2. [Solution](#solution)
3. [Why LotFlow?](#why-lotflow)
4. [Key features](#key-features)
5. [Architecture](#architecture)
6. [Tech stack](#tech-stack)
7. [Database schema](#database-schema)
8. [AI workflow](#ai-workflow)
9. [Demo flow (3–5 minutes)](#demo-flow-35-minutes)
10. [Local setup: step by step](#local-setup-step-by-step)
11. [Environment variables](#environment-variables)
12. [Deployment (Vercel + Render + MongoDB Atlas)](#deployment-vercel--render--mongodb-atlas)
13. [API reference](#api-reference)
14. [Project structure](#project-structure)
15. [Troubleshooting](#troubleshooting)
16. [Future scope](#future-scope)

---

## Problem

Dealership operations still run on walkie-talkies, clipboards and memory:

- Lot associates spot damage, low tyres and misparked cars, but the observation rarely reaches the DMS in a structured form. Vehicles go "missing" on their own lot.
- Service advisors find out about issues late, then discover the part is out of stock and the assigned technician is on leave.
- Managers see aging inventory but not *why* it is aging, and cannot compare stores on the operational habits that cause it.
- Customers call to ask "is my car ready?" because nobody told them it is waiting on a part.
- Every one of these gaps burns fuel and time: extra trips, re-parking, idle bays.

## Solution

One connected workflow instead of seven disconnected tools:

```
LOT ASSOCIATE → VOICE + PHOTO → AI UNDERSTANDS OBSERVATION → VEHICLE INVENTORY UPDATED
→ ISSUE DETECTED → SERVICE TASK CREATED → PARTS AVAILABILITY CHECKED
→ SERVICE BAY / TECHNICIAN ASSIGNED → MANAGER ALERTED → CUSTOMER STATUS UPDATED
```

LotFlow follows one principle everywhere: **understand → decide → act → show the result.** It does not just answer questions; every recommendation has an *Apply* button that runs the real workflow and writes to the database.

## Why LotFlow?

LotFlow combines six challenge ideas into a single product, because in a real dealership they are one chain of events:

```
Voice Lot Assistant            (Theme 1: AI & Automation)
  +
Service Parts Shortage Resolver (Theme 1)
  +
Autonomous Dispatch Orchestration (Theme 1)
  +
Days-to-Sell Anomaly Explainer & cross-store analytics (Theme 2: Data Analytics)
  +
Proactive Service Status Companion (Theme 3: Customer Experience)
  +
Green Dealership Score (Theme 4: Sustainability)
```

A single voice note ("*Vehicle 2847 is in row B position 12, scratch on the front bumper, left rear tyre looks low, send it for inspection*") flows through every one of them: inventory and lot map update, an inspection and alert are created, the dispatcher picks a bay and technician, the parts resolver finds brake pads 12 km away, the customer's tracking page moves to "Repair scheduled", and the sustainability view groups the resulting part transfers into fewer trips.

## Key features

| Area | What it does |
| --- | --- |
| **Voice Lot Assistant** (hero) | Mobile-first push-to-talk using the browser's Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`, `en-IN`). Live transcript and waveform, "I understood" review card with highlighted entities, editable fields, health-score preview, photo capture/upload, typed fallback and one-tap sample observations. |
| **AI extraction** | Provider-agnostic AI layer (Anthropic, OpenAI or Groq) with prompt templates, JSON extraction and zod validation. Without a key, a deterministic rules engine tuned for Indian-English lot talk ("tyre", "bonnet", spoken numbers like "twenty eight forty seven") does the same job. Malformed AI output falls back automatically. |
| **Manager command center** | Health band (healthy / needs attention / critical), five operational KPIs, live AI alerts with one-click actions, service bay snapshot and live activity feed over Socket.IO. |
| **Interactive lot map** | Six rows × twelve stalls drawn like a real lot (painted stall lines, lanes, facing rows). Cars coloured by status, critical markers, filters, stock-number search and a details drawer. |
| **Vehicle details** | Overview, condition, location strip, photos, inspection and service history, AI insights and a full activity timeline, with a 0–100 health score broken down by location, condition, photos, listing and service. |
| **Service orchestrator** | Bay cards with live progress, technician workload, a bay Gantt for today, repair orders with status workflow, and the inspections queue (inspection → repair order in one click). |
| **Parts shortage resolver** | Checks stock across three stores, recommends the fastest option (express transfer vs. adding to the scheduled 11:00/15:30 parts run vs. OEM order), then requests the transfer and reschedules the job around the part's arrival. |
| **Autonomous dispatch** | Rule-based list scheduler: reassigns unavailable technicians, defers jobs until parts arrive, prioritises urgent work, shifts around overrunning jobs and pulls work forward into idle gaps. Shows every change and idle time before → after. *Apply recommendation* writes the new schedule. |
| **AI Action Center** | Every recommendation with priority, issue, reason, recommended action and expected impact. *Apply* executes eight different action types end to end. |
| **Days-to-sell explainer** | For each aging vehicle: risk level, reasons computed from data (photo coverage vs. comparables, listing completeness, lot visibility, online views, condition), recommendations and a one-click merchandising playbook. It never changes price. |
| **Cross-store benchmarking** | Store A/B/C comparison table, charts and an AI insight explaining the weakest store. |
| **Customer service status** | Advisor console to move stages, set ETA and message the customer (simulated WhatsApp/SMS log), plus a clean public tracking page (`/track/LF2847`) that auto-refreshes. Status also updates automatically from the repair order. |
| **Sustainability** | Green dealership score, avoidable movement, fuel savings (INR), idle-time reduction, EV utilisation, recommendations and transfer grouping. |
| **Real-time** | Socket.IO pushes vehicle, alert, service and customer changes to every open dashboard; polling fallback if the socket drops. |
| **Security** | bcrypt password hashing, JWT access + refresh tokens with revocation, role-based access control on every route, zod input validation, Helmet, CORS allow-list, rate limiting, no secrets in source. |
| **Demo mode** | One-click role logins, realistic seeded Bengaluru dealership group, deterministic AI, *Reset demo data* button, and a "Demo environment" indicator explaining that enterprise integrations are simulated. |

Roles: **Manager**, **Lot Associate**, **Service Advisor**. Desktop is optimised for managers and advisors; the voice assistant and lot map are optimised for associates on phones.

## Architecture

```
┌──────────────────────────┐        REST (Axios, JWT)        ┌───────────────────────────────┐
│  React + Vite + TS       │  ─────────────────────────────▶ │  Express API                  │
│  Tailwind, Recharts      │  ◀───── Socket.IO events ─────  │  routes → controllers →       │
│  Web Speech API          │                                 │  services (workflow, dispatch,│
│  (Vercel)                │                                 │  parts, analytics, actions)   │
└──────────────────────────┘                                 │  (Render)                     │
                                                             └──────┬───────────────┬────────┘
                                                                    │ Mongoose      │ fetch
                                                             ┌──────▼──────┐  ┌─────▼──────────────┐
                                                             │  MongoDB    │  │ AI provider        │
                                                             │  (Atlas)    │  │ Anthropic / OpenAI │
                                                             └─────────────┘  │ / Groq, or rules   │
                                                                              └────────────────────┘
```

Backend layering:

- `routes/` – URL → middleware (auth, role, validation) → controller
- `controllers/` – HTTP in/out only
- `services/` – all business logic: `voiceWorkflowService`, `inspectionService`, `dispatchService`, `partsService`, `analyticsService`, `actionService`, `customerService`, `healthService`, `socketService`, `storageService`, and `ai/` (`aiService`, `promptTemplates`, `parsers`, `providers`, `demoEngine`)
- `models/` – Mongoose schemas
- `seed/` – deterministic demo dataset

## Tech stack

**Frontend:** React 19, Vite, TypeScript, Tailwind CSS 4, React Router, Axios, Recharts, Lucide icons, Socket.IO client, Web Speech API, Archivo variable font (width axis used for stock-number stickers).

**Backend:** Node.js 20+, Express 5, MongoDB + Mongoose, Socket.IO, JSON Web Tokens, bcryptjs, zod, Helmet, CORS, express-rate-limit, Multer (+ optional Cloudinary), optional `mongodb-memory-server` for zero-install demos.

**AI:** Anthropic Messages API, OpenAI Chat Completions or Groq (OpenAI-compatible), selected with environment variables. Built-in deterministic rules engine when no key is set.

## Database schema

| Collection | Key fields |
| --- | --- |
| **User** | name, email (unique), password (bcrypt, never returned), role (`MANAGER` / `LOT_ASSOCIATE` / `SERVICE_ADVISOR`), dealershipId, storeCode, tokenVersion |
| **Dealership** | name, location, stores[] (code, name, label, distanceKm, metrics, 6-month trend) |
| **Vehicle** | vehicleId (stock no.), vin, make, model, variant, year, type, fuelType, color, ownership, location {zone, row, position}, lastSeenAt, status (`AVAILABLE` / `INSPECTION_REQUIRED` / `SERVICE` / `SOLD` / `HOLD`), condition {exterior, interior, tires, fuel, battery, mechanical}, photos[], inspectionHistory[], serviceHistory[], stockedAt, daysInInventory, expectedDaysToSell, listingCompleteness, listing stats, healthScore, healthBreakdown, timestamps |
| **Inspection** | inspectionId, vehicleId, reportedBy, issues[] {area, description, severity, conditionKey}, photos[], status, priority, source (VOICE/MANUAL), transcript, aiMeta, serviceTaskId |
| **ServiceTask** | taskId (RO-####), vehicleId, issue, category, requiredSkill, priority, status, technician, bay, requiredParts[] {partNumber, qty, status, sourceStore, eta, transferId}, estimatedDuration, scheduledTime, history[] |
| **Part** | partNumber, name, category, brand, compatibleModels[], unitPriceINR, leadTimeDays, inventoryByStore[] {storeCode, quantity, reserved, reorderLevel, bin} |
| **PartTransfer** | transferId, partNumber, qty, fromStore, toStore, distanceKm, eta, serviceTaskId, status |
| **Technician** | techId, name, level, skills[], status (AVAILABLE/BUSY/OFF), shift |
| **Bay** | code, name, type (GENERAL/QUICK/EV/BODY), capabilities[] |
| **Alert** | type, priority, title, description, vehicleId, reason, recommendedAction, expectedImpact, actionType, payload, audience[], status, resolution |
| **Customer** | customerCode, name, phone, vehicleId, relationship, trackingCode, serviceStatus {stage, steps[], estimatedCompletion, advisorNote}, notifications[] |
| **Activity** | vehicleId, type, message, actor, source (VOICE/AI/MANUAL/SYSTEM), timestamps (vehicle timelines and live feeds) |

Seed data: 3 stores (Whitefield, Koramangala, Hebbal in Bengaluru), 64 vehicles (56 inventory + 8 customer cars in service) across 72 lot stalls, 10 technicians, 5 bays, 30 parts with per-store stock, 20 service tasks, 10 customers, 9 alerts (7 actionable), part transfers, aging vehicles and parts shortages. Prices in INR.

## AI workflow

```
transcript ──▶ aiService.extractObservation()
                 ├─ AI key set?  ── yes ─▶ provider (Anthropic / OpenAI / Groq)
                 │                          prompt: promptTemplates.OBSERVATION_SYSTEM
                 │                          parsers.extractJson()  (handles ```json fences, prose)
                 │                          parsers.validateObservation()  (zod + business rules)
                 │                          invalid or error ─▶ fall back to rules engine
                 └─ no ──────────────────▶ demoEngine.extractObservation()  (deterministic)
               ──▶ voiceWorkflowService.previewObservation()
                     checks the vehicle exists, slot conflicts, simulates health score
               ──▶ "I understood" card (associate can edit) ──▶ Confirm
               ──▶ voiceWorkflowService.applyObservation()
                     update vehicle + condition + location + photos
                     open inspection (inspectionService) + actionable alert
                     dispatchService.previewSlot() suggests bay/technician/time
                     Socket.IO: vehicle:updated, alert:new, notification
```

Example output (validated before anything is written):

```json
{
  "vehicleId": "2847",
  "location": { "row": "B", "position": 12 },
  "issues": [
    { "area": "front bumper", "description": "minor scratch", "severity": "low" },
    { "area": "left rear tire", "description": "low pressure", "severity": "medium" }
  ],
  "action": "inspection_required",
  "priority": "medium"
}
```

AI is also used for the days-to-sell narrative and the cross-store insight. In both cases the **facts are computed from the database** and the model only writes the explanation, so it cannot invent numbers or recommend price changes.

## Demo flow (3–5 minutes)

Start from a fresh dataset: sign in as Manager → profile menu (top right) → **Reset demo data**.

1. **Lot Associate.** On the login page click **Continue as Lot Associate**. You land on the Voice Lot Assistant (works best on a phone or a narrow window).
2. Tap the microphone and say, or tap the **Damage + inspection** sample:
   > "Vehicle 2847 is in row B position 12. There is a scratch on the front bumper and the left rear tire looks low. Send it for inspection."
3. LotFlow shows *Processing observation…* then **I understood**: vehicle #2847 (2024 Mahindra XUV700), Row B → Position 12 (moved from A4), front bumper → minor scratch (low), left rear tire → low pressure (medium), action *Inspection required*, health 99 → 81. Click **Confirm update**: ✓ Vehicle updated ✓ Inspection task created ✓ Service team notified.
4. **Manager.** Profile menu → *Switch demo role → Manager* (or open a second browser window signed in as Manager before step 2 to watch it arrive live). The dashboard shows **Vehicle #2847 requires inspection** with a recommended bay, technician and time. Open the lot map: #2847 now sits in B12 in amber. Open the vehicle to show the health breakdown and activity timeline.
5. **Service Advisor.** Switch to Service Advisor → **Service → Inspections** → **Create repair order** on #2847. LotFlow assigns a bay and technician and opens the repair order.
6. In *Common parts for this model*, click **Front brake pad set**. Shortage detected: Whitefield 0, Koramangala 0, **Hebbal 12 available**. The AI recommends *Transfer 1 unit from Store C (Hebbal), 12 km, about 2 hours* with the alternative *Reschedule job* to a later slot via the scheduled 11:00 / 15:30 parts run (exact times depend on when you run the demo).
7. Click **Transfer part**: ✓ Part transfer requested ✓ Bay assigned ✓ Technician assigned ✓ Customer status updated.
8. Go to **Bays & schedule** to show the Gantt and the **AI scheduling recommendation** (reassign the technician on leave, defer the AC-compressor job until its part arrives, schedule the urgent brake job). Click **Apply recommendation** and point at idle time before → after.
9. **Customer.** Open **Customers → Rohan Mehta → Open customer view** (or `/track/LF2847`): *Repair scheduled* with the estimated completion time.
10. Optional extras: **Analytics** (#1732 is aging: 47 days vs 32 expected, 42% fewer photos, incomplete listing, back-row parking; apply the merchandising playbook), **AI actions** (apply any of the eight action types), **Sustainability**.

## Local setup: step by step

### 1. Install prerequisites

- **Node.js 20 or newer** (22 LTS recommended): <https://nodejs.org>. Check with `node -v`.
- **A database**, pick one:
  - **Option A, nothing to install (easiest):** the in-memory database. LotFlow downloads a MongoDB binary (~100 MB) the first time and seeds itself. Data resets when the server stops. Requires internet on first run.
  - **Option B, local MongoDB:** install MongoDB Community Server 7 or 8.
    - Windows: download the MSI from <https://www.mongodb.com/try/download/community> and keep "Install as a Service" ticked.
    - macOS: `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`
    - Ubuntu: follow <https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/> then `sudo systemctl start mongod`
  - **Option C, MongoDB Atlas (free cloud):** create a free M0 cluster at <https://www.mongodb.com/atlas>, add a database user, allow your IP (or `0.0.0.0/0` for a demo) under *Network Access*, and copy the connection string.
- **Chrome or Edge** for the voice demo (see [browser support](#voice-does-not-work)).

### 2. Unzip and install dependencies

```bash
cd lotflow
npm run install:all
```

This installs the root helper (`concurrently`), the backend and the frontend. If you prefer, run `npm install` inside `backend/` and inside `frontend/` separately.

### 3. Create the environment files

macOS / Linux:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Windows (PowerShell):

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

Then edit `backend/.env`:

- Set `JWT_SECRET` and `JWT_REFRESH_SECRET` to long random strings. Generate one with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- Database:
  - Option A: set `USE_MEMORY_DB=true` (or skip editing and use `npm run dev:memory` below).
  - Option B: keep `MONGODB_URI=mongodb://127.0.0.1:27017/lotflow`.
  - Option C: paste your Atlas string into `MONGODB_URI`, ending with `/lotflow?retryWrites=true&w=majority`.
- AI (optional): put an API key in `AI_API_KEY` and set `AI_PROVIDER` to `anthropic`, `openai` or `groq`. Leave it empty to use the built-in rules engine; the demo works identically.

`frontend/.env` can stay as it is for local development.

### 4. Seed the database (optional)

The server seeds an empty database automatically (`AUTO_SEED=true`). To reset at any time:

```bash
npm run seed          # from the project root (Options B and C)
```

or use **Reset demo data** in the Manager's profile menu (works with every option).

### 5. Run the app

From the project root, one command starts both servers:

```bash
npm run dev           # Options B and C
npm run dev:memory    # Option A, no MongoDB needed
```

Or in two terminals:

```bash
# terminal 1
cd backend
npm run dev           # or: npm run dev:memory

# terminal 2
cd frontend
npm run dev
```

You should see `LotFlow API listening on http://localhost:5000` and Vite on `http://localhost:5173`.

### 6. Open it

Go to **<http://localhost:5173>** and click **Continue as Manager**, **Continue as Lot Associate** or **Continue as Service Advisor**. Email sign-in also works with the demo accounts below.

| Role | Email | Password |
| --- | --- | --- |
| Manager | `manager@lotflow.demo` | `Demo@123` |
| Lot Associate | `associate@lotflow.demo` | `Demo@123` |
| Service Advisor | `advisor@lotflow.demo` | `Demo@123` |

Quick API check: <http://localhost:5000/api/health> shows the database, AI engine and demo-mode status.

### 7. Try it on your phone

Speech recognition in mobile browsers requires HTTPS. On the same Wi-Fi you can open `http://<your-computer-ip>:5173` and use the **Type instead** fallback, but for real voice on a phone, deploy (step below) or expose your laptop through an HTTPS tunnel such as `npx localtunnel --port 5173` or ngrok.

### 8. Production build (optional)

```bash
npm run build                # builds frontend/dist
cd frontend && npm run preview
```

## Environment variables

### Backend (`backend/.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | no | API port (default `5000`) |
| `NODE_ENV` | no | `development` or `production` |
| `MONGODB_URI` | yes* | MongoDB connection string. *Not needed with `USE_MEMORY_DB=true` |
| `USE_MEMORY_DB` | no | `true` to use an in-memory MongoDB (demo only) |
| `MEMORY_DB_FALLBACK` | no | In development, use the in-memory DB if `MONGODB_URI` is unreachable (default `true`; forced off in production) |
| `AUTO_SEED` | no | Seed demo data when the database is empty (default `true`) |
| `JWT_SECRET` | yes in production | Signs access tokens. In development a random one is generated if missing |
| `JWT_REFRESH_SECRET` | recommended | Signs refresh tokens |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | no | Token lifetimes (default `15m` / `7d`) |
| `CLIENT_URL` | yes in production | Allowed frontend origin(s), comma-separated. `localhost` and LAN origins are always allowed in development |
| `DEMO_MODE` | no | `true` enables one-click demo logins and *Reset demo data* (default `true`) |
| `AI_PROVIDER` | no | `anthropic`, `openai` or `groq` |
| `AI_API_KEY` | no | Provider key. Empty = built-in rules engine |
| `AI_MODEL` | no | Model override (defaults: `claude-haiku-5-5`, `gpt-4o-mini`, `llama-3.3-70b-versatile`) |
| `AI_BASE_URL` | no | Custom endpoint for OpenAI-compatible gateways |
| `AI_TIMEOUT_MS` | no | Provider timeout before falling back (default `12000`) |
| `CLOUDINARY_URL` or `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` | no | Photo storage. Without it photos are stored in `backend/uploads` |
| `SERVER_URL` | no | Public API URL (fallback for local photo links) |
| `DEALERSHIP_TZ_OFFSET_MIN` | no | Dealership timezone offset for schedule labels (default `330`, IST) |

### Frontend (`frontend/.env`)

| Variable | Description |
| --- | --- |
| `VITE_API_URL` | Backend URL. Leave empty locally (Vite proxies `/api`, `/uploads` and `/socket.io` to port 5000). Set to your Render URL in production |
| `VITE_DEV_PROXY_TARGET` | Optional, point the dev proxy at another backend |

## Deployment (Vercel + Render + MongoDB Atlas)

### 1. Database: MongoDB Atlas

1. Create a free M0 cluster.
2. *Database Access*: add a user and password.
3. *Network Access*: add `0.0.0.0/0` (Render's IPs are dynamic).
4. *Connect → Drivers*: copy the string and add the database name: `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/lotflow?retryWrites=true&w=majority`.

### 2. Backend: Render

Push the project to GitHub, then either:

- **Blueprint:** Render → *New + → Blueprint* → select the repo. `render.yaml` creates the `lotflow-api` web service; fill in `MONGODB_URI`, `CLIENT_URL` and optionally `AI_API_KEY`.
- **Manual:** *New + → Web Service* → repo → **Root directory** `backend`, **Build** `npm install`, **Start** `npm start`, **Health check path** `/api/health`. Add environment variables: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_URL` (your Vercel URL, set after step 3), `DEMO_MODE=true`, `MEMORY_DB_FALLBACK=false`, optionally `AI_PROVIDER`/`AI_API_KEY`, `CLOUDINARY_URL`.

The first boot seeds Atlas automatically. Note your URL, e.g. `https://lotflow-api.onrender.com`. (Free Render instances sleep after inactivity; open `/api/health` a minute before a demo to wake it. Use Cloudinary for photos in production because Render's disk is ephemeral.)

### 3. Frontend: Vercel

1. Vercel → *Add New → Project* → import the repo.
2. **Root directory** `frontend`. Framework preset: Vite (build `npm run build`, output `dist`).
3. Environment variable: `VITE_API_URL=https://lotflow-api.onrender.com`.
4. Deploy. `vercel.json` already rewrites all routes to `index.html` so deep links like `/track/LF2847` work.
5. Copy the Vercel URL into Render's `CLIENT_URL` and redeploy the backend.

Because Vercel serves over HTTPS, the voice assistant works on phones (Chrome on Android; Safari on iOS 14.5+).

## API reference

All routes are under `/api`. Everything except `health`, `auth/*` and `public/*` requires `Authorization: Bearer <accessToken>`; role restrictions are enforced server-side.

| Method & path | Roles | Purpose |
| --- | --- | --- |
| `GET /health` | public | DB, AI and demo status |
| `POST /auth/login` | public | Email + password → access + refresh token |
| `POST /auth/demo` | public (demo mode) | One-click login by role |
| `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` | | Session management |
| `GET /vehicles` · `GET /vehicles/lot` · `GET /vehicles/:id` | all | Inventory list, lot map, vehicle details (+ inspections, tasks, timeline, aging insight) |
| `PATCH /vehicles/:id` · `POST /vehicles/:id/photos` | all | Update status/location/condition, upload photos |
| `POST /voice/process` | associate, manager | Transcript → validated observation + preview |
| `POST /voice/preview` · `POST /voice/confirm` | associate, manager | Re-validate edits · apply the observation |
| `GET /voice/recent` · `GET /voice/samples` | all | Recent voice updates · demo scripts + AI engine |
| `GET /inspections` · `POST /inspections` | all | List / create inspections |
| `POST /inspections/:id/convert` | advisor, manager | Inspection → repair order with bay + technician |
| `GET /service/tasks` · `POST /service/tasks` · `GET/PATCH /service/tasks/:id` | advisor, manager | Repair orders and status workflow |
| `POST /service/tasks/:id/parts` | advisor, manager | Add a part (reserves stock or flags a shortage) |
| `GET /service/board` | advisor, manager | Bays, technicians, timeline |
| `GET /service/dispatch/recommendation` · `POST /service/dispatch/apply` | advisor, manager | Scheduling recommendation · apply it |
| `GET /parts` · `GET /parts/:partNumber/availability` · `POST /parts/resolve` | advisor, manager | Inventory, cross-store availability, resolve shortage |
| `GET /parts/transfers` · `POST /parts/transfers/:id/receive` | advisor, manager | Transfers |
| `GET /analytics/dashboard` · `GET /analytics/aging` · `GET /analytics/aging/:vehicleId` | advisor, manager | KPIs, aging list, AI explanation |
| `POST /analytics/aging/:vehicleId/playbook` · `GET /analytics/stores` · `GET /analytics/sustainability` | manager | Merchandising playbook, benchmarking, green score |
| `GET /alerts` · `PATCH /alerts/:id` | all / advisor, manager | Alerts |
| `GET /actions` · `POST /actions/:id/apply` | advisor, manager | AI Action Center |
| `GET /customers` · `GET/PATCH /customers/:id/service-status` · `POST /customers/:id/notify` | advisor, manager | Customer status console |
| `GET /public/track/:code` | public | Customer tracking page data |
| `POST /system/demo/reset` | manager | Restore the demo dataset |

Socket.IO events: `vehicle:updated`, `alert:new`, `alert:updated`, `activity:new`, `inspection:new`, `service:updated`, `parts:updated`, `customer:updated`, `notification`, `system:reset`.

## Project structure

```
lotflow/
├── README.md
├── .env.example
├── package.json            # root helper: install:all, dev, dev:memory, seed
├── render.yaml             # Render blueprint for the API
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── uploads/            # local photo storage when Cloudinary is not configured
│   └── src/
│       ├── server.js       # HTTP + Socket.IO bootstrap, auto-seed
│       ├── app.js          # Express app, security middleware, CORS
│       ├── config/         # env.js, db.js (MongoDB / in-memory fallback)
│       ├── models/         # User, Dealership, Vehicle, Inspection, ServiceTask, + index.js
│       ├── routes/         # index.js (all routes with auth, roles, validation)
│       ├── controllers/    # auth, vehicle, voice, service, parts, analytics, alert, customer, system
│       ├── services/
│       │   ├── ai/         # aiService, promptTemplates, parsers, providers, demoEngine
│       │   └── *.js        # voiceWorkflow, inspection, dispatch, parts, analytics, action, customer, health, socket, storage, activity
│       ├── middleware/     # auth (JWT + RBAC), validate (zod), upload, errorHandler
│       ├── utils/          # constants, time, ApiError, serviceSteps, logger
│       └── seed/           # catalog.js (reference data), seed.js, runSeed.js
└── frontend/
    ├── .env.example
    ├── vercel.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx · App.tsx · index.css
        ├── layouts/        # AppLayout (sidebar, top bar, mobile bottom nav)
        ├── pages/          # Login, Dashboard, LotMap, Vehicles, VehicleDetails, VoiceAssistant,
        │                   # Service, ActionCenter, Analytics, Customers, Track, Sustainability
        ├── components/     # ui primitives, StockTag, AlertCard, PartsResolver, Timeline, ...
        ├── context/        # Auth, Theme, Toast, Realtime (Socket.IO)
        ├── hooks/          # useApi + useLiveRefresh, useSpeechRecognition
        ├── services/       # api.ts (Axios + token refresh), socket.ts
        ├── types/          # shared TypeScript types
        └── utils/          # formatting, labels
```

## Troubleshooting

**"Cannot reach the LotFlow server" on the login page.** The backend is not running or crashed. Start it (`npm run dev` in `backend/`) and look at its terminal output. Check <http://localhost:5000/api/health>.

**`Could not connect to MongoDB`.** Local: make sure `mongod` is running (`brew services list`, Windows *Services* app, or `sudo systemctl status mongod`). Atlas: check the user/password in the string, URL-encode special characters in the password, and allow your IP under *Network Access*. In development the server falls back to the in-memory database so the demo still runs; the log tells you when that happens.

**In-memory database download fails.** It needs internet access to `fastdl.mongodb.org` on first run. Behind a strict firewall use local MongoDB or Atlas instead.

**Port already in use (`EADDRINUSE`).** Another process is using 5000 or 5173. Stop it, or set `PORT=5050` in `backend/.env` and `VITE_DEV_PROXY_TARGET=http://localhost:5050` in `frontend/.env`.

<a id="voice-does-not-work"></a>**Voice does not work.**
- Use **Chrome or Edge** (desktop or Android) or **Safari** on iOS/macOS. Firefox has no speech recognition, so LotFlow switches to the typed fallback automatically.
- Allow microphone access when the browser asks. If you blocked it, click the padlock in the address bar → *Microphone → Allow* and reload.
- The page must be served from `localhost` or HTTPS.
- Chrome's speech service needs internet access. If it fails, the error banner offers **Type instead**, and the sample chips always work.

**CORS error in production.** `CLIENT_URL` on Render must exactly match the Vercel origin (no trailing slash). Multiple origins can be comma-separated.

**Logged out after a restart.** If `JWT_SECRET` is not set, a random secret is generated per run in development. Set it in `.env` to keep sessions across restarts.

**Demo data got messy.** Manager → profile menu → **Reset demo data**, or `npm run seed`.

## Future scope

- Native DMS integration (Tekion ARC) instead of the simulated inventory feed
- Computer vision on uploaded photos to grade damage and auto-fill the condition report
- Multilingual voice (Hindi, Kannada, Tamil) and offline capture with background sync
- RFID / QR yard scanning to raise lot accuracy without manual reports
- Optimisation-based dispatch (constraint solver) with technician certifications and customer wait-time promises
- Real WhatsApp Business API messages and two-way customer replies
- Price elasticity insights for managers (advisory only), demand forecasting by segment
- EV charging-point scheduling integrated with the green score
- Group-level command center across all stores with drill-down

---

LotFlow AI is a hackathon prototype with simulated enterprise integrations (inventory system, parts warehouses and customer messaging). Every workflow in the app runs for real against the database.
