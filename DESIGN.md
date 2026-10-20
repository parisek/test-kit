---
name: test kit viewer
description: A calm laboratory notebook for measured differences between two sides of a site.
colors:
  surface: "#ffffff"
  toolbar: "#fafafa"
  text: "#18181b"
  muted: "#52525b"
  border: "#e4e4e7"
  control-border: "#d4d4d8"
  active-surface: "#18181b"
  active-text: "#ffffff"
  focus: "#dc2626"
  verdict-match: "#15803d"
  verdict-unexplained: "#b91c1c"
  verdict-explained: "#1d4ed8"
  verdict-incomplete: "#b45309"
  dark-surface: "#18181b"
  dark-active-surface: "#f4f4f5"
  dark-active-text: "#18181b"
  dark-text: "#f4f4f5"
  dark-muted: "#d4d4d8"
  dark-border: "#27272a"
  dark-verdict-match: "#4ade80"
  dark-verdict-unexplained: "#f87171"
  dark-verdict-explained: "#60a5fa"
  dark-verdict-incomplete: "#fbbf24"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
  heading:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  record:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  panel: "0.25rem"
  pill: "9999px"
spacing:
  control: "2rem"
  control-touch: "2.75rem"
  toolbar: "57px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.active-surface}"
    textColor: "{colors.active-text}"
    rounded: "{rounded.panel}"
    height: "{spacing.control}"
    padding: "0 16px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "{spacing.lg}"
---

# Design System: test kit viewer

Tier 3 by the owner's rule of 2026-10-20 (see #151): the owner approves a change to this file.

Status: target design for the viewer redesign (issue #148). It is not the current state of `frontend/`. It supersedes R10.3 (collapsible left column), R10.4 (the list of views) and R10.5 (the first view by pair kind) only after the owner approves a specification change. Until then the specification wins. The current badge colors in `frontend/src/style.css` differ from the verdict colors below.

## Overview

**Creative North Star: "The Laboratory Notebook"**

The viewer is a careful record of measurements. Each entry has a time and a short identifier. The page states what was measured, what was not, and what the person may decide. It adds no decoration. It does not hide a gap behind a color.

The system keeps the shared UI token contract of the styleguide (`frontend/ui-contract`, version 0.1.0): zinc neutrals, the system font, a red focus ring and a `dark` class. The viewer adds to the contract: verdict colors, a touch size of 2.75rem and a type scale. In dark, the active surface is `#f4f4f5` and the active text `#18181b`, as the contract defines.

**Key characteristics:**
- Medium density. A row holds one finding or one comparison.
- Time is a first-class element: every record shows a local time. The ISO time stays in a `title`.
- A verdict is always a word plus a dot. Color never carries the verdict alone.
- Flat surfaces. Borders separate, shadows do not.

## Colors

Neutrals come from the contract, so the viewer matches the other tools. The four verdict colors are the only addition. Each pair passes WCAG AA on its surface (4.5:1 for text).

- **Surface, toolbar, text, muted, border:** the contract values, light and dark.
- **Focus red `#dc2626`:** the focus ring only. Never use it for a verdict.
- **Verdict match (green):** `#15803d`. Light surface. In dark, `#4ade80`.
- **Verdict unexplained (red):** `#b91c1c`. In dark, `#f87171`. This is the only red that signals a problem.
- **Verdict explained (blue):** `#1d4ed8`. In dark, `#60a5fa`.
- **Verdict incomplete (amber):** `#b45309`. In dark, `#fbbf24`.

Rule: a verdict color appears on a dot, a count or a word. It never fills a whole row or a selected state. A selected row uses the neutral active surface.

## Typography

One system sans for text. One system mono for records: identifiers, times, paths and hashes.

- **Title** 1.875rem, 600. One per page.
- **Heading** 1.125rem, 600.
- **Body** 0.9375rem, 400. Line length stays under 75 characters.
- **Label** 0.8125rem, 500. Table headers and small captions.
- **Record** 0.75rem mono. Text smaller than 0.75rem is not used.

## Layout

A single content column, 1040px maximum, centered. The home and the report use the same header and the same column. There is no permanent side panel on the home. On a report, the page offers four views as tabs. The target list is a panel inside the Evidence view only.

A row wraps below 640px. Every flex or grid child that holds text has `min-width: 0`. The page never scrolls sideways. Wide tables scroll inside their own box.

## Elevation & Depth

Flat. Depth comes from a 1px border and a toolbar tint. No shadows. An overlay or a drawer uses a border and the surface color.

## Shapes

Panels use the contract radius 0.25rem. Pills (segmented control, chips) use the full radius. A verdict dot is a circle. No side-stripe borders on cards or rows.

## Components

- **Button primary:** active surface fill, active text, height 2rem, radius panel. On a coarse pointer the hit area is 2.75rem (44px). The visible size stays.
- **Link:** the text color with an underline on hover. In running text it is always underlined.
- **Segmented control:** one filter set per view. The selected segment uses the active surface.
- **Verdict count:** a number, a word and a color. Counts stay visible under every filter.
- **Comparison row:** a verdict dot, a local time, a verdict word, a short detail, the change against the previous row, and a short identifier in mono.
- **Breadcrumb:** the way back is always the first element in the content column.
- **Tabs:** real buttons with `role="tab"`. The tab never changes by itself. If the app opens a tab for the person, it says why.
- **Disclosure:** for measurement context, capture details and help. Closed by default.

## Do's and Don'ts

**Do**
- Show the time of every record in local time and keep the ISO time in a `title`.
- Put the verdict in words first, the numbers second.
- Keep a deep link for every finding, with its view state.
- State what was not measured. Show `null` as "not measured", never as 0.

**Don't**
- Don't use red for anything but "unexplained" and the focus ring.
- Don't show the same filter twice or with two different words.
- Don't ask for a file name or a URL when the app already knows the report.
- Don't use a side-stripe border, a gradient or a shadow.
- Don't change the active tab without telling the person.
