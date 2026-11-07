#!/bin/sh
# PreToolUse guard for the Bash tool — the enforcement layer behind the
# prompt-level rules in CLAUDE.md ("agents open PRs only, never push to main").
# Receives the tool call as JSON on stdin; exit 2 blocks the call and feeds
# stderr back to the agent. Success is silent.
#
# Ratchet rules (each traces to a guardrail in CLAUDE.md):
#   1. No force pushes — agents never need them.
#   2. No direct pushes to main — main only moves via the release PR.
#   3. No `git reset --hard` / `git clean -f` while on main or develop.
#   4. No `rm -rf` aimed at /, ~, $HOME, or a parent path (..).

cmd=$(node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{process.stdout.write(JSON.parse(s).tool_input?.command||'')}catch(e){}
})")

[ -z "$cmd" ] && exit 0

block() {
  echo "BLOCKED by .claude/hooks/bash-guard.sh: $1" >&2
  exit 2
}

# 1. Force pushes (any variant, incl. --force-with-lease)
echo "$cmd" | grep -qE 'git[^|;&]*push[^|;&]*( --force| -f\b|--force-with-lease)' \
  && block "force push. Agents never force-push; rework the branch instead."

# 2. Direct pushes to main
echo "$cmd" | grep -qE 'git[^|;&]*push[^|;&]+(origin[[:space:]]+main\b|[^ ]+:main\b)' \
  && block "push to main. Work lands on develop via PR; main only moves via the release PR."

# 3. Destructive resets on protected branches
if echo "$cmd" | grep -qE 'git[^|;&]*(reset[^|;&]*--hard|clean[^|;&]* -[a-zA-Z]*f)'; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  case "$branch" in
    main|develop) block "git reset --hard / git clean -f on '$branch'. Switch to a work branch first." ;;
  esac
fi

# 4. rm -rf aimed at /, ~, $HOME, or a parent path
if echo "$cmd" | grep -qE '\brm\b[^|;&]* -[a-zA-Z]*r[a-zA-Z]*f|\brm\b[^|;&]* -[a-zA-Z]*f[a-zA-Z]*r'; then
  echo "$cmd" | grep -qE '\brm\b[^|;&]*[[:space:]](/([[:space:]]|$)|~|\$HOME|\.\.)' \
    && block "rm -rf targeting /, ~, \$HOME, or a parent directory. Use a repo-relative path."
fi

exit 0
