#!/usr/bin/env bash
#
# check-package.sh — CI guard over the PUBLISHED artifact.
#
# `npm test` proves the engine works from a repo checkout. It proves nothing
# about the tarball: this package ships `files: ["src","schema","docs","skills"]` and
# one `bin` entry, and a consumer only ever sees what
# `npm pack` put in the tarball. Drop a path from `files`, rename a file a
# `bin` points at, or break the `exports` entry, and the suite stays green
# while every consumer's `npm ci` installs something broken — surfacing one
# repo away, at their next audit run, as a confusing ENOENT.
#
# So: pack the package exactly as the release would, install THAT tarball into
# a throwaway project, and exercise it the way a consumer does.
#   1. every `bin` target resolves inside the installed package
#   2. every `bin` target is executable by node (shebang + parses as ESM)
#   3. the `exports` entry imports and yields the public API
#   4. the CLI actually runs
#
# Runnable locally, same as in CI: bash scripts/ci/check-package.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Packing the package as the release would"
npm pack --pack-destination "$WORK" >/dev/null
TARBALL="$(find "$WORK" -maxdepth 1 -name '*.tgz' -print -quit)"
if [ -z "$TARBALL" ]; then
  echo "::error::npm pack produced no tarball" >&2
  exit 1
fi
echo "    $(basename "$TARBALL")"

echo "==> Installing the tarball into a throwaway consumer project"
mkdir -p "$WORK/consumer"
cd "$WORK/consumer"
# A bare private project — no registry auth, mirroring a consumer that has
# already resolved design-delta and is installing it for real.
cat > package.json <<'JSON'
{ "name": "design-delta-package-check", "private": true, "type": "module" }
JSON
npm install "$TARBALL" --no-audit --no-fund --loglevel=error

PKG_DIR="node_modules/design-delta"
if [ ! -d "$PKG_DIR" ]; then
  echo "::error::the tarball did not install to $PKG_DIR" >&2
  exit 1
fi

echo "==> Verifying every bin resolves, has a shebang, and parses"
node --input-type=module -e '
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const pkgDir = "node_modules/design-delta"
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))
const bins = Object.entries(pkg.bin ?? {})

if (bins.length === 0) {
  console.error("FAIL  the installed package declares no bins")
  process.exit(1)
}

let failed = 0
for (const [name, rel] of bins) {
  const abs = join(pkgDir, rel)
  if (!existsSync(abs)) {
    console.error(`FAIL  ${name} -> ${rel} is missing from the tarball (check package.json "files")`)
    failed++
    continue
  }
  if (!readFileSync(abs, "utf8").startsWith("#!")) {
    console.error(`FAIL  ${name} -> ${rel} has no shebang; npm will link it unexecutable`)
    failed++
    continue
  }
  // Syntax-only; does not execute the module (so no side effects, and a bin
  // that needs args or a config still passes). Catches a truncated or
  // half-published file, which existence alone would not.
  try {
    execFileSync(process.execPath, ["--check", abs], { stdio: "pipe" })
  } catch (err) {
    console.error(`FAIL  ${name} -> ${rel} is not valid ESM — ${String(err.stderr ?? err).trim().split("\n")[0]}`)
    failed++
    continue
  }
  console.log(`OK    ${name} -> ${rel}`)
}
process.exit(failed ? 1 : 0)
'

echo "==> Verifying the package entry imports"
node --input-type=module -e '
const mod = await import("design-delta")
const names = Object.keys(mod)
if (names.length === 0) {
  console.error("FAIL  the exports entry resolved but exported nothing")
  process.exit(1)
}
console.log(`OK    exports entry imports (${names.length} exports)`)
'

echo "==> Verifying the CLI runs"
# `design-delta` with no subcommand prints usage and exits non-zero; asking for
# help is the run that should succeed. Capture rather than stream: we only care
# that it exits 0 and says something.
if ! OUT="$(node "$PKG_DIR/src/cli/main.mjs" --help 2>&1)"; then
  echo "::error::design-delta --help exited non-zero" >&2
  echo "$OUT" >&2
  exit 1
fi
if ! grep -q "Usage:" <<<"$OUT"; then
  echo "::error::design-delta --help produced no usage output" >&2
  echo "$OUT" >&2
  exit 1
fi
echo "OK    design-delta --help"

echo
echo "Package integrity checks passed — the tarball a consumer installs works."

echo "==> Verifying the packaged skills"
# The skills are the consumer-facing instruction set (#335): a consumer's stub
# links to one by path, so dropping `skills` from `files` — or breaking one of
# a skill's own relative doc links — strands every consumer silently. Every
# skill under skills/ is checked, not a named list, so a skill added later is
# guarded the day it ships rather than the day someone remembers to add it.
CANONICAL="$PKG_DIR/skills/design-delta/SKILL.md"
if [ ! -f "$CANONICAL" ]; then
  echo "::error::skills/design-delta/SKILL.md missing from the installed package" >&2
  exit 1
fi
FAILED_LINKS=0
SKILL_COUNT=0
for SKILL in "$PKG_DIR"/skills/*/SKILL.md; do
  [ -f "$SKILL" ] || continue
  SKILL_COUNT=$((SKILL_COUNT + 1))
  REL="${SKILL#"$PKG_DIR"/}"
  SKILL_DIR="$(dirname "$SKILL")"
  # A skill with no frontmatter `name:` is not discoverable as a skill at all.
  if ! grep -qE '^name: ' "$SKILL"; then
    echo "::error::$REL has no frontmatter name:" >&2
    FAILED_LINKS=1
  fi
  while IFS= read -r link; do
    if [ ! -e "$SKILL_DIR/$link" ]; then
      echo "::error::$REL links $link, which does not resolve in the installed package" >&2
      FAILED_LINKS=1
    fi
  done < <(grep -oE '\]\([^)#]+\)' "$SKILL" | sed 's/^](//; s/)$//' | grep -Ev '^[a-z]+://')
done
[ "$FAILED_LINKS" -eq 0 ] || exit 1
if [ "$SKILL_COUNT" -eq 0 ]; then
  echo "::error::no skills/*/SKILL.md shipped in the installed package" >&2
  exit 1
fi
echo "OK    $SKILL_COUNT packaged skill(s); every relative link resolves"

echo "==> Verifying \`init\` scaffolds the linked skill stub (#336) against the installed tarball"
# `init --yes` needs no TTY (it skips @clack/prompts on that path), so this
# runs the real installed CLI exactly as a consumer's CI would.
node "$PKG_DIR/src/cli/main.mjs" init --yes >/dev/null
STUB=".claude/skills/design-delta/SKILL.md"
if [ ! -f "$STUB" ]; then
  echo "::error::design-delta init did not write $STUB" >&2
  exit 1
fi
STUB_LINK="node_modules/design-delta/skills/design-delta/SKILL.md"
if ! grep -qF "$STUB_LINK" "$STUB"; then
  echo "::error::$STUB does not link to the packaged canonical skill" >&2
  exit 1
fi
if [ ! -f "$STUB_LINK" ]; then
  echo "::error::$STUB links $STUB_LINK, which does not resolve in the installed package" >&2
  exit 1
fi
echo "OK    init wrote a linked stub that resolves to the packaged canonical skill"

echo "==> Verifying \`init\` never destroys a consumer's own skill at that path"
# `skills/design-delta/` is a name a project may already use for its own
# hand-maintained skill — the guard that keeps `init` off it is the one
# behaviour a consumer cannot recover from if it regresses.
HAND=$'---\nname: design-delta\n---\n\nOur own house rules.\n'
printf '%s' "$HAND" > "$STUB"
node "$PKG_DIR/src/cli/main.mjs" init --yes >/dev/null
if [ "$(cat "$STUB")" != "$(printf '%s' "$HAND")" ]; then
  echo "::error::design-delta init overwrote a consumer-owned $STUB" >&2
  exit 1
fi
echo "OK    init left a consumer-owned stub untouched"
