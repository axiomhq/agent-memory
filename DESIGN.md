# Design System — agent-memory

## Product Context
- **What this is:** a local-first markdown memory store for AI coding agents — capture, consolidate, and browse tiered memory so an agent starts each thread with relevant context.
- **Who it's for:** developers running AI agents (amp, cursor, codex, manual CLI) who read/curate what their agent remembers.
- **Space/industry:** developer tools / local-first infrastructure.
- **Project type:** local web app (memory browser) + CLI + MCP server.
- **Memorable thing:** a calm, dense, terminal-adjacent tool that makes an agent's memory feel trustworthy and scannable — not a marketing page.

## Aesthetic Direction
- **Direction:** Industrial / Utilitarian. Function-first, data-dense, calm. Linear / Datasette, not a landing page.
- **Decoration level:** minimal. Typography, hairline borders, and one accent do the work. No gradients, no glassmorphism, no decorative blobs, no card mosaic.
- **Mood:** quiet competence. The UI gets out of the way so memory entries (the hero content) are easy to scan and read.
- **Reference feel:** Linear, Datasette, a good TUI.

## Typography
Curated **native font stack** — zero network requests, no bundler, no web fonts. One coherent
sans + mono voice (no serif: agent memories are structured technical notes, not prose).
- **Titles / headings / UI:** `'Avenir Next', 'Segoe UI', system-ui, sans-serif`
- **Body / reader prose:** same sans, 16px min, line-height ~1.6
- **Metadata chips / tags / IDs / code:** `'SF Mono', 'Cascadia Code', ui-monospace, monospace`
- **Scale (rem, one ramp):** 0.75 / 0.82 / 0.9 / 1.0 / 1.15 / 1.34 / 1.55
- **Rules:** body/reader ≥ 16px; contrast ≥ 4.5:1; never bare `system-ui` as the sole display font; never the overused defaults (Inter, Roboto, Space Grotesk) as primary.

## Color
Restrained. Dark is the default; light mode is a **token swap only** (one stylesheet,
`:root` + `:root[data-theme=light]`). Accent is used sparingly: selection, primary button,
focus ring.

**Dark (default)**
- `--bg: #0d1117` — app background
- `--panel: #131820` — list + left rail (flat, 1px border)
- `--raised: #171d26` — reader pane, hover
- `--border: #232a33` — hairline 1px
- `--text: #e8edf7` — primary text
- `--muted: #96a2b8` — secondary/metadata text
- `--accent: #2dd4bf` — solid teal, sparing

**Semantic:** success `#3fb950` · warning `#d29922` · error `#f85149` · info `#58a6ff`
(muted to fit the calm surface; never saturated banners).

**Light mode:** swap `--bg/panel/raised/border/text/muted` to a light ramp; reduce accent
saturation ~10–15%. Verify every pairing hits WCAG AA (WORKPAC-796).

## Spacing
- **Base unit:** 4px
- **Density:** comfortable (dense but readable — this is a data workspace)
- **Scale:** 2xs(2) xs(4) sm(8) md(12) lg(16) xl(24) 2xl(32) 3xl(48)

## Layout
- **Approach:** hybrid — grid-disciplined 3-pane app shell.
- **Shell:** `[ left rail ][ memory list ][ reader/editor ]`. Hairline separators, no cards
  unless the card IS the interaction.
- **Responsive:** desktop ≥1100px = 3 panes; tablet 700–1100px = rail collapses to ☰,
  list + reader; mobile <700px = master-detail drill-down (list → full-screen reader, filters
  in a bottom sheet).
- **Selection affordance:** left-edge accent bar on the active list row (functional).
- **Border radius:** sm 4px / md 6px / lg 10px. No uniform bubble-radius on everything.

## Motion
- **Approach:** minimal-functional. Motion only to aid comprehension (selection, hover,
  panel toggle, mobile reader slide).
- **Duration:** 120–160ms.
- **Easing:** ease-out enter, ease-in exit.
- **Reduced motion:** respect `prefers-reduced-motion` — disable slides/transitions.

## Accessibility
- Visible 2px `--accent` focus ring on every interactive element.
- Keyboard: `/` focuses search; ↑/↓ move list selection; Enter opens; Esc closes/back.
- ARIA: nav rail, list/listitem rows, `aria-selected` on active row, `aria-live="polite"`
  on count + save status.
- Touch targets ≥ 44px on mobile.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-30 | Initial design system created | From /plan-design-review (3/10→8/10) + /plan-eng-review, formalized via /design-consultation. |
| 2026-05-30 | Flat calm dark surfaces; removed gradients/glassmorphism | App UI (dense workspace) rules; kills AI-slop signals from the old `/old` UI. |
| 2026-05-30 | **No serif — sans titles + mono metadata** | Agent memories are structured technical notes, not prose; serif clashed with the utilitarian/CLI aesthetic. Reconsidered and dropped during /design-consultation. |
| 2026-05-30 | Native font stack (zero web fonts) | Local-first, zero-dependency, no-bundler ethos; avoids a network dependency the rest of the app avoids. |
