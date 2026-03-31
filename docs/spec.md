# WanderVibe — Product Specification

## Overview

WanderVibe is a collaborative trip planning app for friends and family. It provides a web app for desktop planning and a native mobile app for on-the-go use during trips, sharing a single codebase foundation through a monorepo architecture.

**Target users:** ~10 friends and family members (whitelist-controlled access).

**Repository:** https://github.com/marcgs/WanderVibe

---

## Architecture

### Monorepo Structure

```
wandervibe/
├── apps/
│   ├── web/                → Next.js (App Router) on Vercel
│   └── mobile/             → React Native + Expo
├── packages/
│   ├── shared/             → Business logic, types, validation
│   ├── db/                 → Drizzle ORM, typed queries, schema
│   └── ui/                 → Shared design tokens (colors, spacing, typography)
├── .github/
│   └── workflows/          → GitHub Actions CI/CD
├── docs/
│   └── spec.md
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### Tech Stack

| Layer              | Choice                                      |
|--------------------|---------------------------------------------|
| Monorepo           | pnpm workspaces + Turborepo                 |
| Web app            | Next.js (App Router) + TypeScript            |
| Mobile app         | React Native + Expo                         |
| Database           | Azure PostgreSQL Flexible Server + PostGIS  |
| ORM                | Drizzle                                     |
| Auth               | Google Sign-In (Auth.js on web, expo-auth-session on mobile) |
| Maps (web)         | Mapbox GL JS                                |
| Maps (mobile)      | react-native-maps + Mapbox                  |
| Place search       | Google Places API                           |
| File storage       | Azure Blob Storage                          |
| Styling (web)      | Tailwind CSS + shadcn/ui                    |
| Styling (mobile)   | Nativewind                                  |
| State (web)        | Zustand + TanStack Query                    |
| State (mobile)     | Zustand + TanStack Query                    |
| Hosting (web)      | Vercel                                      |
| Hosting (mobile)   | Expo EAS (TestFlight + APK)                 |
| Real-time (v1)     | Polling / pull-to-refresh                   |
| Real-time (v2)     | Azure Web PubSub                            |
| Push notifications (v2) | Azure Notification Hubs                |
| Email (v2)         | Azure Communication Services                |
| Secrets            | Azure Key Vault                             |
| Monitoring         | Azure Application Insights                  |
| CI/CD              | GitHub Actions                              |

### Why App Router

Next.js App Router (not Pages Router) for:
- Server Components for trip lists, place search — call Google Places API server-side without exposing keys.
- Server Actions for form mutations (create trip, add place).
- Layouts for persistent navigation and trip-scoped views.
- Streaming/Suspense for loading states on map-heavy pages.
- It's where Next.js is headed — Pages Router is maintenance mode.

### Cross-Cloud Networking

The web app runs on Vercel (AWS) while the database is on Azure. This cross-cloud setup requires:
- **Connection pooling:** Drizzle with `pg` driver using a connection pool (max 10 connections). Azure PostgreSQL Flexible Server includes built-in PgBouncer — enable it.
- **SSL required:** All connections over SSL. Azure PostgreSQL enforces this by default.
- **IP allowlisting:** Azure PostgreSQL firewall must allow Vercel's IP ranges (or use "Allow access to Azure services" + Vercel's static IP add-on for production).
- **Latency:** Cross-cloud adds ~20-50ms per query vs. same-cloud. Acceptable for 10 users. Mitigate with TanStack Query caching and optimistic updates on the client.
- **If latency becomes a problem:** Add a Vercel Edge Config or Redis cache layer. Unlikely to be needed at this scale.

---

## Authentication & Access Control

- **Google Sign-In** is the only auth method.
- A **whitelist** of approved Google email addresses controls access.
- Unauthenticated or non-whitelisted users see a "Request Access" screen.
- Whitelist is managed by the app admin (the app owner) via a simple admin page.
- JWT tokens issued on sign-in, validated by both web and mobile apps against the shared `@wandervibe/db` package.

### Invite Flow

1. **App admin pre-whitelists** all friends and family by email address. This is the gate — only whitelisted emails can sign in.
2. **Trip owner invites collaborators** to a specific trip by selecting from whitelisted users or entering an email.
   - If the email is whitelisted: an invite link is generated (URL with a unique, single-use token). The invitee clicks, signs in, and is added as a collaborator.
   - If the email is NOT whitelisted: the trip owner can request the admin whitelist them. The admin gets a notification (in-app or push) to approve/deny.
3. **Invite link format:** `https://wandervibe.app/invite/{token}` — token is a UUID, expires after 7 days, single-use.
4. **Roles on join:** Trip owner sets the role (editor or viewer) at invite time. Owner role is reserved for the trip creator.
5. **Leave/remove:** Collaborators can leave a trip. Trip owners can remove collaborators.

---

## Timezone Strategy

Travel apps cross timezones constantly. The strategy:

- **Database:** All `timestamptz` columns store UTC. Always.
- **Day entity:** Each day has a `timezone` field (IANA format, e.g., `Asia/Tokyo`). Auto-populated from the trip destination on creation, editable per day for multi-city trips.
- **Flight entity:** Stores `departure_timezone` and `arrival_timezone` separately. Departure time displays in departure timezone, arrival time in arrival timezone — this matches how airlines display times.
- **Hotel entity:** Uses the timezone of the day/location it belongs to.
- **Place entity:** Inherits timezone from its parent day.
- **Display rule:** All times shown to the user are in **local timezone** for that location. Never show UTC or the user's home timezone for trip items.
- **Edge case — multi-timezone days:** A day with places in two timezones (e.g., crossing a border) uses the day's primary timezone. Individual places can override if needed (future enhancement).

---

## Data Model

### Core Entities (v1)

```
User
├── id (uuid, PK)
├── email (unique, whitelisted)
├── name
├── avatar_url
├── is_admin (boolean, default false)
├── created_at
└── updated_at

Whitelist
├── id (uuid, PK)
├── email (unique)
├── added_by (FK → User)
├── created_at

Trip
├── id (uuid, PK)
├── name
├── description
├── destination (text)
├── destination_timezone (text, IANA — default timezone for auto-generated days)
├── cover_photo_url
├── start_date
├── end_date
├── base_currency (text, ISO 4217 — e.g., "USD")
├── created_by (FK → User)
├── created_at
└── updated_at

TripCollaborator
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── user_id (FK → User)
├── role (enum: owner, editor, viewer)
├── invited_at
└── joined_at

TripInvite
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── email (text)
├── token (uuid, unique)
├── role (enum: editor, viewer)
├── invited_by (FK → User)
├── expires_at (timestamptz)
├── accepted_at (timestamptz, nullable)
├── created_at

Day
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── date
├── timezone (text, IANA — e.g., "Asia/Tokyo")
├── position (int, for drag-to-reorder)
├── created_at
└── updated_at

Place
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── day_id (FK → Day, nullable — null means unassigned/wishlist)
├── name
├── address
├── location (PostGIS geography point)
├── google_place_id
├── category (enum: restaurant, attraction, shopping, transport, other)
├── notes
├── position (int, for ordering within a day — null if unassigned)
├── added_by (FK → User)
├── created_at
└── updated_at

Flight
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── airline
├── flight_number
├── departure_airport (IATA code)
├── arrival_airport (IATA code)
├── departure_time (timestamptz)
├── departure_timezone (text, IANA)
├── arrival_time (timestamptz)
├── arrival_timezone (text, IANA)
├── confirmation_code
├── raw_paste (text, original pasted text)
├── added_by (FK → User)
├── created_at
└── updated_at

Hotel
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── name
├── address
├── location (PostGIS geography point)
├── check_in (timestamptz)
├── check_out (timestamptz)
├── timezone (text, IANA)
├── confirmation_code
├── raw_paste (text, original pasted text)
├── added_by (FK → User)
├── created_at
└── updated_at
```

**Key data model decisions:**
- **Places have nullable `day_id`:** Unassigned places (`day_id = null`) form a trip-level wishlist. Users can browse and drag them onto a day when ready.
- **Flights belong to trips, not days:** A flight's departure/arrival times determine which days it appears on. A red-eye that departs Day 1 and arrives Day 2 renders on both days automatically.
- **Hotels belong to trips, not days:** A hotel spanning Day 1–5 renders on each day between check-in and check-out. The itinerary view queries hotels by date range overlap.

### v2+ Entities (defined now, implemented later)

```
Comment
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── day_id (FK → Day, nullable)
├── place_id (FK → Place, nullable)
├── user_id (FK → User)
├── body (text)
├── created_at
└── updated_at

ActivityLog
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── user_id (FK → User)
├── action (enum: added_place, edited_place, removed_place, added_flight, added_hotel, invited_user, etc.)
├── entity_type (text)
├── entity_id (uuid)
├── metadata (jsonb)
├── created_at

Expense
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── paid_by (FK → User)
├── description
├── amount (decimal)
├── currency (text, ISO 4217)
├── exchange_rate (decimal — rate to trip's base_currency at time of entry)
├── base_amount (decimal — amount converted to base_currency)
├── category (enum: food, transport, accommodation, activity, other)
├── split_type (enum: equal, custom)
├── created_at
└── updated_at

ExpenseSplit
├── id (uuid, PK)
├── expense_id (FK → Expense)
├── user_id (FK → User)
├── amount (decimal — in base_currency)

ChecklistItem
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── user_id (FK → User, nullable — null means shared, non-null means personal)
├── label (text)
├── checked (boolean)
├── position (int)
├── created_at
└── updated_at

Photo
├── id (uuid, PK)
├── trip_id (FK → Trip)
├── place_id (FK → Place, nullable)
├── day_id (FK → Day, nullable)
├── uploaded_by (FK → User)
├── blob_url (text)
├── caption (text)
├── taken_at (timestamptz)
├── created_at
└── updated_at
```

### Multi-Currency Strategy (v3)

- Each **trip** has a `base_currency` (e.g., USD) set at creation.
- Each **expense** is logged in its local currency (e.g., JPY at a Tokyo restaurant).
- On save, the app fetches the current exchange rate from a free API (Open Exchange Rates free tier or exchangerate.host) and stores:
  - `exchange_rate`: the rate from local currency → base currency at time of entry.
  - `base_amount`: `amount × exchange_rate` — the converted value.
- **All settlement math uses `base_amount`**, so "Marc owes Sarah $23.50" is always in the trip's base currency.
- Exchange rates are **snapshot at entry time** — no retroactive recalculation. Simple, predictable, good enough for friends splitting bills.

---

## Features by Release

**Both web and mobile apps are developed in parallel from v1.** Agent teams (Web Agent and Mobile Agent) work simultaneously on each feature, sharing types and logic from `@wandervibe/shared`.

### v1 — Core Trip Planning

The minimum viable product: a trip planner you can use on your next trip.

**Trip CRUD**
- Create a trip with name, destination, dates, base currency, and optional cover photo.
- Edit trip details. Delete a trip (owner only).
- Trip list view (upcoming, past, all).

**Day-by-Day Itinerary**
- Auto-generate days from trip start/end dates (with timezone from destination).
- Drag-to-reorder days.
- Add/remove days manually.
- Flights and hotels render on relevant days based on their date ranges.

**Places**
- Search and add places via Google Places API (name, address, category, location).
- Assign places to a day with a position (ordered list).
- **Wishlist:** Add places without assigning a day — browse and drag onto a day later.
- Drag-to-reorder places within a day.
- Edit/delete places.

**Flights & Hotels**
- Paste confirmation email or booking text → AI extracts flight/hotel details (airline, flight number, times, airports, hotel name, address, check-in/out, confirmation code).
- Manual editing of parsed fields.
- Raw paste stored for reference.
- Flights render on departure and arrival days. Hotels render on all days between check-in and check-out.

**Map View**
- Map showing all pinned places for a trip.
- Filter by day (show only that day's places).
- Tap a pin to see place details.
- Mapbox GL JS on web, react-native-maps on mobile.

**Place Search**
- Google Places Autocomplete for searching.
- Show place details (rating, hours, photos, address) from Google Places API.
- One-tap add to a day or wishlist.

**Collaboration**
- Invite friends via invite link (only whitelisted emails can join).
- Trip collaborator roles: owner, editor, viewer.
- Multiple editors can add/edit places (conflict resolution via last-write-wins for v1).

**Auth**
- Google Sign-In only.
- Whitelist check on sign-in.
- "Request Access" screen for non-whitelisted users.
- Admin page for managing the whitelist.

**PWA (web)**
- Web app is installable as a PWA (manifest + service worker via next-pwa).
- Useful for mobile users before the native app is polished.

### v2 — Collaboration & Detail

**Notes & Comments**
- Add notes to any place, day, or trip.
- Threaded comments on places and days.
- @mention collaborators in comments.

**Activity Log**
- "Marc added Sushi Dai to Day 3" — visible feed per trip.
- Track all additions, edits, and deletions with user attribution.

**Directions & Routing**
- Show walking/driving/transit directions between consecutive places in a day.
- Estimated travel time between places.
- Mapbox Directions API.

**Flight & Hotel Reference**
- Link to booking confirmation (URL).
- Attach PDF/screenshot of confirmation (stored in Azure Blob Storage).

**Real-time Sync**
- Live updates when a collaborator makes changes.
- Powered by Azure Web PubSub (WebSocket-based).
- Presence indicators (who's currently viewing/editing).

**Push Notifications**
- "Sarah added 3 restaurants to the Tokyo trip" — via Azure Notification Hubs (APNs + FCM).
- Trip invite notifications, comment mentions, expense reminders.
- Configurable per user (mute per trip, mute all).

**Email Notifications**
- Invite emails sent via Azure Communication Services.
- Expense settlement summaries.
- Optional weekly trip digest for upcoming trips.

### v3 — Money & Logistics

**Expense Tracking**
- Log expenses per trip (amount, local currency, category, who paid).
- Auto-convert to trip's base currency using exchange rate at time of entry.
- Expense list view with totals by category.

**Expense Splitting**
- Equal split among all or selected collaborators.
- Custom split amounts.
- Running balance: "Marc owes Sarah $23.50" (in base currency).
- Settlement summary at trip end.

**Packing Lists / Checklists**
- Shared and personal checklists per trip.
- Check/uncheck items.
- Drag-to-reorder.

### v4 — Media & Discovery

**Photo Uploads**
- Upload photos to a trip, day, or place.
- Stored in Azure Blob Storage.
- Gallery view per trip.
- Photo timeline (chronological view of trip photos).

**Trip Journal / Timeline**
- Auto-generated timeline combining itinerary, photos, and notes.
- Shareable read-only view (public link for a trip journal).

**Explore Nearby**
- "What's near my hotel?" — discover restaurants, attractions within a radius.
- Powered by Google Places API nearby search + PostGIS distance queries.
- One-tap add to itinerary or wishlist.

### v5 — AI Features

**Itinerary Suggestions**
- "Suggest a 3-day itinerary for Tokyo" → AI generates a day-by-day plan.
- Based on destination, trip duration, and stated preferences.
- User can accept, modify, or discard suggestions.
- Suggested places are real (validated against Google Places API).

**Smart Scheduling**
- Auto-arrange places to minimize travel time within a day.
- Suggest grouping nearby places on the same day.
- "You have 2 places in Shibuya on Day 1 and 1 on Day 4 — move it to Day 1?"

---

## Paste & Parse — Flight/Hotel Extraction

Users paste raw text (confirmation emails, booking screenshots copied as text) and AI extracts structured data.

**Flight extraction fields:**
- Airline, flight number
- Departure/arrival airport (IATA codes)
- Departure/arrival date and time (with timezone)
- Confirmation/booking code

**Hotel extraction fields:**
- Hotel name
- Address
- Check-in / check-out dates and times (with timezone)
- Confirmation/booking code

**Implementation:**
- Claude API for text extraction (structured output with tool_use).
- Raw paste stored in `raw_paste` field for reference and re-parsing.
- User reviews and confirms parsed fields before saving.
- Fallback: manual entry form if parsing fails.

---

## Shared Packages

### @wandervibe/shared
- TypeScript types for all entities (Trip, Day, Place, Flight, Hotel, etc.)
- Validation schemas (zod) for all forms and API inputs.
- Business logic: date calculations, itinerary conflict detection, timezone display helpers, expense splitting math.
- Constants: categories, roles, currencies, IANA timezone list.

### @wandervibe/db
- Drizzle ORM schema definitions (source of truth for DB structure).
- Typed query helpers (CRUD operations for all entities).
- Migration files.
- PostGIS query utilities (nearby search, distance calculations, bounding box queries).
- Connection configuration for Azure PostgreSQL (SSL, pooling).

### @wandervibe/ui
- Shared design tokens: color palette, spacing scale, typography scale, border radii.
- Exported as CSS variables (web) and JS constants (mobile).
- Not shared components — web uses shadcn/ui, mobile uses native components.

---

## Infrastructure

### Azure

| Service | Version | Purpose |
|---------|---------|---------|
| Azure PostgreSQL Flexible Server | v1 | Primary database with PostGIS. PgBouncer enabled for connection pooling. |
| Azure Blob Storage | v1 | Photos, file attachments. |
| Azure Key Vault | v1 | All secrets (Google Places API key, Mapbox API key, Claude API key, database connection string, Auth.js secret). Accessed via Azure SDK at runtime, never stored in code or environment variables directly. |
| Azure Application Insights | v1 | Error tracking, performance monitoring, and logging. Server-side via Next.js instrumentation, client-side via Application Insights JS SDK (web) and React Native plugin (mobile). |
| Azure Web PubSub | v2 | Real-time collaboration — live updates when collaborators make changes, presence indicators. |
| Azure Notification Hubs | v2 | Push notifications to iOS (APNs) and Android (FCM). Trip invites, activity alerts, expense reminders. |
| Azure Communication Services | v2 | Transactional email — invite emails, expense settlement summaries, trip share links. |
| Azure Cache for Redis | If needed | Server-side caching for Google Places API responses and exchange rates. Only add if API costs or latency become a problem. |

- Deployment region: (TBD — choose based on user location).

### Vercel
- **Web app hosting** — Next.js with automatic preview deployments per PR.
- **Server functions** — API routes for Google Places proxy, paste-and-parse endpoint, auth callbacks.
- **Environment variables** — references to Azure Key Vault (vault URI + managed identity or service principal credentials for access).

### Expo EAS
- **Build service** — iOS and Android builds.
- **EAS Update** — over-the-air updates for non-native changes.
- **Distribution** — TestFlight (iOS), APK sideload or internal track (Android).

---

## Testing Strategy

### Frameworks

| Type | Tool | Scope |
|------|------|-------|
| Unit tests | Vitest | `@wandervibe/shared` business logic, `@wandervibe/db` query builders, utility functions |
| Component tests (web) | Vitest + React Testing Library | Individual shadcn/ui components, form behavior, state management |
| Component tests (mobile) | Vitest + React Native Testing Library | Individual screens and components |
| Integration tests | Vitest + testcontainers (Postgres) | Database queries, migrations, PostGIS operations against a real Postgres instance |
| E2E tests (web) | Playwright | Full user flows: sign in → create trip → add places → invite friend |
| E2E tests (mobile) | Maestro | Full user flows on iOS/Android simulators |
| API tests | Vitest | Next.js API routes (paste-and-parse, Google Places proxy, auth) |

### Testing Principles
- **Shared logic has the highest test coverage** — it's used by both apps. Bugs here multiply.
- **Integration tests hit a real Postgres** (via testcontainers) — not mocks. Especially critical for PostGIS queries.
- **E2E tests cover critical paths only** — not every button, just the flows that would break the app if they failed.
- **Component tests focus on behavior**, not implementation — test what the user sees and does.

---

## CI/CD Pipeline (GitHub Actions)

### Repository

https://github.com/marcgs/WanderVibe

### Workflows

**On every PR:**
```
┌──────────────────────────────────┐
│           Lint + Types           │
│  pnpm lint && tsc --noEmit      │
└──────────────┬───────────────────┘
               │
┌──────────────┴───────────────────┐
│          Unit + Integration      │
│  vitest run (all packages)       │
│  testcontainers for DB tests     │
└──────────────┬───────────────────┘
               │
       ┌───────┴────────┐
       ▼                 ▼
┌────────────┐   ┌─────────────┐
│ Build Web  │   │ Build Mobile│
│ next build │   │ expo export │
└─────┬──────┘   └──────┬──────┘
      │                  │
      ▼                  ▼
┌────────────┐   ┌─────────────┐
│ E2E Web    │   │ E2E Mobile  │  (on main branch merges only)
│ Playwright │   │ Maestro     │
└────────────┘   └─────────────┘
```

**On merge to main:**
- All of the above, plus:
- **Deploy web** to Vercel (automatic via Vercel GitHub integration).
- **Build mobile** via Expo EAS (triggered by GitHub Action).
- **Parity check** — agent-generated report comparing feature coverage across web and mobile.

**On PR (preview):**
- Vercel preview deployment (automatic).
- Expo preview build (EAS Update for review).

---

## Agent Team Architecture

Development follows an agent orchestra pattern with quality gates and compound learning.

### Agent Teams

| Agent | Responsibility | Inputs | Outputs |
|-------|---------------|--------|---------|
| **Schema Agent** | Database migrations, Drizzle schema changes | Feature requirements | Migration files, updated types in `@wandervibe/db` |
| **Shared Logic Agent** | Business logic, validation, types in `@wandervibe/shared` | Schema changes, feature requirements | Validated shared package updates |
| **Web Agent** | Next.js frontend features | Shared types + feature requirements | Web app pages, components, API routes |
| **Mobile Agent** | React Native features | Shared types + feature requirements | Mobile screens, components |
| **Quality Gate Agent** | Tests, linting, type checking, feature parity | PRs from any agent | Pass/fail with actionable feedback |
| **Parity Agent** | Ensures web and mobile have the same features | Both app codebases | Parity report, missing feature flags |

### Development Flow

```
Feature Request
      │
      ▼
┌─────────────┐
│ Schema Agent │ ── migrations + types
└──────┬──────┘
       ▼
┌──────────────┐
│ Shared Logic │ ── validation + business logic
│    Agent     │
└──────┬───────┘
       │
       ├────────────────┐
       ▼                ▼
┌────────────┐   ┌─────────────┐
│  Web Agent │   │Mobile Agent │  ← parallel
└─────┬──────┘   └──────┬──────┘
      │                  │
      ▼                  ▼
┌──────────────────────────────┐
│     Quality Gate Agent       │
│  (tests, lint, types, a11y)  │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│       Parity Agent           │
│  (feature coverage check)    │
└──────────────────────────────┘
```

### Quality Gates

Each PR must pass before merge:
- **Type safety:** `tsc --noEmit` across all packages.
- **Lint:** ESLint with shared config.
- **Tests:** Unit tests for shared logic, integration tests for DB queries, component tests for UI.
- **Build:** Both apps build successfully.
- **Parity check:** New features flagged if only implemented in one app.

### Compound Learning

Agents accumulate context across development cycles:
- Schema Agent learns the data model patterns used in this project.
- Web/Mobile Agents learn the component patterns and project conventions.
- Quality Gate Agent learns common failure patterns and checks proactively.
- Shared context via `CLAUDE.md` files at repo and package level documenting conventions, patterns, and decisions.

---

## Non-Functional Requirements

- **Offline support (v1):** Basic — cache last-viewed trip itinerary for read-only access via service worker (web) and TanStack Query persistence (mobile). Full offline editing deferred.
- **Performance:** First contentful paint < 2s on web. App launch < 1.5s on mobile.
- **Accessibility:** WCAG 2.1 AA for web. VoiceOver/TalkBack support for mobile.
- **Data privacy:** All data stored in Azure (region TBD). No third-party analytics. Google Places queries are proxied through Next.js API routes to protect API keys. Application Insights telemetry only — no user tracking.
- **Backup:** Azure PostgreSQL automated daily backups with 7-day retention.
- **Secrets:** All API keys and connection strings stored in Azure Key Vault. Never committed to the repository. Local development uses `.env.local` files (gitignored) populated from Key Vault via a setup script.
