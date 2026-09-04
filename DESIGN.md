# English Conversation App Design System

This document reflects the mint claymorphism direction confirmed 2026-09 (trialed first on Home/Progress, now applied app-wide). It supersedes the earlier blueprint/workbook contract; the tokens and component rules below are current.

## 1. Atmosphere

The app is a compact, mobile-first Korean English-learning tool with a soft, calm study-companion feel: light neutral canvas, rounded mint cards with a gentle lift (soft shadow), pill-shaped buttons and tags, quiet Korean guidance, and restrained interaction feedback.

Surfaces float rather than being drawn: rounded corners, soft drop shadows instead of hairline borders, and a light mint accent instead of the earlier steel-blue construction-line look. Avoid the old navy header, square hairline cards, and corner registration marks.

## 2. Tokens

```css
:root {
  --mint-surface: #fffffe;
  --mint-primary: #a7e8d0;
  --mint-primary-dark: #6fcf9e;
  --mint-border: #e5e5e0;
  --mint-focus: #00cfc4;
  --mint-text: #1d1f20;
  --mint-radius: 20px;
  --mint-radius-sm: 14px;
  --mint-shadow: 0 10px 24px rgba(90, 140, 120, 0.14), 0 2px 6px rgba(90, 140, 120, 0.08);
}
```

The pre-existing `--color-*` tokens (bg, danger, success, neutral-600, etc.) remain in place for text, danger/success feedback, and the page background grid; only card/button/input surfaces and radii move to the `--mint-*` tokens above.

## 3. Typography

Unchanged: `Barlow` for body text and `Barlow Condensed` for headings, with `system-ui, sans-serif` as the fallback stack. Korean learning copy stays quiet and direct — short labels, no marketing slogans or feature explanations inside the app surface.

## 4. Layout

Unchanged: the desktop layout centers a phone-sized app frame on the light neutral page canvas, mobile-first, with a sticky top title/account bar and sticky bottom tab bar.

## 5. Components

Cards (`.card`, `.curriculum-card`, `.scenario-item`, `.reward-card`, `.ai-message`, `.ai-correction`, `.progress-hero`, `.badge-item`, `.flashcard-face`, `.admin-table`) use `--mint-surface` background, a 1px `--mint-border`, `--mint-radius` corners, and `--mint-shadow`. `.badge-item` uses the smaller `--mint-radius-sm` and no shadow so the badge grid stays visually light.

Primary buttons are pill-shaped (`border-radius: 999px`), filled with `--mint-primary`, text in `--mint-text` (not white — the mint fill is light enough that dark text keeps contrast); hover/active deepen to `--mint-primary-dark`. Secondary buttons and icon buttons stay pill-shaped with a `--mint-surface` background and `--mint-border`, darkening the border on hover.

Inputs use `--mint-surface`, a 1px `--mint-border`, and `--mint-radius-sm` corners; hover darkens the border toward `--mint-primary-dark`. Focus-visible on any button/input/select/link uses a `--mint-focus` outline.

Tags (`.status-tag`, `.ai-badge`, `.tag`) are pill-shaped with a `--mint-border`, keeping their existing text-color-by-state logic (accent/neutral/danger/success text colors are unchanged).

Progress bars (`.curriculum-progress-bar`) are fully rounded pill tracks; the fill uses `--mint-primary-dark`. The level badge (`.progress-level-badge`) is a full circle filled with `--mint-primary`.

Admin tables keep their existing row grid and hairline row dividers (`--line`, unchanged) inside a single rounded `--mint-shadow` card frame, rather than being individually framed rows.

## 6. States

Unchanged from the previous contract: every reusable component defines default, hover, active, focus, disabled, loading, empty, and error states, and state changes must preserve dimensions (no layout jump).

## 7. Motion And Surfaces

Unchanged: short transitions (120-180ms) on transform/opacity/color, respecting `prefers-reduced-motion`. The microphone never auto-starts.

## 8. App icon

`icon.svg` is the source-of-truth app icon (mint rounded-square mark). It is referenced as the favicon and in `manifest.json` for "Add to Home Screen" so the home-screen shortcut matches this design system. See `manifest.json` and the `<link rel="icon">`/`<link rel="apple-touch-icon">` tags in `index.html`.
