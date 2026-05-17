#!/usr/bin/env bash
# Fail CI if a `#[cfg(not(debug_assertions))]` block in Rust contains
# anything beyond a single attributed-item or a tagged opt-out.
#
# The hazard: a release-only branch silently diverges from its dev
# counterpart, and the bug only surfaces in shipped DMGs. We've eaten
# that pain once (the poller's bridge_just_loaded loop emitted
# `player:position = 0` every 150 ms in release — invisible in `pnpm
# tauri dev`). The rule: `cfg(debug_assertions)` may only gate
# diagnostics (logging, asserts), never an alternative implementation
# that contributes to state or side effects.
#
# Allow opt-out with a `// LINT:cfg-debug-assertions-ok` comment on the
# line immediately preceding the `#[cfg(...)]` attribute, when the
# branch is genuinely intentional (e.g. a Windows platform attribute).
#
# Usage (from repo root):
#   bash scripts/check-cfg-debug-assertions.sh
# Exit codes:
#   0 — all matches are either single-line attributed items or
#       explicitly opt-out
#   1 — at least one match is a multi-line block without opt-out
#
# Intentionally a tiny grep — full Rust AST parsing isn't worth the
# dependency surface for this one rule.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Build a list of (file, line) for every cfg(... debug_assertions ...)
# attribute. We DON'T flag `cfg_attr(...)` because those apply a single
# attribute (like Windows subsystem) and can't house a divergent block.
matches=$(grep -rn '#\[cfg([^)]*debug_assertions[^)]*)\]' src-tauri/src --include='*.rs' || true)

if [ -z "$matches" ]; then
  echo "ok: no #[cfg(...debug_assertions...)] gates in src-tauri/src"
  exit 0
fi

violations=0
while IFS=: read -r file line _; do
  next=$((line + 1))
  next_line=$(sed -n "${next}p" "$file")
  prev=$((line - 1))
  prev_line=$(sed -n "${prev}p" "$file")

  # Allow if explicitly opted out on the preceding line.
  if echo "$prev_line" | grep -q 'LINT:cfg-debug-assertions-ok'; then
    continue
  fi

  # Allow if the next line is a SINGLE statement / attributed item
  # (i.e. doesn't open a multi-line `{ ... }` block). Heuristic: the
  # line doesn't end with `{` and isn't itself an `if` / `match` that
  # spans multiple lines.
  trimmed=$(echo "$next_line" | sed 's/[[:space:]]*$//')
  if [[ "$trimmed" != *"{" && "$trimmed" != *"if "* && "$trimmed" != *"match "* ]]; then
    continue
  fi

  echo "VIOLATION: $file:$line"
  echo "  $next_line"
  echo "  -- multi-line cfg(debug_assertions) block. Either:"
  echo "     (a) refactor to share logic with the matching dev branch,"
  echo "         keeping only a logging side effect under the gate, or"
  echo "     (b) add '// LINT:cfg-debug-assertions-ok' on the line above"
  echo "         with a 1-line justification."
  violations=$((violations + 1))
done <<<"$matches"

if [ "$violations" -gt 0 ]; then
  echo
  echo "found $violations cfg(debug_assertions) violation(s) — see above"
  exit 1
fi

echo "ok: all #[cfg(...debug_assertions...)] gates are single-line or opt-out"
