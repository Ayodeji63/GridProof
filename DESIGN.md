---
name: GridProof Operations
description: An authoritative national observatory for electricity-grid telemetry reliability and verifiable evidence.
colors:
  authority-navy: "#0b1530"
  authority-navy-strong: "#172554"
  verification-blue: "#2563eb"
  verification-blue-deep: "#1e40af"
  evidence-amber: "#d97706"
  canvas: "#f4f7fb"
  surface: "#ffffff"
  surface-muted: "#f8fafc"
  ink: "#172033"
  ink-muted: "#5c687d"
  divider: "#dfe5ef"
  reliable: "#15803d"
  outage: "#dc2626"
  warning: "#b45309"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.18rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.94rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.09em"
rounded:
  control: "8px"
  compact: "9px"
  panel: "12px"
  card: "13px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.authority-navy-strong}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.verification-blue-deep}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "18px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "6px"
    padding: "10px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
---

# Design System: GridProof Operations

## Overview

**Creative North Star: "The National Grid Observatory"**

GridProof presents the electricity telemetry network as a national observatory: a composed, high-trust environment where regulators scan broad reliability conditions, isolate anomalies, and follow evidence into verifiable detail. The system is authoritative, precise, calm, and operational. Its expression comes from hierarchy, disciplined density, exact status language, and the contrast between bright evidence surfaces and a deep institutional frame.

The interface avoids glossy consumer-fintech styling and decorative dashboard effects. It favors direct labels, compact measurements, stable geometry, and visible distinctions between observed readings, missing data, alerts, review states, and blockchain proof. Brand character lives in the navy control-room shell, verification blue actions, the sparing amber proof accent, and typography that privileges data over spectacle.

**Key Characteristics:**

- National-scale oversight with a clear path from summary to evidence.
- Dense but calm operational layouts built for repeat scanning.
- Explicit status semantics supported by text, iconography, and color.
- Restrained layering with stronger depth reserved for selected or actionable surfaces.
- Precise, evidence-first components with minimal ornament.

## Colors

The palette combines institutional navy, verification blue, and evidence amber over cool white operational surfaces. Semantic green, red, and amber communicate reliability states without becoming the product identity.

### Primary

- **Authority Navy:** The app shell, selected-feeder inspector, and deepest primary controls. It establishes regulatory seriousness and separates global navigation from evidence content.
- **Verification Blue:** Active navigation, primary actions, links, focus treatments, progress readings, and verifiable interactive states.

### Secondary

- **Evidence Amber:** The GridProof mark and proof-oriented emphasis. Its rarity makes it meaningful; it should not become a general-purpose highlight color.

### Tertiary

- **Reliable Green:** Confirmed active or healthy telemetry.
- **Outage Red:** Confirmed outage, failure, destructive, or critical error states.
- **Warning Amber:** Below-target DAR, pending attention, or degraded-but-not-failed states.

### Neutral

- **Observatory Canvas:** The cool page background that holds all operational surfaces.
- **Evidence Surface:** White cards, tables, forms, and proof containers.
- **Muted Evidence Surface:** Table headers, quiet groupings, and secondary panels.
- **Operational Ink:** Primary text and critical numeric data.
- **Muted Operational Ink:** Explanations, timestamps, labels, and secondary metadata.
- **Instrument Divider:** Borders and separators that carry most of the structural hierarchy.

### Named Rules

**The Evidence Amber Rule.** Amber is reserved for the product mark, proof emphasis, and warning-level telemetry; its rarity is the point.

**The Status Is Not Branding Rule.** Green and red describe measured state. They never replace verification blue as the system's interactive identity, and every critical state also receives a text or icon label.

**The Bright Evidence Rule.** Operational evidence sits on bright, legible surfaces; dark surfaces are reserved for navigation, selection, or focused inspection.

## Typography

**Display Font:** Inter with the system sans-serif stack

**Body Font:** Inter with the system sans-serif stack

**Label/Mono Font:** SFMono-Regular, Consolas, or Liberation Mono for feeder codes, hashes, and machine identifiers

**Character:** The single sans-serif family keeps the interface neutral, modern, and fast to scan. Hierarchy comes from weight, scale, tight display tracking, uppercase utility labels, and tabular numeric alignment rather than decorative type pairing.

### Hierarchy

- **Display** (bold, fluid 2–3rem, 1.05 line height): Page titles and national-level operational framing; use tight tracking and sentence case.
- **Headline** (semibold, approximately 1.15–1.18rem): Section and panel headings that divide operational tasks.
- **Title** (semibold, approximately 0.86–1rem): Card titles, feeder names, and compact component headings.
- **Body** (regular, approximately 0.88–0.94rem, 1.5 line height): Explanations, guidance, evidence summaries, and interface copy.
- **Label** (bold, approximately 0.68–0.76rem, tracked uppercase where appropriate): Eyebrows, status labels, table headings, and metadata.
- **Data** (bold with tabular numerals): Percentages, voltage, current, counts, uptime, and other values where changing width would impair scanning.

### Named Rules

**The Numbers Hold Still Rule.** Operational numbers use tabular figures and stable containers so telemetry updates never cause distracting layout shifts.

**The Label Before Flourish Rule.** Technical abbreviations, statuses, and proof terms receive explicit labels; typography must clarify them rather than stylize them.

## Layout

The desktop application uses a persistent 232px authority-navy sidebar and a flexible content canvas. Page content is centered within a maximum 1480px shell with fluid 20–44px horizontal gutters and a compact 32px section rhythm. Dashboard summaries use four equal cards, while the primary investigation workspace pairs a larger map with a narrower feeder inspector.

At 1100px, four-column metrics become two columns. Below 980px, the sidebar becomes a horizontal, scrollable navigation rail above the page. Below 760px, top bars, metric grids, map-and-inspector layouts, and forms become single-column stacks. At 600px and below, page gutters reduce to 16px while controls and critical navigation retain touchable heights.

Spacing follows a compact 4/8px-derived rhythm. Use 8–18px inside controls and cards, 24–32px between major content regions, and whitespace to separate distinct jobs rather than making every surface equally airy. Wide data tables remain in a contained horizontal-scrolling region on small screens.

**The Scan Then Inspect Rule.** National summaries precede network selection; focused evidence appears only after the user has enough context to understand it.

**The Stable Shell Rule.** Global navigation and page gutters remain predictable across routes. Feature pages may change density, but not the location or visual priority of core navigation.

## Elevation & Depth

The system uses restrained layering. Borders establish structure first, cool tonal shifts establish groups second, and soft ambient shadows separate important cards from the canvas. Stronger depth is reserved for selected, actionable, or overlaid operational surfaces such as the focused feeder inspector and map markers.

### Shadow Vocabulary

- **Operational Card:** A nearly flat two-part ambient shadow under dashboard cards; it separates a surface without making it float.
- **Action Lift:** A compact blue-tinted shadow on hovered primary actions; it indicates interactivity without moving layout bounds.
- **Focused Inspector:** A deeper navy shadow for the selected feeder panel; it marks an active investigation context.
- **Map Marker:** A localized shadow and focus halo around selectable feeder pins.

### Named Rules

**The Border Before Shadow Rule.** Every resting operational surface earns its structure through border and spacing; shadow is supplementary, never the only boundary.

**The Selected Surface Rule.** Strong depth communicates focus or action. Do not apply it uniformly to passive cards, tables, and forms.

## Shapes

GridProof uses gently rounded operational geometry: 8–9px controls, 10–13px panels and cards, and fully rounded pills only for statuses, compact chips, and progress tracks. Thin borders and clipped card edges preserve a disciplined instrument-panel feel. The amber brand mark is a compact rounded square; icons use one consistent outlined Lucide vocabulary.

**The Pill Has Meaning Rule.** Fully rounded forms are reserved for finite statuses, filters, compact counts, and progress indicators—not general containers or large calls to action.

## Components

Components are precise, compact, and evidence-first. Controls feel decisive without becoming decorative; status, measurement, and proof information always outrank ornament.

### Buttons

- **Shape:** Compact rounded rectangle with an 8px radius and a minimum height near 42px.
- **Primary:** Authority navy or verification blue with white text and balanced 10px × 13px padding.
- **Hover / Focus:** Shift to verification blue with a restrained action shadow; keyboard focus uses a visible blue outer ring.
- **Secondary:** On dark inspectors, use a translucent navy surface with a visible light border. Disabled controls remain structurally present with reduced opacity and a non-interactive cursor.

### Chips

- **Style:** White or softly tinted pill with a thin instrument divider, compact label, and a small semantic status dot where relevant.
- **State:** Selection uses a verification-blue border, cool blue background, and a subtle focus halo. Grid status uses green, red, or slate dots plus text.

### Cards / Containers

- **Corner Style:** Gently rounded 12–13px panels and cards.
- **Background:** Evidence white over the cool observatory canvas; focused inspectors use authority navy.
- **Shadow Strategy:** Ambient card shadow for key dashboard modules; most supporting panels rely primarily on borders.
- **Border:** One-pixel cool divider that remains visible in all resting states.
- **Internal Padding:** Typically 18–22px, reduced to 14–16px for dense headers or narrow screens.

### Inputs / Fields

- **Style:** White input surface, one-pixel cool border, 6px radius, inherited body type, and 10px internal padding.
- **Focus:** A visible verification-blue focus outline must remain present for keyboard navigation.
- **Error / Disabled:** Error copy and boundaries use outage red with explicit recovery language; disabled controls retain labels and use reduced opacity.

### Navigation

Desktop navigation uses a persistent authority-navy sidebar with outlined Lucide icons, compact labels, 44px minimum row height, and verification blue for the active route. Hover states use a quiet translucent surface. On smaller screens, navigation becomes a horizontally scrollable top rail; labels and icons remain together, and the active route receives a bottom inset marker.

### Metric Cards

Metric cards combine a semantic icon tile, a short label, a tabular percentage, a denominator caption, and a thin progress track. Their restrained entrance stagger supports initial scanning; progress animation uses transform rather than layout-changing width animation and is disabled under reduced-motion preferences.

### Feeder Inspector

The selected-feeder inspector is the signature focused surface: authority navy, explicit status badge, tabular voltage/current/uptime readings, a mono feeder code, and paired timeline/proof actions. It is the only major dashboard card allowed to invert to a dark field because it represents the current investigation target.

### Data Tables

Tables use muted headers, low-contrast row dividers, left-aligned labels, tabular numerical values, and quiet row-hover feedback. Compact horizontal bars may support comparisons, but exact values remain visible and the table is always the accessible source of truth.

## Do's and Don'ts

### Do:

- **Do** make measured, inferred, reviewed, and blockchain-confirmed states visually and verbally distinct.
- **Do** preserve the authority-navy shell, verification-blue interaction language, and rare evidence-amber emphasis.
- **Do** use tabular numerals for changing telemetry and pair semantic color with labels or icons.
- **Do** use borders and spacing as the default structure, reserving stronger shadows for focus and action.
- **Do** preserve mobile access to navigation, proof, status, and review actions with touchable targets and contained data overflow.
- **Do** communicate loading, missing, stale, demo, fallback, and error states directly.

### Don't:

- **Don't** use glossy consumer-fintech gradients, glass effects, decorative chart chrome, or animation that competes with evidence.
- **Don't** use evidence amber as a generic accent or green/red as the product's navigation identity.
- **Don't** represent missing telemetry as zero, healthy, or active.
- **Don't** rely on color alone for outage, reliability, review, or proof status.
- **Don't** add floating cards and heavy shadows indiscriminately; depth must correspond to selection or action.
- **Don't** hide feeder identifiers, timestamps, denominators, or proof state behind ambiguous icons or hover-only interactions.
