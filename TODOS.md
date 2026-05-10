# TODOS

Design and a11y debt surfaced by `/plan-design-review` on 2026-05-09 against
the bug-bash-3 branch. The blocking items shipped in 1.3.2; what's listed
here was explicitly deferred. Each entry: what, why it matters, the concrete
exit criteria, and the rough cost.

## Keyboard navigation audit on the cards grid

**What:** Add a roving-tabindex pattern to Home / Explore / Library card
grids so Tab moves between sections (not into every card), and arrow keys
move between cards within the active section. Today every card is its own
tab stop — pressing Tab from the H1 walks through 30+ cards before reaching
the player chrome.

**Why:** Power users and keyboard-only users currently have to Tab past the
entire grid to reach Settings or the player. The behavior is invisible until
someone tries it (and reports it as "the keyboard is broken").

**Exit criteria:** From the sidebar, Tab lands once on each section's first
card. Arrow keys (← → ↑ ↓) move within the section's grid. Enter activates.
Verified on Home, Explore, Library/Albums, Library/Playlists. Locked in by
a Vitest contract test using `userEvent.tab()` + `userEvent.keyboard('{ArrowRight}')`.

**Cost:** ~2-3 hours. Touches `AlbumCard.tsx`, `SongRow.tsx`, and the page
container that owns the grid in each location. Use a custom
`useRovingFocus(refs)` hook instead of duplicating logic.

---

## Contrast measurement on glass-over-gradient surfaces

**What:** Render the app at default size, sample the actual rendered RGB
under each text token's location (player chrome over album-art-tinted
gradient, sidebar over violet-tint zone, card label over red-tint zone),
and verify ≥ 4.5:1 against the foreground token. Today contrast is computed
against tokens, not against rendered pixels — the ambient gradient + glass
opacity can drop effective contrast below AA in worst-case zones.

**Why:** The lift token discipline is good but the effective contrast on
glass surfaces is a function of (token, glass opacity, current ambient
hue). It can pass on one frame and fail two seconds later when a track
change rotates the accent. Real users with low-vision settings will hit
the failing zones first.

**Exit criteria:** Captured screenshots at 1200×800 for Home (no track),
Home (red-tinted track), Now Playing, Lyrics overlay, Queue panel, Settings.
Sampled and tabulated rendered contrast for every visible text token. Any
ratio below 4.5:1 raised to AA either by bumping `--color-text-secondary`
lightness or by darkening the relevant glass tier. Documented in DESIGN.md
under a new "Contrast budget" subsection.

**Cost:** ~3-4 hours. Use `mcp__chrome-devtools__evaluate_script` against
`document.elementFromPoint` + `getComputedStyle` to sample without leaving
the editor. The fix-tighten loop is tighter when you can measure.

---

## "Audio engine stuck" UX during 3-15 s YTM hangs

**What:** When the YTM bridge stops emitting `player:position` for >2.5 s
mid-playback (track-change webview-navigation in flight), surface a
non-modal banner: "Reconnecting to audio engine…" with a soft spinner.
Auto-dismiss when ticks resume. If the stall exceeds 20 s, escalate to
"Audio engine unresponsive — restart?" with a single-button restart.

**Why:** CLAUDE.md documents the 3-15 s hang as expected. Today the user
sees the play button still highlighted while the time freezes — they
report this as a crash and force-quit. A 600-byte banner converts the
exact same backend behavior from "broken app" to "system is doing
something."

**Exit criteria:** Reproducible by injecting a 4 s sleep into the bridge
after a track change. Banner appears within 2.5 s, dismisses within
500 ms of the next tick. Vitest test mocks `usePlayerState` with a
position that doesn't advance and asserts the banner appears. CLAUDE.md
gets a "Stall affordance" entry under WKWebView quirks.

**Cost:** ~2 hours. New component `AudioEngineStallBanner.tsx`, a hook
`useStallDetection({ ticks, thresholdMs })`, and one Rust IPC for the
"restart audio engine" path that already exists internally.

---

## Search empty state on first-ever visit (no recent searches)

**What:** When the user opens Search for the first time and has no recent-
search history, show a curated empty state: "Search for songs, albums,
artists, podcasts" + a row of trending-search chips (pulled from YTM's
`searchSuggestions` with an empty seed if YTM supports it, or a hard-coded
genre row if not).

**Why:** Today an empty Search page is just the search input on a black
background. The user types nothing, gets nothing, leaves. A first-visit
prompt gives them a second-or-zero start.

**Exit criteria:** First-launch (or after a "Clear recent searches"
action) shows a prompt + at least 6 trending/genre chips. Clicking a chip
populates the search box and runs the query. Vitest test asserts the
prompt renders when `recentSearches === []`.

**Cost:** ~1-2 hours. Mostly UI work in `SearchPage`; chip logic is a
local array if YTM trending isn't available without auth.

---

## `--text-3xl` (40 px) hero token

**What:** Add `--text-3xl: 2.5rem` (40px) to `tokens.css` and use it on
Album Detail / Playlist Detail / Artist Detail H1s, where today the title
is set inline at "ALBUM 28px Bold" by `DetailPageHero` and reads small
relative to the cover.

**Why:** Detail pages today have a visually quiet H1 next to a massive
cover. Apple Music's detail-page title is the second loudest thing on
the screen after the cover; ours is barely the third.

**Exit criteria:** Token added to `tokens.css` documented in DESIGN.md.
`DetailPageHero` consumes the new token. Visual screenshot at 1200×800
shows the title clearly anchoring the right column. Tests pass.

**Cost:** ~30 min. One-token, one-component.

---

## A11y skip-to-content link

**What:** Add an off-screen, focus-visible "Skip to main content" link
as the first focusable element in the sidebar so keyboard users can jump
past the 9 nav items to the page content.

**Why:** Standard pattern; we don't have it; pure win for keyboard users.

**Exit criteria:** Tab from a fresh window focuses "Skip to content"
first, visibly outlined. Activation moves focus to `<main>`'s first
focusable child. Vitest test using `userEvent.tab()` asserts the link
exists and its target is reachable.

**Cost:** ~30 min.
