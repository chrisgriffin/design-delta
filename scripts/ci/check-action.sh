#!/usr/bin/env bash
#
# check-action.sh — CI guard over action.yml, exercised against the PUBLISHED
# tarball rather than the source tree.
#
# action.yml's steps never `require` the source tree directly — they shell
# out to `npx design-delta`, exactly like a consumer's own CI
# job would after installing the package. Running those same commands
# straight out of `src/` would prove nothing about whether the tarball a
# consumer actually installs behaves the same way (the same gap
# check-package.sh closes for the CLI itself — see its header).
#
# So: pack the package as the release would, install it into a throwaway
# consumer project (no registry auth — the same npx invocation an installed
# package resolves locally, without a network fetch), and run the two
# commands action.yml's steps run against it.
#
# The command surface below is CHECKED against action.yml rather than merely
# restated: a renamed input or a changed flag over there fails this guard
# instead of leaving it green against a stale copy.
#
# Runnable locally, same as in CI: bash scripts/ci/check-action.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# The commands this script exercises. Kept in sync with action.yml by the
# derivation checks immediately below, not by hand.
REPORT_CMD=(report --format sarif --config design-delta.json --out drift-report.sarif)
VERIFY_CMD=(verify --config design-delta.json --fail-on error)

echo "==> Deriving action.yml's surface and checking this script covers it"

# 1. Every input the steps reference is one the action declares. Miss this and
#    a renamed input silently resolves to the empty string at run time — the
#    flag it feeds just disappears, with no error anywhere.
DECLARED_INPUTS="$(sed -n '/^inputs:/,/^runs:/p' action.yml |
  grep -oE '^  [a-z0-9-]+:' | tr -d ' :' | sort -u)"
REFERENCED_INPUTS="$(sed -n '/^runs:/,$p' action.yml |
  grep -oE 'inputs\.[a-z0-9-]+' | sed 's/^inputs\.//' | sort -u)"
for input in $REFERENCED_INPUTS; do
  if ! printf '%s\n' "$DECLARED_INPUTS" | grep -qx "$input"; then
    echo "::error::action.yml references \`inputs.$input\`, which it does not declare" >&2
    exit 1
  fi
done
echo "OK    every referenced input is declared"

# 2. Every subcommand and flag action.yml's steps assemble is one this script
#    actually runs. Values interpolated from inputs ("$CONFIG_PATH") are
#    skipped — this checks the CLI surface, which is what a released action
#    can get wrong without any test noticing.
ACTION_TOKENS="$(grep -oE '^[[:space:]]*args\+?=\(.*' action.yml |
  sed -E 's/.*\(//; s/\)$//' | tr ' ' '\n' |
  grep -E '^(--[a-z-]+|[a-z]+)$' | sort -u)"
EXERCISED=" ${REPORT_CMD[*]} ${VERIFY_CMD[*]} "
for token in $ACTION_TOKENS; do
  case "$EXERCISED" in
  *" $token "*) ;;
  *)
    echo "::error::action.yml runs \`$token\`, which check-action.sh does not exercise" >&2
    echo "::error::update REPORT_CMD/VERIFY_CMD in this script to match action.yml" >&2
    exit 1
    ;;
  esac
done
echo "OK    every subcommand and flag action.yml runs is exercised below"

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
cat >package.json <<'JSON'
{ "name": "design-delta-action-check", "private": true, "type": "module" }
JSON
npm install "$TARBALL" --no-audit --no-fund --loglevel=error

# `{}` is a valid, vacuous config (validateConfig's own docs: no field is
# required) — a stand-in for a consumer with no contracts authored yet.
# Vacuous is exactly the case a smoke test should not choke on.
echo '{}' >design-delta.json

echo "==> design-delta ${REPORT_CMD[*]} (action.yml's sarif: \"true\" step)"
npx --yes design-delta "${REPORT_CMD[@]}"
if [ ! -f drift-report.sarif ]; then
  echo "::error::report --format sarif did not write drift-report.sarif" >&2
  exit 1
fi
if ! grep -q '"version": "2.1.0"' drift-report.sarif; then
  echo "::error::drift-report.sarif does not look like a SARIF 2.1.0 log" >&2
  cat drift-report.sarif >&2
  exit 1
fi
echo "OK    drift-report.sarif written"

echo "==> design-delta ${VERIFY_CMD[*]} (action.yml's verify step)"
if ! npx --yes design-delta "${VERIFY_CMD[@]}"; then
  echo "::error::verify exited non-zero against a vacuous config" >&2
  exit 1
fi
echo "OK    verify passed"

echo
echo "Action integrity checks passed — the commands action.yml runs work"
echo "against the published tarball."
