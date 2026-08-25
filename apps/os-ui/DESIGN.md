# Hustronix OS — DESIGN.md

> Executive decision-intelligence dashboard. "Decide. Align. Execute."
> Drop this file into any project and ask a coding agent to build UI that matches the Hustronix design language.

## 1. Visual Theme & Atmosphere

- **Mood:** High-tech executive command center. Dense, calm, authoritative. Nothing playful.
- **Canvas:** True OLED black (`#000000`). Panels are barely-lifted charcoal glass with 1px hairline borders.
- **Signal color:** A single muted gold — used *only* for active states, primary actions, and AI affordances. Gold means "the system is speaking or you are acting."
- **Status is color-coded, never decorative:** red/orange/yellow/green/blue map strictly to severity.
- **Density:** High. 12–14px body text, tight 12px grid gaps, information-per-pixel prioritized over whitespace.

## 2. Color Palette & Roles

| Token | Hex | Role |
|---|---|---|
| `--bg-app` | `#000000` | Page background |
| `--bg-sidebar` | `#050505` | Sidebar background |
| `--surface-panel` | `#0d0d0d` | Card/panel base |
| `--surface-raised` | `#121212` | Inputs, buttons, chips |
| `--surface-sunken` | `#080808` | Graph canvases, table headers |
| `--signal-gold` | `#d4af37` | Primary accent: active nav, CTAs, AI, focus |
| `--status-critical` | `#f05252` | Critical severity, Off Track, rejections |
| `--status-high` | `#f97316` | High severity, At Risk |
| `--status-medium` | `#d4af37` | Medium severity (shares gold family) |
| `--status-low` | `#2fbd73` | Low severity, success, On Track |
| `--status-info` | `#3b82f6` | Info severity, neutral progress |
| `--status-purple` | `#8b5cf6` | Objectives, strategic categories |
| `--status-cyan` | `#22d3ee` | Capacity / engineering categories |
| `--text-primary` | `#f5f5f4` | Headings, values |
| `--text-secondary` | `#c7c5bf` | Body copy |
| `--text-muted` | `#8a887f` | Labels, meta, subtitles |
| `--border-subtle` | `rgba(255,255,255,0.07)` | Default hairlines |
| `--border-strong` | `rgba(255,255,255,0.14)` | Hover/emphasis borders |
| `--border-gold` | `rgba(212,175,55,0.35)` | Gold-accented borders |

## 3. Typography Rules

- **Family:** Inter (fallback: system-ui, sans-serif). Tabular numerals for all metrics (`font-variant-numeric: tabular-nums`).

| Level | Size / Weight | Usage |
|---|---|---|
| Page title | 26px / 700, -0.01em | One per screen, top-left |
| Panel title | 13px / 700, uppercase, +0.06em | "KNOWLEDGE GRAPH", "CRITICAL NOW" |
| Card title | 14–15px / 650 | Alert titles, decision names |
| Body | 13px / 400–500 | Descriptions |
| Meta/labels | 10–12px / 500–700, muted | Timestamps, KV labels (often uppercase) |
| Hero metric | 28–34px / 700, tabular | KPI values, health scores |

## 4. Component Stylings

- **Panels:** `border-radius: 12px`, 1px `--border-subtle` border, faint top-down white gradient (3% → 1%) over `--surface-panel`. Soft ambient shadow only — no drop shadows fighting the black.
- **Buttons:**
  - *Primary:* gold gradient (`--gold-gradient`: `#e8c552 → #d4af37 → #b8952c` at 160°), near-black text (`#12110c`), 8px radius, inner top highlight (`0 1px 0 rgba(255,255,255,.35) inset`) + gold glow shadow. Hover: brightness 1.06 + `translateY(-1px)` + stronger glow.
  - *Ghost:* transparent, hairline border, secondary text; border brightens on hover.
  - *Severity action buttons:* transparent with the severity color at ~45% alpha border + tinted text.
- **Pills:** 999px radius, 22–30px height. Severity pills use tinted background (8–12% alpha) + colored text. Active filter pill = solid gold + dark text.
- **Nav (sidebar):** 42px rows, 8px radius. Active = solid gold background, dark text/icon. Hover = 3% white.
- **Inputs:** `--surface-raised` bg, hairline border, gold border on focus. Search shows `⌘K` kbd chip.
- **Rings/graphs:** SVG circular progress with 8–12px stroke, rounded caps, track at 8% white. Line charts are 2px polylines in status colors on `--surface-sunken`.
- **Modals:** centered, 560–720px, 14px radius, backdrop `rgba(0,0,0,0.65)` + 4px blur. Header/body/footer separated by hairlines.
- **Signal evidence:** never dump ingest blobs. Parse `[event] key=value {json}` into an event chip (mono, muted), a 15px headline (`summary`), optional note, then fact chips (Ground truth / Entities / Scenario / Object). JSON stays out of the reading path.
- **Toasts:** bottom-right, dark gold-bordered cards, auto-dismiss ~4s.
- **Status icons:** 36px rounded squares, 10% alpha tinted background + colored icon, matching severity.
- **Icons:** Hustronix icon pack only (`@/components/icons`). 24×24 grid, **2px** stroke, round caps/joins. Nav metaphors from the product sheet: Home, Signals (pulse), Company Brain (side-profile), Decisions (**balance scales**), Tasks (checklist), Chat (bubble + dots), Teams, Analytics (bars). Brand mark for assistant identity (`HustronixMark`). Never mix Lucide / Heroicons / emoji. Integration logos stay in `IntegrationIcons`.

## 5. Layout Principles

- **Shell:** fixed 248px sidebar (collapsible to 76px) + fluid main. Sidebar: logo lockup → primary nav (core loop) → Settings / Help / profile in the footer.
- **Primary nav is the product loop, in this order:** Home → Signals → Company Brain → Decisions → Tasks → Chat → Teams → Analytics. Settings is not a loop step.
- Each tab is one part of: Signals → Company Brain → Intelligence → Decisions → Execution → Team coordination → Outcomes. Chat sits across the whole system (Ask / Investigate / Decide / Execute).
- **Alerts** is not primary nav. Attention lives on Home. Notifications stay in the top-bar bell.
- **Screens:** `main content (1fr) + right rail (~320px)` two-column grid; rail stacks context widgets (health, blockers, trends, settings).
- **Grid gap:** 12–14px everywhere. Panel padding 14–16px.
- **Every screen ends with an AI composer bar** (input + suggested prompt chips + disclaimer line).
- Breakpoints: rail drops under ~1100px; sidebar becomes a drawer under 1280px; single column under 768px.

## 6. Depth & Elevation

Three levels only:
1. **Canvas** (`#000`) — flat.
2. **Panel** (+1) — hairline border + faint gradient; ambient shadow `0 8px 24px rgba(0,0,0,0.35)`.
3. **Overlay** (+2) — modals/menus/slide-overs; stronger border (`--border-strong`), heavy shadow `0 24px 64px rgba(0,0,0,0.7)`.

Glow is reserved for meaning: gold glow on primary CTAs, red glow (36px, 14% alpha, slow 3.2s pulse) on At-Risk graph nodes. Progress fills and health-ring arcs carry a soft `drop-shadow` glow in their status color.

## 6b. Motion

- Tokens: `--ease-out: cubic-bezier(0.22,1,0.36,1)`, `--dur-fast: 150ms`, `--dur-med: 240ms`.
- Page content fades/slides in (6px, 320ms) on route change.
- Cards lift on hover (`translateY(-1px … -3px)` + deeper ambient shadow); nav items nudge right 2px.
- Progress bars animate width (480ms); ring arcs animate dashoffset (640ms).
- All motion collapses under `prefers-reduced-motion`.

## 6c. Premium finishes

- Body backdrop: fixed radial gold wash top-right (4.5% alpha) + faint violet bottom-left (3%) over `#060606`.
- Panels get a 1px gradient "light edge" along the top (`transparent → 14% white → transparent`).
- Large metric numerals use a white→grey vertical gradient text fill.
- Alert rows carry a 3px severity accent bar on the left edge (gradient fading downward).
- Scrollbars: 10px, pill thumbs at 9% white, gold on hover.
- Graph canvas sits on a 22px dot grid (5% white dots).

## 7. Do's and Don'ts

**Do**
- Use gold sparingly — one primary action per view.
- Pair every metric with context (delta, % of total, "vs required").
- Keep severity color mapping absolute across all components.
- Use uppercase micro-labels for panel titles and KV labels.

**Don't**
- No pure-white large surfaces; nothing lighter than `#1a1a1a` as a fill.
- No blue/purple gradients or glassmorphism rainbows.
- No rounded-full cards; radius stays 8–14px.
- Never use red/green for anything other than status.
- No emoji in data UI (the Home greeting "👋" is the single exception).
- No Lucide / Heroicons / mixed icon families — use `@/components/icons` only.

## 8. Responsive Behavior

- ≥1280px: full sidebar + rail.
- 1100–1279px: sidebar → hamburger drawer; rail remains.
- 768–1099px: rail stacks below main column.
- <768px: single column, search full-width, action labels collapse to icons.
- Touch targets ≥40px on interactive chrome.

## 9. Agent Prompt Guide

Quick reference: bg `#000`, panel `#0d0d0d`, accent gold `#d4af37`, critical `#f05252`, success `#2fbd73`, info `#3b82f6`, text `#f5f5f4`/`#8a887f`, borders `rgba(255,255,255,0.07)`, Inter, 12px radius panels.

Example prompts:
- "Build a metrics panel in the Hustronix style: black canvas, charcoal panel with hairline border, uppercase 13px gold-less title, 28px tabular metric with a colored progress ring."
- "Create an alert list row: 36px tinted severity icon, 14px bold title + severity pill, muted description, timestamp and ghost action button on the right."
- "Add a modal in the Hustronix style with a gold primary button, ghost cancel, and a 3-column key-value grid."
