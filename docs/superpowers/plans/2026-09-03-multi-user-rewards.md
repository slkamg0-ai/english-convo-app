# Multi-User Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert LAKE English conversation practice into an invite-only, multi-user app with server-held Gemini access, per-user cloud progress, and manual reward claims.

**Architecture:** Keep the existing vanilla HTML/CSS/JavaScript app and Node test stack. Add Supabase Auth/Postgres as the cloud source of truth, Cloudflare Pages/Worker deployment files, and a local mockable API layer so the app still develops and tests without paid services. The owner Gemini key lives only in server/Worker environment secrets; the browser sees only session state and AI availability.

**Tech Stack:** Plain HTML/CSS/JavaScript, Node `node:test`, Cloudflare Pages/Worker, Supabase Auth/Postgres, Gemini API Free Tier.

---

## File Structure

- Modify `DESIGN.md`: replace the old navy/white-card contract with the `index-redesigned.html` blueprint design system.
- Modify `index.html`: remove user API-key setup UI, add account/signup/login, AI status, rewards, and admin surfaces.
- Modify `style.css`: implement blueprint tokens, mobile frame, sticky top bar, sticky bottom tabs, reward/admin layouts.
- Modify `app.js`: wire auth, tab rendering, progress sync, reward claim UI, admin actions, and local migration prompts.
- Create `progress-domain.mjs`: pure XP, streak, migration, and reward eligibility helpers for tests, server, Worker, and browser adapters.
- Modify `progress.js`: keep classic browser script compatibility, delegate shared rules to equivalent browser-safe helpers or values from `progress-domain.mjs` during module-aware refactor, support cloud summaries, preserve local import source.
- Modify `ai-roleplay-core.js` and `ai-roleplay-connection.js`: remove user-key assumptions and route AI calls through authenticated server APIs.
- Modify `server.mjs`: remove `/api/settings`, load owner key from environment, add mockable auth/progress/rewards/admin API handlers for local tests.
- Modify `gemini-service.mjs`: keep Gemini request/validation helpers, expose error mapping needed by Worker/server APIs.
- Create `supabase/migrations/0001_multi_user_rewards.sql`: schema, indexes, RLS policies, RPCs, seed rewards.
- Create `worker/src/index.js`: Cloudflare Worker API entrypoint for auth-checked Gemini, progress, rewards, admin, and invite actions.
- Create `worker/wrangler.toml.example`: documented Worker bindings and secret names without real secrets.
- Modify `package.json`: add scripts for test groups, local server, and Worker syntax checks if dependencies are introduced.
- Modify `tests/server.test.mjs`: replace settings tests with central-key, quota, and authenticated API tests.
- Create `tests/progress-sync.test.mjs`: XP idempotency, summary calculation, migration payload, reward eligibility through `progress-domain.mjs`.
- Create `tests/worker-api.test.mjs`: Worker handler tests using mocked Supabase and mocked Gemini fetch.
- Modify `README.md`: explain free deployment setup, Supabase/Cloudflare configuration, owner Gemini secret, invite flow, and manual rewards.

---

### Task 1: Lock the Redesigned Visual Contract

**Files:**
- Modify: `DESIGN.md`
- Reference: `index-redesigned.html`

- [ ] **Step 1: Replace the current design contract**

Write `DESIGN.md` around the concrete reference:

```markdown
# LAKE 영어회화연습 Design System

## 1. Atmosphere & Identity
LAKE is a compact mobile-first learning app with a blueprint/workbook feel based on `index-redesigned.html`: light neutral canvas, thin steel-blue construction lines, square framed cards, and quiet Korean learning copy.

## 2. Color
Use --color-bg #f2f2f3, --color-surface #e9e9ea, --color-text #1d1f20, --color-accent #5980a6, --color-accent-700 #416180, --color-neutral-300 #d4d4d7, --color-neutral-600 #7a7a7d, --color-danger #c34331, --color-success #1a8a5f.

## 3. Typography
Use Barlow for body and Barlow Condensed for headings when available. Fallback to system-ui. Keep headings condensed and firm; body remains readable at 14-16px.

## 4. Layout
Center a phone-sized app frame on desktop. Use sticky top title bar and sticky bottom tab bar. Content is a vertical stack with 13.6-20.4px gaps.

## 5. Components
Define blueprint cards, buttons, inputs, tags, progress bars, stat grids, bottom tabs, toast, auth panel, reward card, and admin table with default, hover, active, focus, disabled, loading, empty, and error states.

## 6. Motion & Interaction
Use short transform/opacity transitions only. Respect prefers-reduced-motion. Do not auto-start microphone.

## 7. Depth & Surface
Use hairline borders and corner registration marks. Avoid navy header, white rounded cards, heavy shadows, and pill-heavy UI.
```

- [ ] **Step 2: Verify design contract references the supplied file**

Run: `rg -n "index-redesigned.html|#f2f2f3|#5980a6|blueprint|bottom tab" DESIGN.md`

Expected: matching lines for the reference file, palette, blueprint components, and bottom tabs.

- [ ] **Step 3: Commit**

Run:

```bash
git add DESIGN.md
git commit -m "docs: adopt redesigned app design system"
```

---

### Task 2: Extract Testable Progress and Reward Domain Logic

**Files:**
- Create: `progress-domain.mjs`
- Modify: `progress.js`
- Create: `tests/progress-sync.test.mjs`

- [ ] **Step 1: Write failing domain tests**

Cover these cases in `tests/progress-sync.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyProgress, applyActivity, summarizeProgress, rewardEligibility, buildMigrationPayload } from '../progress-domain.mjs';

test('activity ids are idempotent and update XP counters once', () => {
  let progress = createEmptyProgress();
  progress = applyActivity(progress, { clientEventId: 'curriculum:1:0', kind: 'curriculum', xpDelta: 10, occurredAt: '2026-09-03T00:00:00.000Z' }).progress;
  const duplicate = applyActivity(progress, { clientEventId: 'curriculum:1:0', kind: 'curriculum', xpDelta: 10, occurredAt: '2026-09-03T00:00:00.000Z' });
  assert.equal(duplicate.awarded, false);
  assert.equal(summarizeProgress(duplicate.progress).xp, 10);
});

test('reward milestones are claimable once cumulative XP is high enough', () => {
  const summary = { xp: 1000 };
  const rules = [{ id: 'coffee', requiredXp: 1000, active: true }];
  assert.equal(rewardEligibility(summary, rules, []).find(r => r.id === 'coffee').eligible, true);
  assert.equal(rewardEligibility(summary, rules, [{ rewardRuleId: 'coffee' }]).find(r => r.id === 'coffee').eligible, false);
});
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests/progress-sync.test.mjs`

Expected: FAIL because `progress-domain.mjs` and the exported pure helpers do not exist yet.

- [ ] **Step 3: Implement pure helpers in a separate module**

Create `progress-domain.mjs` and export:

- `createEmptyProgress()`
- `applyActivity(progress, activity)`
- `summarizeProgress(progress)`
- `rewardEligibility(summary, rewardRules, claims)`
- `buildMigrationPayload(localProgress)`

Do not add `export` syntax to `progress.js` while it is still loaded as a classic browser script.

- [ ] **Step 4: Keep browser progress compatible**

Update `progress.js` so `recordActivity`, `getProgressSummary`, and `isStreakActiveToday` still work in the current browser path. If the implementation later converts the app to module scripts, perform that conversion in the same task and update `index.html` script tags explicitly.

- [ ] **Step 5: Run progress tests and existing tests**

Run: `node --test tests/progress-sync.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add progress-domain.mjs progress.js tests/progress-sync.test.mjs
git commit -m "test: cover cloud progress rules"
```

---

### Task 3: Add Supabase Schema and RLS

**Files:**
- Create: `supabase/migrations/0001_multi_user_rewards.sql`

- [ ] **Step 1: Write the migration**

Create tables from the spec: `profiles`, `invites`, `activity_events`, `progress_summaries`, `reward_rules`, `reward_claims`, and `ai_usage_daily`.

Include:

- primary keys and foreign keys to `auth.users(id)`.
- unique constraints on `(user_id, client_event_id)`, `(user_id, reward_rule_id)`, and `(user_id, usage_date)`.
- indexes on reward status, activity user/date, and invite hash.
- RLS enabled on every app table.
- policies for user-owned reads.
- admin policies based on `profiles.role = 'admin'`.
- seed rows for 500, 1000, and 2000 XP reward rules.

- [ ] **Step 2: Add RPCs for controlled writes**

In the same migration, add SQL functions:

- `record_activity(client_event_id text, kind text, source_id text, xp_delta integer, occurred_at timestamptz, metadata jsonb)` returns the updated summary and does nothing on duplicate event IDs.
- `claim_reward(rule_id uuid)` validates active rule, cumulative XP, and one-time claim.

- [ ] **Step 3: Validate migration text**

Run: `rg -n "enable row level security|create policy|record_activity|claim_reward" supabase/migrations/0001_multi_user_rewards.sql`

Expected: RLS, policies, and both functions are present.

- [ ] **Step 4: Commit**

Run:

```bash
git add supabase/migrations/0001_multi_user_rewards.sql
git commit -m "feat: add Supabase progress rewards schema"
```

---

### Task 4: Replace Local API-Key Settings with Central Server Key

**Files:**
- Modify: `server.mjs`
- Modify: `tests/server.test.mjs`
- Modify: `gemini-service.mjs` if shared errors need small exports

- [ ] **Step 1: Rewrite failing server tests**

Update `tests/server.test.mjs`:

- `/api/settings` returns 404 or 410.
- `/api/status` reports AI availability from `process.env.GEMINI_API_KEY` or injected config.
- `/api/roleplay` never accepts an API key from the browser.
- Gemini fetch uses the server-held key.
- quota failure latches limited mode without exposing upstream secrets.

- [ ] **Step 2: Run failing server tests**

Run: `node --test tests/server.test.mjs`

Expected: FAIL because `/api/settings` still exists and the key is browser configured.

- [ ] **Step 3: Implement central key behavior**

Change `createApp()` to accept `{ geminiApiKey = process.env.GEMINI_API_KEY }`. Remove `replaceSettings`, `/api/settings` POST, and `/api/settings` DELETE. Keep local development simple: if no key exists, `/api/status` returns `{ ai: 'limited' }` and `/api/roleplay` returns a quota/configured error that the client can turn into static fallback.

- [ ] **Step 4: Run server and roleplay tests**

Run: `node --test tests/server.test.mjs tests/ai-roleplay.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add server.mjs gemini-service.mjs tests/server.test.mjs
git commit -m "feat: use server-held Gemini key"
```

---

### Task 5: Add Worker API Surface

**Files:**
- Create: `worker/src/index.js`
- Create: `worker/wrangler.toml.example`
- Create: `tests/worker-api.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write Worker API tests with mocks**

Create tests for:

- unauthenticated progress/reward/admin calls return 401.
- `/api/auth/signup` validates invite code, creates an account through Supabase Auth Admin or a controlled signup flow, increments invite `uses`, and rejects expired or fully used invites.
- `/api/admin/invites` creates a hashed invite code record for admin users and returns the plain code only once.
- authenticated `/api/progress` calls invoke mocked Supabase RPC `record_activity`.
- `/api/rewards/claim` invokes mocked Supabase RPC `claim_reward`.
- `/api/admin/claims` rejects non-admin profiles.
- `/api/roleplay` checks daily usage before calling mocked Gemini.
- Gemini 429 returns limited-mode response without leaking upstream text.

- [ ] **Step 2: Run failing Worker tests**

Run: `node --test tests/worker-api.test.mjs`

Expected: FAIL because the Worker module does not exist.

- [ ] **Step 3: Implement Worker handler**

Export `fetch(request, env)` from `worker/src/index.js`. Keep dependencies minimal. Use plain fetch to Supabase REST/RPC endpoints so tests can mock network calls. Required env names:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `AI_DAILY_USER_LIMIT`
- `AI_DAILY_GLOBAL_LIMIT`

- [ ] **Step 4: Implement invite endpoints**

Add:

- `POST /api/auth/signup`: body `{ email, password, displayName, inviteCode }`; hashes the invite code, verifies active capacity, creates the auth user, creates `profiles`, increments invite use count, and returns a session-compatible response or clear Korean error.
- `POST /api/admin/invites`: admin-only; creates a random invite code, stores only `code_hash`, `max_uses`, `expires_at`, and returns the plain code once.
- `GET /api/admin/invites`: admin-only; lists invite metadata without plain codes.

- [ ] **Step 5: Add Worker example config**

Create `worker/wrangler.toml.example` with placeholders only. Document secrets using comments, not real values.

- [ ] **Step 6: Run Worker and full tests**

Run: `node --test tests/worker-api.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add worker/src/index.js worker/wrangler.toml.example tests/worker-api.test.mjs package.json
git commit -m "feat: add cloud worker api"
```

---

### Task 6: Add Auth, Cloud Progress, Rewards, and Admin Client Modules

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `progress.js`
- Create: `cloud-client.js`
- Create: `auth-ui.js`
- Create: `rewards-ui.js`
- Create: `admin-ui.js`
- Modify: `server.mjs` static allowlist

- [ ] **Step 1: Add module files to the local static allowlist**

Add `cloud-client.js`, `auth-ui.js`, `rewards-ui.js`, and `admin-ui.js` to `FILES` in `server.mjs`.

- [ ] **Step 2: Add local mock/proxy API support**

For `npm start` QA, choose one of these two executable paths and document the choice in `README.md`:

- preferred for local-only QA: add mockable `server.mjs` endpoints for `/api/session`, `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/progress`, `/api/rewards`, `/api/rewards/claim`, `/api/admin/invites`, and `/api/admin/claims`; keep data in memory during local runs and protect admin routes with a deterministic test admin session.
- preferred for Worker parity: run the Worker locally with Wrangler and proxy `/api/*` from `server.mjs` to the Worker dev URL.

The chosen path must let Task 10 browser QA run from `http://127.0.0.1:4173/` without real Supabase credentials.

- [ ] **Step 3: Implement `cloud-client.js`**

Provide fetch helpers:

- `getSessionState()`
- `signupWithInvite({ email, password, displayName, inviteCode })`
- `login({ email, password })`
- `logout()`
- `createInvite({ maxUses, expiresAt })`
- `fetchInvites()`
- `fetchProgress()`
- `recordCloudActivity(activity)`
- `fetchRewards()`
- `claimReward(ruleId)`
- `fetchAdminClaims()`
- `updateAdminClaim(id, status, adminNote)`

Use `credentials: 'include'` only if the chosen auth implementation uses cookies; otherwise attach the Supabase access token in `Authorization`.

- [ ] **Step 4: Implement auth UI**

Add a compact account panel:

- signed out: email, password, invite code, display name, signup, login.
- signed in: display name/email, AI status, logout.
- errors: concise Korean messages.

- [ ] **Step 5: Implement rewards UI**

Render total XP, next reward, eligible reward cards, claim status, and limited-mode sync state.

- [ ] **Step 6: Implement admin UI**

Show admin-only claim table with status filter and action controls for `approved`, `delivered`, and `rejected`.

- [ ] **Step 7: Wire app activity recording**

Route curriculum, roleplay, and flashcard completions through cloud progress when signed in. Keep local progress fallback when signed out.

- [ ] **Step 8: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add index.html app.js progress.js cloud-client.js auth-ui.js rewards-ui.js admin-ui.js server.mjs
git commit -m "feat: add account rewards admin UI"
```

---

### Task 7: Apply the `index-redesigned.html` Layout and Styling

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js` if tab labels or structure need small hooks

- [ ] **Step 1: Replace layout shell**

Adapt the current page into:

- centered app frame on desktop.
- sticky top LAKE title/account bar.
- scrollable content region.
- sticky bottom tab bar with Home, Course, Roleplay, Cards, Rewards/Admin.

- [ ] **Step 2: Replace visual tokens**

Use the `DESIGN.md` token names and values. Remove old navy header and white rounded-card dominance.

- [ ] **Step 3: Add blueprint primitives**

Implement reusable classes:

- `.blueprint`
- `.corner`
- `.card`
- `.btn`
- `.btn-primary`
- `.btn-secondary`
- `.input`
- `.tag`
- `.progress-track`
- `.bottom-tabs`
- `.admin-table`

- [ ] **Step 4: Remove emoji-as-icon UI**

Replace visible emoji icons in navigation, badges, status, and buttons with inline SVG or text-only labels. Keep Korean status text clear.

- [ ] **Step 5: Run browser smoke locally**

Run: `npm start`

Expected: server prints `English conversation: http://127.0.0.1:4173`.

Open `http://127.0.0.1:4173/` in the in-app browser or Playwright and verify:

- top bar sticks.
- bottom tabs switch screens.
- no API key setup card is visible.
- rewards/progress screen uses blueprint cards.
- desktop view centers the app frame.

- [ ] **Step 6: Run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add index.html style.css app.js
git commit -m "feat: apply redesigned mobile layout"
```

---

### Task 8: Add Local Progress Migration

**Files:**
- Modify: `app.js`
- Modify: `progress.js`
- Modify: `progress-domain.mjs`
- Modify: `cloud-client.js`
- Modify: `tests/progress-sync.test.mjs`

- [ ] **Step 1: Add migration tests**

Test that `buildMigrationPayload()` maps old local XP, activity IDs, streak, counts, and badge IDs into one import payload without secrets.

- [ ] **Step 2: Implement one-time import flow**

After login, if local `englishConvoApp.progress` exists and profile has no `local_progress_imported_at`, show an import card with:

- "기존 이 브라우저의 학습 기록을 내 계정으로 가져오기"
- import button.
- skip button.

- [ ] **Step 3: Add server/Worker migration endpoint if needed**

Support one controlled endpoint or RPC that imports summary once and sets `local_progress_imported_at`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/progress-sync.test.mjs tests/worker-api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add app.js progress.js cloud-client.js tests/progress-sync.test.mjs tests/worker-api.test.mjs worker/src/index.js supabase/migrations/0001_multi_user_rewards.sql
git commit -m "feat: import local progress on login"
```

---

### Task 9: Documentation and Free Deployment Guide

**Files:**
- Modify: `README.md`
- Create: `.env.example`

- [ ] **Step 1: Write owner setup docs**

Document:

- create Supabase free project.
- run migration.
- create first admin account.
- create invite codes.
- create Cloudflare Pages/Worker project.
- set Worker secrets for Supabase and Gemini.
- set daily AI limits.
- do not attach payment methods if staying free-only.
- manual reward fulfillment flow.

- [ ] **Step 2: Add `.env.example`**

Include only placeholder names:

```dotenv
GEMINI_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AI_DAILY_USER_LIMIT=20
AI_DAILY_GLOBAL_LIMIT=150
```

- [ ] **Step 3: Run docs sanity checks**

Run: `rg -n "GEMINI_API_KEY|Supabase|Cloudflare|invite|reward|free" README.md .env.example worker/wrangler.toml.example`

Expected: setup steps and placeholders are present, with no real secrets.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md .env.example
git commit -m "docs: add free cloud setup guide"
```

---

### Task 10: Full Verification and Visual QA

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run full automated tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Search for removed API-key UI**

Run: `rg -n "freeTierConfirmed|apiKey|API 키를 연결|/api/settings" index.html app.js style.css ai-roleplay*.js server.mjs tests`

Expected: no user-facing API-key setup flow remains. `rg` exit code 1 is acceptable when there are no matches. Internal `GEMINI_API_KEY` references are allowed only in server, Worker, docs, and env examples.

- [ ] **Step 3: Search for real secrets**

Run: `rg -n "AIza[0-9A-Za-z_-]{20,}|SUPABASE_SERVICE_ROLE_KEY=.+" . -g "!.git/**"`

Expected: no real key material appears.

- [ ] **Step 4: Run local browser QA**

Start the app: `npm start`

Verify at 375px, 768px, and 1280px:

- app frame is centered and readable.
- bottom tabs work.
- account login/signup panel fits.
- no text overlaps in Korean or English.
- roleplay starts in limited/static mode when no server key is configured.
- rewards screen shows XP, next milestone, claim buttons, and claim statuses.
- admin table appears only for admin state.
- admin can create an invite and the returned plain code is shown once.
- signup rejects a missing, expired, or exhausted invite code.
- microphone and TTS controls still work or fail with friendly browser messages.

- [ ] **Step 5: Run production-like static check**

Open the app through the local server with cache disabled. Confirm all scripts listed in `server.mjs` load with 200 responses and CSP does not block app scripts.

- [ ] **Step 6: Final commit if QA fixes were needed**

If QA required edits, commit them:

```bash
git add index.html style.css app.js progress.js cloud-client.js auth-ui.js rewards-ui.js admin-ui.js server.mjs worker/src/index.js tests
git commit -m "fix: polish multi-user rewards QA"
```

---

## Execution Notes

- Do not commit real API keys, Supabase service role keys, invite codes, cookies, or tokens.
- Keep rewards manually fulfilled. Do not integrate Kakao, Starbucks, gift-card vendors, payments, or automated purchasing.
- Keep the free-operation guardrails visible in README and enforced in API limits.
- Do not rewrite the app into React or a larger framework unless a task proves the vanilla structure cannot support the feature.
- Preserve current learning content unless a task specifically needs markup changes to display it in the redesigned shell.
- Use `index-redesigned.html` as the visual reference, but do not copy its bundler runtime into the production app.
