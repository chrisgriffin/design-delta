#!/bin/sh
# PostToolUse check for Edit/Write — file-scoped back-pressure.
# design-delta stack: ESM JavaScript, prettier (no eslint).
# Success is silent; failures exit 2 so the error text is injected back.

file=$(node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{process.stdout.write(JSON.parse(s).tool_input?.file_path||'')}catch(e){}
})")

[ -z "$file" ] || [ ! -f "$file" ] && exit 0

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

fail() {
  echo "post-edit-check failed for $file:" >&2
  echo "$1" >&2
  exit 2
}

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs)
    out=$(npx prettier --check "$file" 2>&1) || fail "$out
Run: npx prettier --write \"$file\""
    ;;
  *.json)
    out=$(npx prettier --check "$file" 2>&1) || fail "$out
Run: npx prettier --write \"$file\""
    ;;
  *.md|*.mdx)
    out=$(npx prettier --check "$file" 2>&1) || fail "$out
Run: npx prettier --write \"$file\""
    ;;
esac

exit 0
