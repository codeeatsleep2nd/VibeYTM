# VibeYTM 2.0 — Design System

The v2.0 design system is **canonically defined in Swift** at:

> [`app/Packages/PlayerCore/Sources/PlayerCore/DesignTokens.swift`](app/Packages/PlayerCore/Sources/PlayerCore/DesignTokens.swift)

That file mirrors the OKLCH-based design tokens originally documented in
[`v1/DESIGN.md`](v1/DESIGN.md). When the SwiftUI build draws anything, it
reads from `DesignTokens.Color.*`, `DesignTokens.Space.*`, etc., not from
hardcoded values.

## Why no separate DESIGN.md at root

In v1.x, `DESIGN.md` was the source of truth — a long markdown spec with
embedded CSS variables (`--color-surface-1`, etc.) that the React UI
consumed as CSS custom properties. SwiftUI can't read CSS variables, so
the canonical definitions had to move into Swift.

The v1.x DESIGN.md (which has substantially more context: full visual
language description, Apple Music inspiration notes, layout anatomy
diagrams, key views table) is preserved at [`v1/DESIGN.md`](v1/DESIGN.md)
and is still the canonical reference for visual *style*. The Swift file is
just the runtime *values*.

## The split

| Concern | Source of truth |
|---|---|
| Color hex / OKLCH values | `app/Packages/PlayerCore/Sources/PlayerCore/DesignTokens.swift` |
| Spacing scale | Same file (`DesignTokens.Space.*`) |
| Typography scale + font choice | Same file (`DesignTokens.Typography.*`) |
| Layout breakpoints (min window, sidebar widths) | Same file (`DesignTokens.Layout.*`) |
| Liquid Glass treatment rationale | `v1/DESIGN.md` section "Visual Language" |
| Apple Music inspiration / mood | `v1/DESIGN.md` section "UI Design — Apple Music Style" |
| Per-surface visual decisions (DJ Copilot, widgets, sheet states) | `docs/design/dongli-SwiftUI-design.md` "Design Decisions" section |
| Bridge-side layout invariants (rounded corner, sidebar inset, etc.) | `app/SWIFTUI_CHECKLIST.md` |

## Rule when changing a design token

1. Update `DesignTokens.swift` first (this is what ships).
2. If the change is **substantial** (new color family, new spacing unit,
   rethinking typography), also update `v1/DESIGN.md` so the visual
   rationale stays current. v1/DESIGN.md is otherwise frozen as Tauri-era
   reference.
3. If the change touches a specific NEW v2.0 surface (Vibe sheet, widget,
   Control Center tile), document the decision in
   `docs/design/dongli-SwiftUI-design.md` under "Design Decisions
   (from /plan-design-review)".

## See also

- [`docs/design/README.md`](docs/design/README.md) — full v2.0 planning
  trail (`/office-hours` → `/plan-eng-review` → `/plan-design-review`)
- [`docs/design/dongli-SwiftUI-design.md`](docs/design/dongli-SwiftUI-design.md) —
  every architectural + design decision with rationale
- [`v1/DESIGN.md`](v1/DESIGN.md) — original visual language spec (Apple
  Music inspiration, Liquid Glass treatment, layout anatomy)
