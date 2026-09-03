# Multi-User Access, Central AI Key, and Rewards Design

## Goal

Make LAKE English conversation practice usable by the owner and about 10 invited acquaintances from their own devices and locations. Users should not enter API keys. The owner configures one Gemini API key on the server side, learning progress is saved per user, and users can claim simple milestone rewards such as coffee coupons after earning enough points.

The first version should stay free to operate except for manually purchased rewards. It must avoid paid infrastructure, avoid automatic coupon purchasing, and fail gracefully when free quotas are exhausted.

## Current State

The app is a static HTML/CSS/JavaScript application with a local Node server. Progress is stored in browser `localStorage` through `progress.js`, and Gemini roleplay calls currently depend on an API-key setup flow exposed in the browser. The current README describes local-only use.

This design changes the app from a personal local tool into a small invite-only cloud app while preserving the current learning screens and lightweight feel.

## Recommended Architecture

Use Cloudflare Pages for the static frontend, a Cloudflare Worker for private server APIs, Supabase Free for authentication and Postgres storage, and Gemini API Free Tier through one owner-managed key.

Cloudflare stores the owner Gemini API key as an environment secret. Supabase stores users, invite access, progress events, reward rules, reward claims, and usage counters. The browser receives only the Supabase public anon key and the app URL; it never receives the Gemini API key or a Supabase service-role key.

This keeps the app accessible from phones and PCs without exposing owner credentials. It also gives a practical free deployment path for around 10 users.

## Non-Goals

- No user API-key registration or free-tier confirmation screen.
- No automatic purchase or delivery of coffee coupons.
- No public self-signup.
- No paid billing, payment method attachment, or paid quota fallback.
- No large social features such as friend feeds, rankings, chat, or groups.
- No native mobile app.

## User Access Flow

The owner creates invite codes in an admin screen or a simple admin API. A friend opens the app URL, enters an invite code, creates an email/password account, and then uses the app from any device.

After login, the app loads that user's cloud progress. If the browser already has local progress from the old single-user version, the app offers a one-time migration into the logged-in account. Once imported, cloud data becomes the source of truth.

Users can log out and log in from another device. Their XP, streak, completed activity IDs, and reward claim history follow the account.

## AI Roleplay Flow

The roleplay screen calls the Cloudflare Worker endpoint instead of calling Gemini directly or sending an API key from the browser. The Worker verifies the user's Supabase session, checks AI usage limits, calls Gemini with the owner secret, and returns the roleplay response.

If Gemini free quota or the app's per-user limit is reached, the roleplay screen switches to a static practice fallback and shows a short Korean message that AI practice is temporarily limited. The rest of the app continues working.

## API Key Setup Removal

Remove the current browser API-key registration process from the product flow. This includes the visible API key input, user-side key status setup, free-tier confirmation step, and any local storage of a user-provided Gemini key.

Replace it with a signed-in state indicator and a simple AI availability state:

- available: roleplay uses the owner-managed Gemini key through the Worker.
- limited: roleplay remains usable with static scripted prompts.
- signed out: the app asks the user to log in before saving progress or using AI roleplay.

## Points and Progress Rules

XP is server-authoritative after login. The client may request activity recording, but the server decides whether the activity is new and how much XP it grants.

Each recordable activity sends a stable `client_event_id`, activity `kind`, optional `source_id`, and completion timestamp. The backend enforces idempotency so refreshing the page or retrying a request cannot duplicate XP for the same activity.

Existing XP rules can remain close to the local version at first. The important change is ownership: the browser displays progress, but Supabase stores the lasting record.

## Reward Rules

Rewards are milestone claims. A user can claim each active reward once after reaching its required cumulative XP. XP is not deducted by default because the user's request describes earning a reward after reaching a point level. A later setting can add spendable points if needed, but the first version should keep rewards simple.

Suggested initial rewards:

| Reward | Required XP | Fulfillment |
| --- | ---: | --- |
| Coffee coupon entry | 500 | Manual admin review |
| Coffee coupon | 1000 | Manual admin delivery |
| Bigger treat | 2000 | Manual admin delivery |

The app should make clear that reward delivery is handled by the owner, not by automatic purchase.

## Admin Flow

An admin-only dashboard shows users, total XP, current streak, reward eligibility, and reward claims. The owner can review a claim, mark it approved, delivered, or rejected, and add an internal note.

The dashboard does not need complex analytics. For 10 users, a compact table and filters by status are enough.

## Data Model

Use Supabase Auth for accounts and Postgres tables for app data.

`profiles`

- `user_id uuid primary key references auth.users(id)`
- `display_name text`
- `role text check role in ('user', 'admin')`
- `local_progress_imported_at timestamptz`
- `created_at timestamptz`

`invites`

- `id uuid primary key`
- `code_hash text unique`
- `max_uses integer`
- `uses integer`
- `expires_at timestamptz`
- `created_by uuid references auth.users(id)`
- `created_at timestamptz`

`activity_events`

- `id uuid primary key`
- `user_id uuid references auth.users(id)`
- `client_event_id text`
- `kind text`
- `source_id text`
- `xp_delta integer`
- `occurred_at timestamptz`
- `metadata jsonb`
- unique constraint on `(user_id, client_event_id)`

`progress_summaries`

- `user_id uuid primary key references auth.users(id)`
- `total_xp integer`
- `current_streak integer`
- `last_activity_date date`
- `completed_count integer`
- `updated_at timestamptz`

`reward_rules`

- `id uuid primary key`
- `title text`
- `required_xp integer`
- `description text`
- `active boolean`
- `created_at timestamptz`

`reward_claims`

- `id uuid primary key`
- `user_id uuid references auth.users(id)`
- `reward_rule_id uuid references reward_rules(id)`
- `status text check status in ('pending', 'approved', 'delivered', 'rejected')`
- `requested_at timestamptz`
- `reviewed_at timestamptz`
- `delivered_at timestamptz`
- `admin_note text`
- unique constraint on `(user_id, reward_rule_id)`

`ai_usage_daily`

- `user_id uuid references auth.users(id)`
- `usage_date date`
- `request_count integer`
- primary key on `(user_id, usage_date)`

## Security and Access Control

Enable Row Level Security on all app tables.

Users can read their own profile, progress, activity events, and reward claims. Users can create activity events only through controlled server APIs or database RPCs that enforce XP rules. Users can create reward claims only for active reward rules they are eligible for and have not already claimed.

Admins can read user summaries and manage reward claims. Invite creation and role changes are admin-only. The Worker uses server credentials only for operations that must be private, such as calling Gemini or verifying an invite code hash.

Invite codes should be stored hashed in the database. The plain code is shown once to the owner when created.

## Free-Cost Guardrails

Keep usage within free plans:

- limit access to invited users only.
- cap AI requests per user per day.
- add a global daily AI request cap.
- keep uploaded files out of scope.
- store only minimal metadata in `activity_events`.
- do not attach paid billing methods unless the owner later chooses to.

If Supabase or Gemini free limits are exhausted, the app should show a friendly limited-mode message and keep non-AI practice available.

## Error Handling

If login fails, keep the user on the login panel with a concise Korean error. If progress sync fails, retain current screen state and show that cloud saving is temporarily unavailable. If reward claim creation fails because the user is not eligible or already claimed the reward, show the server reason.

If AI roleplay fails because of quota, network, or Gemini errors, fall back to static roleplay prompts for that session. Do not expose internal error details or secret configuration names in the UI.

## Frontend Changes

Add a small account area with login, signup by invite, logout, and signed-in user display. Keep the app compact and mobile-friendly.

Replace the AI setup card with an AI status card. Add a progress/rewards card that shows total XP, next reward milestone, eligible rewards, and claim status. Add an admin tab or admin-only panel when the signed-in profile has role `admin`.

Apply the overall design and layout direction from `index-redesigned.html`. Treat that file as the concrete visual reference for the implementation, while adapting it into the current app's plain HTML/CSS/JavaScript structure.

The reference direction is:

- centered mobile-app frame, optimized first for phone-sized use.
- light neutral background `#f2f2f3` with slightly darker surfaces around `#e9e9ea`.
- dark near-black text `#1d1f20`.
- muted steel-blue accent around `#5980a6`, with darker accent states for active buttons and selected tabs.
- Barlow for body text and Barlow Condensed for headings where practical; if remote font loading is not available in the free deployment path, use the closest bundled or system fallback while preserving the condensed heading/body contrast.
- square, blueprint-like cards and buttons with hairline borders, no rounded pill card style, and small registration corner marks on primary framed cards.
- sticky top app bar with the LAKE title.
- sticky bottom tab navigation with icon plus short Korean label for Home, Course, Roleplay, Cards, and Progress/Rewards.
- compact vertical card stack rather than wide desktop dashboard layout.
- progress and reward sections should reuse the reference's level/progress bar/stat-card rhythm.
- admin views may become wider on desktop, but should still use the same blueprint table, hairline borders, and restrained accent color.

The existing `DESIGN.md` must be updated before implementation so these tokens and primitives become the new design-system contract. The current navy/white-card design should not remain the target for this feature.

## Migration Plan

On first login, inspect the old `englishConvoApp.progress` localStorage record. If it exists and the profile has no `local_progress_imported_at`, show a one-time import option. Import activity can be represented as one server-approved migration event that sets the initial summary and marks the profile imported.

After import, leave the local record in place for rollback safety, but stop treating it as the source of truth while signed in.

## Deployment Plan

Deploy the frontend to Cloudflare Pages and deploy server APIs as a Cloudflare Worker. Configure the Gemini key and Supabase service credentials as Cloudflare secrets. Configure Supabase Auth, database migrations, seed reward rules, and the first admin account.

The implementation should include setup documentation for the owner: Supabase project creation, Cloudflare secret names, admin account bootstrap, invite creation, and free-quota limits.

## Testing and QA

Implementation planning should include:

- unit tests for XP idempotency and reward eligibility.
- API tests for invite signup, progress recording, reward claiming, admin claim updates, and AI quota enforcement.
- RLS checks showing users cannot read or modify another user's data.
- browser QA for signup, login, progress sync, reward claim, admin review, logout, and AI limited fallback.
- responsive checks for mobile phone, tablet, and desktop widths.

## Open Decisions Deferred to Implementation Plan

The exact Cloudflare Worker framework, Supabase migration filenames, and admin bootstrap command can be chosen during implementation planning after checking the current project structure. The product behavior above should remain fixed unless the owner asks to change it.
