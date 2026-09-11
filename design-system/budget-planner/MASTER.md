<!-- PROJECT OVERRIDES - these take precedence over the generated sections below -->

# Budget Planner - Design System

> Generated with `ui-ux-pro-max --design-system`, then corrected in three places.
> Each correction is recorded with its reason so it is not silently reverted.

## Overrides applied to the generated output

### 1. Typography: NOT the generated pairing
The generator proposed **Caveat / Quicksand**. Caveat is a handwritten display
face whose own profile reads *"Best For: Personal blogs, invitations, creative
portfolios"*. On a screen showing someone's money, handwriting signals the
opposite of precision and trust.

Replaced with **IBM Plex Sans** (`--domain typography` -> "Financial Trust":
*"Banks, finance, insurance, investment, fintech. Excellent for data."*), plus
**IBM Plex Mono** for currency figures so digits align when scanning a column
of amounts. Same superfamily, so they share metrics and cohere.

Apply `font-variant-numeric: tabular-nums` to every money value.

### 2. `--color-primary` must never be a foreground colour on the dark background
Measured, not assumed:

| Pair | Ratio | Required | Result |
|---|---|---|---|
| `#1E40AF` primary **on** `#0F172A` background | **2.05:1** | 3:1 | **FAILS** |
| `#FFFFFF` on `#1E40AF` (primary as a *fill*) | 8.72:1 | 4.5:1 | passes |
| `#60A5FA` blue-400 on `#0F172A` | 7.02:1 | 4.5:1 | passes |

So: primary is a **fill colour only**, always with white text on it. For links,
icons and interactive text on the background, use `--color-interactive`
(`#60A5FA`). Every other pair in the generated palette was verified and passes.

```css
--color-interactive: #60A5FA;   /* links, icons, interactive text on dark */
--color-under:       #4ADE80;   /* 10.25:1 - comfortably under budget */
--color-near:        #FBBF24;   /* 10.69:1 - approaching the limit */
--color-over:        #F87171;   /*  6.45:1 - over budget */
```

The app's existing `trafficLight` (green/yellow/red) maps onto the last three.
Per the chart guidance, **red/yellow/green alone is insufficient** - always pair
the colour with a text label or icon.

### 3. Ignore the generated "Pattern" section
It returned **Product Demo + Features** (Hero -> product video -> feature
breakdown -> CTA). That is a *marketing landing page* structure. Budget Planner
is an authenticated application; there is no landing page in scope. The section
is left below for reference but does not apply.

## Charts (supersedes the original Phase 6 plan)

Searched `--domain chart`. Two of the three chart types originally planned
carry a **high** accessibility risk, so the plan changed:

| Data | Chart | Risk | Note |
|---|---|---|---|
| Spent vs budget | **Bullet / Gauge** | low | *"Single KPI measured against a defined target"* - exactly this case. Replaces the donut. |
| Category breakdown | **Horizontal Bar** | low | Ranked magnitude, <= 15 categories |
| Month-on-month trend | **Line** | low | Continuous time axis |
| ~~Donut / Pie~~ | avoid | **high** | *"unlabeled color-only slices are inaccessible"* |
| ~~Treemap / Sunburst~~ | avoid | **high** | Needs a data table as the primary accessible view |

Library: **Recharts** (recommended across all chart results; React-native fit).
Never encode a series by hue alone - use direct labels, plus dash patterns on
the line chart.

## Stack

React 18 + Vite, plain CSS with custom properties. **No Tailwind, no shadcn** -
ignore any `tailwind.config` snippets below. `React.memo` is a measured
optimisation for the chart components only, not a blanket default.

---

# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Budget Planner
**Generated:** 2026-09-11 22:45:13
**Category:** Personal Finance Tracker
**Design Dials:** Variance 5/10 (Balanced / Modern) | Motion 6/10 (Standard) | Density 7/10 (Standard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E40AF` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#3B82F6` | `--color-secondary` |
| On Secondary | `#000000` | `--color-on-secondary` |
| Accent/CTA | `#059669` | `--color-accent` |
| On Accent/CTA | `#000000` | `--color-on-accent` |
| Background | `#0F172A` | `--color-background` |
| Foreground | `#FFFFFF` | `--color-foreground` |
| Card | `#192134` | `--color-card` |
| Card Foreground | `#FFFFFF` | `--color-card-foreground` |
| Muted | `#101A34` | `--color-muted` |
| Muted Foreground | `#94A3B8` | `--color-muted-foreground` |
| Border | `rgba(255,255,255,0.08)` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#FFFFFF` | `--color-ring` |

**Color Notes:** Trust blue + profit green on dark

### Typography

- **Heading Font:** IBM Plex Sans
- **Body Font:** IBM Plex Sans
- **Numeric Font:** IBM Plex Mono (currency figures only)
- **Mood:** handwritten, personal, friendly, casual, warm, charming
- **Google Fonts:** [IBM Plex Sans + Mono](https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 7/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #059669;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1E40AF;
  border: 2px solid #1E40AF;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #0F172A;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E40AF;
  outline: none;
  box-shadow: 0 0 0 3px #1E40AF20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Glassmorphism

**Keywords:** Frosted glass, transparent, blurred background, layered, vibrant background, light source, depth, multi-layer

**Best For:** Modern SaaS, financial dashboards, high-end corporate, lifestyle apps, modal overlays, navigation

**Key Effects:** Backdrop blur (10-20px), subtle border (1px solid rgba white 0.2), light reflection, Z-depth

### Page Pattern

**Pattern Name:** Product Demo + Features

- **Conversion Strategy:** Use an interactive demo only when it explains value better than static media. Provide captions, transcript, visible play/pause controls, and a non-video fallback; do not autoplay under reduced motion. Pause media when offscreen or hidden and keep the final product state available as static content.
- **CTA Placement:** Video center + CTA right/bottom
- **Section Order:** Hero > Product video/mockup (center) > Feature breakdown per section > Comparison (optional) > CTA

---

## Motion

**Stagger List** (Standard) — Trigger: load or scroll | Duration: 300-450ms | Easing: `back.out(1.4)`

```js
gsap.from('.grid-item', { opacity: 0, scale: 0.92, y: 16, duration: 0.4, stagger: { each: 0.06, from: 'start', grid: 'auto' }, ease: 'back.out(1.4)' });
```

**Framework notes:** grid: 'auto' lets GSAP infer rows/columns from a CSS grid layout for a natural wave stagger; Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Combine with from: 'center' for a bento-grid layout to draw the eye inward first
- ❌ Don't use back.out on dense data tables; the overshoot reads as sloppy on informational UI
- ⚡ Group DOM writes; avoid interleaving layout reads (getBoundingClientRect) between staggered tweens

---

## Anti-Patterns (Do NOT Use)

- ❌ Pure white backgrounds

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
