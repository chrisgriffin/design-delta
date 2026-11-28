# Spec: Test the two `decide` paths that write nothing

## Overview

`design-delta decide` promises two things no test holds it to: Ctrl-C stops
the served page without writing, and a save that would leave the config
invalid writes nothing. Both are in the code today; a regression in either
would pass the suite.

## Requirements

- FR1. A test stops a served `decide` with SIGINT and checks it returns 130
  and leaves the config and decisions file untouched.
- FR2. A test saves answers against a state whose resulting config fails the
  config schema and checks the save is refused with the schema's errors and
  nothing is written.

## Success criteria

- [ ] A served `decide` stopped with SIGINT returns 130 and the config and decisions file are byte-identical to before.
- [ ] A save whose resulting config fails `schema/config.schema.json` returns the errors and writes neither file.
- [ ] **Runnable:** `npx jest __tests__/cli-decide.test.js -t "leaves the project untouched" 2>&1 | grep -q "Tests:.* 2 passed"` exits 0; this work adds those tests (exits 1 on develop, where no test matches and every test is skipped).
- [ ] `npm run verify` exits 0.
