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
  verdict-oracle: "#52525b"
  dark-surface: "#18181b"
  dark-active-surface: "#f4f4f5"
  dark-active-text: "#18181b"
  dark-text: "#f4f4f5"
  dark-muted: "#d4d4d8"
  dark-border: "#27272a"
  dark-control-border: "#3f3f46"
  dark-verdict-match: "#4ade80"
  dark-verdict-unexplained: "#f87171"
  dark-verdict-explained: "#60a5fa"
  dark-verdict-incomplete: "#fbbf24"
  dark-verdict-oracle: "#d4d4d8"
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
  count:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.1
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
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
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

A change to a rule, a token set or a path in this file is Tier 3. A record of an approved decision is Tier 1 (`docs/vision.md`, Design authority, rule 6). The owner approves the Tier 3 changes (see #151).

Decisions D1 to D15 of #153 are recorded below. The owner accepted the recommended option of each on 2026-10-20, as the choice sheet showed it (the option text and its preview are the decision).

Status: design authority for the viewer redesign (issue #148). The specification (R10.3 to R10.5, R10.10, R10.13 to R10.15) adopts it. It is not yet the state of `frontend/`: the viewer work follows in #148. The specification wins when this file and a requirement disagree. The current badge colors in `frontend/src/style.css` differ from the verdict colors below.

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
- **Verdict incomplete (amber):** `#b45309`. In dark, `#fbbf24`. Incomplete is a measurement state (R8.12), shown beside the class, never as a class.
- **Oracle and unclassified (neutral):** the muted text color with the word. An oracle target (R8.12) is not a pass or a fail. An unclassified target has no class because evidence is missing. Neither gets a verdict color.

Counts: a count above zero uses its verdict color (an oracle count uses the muted text color). A count of zero uses the muted text color. The classes show first (match, explained, unexplained, and oracle only when above zero). A rule separates the measurement state. Incomplete is a separate count beside it, labelled as a state, never as a class.

Rule: a verdict color appears on a dot, a count or a word. It never fills a whole row or a selected state. A selected row uses the neutral active surface.

## Typography

One system sans for text. One system mono for records: identifiers, times, paths and hashes.

- **Title** 1.875rem, 600. One per page.
- **Count** 1.875rem, 600, line height 1.1. The number of a verdict count. A page shows several.
- **Heading** 1.125rem, 600.
- **Body** 0.9375rem, 400. Line length stays under 75 characters.
- **Label** 0.8125rem, 500. Table headers and small captions.
- **Record** 0.75rem mono. Text smaller than 0.75rem is not used.

## Layout

A single content column, 1040px maximum, centered. The home and the report use the same header and the same column. There is no permanent side panel on the home. On a report, the page offers four views as tabs. The target list is a panel inside the Evidence view only.

Items in a row wrap by the width of their content. There is no breakpoint rule. Every flex or grid child that holds text has `min-width: 0`. The page never scrolls sideways. Wide tables scroll inside their own box.

## Elevation & Depth

Flat. Depth comes from a 1px border and a toolbar tint. No shadows. An overlay or a drawer uses a border and the surface color.

## Shapes

Panels use the contract radius 0.25rem. Pills (segmented control, chips) use the full radius. A verdict dot is a circle. No side-stripe borders on cards or rows.

## Components

- **Button primary:** active surface fill, active text, height 2rem, radius panel. On a coarse pointer the hit area is 2.75rem (44px). The visible size stays.
- **Touch size:** on a coarse pointer every control takes a 2.75rem (44px) tap area on both axes (`control-touch`). A button, a tab, a summary and a link keep their visible size and take a transparent hit area. A form field (select, text input, range) is at least 2.75rem tall, because a field cannot take a transparent hit area. The owner set this rule on 2026-10-23 (#194).
- **Button secondary:** surface fill, a 1px control border, text color, the same height and radius as primary. Use it for an action next to a primary one.
- **Link:** the text color with an underline on hover. In running text it is always underlined. A text action (such as "More filters") is an underlined link.
- **Segmented control:** the selected segment uses the active surface.
- **View state and filters:** viewport, evidence type and mode are view state. Show them in a group labelled "View". A filter narrows the list (All, Unexplained, Match, and "More filters"). Show it in a group labelled "Filter". A view has one filter set. The control for the artifact is labelled "Evidence type". The deep link keeps the part name `artifact`. Modes are Side by side, Overlay and Difference.
- **Verdict count:** a number, a word and a color. Counts stay visible under every filter.
- **Verdict wording:** a run has a sentence derived from the classes ("Nothing changed", "1 page differs"). A row, a cell and a finding use the class word (match, unexplained).
- **Comparison row:** a verdict dot, a local time, a verdict word, a short detail, the change against the previous row, and a short identifier in mono, after the word "update" when the kind is shown. A whole row is a link. On hover it takes the toolbar tint. In dark, it also lightens its border from `#27272a` to the dark control border `#3f3f46` (the contract value). It does not underline and changes no opacity.
- **Latest comparison card:** the first element of the Home. It shows the verdict sentence, the time, the verdict counts and an "Open comparison" button.
- **Verdict history strip:** one dot for each comparison, oldest on the left, each with a time and a class word under it.
- **Small heading:** the label style (0.8125rem, 500, muted). It carries a caption such as "Latest comparison". Identifiers inside it use the record style.
- **Page counter:** "n of N" in the record style, between the older and newer links.
- **Settings hash line:** shown on a row only when the hash differs from the previous row.
- **Placeholder frame:** a dashed 1px border for an image that is not loaded.
- **Page background:** the toolbar color.
- **Theme toggle:** a text button at the right of the header: "Dark theme" or "Light theme".
- **Breadcrumb:** the way back is always the first element in the content column.
- **Tabs:** real buttons with `role="tab"`. The selected tab has a 3px bottom border in the active surface color and bold text. The tab never changes by itself. If the app opens a tab for the person, it says why.
- **Disclosure:** for measurement context, capture details and help. Closed by default. The A and B run cards stay open.

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
