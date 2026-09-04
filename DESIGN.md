# English Conversation App Design System

This design contract is locked to `index-redesigned.html`. Treat that bundled reference as the visual source of truth for future UI work, including token choices, spacing rhythm, component framing, Korean learning copy tone, and the compact phone-sized app shell.

## 1. Atmosphere

The app is a compact, mobile-first Korean English-learning tool with a blueprint/workbook feel. It should feel like a calm study instrument: light neutral canvas, thin steel-blue construction lines, square framed cards, quiet Korean guidance, and restrained interaction feedback.

The surface language comes from drafting sheets and workbook exercises. Use hairline borders, exposed layout structure, small captions, corner registration marks, and measured spacing. Avoid the old navy header and white-card product-dashboard look. Do not use heavy shadows, rounded white cards, glossy gradients, or pill-heavy UI.

## 2. Tokens

Use these exact color tokens from `index-redesigned.html`:

```css
:root {
  --color-bg: #f2f2f3;
  --color-surface: #e9e9ea;
  --color-text: #1d1f20;
  --color-accent: #5980a6;
  --color-accent-700: #416180;
  --color-neutral-300: #d4d4d7;
  --color-neutral-600: #7a7a7d;
  --color-danger: #c34331;
  --color-success: #1a8a5f;
}
```

Supporting neutral and accent ramps may be derived from these tokens only when a component state needs a lighter or darker step. Keep construction lines steel-blue or neutral gray; do not reintroduce navy, pure white card fields, saturated purple, or high-contrast black panels.

## 3. Typography

Use `Barlow` for body text and `Barlow Condensed` for headings when available, with `system-ui, sans-serif` as the fallback stack. Headings are condensed, firm, and workbook-like; body copy is readable at 14-16px with compact line height.

Korean learning copy should stay quiet and direct: short labels such as "홈", "코스", "상황극", "카드", "성과"; progress copy such as "오늘 진행"; and feedback such as "학습 기록에 저장됐어요". Do not add marketing slogans, large empty hero copy, or instructional feature explanations inside the app surface.

## 4. Layout

The desktop layout centers a phone-sized app frame on the light neutral page canvas. The app frame remains compact, vertically oriented, and optimized for mobile first; desktop should present the mobile product cleanly rather than expanding into a dashboard.

The app shell uses a sticky top title/account bar and a sticky bottom tab bar. Content between them is a vertical stack with gaps based on the redesigned reference spacing: 13.6px for normal section rhythm and 20.4px for larger breaks. Use full-width stacked sections and blueprint cards instead of nested card panels.

Bottom tab navigation is always visible at the bottom of the app frame. Tabs use line icons, 10-11px Korean labels, transparent backgrounds, an active top border in `--color-accent`, active text in `--color-accent-700`, and muted inactive text.

## 5. Components

Blueprint cards are square framed study units. They use transparent or `--color-surface` backgrounds, 1px neutral or steel-blue borders, no large radius, and optional corner registration marks. Card content is dense but breathable: kicker, title, short body copy, progress/stat rows, and action controls.

Buttons use condensed typography, thin borders, compact padding, and short transform/opacity transitions. Primary buttons fill with `--color-accent`; hover shifts toward a darker accent; active uses `--color-accent-700`; disabled lowers opacity and removes pointer affordance. Secondary buttons stay transparent with a hairline border. Ghost buttons are text or icon actions in accent color.

Inputs use `--color-surface`, 1px borders, 14px text, accent caret, and square framing. Hover darkens the border slightly. Focus uses a visible accent outline or accent border. Error states use `--color-danger`; success states use `--color-success`. Disabled inputs are muted and non-interactive.

Tags are small rectangular status labels, not soft pills. Use accent tags for earned or active statuses, neutral tags for inactive statuses, danger tags for destructive/error states, and success tags for completed states. Keep tag copy short: "획득", "미획득", "완료", "오류".

Progress bars are thin workbook gauges. The track uses `--color-neutral-300`; the fill uses `--color-accent` or `--color-success` for confirmed completion. Loading progress may animate opacity or transform only. Empty progress remains visible as a neutral hairline track with quiet explanatory copy.

Stat grids use small square cells with hairline dividers. Numbers use firm heading typography; labels use muted 11-12px body text. Hover may tint the cell subtly when interactive; static stats should not animate.

Bottom tabs use the sticky bottom tab bar contract above. Default state is muted, hover raises contrast, active shows the top accent rule, focus shows an accent outline, disabled lowers opacity, loading preserves the tab width, empty/error states keep navigation stable.

Toast messages appear above the bottom tab bar, centered inside the app frame. They use a compact dark accent surface, 12px text, short opacity/transform motion, and auto-dismiss after the action feedback has been read. Toasts report saved progress, voice preview, microphone check, or recoverable errors.

The auth panel is a blueprint card, not a modal marketing form. It uses compact fields, small Korean labels, clear primary/secondary actions, and quiet error text. Loading disables submit controls and keeps field geometry stable. Empty states explain what account action is needed in one short sentence.

Reward cards use the same square blueprint framing as learning cards. Achievement and XP states use `--color-success` sparingly for earned progress, accent for current level, neutral for locked rewards, and danger only for errors. Reward states include default, hover/selectable, active/claimed, focus, disabled/locked, loading, empty, and error.

Admin tables are dense workbook tables. Headers use small uppercase or firm condensed labels, rows use 13-14px body text, dividers are hairline neutral lines, hover applies a light neutral tint, active selection uses accent line treatment, focus is visible, disabled rows are muted, loading uses stable row skeletons, empty states keep the table frame, and error states show a danger caption without breaking layout.

## 6. States

Every reusable component must define these states before implementation: default, hover, active, focus, disabled, loading, empty, and error. Components that can complete learning work also define success/completed states.

State changes must preserve dimensions. Hover and active states may change background tint, border color, text color, opacity, or `transform: translateY(-1px)`. Focus must be keyboard-visible with an accent outline. Loading states keep labels or reserved width so buttons, tabs, cards, and table rows do not jump.

## 7. Motion And Surfaces

Use short transitions on transform and opacity, generally 120-180ms. Border and color changes may transition briefly when they help controls feel responsive. Respect `prefers-reduced-motion` by removing nonessential transform animation and keeping state changes immediate.

The microphone never auto-starts. Microphone listening begins only after explicit user action and may use the existing `micPulse` style while active. Voice preview and replay controls must also require explicit taps.

Surfaces are drawn, not floated: hairline borders, square edges, neutral fills, thin steel-blue construction lines, and corner registration marks. Avoid navy headers, white rounded cards, heavy shadows, oversized hero treatment, dense pill clusters, and decorative gradients.
