# VibeYTM v1.x — Tauri + React (archived)

This folder contains the **original Tauri 2.x + React 19 + Rust** implementation of
VibeYTM, last shipped as **v1.5.0**. It has been archived in place during the
SwiftUI rewrite (v2.0) so the code stays grep-able, runnable, and reference-able
without polluting the active codebase.

For the **current** (v2.0) SwiftUI implementation, see [`../app/`](../app/) and
[`../README.md`](../README.md).

## Status: archived but functional

This build still works — `pnpm install && pnpm tauri dev` from inside `v1/`
launches the v1.x app. Use it when:

- You want to compare a v2.0 behavior against the shipped v1.x baseline.
- You're investigating a regression and want to verify the v1.x version did
  (or didn't) have the same behavior.
- You're porting a v1.x feature you haven't yet ported to SwiftUI.

## Running the v1.x build

```bash
cd v1
pnpm install
pnpm tauri dev          # development mode (Vite HMR)
pnpm tauri build        # production .dmg at v1/src-tauri/target/release/bundle/
```

Requirements:
- Node 20+
- pnpm
- Rust (rustup)

## Why archived, not deleted

1. **History reference**: the v1.x build has ~30 documented WKWebView quirks in
   `v1/CLAUDE.md` that produced real defects fixed over many cycles. The fixes
   are in git, but the *context* lives in the codebase.
2. **Bridge invariants**: the SwiftUI port's `YTMBridge` re-implements the same
   audio-engine quirks. When YTM ships a breaking change to its bridge surface,
   diff-ing against v1's `scripts/inject/ytm-player-bridge.js` is faster than
   re-deriving the fix from scratch.
3. **Tauri's hidden-WebView audio engine is permanent in v2.0 too** (per
   `../app/Packages/YTMBridge/Sources/YTMBridge/BridgeHost.swift`), so the
   Innertube parsing and bridge-message contracts in v1 are still load-bearing.
4. **Visual reference**: `v1/DESIGN.md` documents the Apple Music-style design
   system that v2.0 inherits. The OKLCH tokens, spacing scale, and typography
   choices are all preserved in `../app/Packages/PlayerCore/Sources/PlayerCore/DesignTokens.swift`.

## When this folder can be deleted

Once **all** of the following are true, you can `git rm -rf v1/`:

- [ ] v2.0 has been the only build shipped in 2+ stable releases.
- [ ] All v1.x users have migrated (no outstanding bug reports against v1.x).
- [ ] The v2.0 codebase has independent regression tests for every quirk that
      `v1/CLAUDE.md` documents (the bridge-side ones — SeekFilter,
      VolumeSettle, TrackChangeGuard, etc. are already ported).
- [ ] You're sure you don't want the reference anymore.

Git history will still have everything if you ever need it
(`git log -- v1/`, `git checkout SHA -- v1/`).

## Layout

```
v1/
├── README.md                  This file
├── CLAUDE.md                  Tauri-era AI assistance notes (WKWebView quirks etc.)
├── DESIGN.md                  Apple Music-style design system spec (still the source of truth for visual tokens)
├── BUILD_PROMPT.md            Full Tauri build specification (could rebuild v1.x from scratch)
├── RESEARCH.md                Research notes from the original implementation
├── TEST_CHECKLIST.md          v1.x WKWebView regression checklist
├── package.json + pnpm-lock   Node deps
├── tsconfig.json + .node.json TypeScript config
├── vite.config.ts             Vite build
├── vitest.config.ts           Unit test runner
├── index.html                 Vite HTML entry
├── src/                       React UI (TypeScript) — ~92 files
├── src-tauri/                 Rust backend + Tauri config — ~34 files
├── scripts/                   inject/ytm-player-bridge.js + helpers
└── public/                    Static assets
```
