# Spec: `design-delta decide` puts every open decision in front of its owner

## Problem

Most findings are not code's to clear: which side of a disagreement is wrong
is the owner's call. The resolve skill sorts those findings by owner and ends
with a report, and nothing delivers that report. The owner never sees the
questions, so the decisions are never made, and the findings sit in every
audit unanswered.

The package must solve this itself, for any project: no tracker, chat tool or
vendor is assumed, and nothing is posted anywhere.

## Overview

A new subcommand, `design-delta decide`, turns the findings that need a
person into a short list of decisions, and gives the owner a page to answer
them on. Each decision carries a recommended answer and the reason for it.
The answers are written back where the engine and the resolve skill read
them, so an answered decision never comes back as a question.

## User scenarios

1. **Owner answers in the browser.** The owner runs `npx design-delta decide`.
   It prints a local address. The page lists each decision: the rule, what
   the findings say, the entities involved, the options, and the recommended
   option with its reason. The owner picks answers, adds a reason or issue
   link where the answer needs one, and saves. The command writes the answers
   and exits.
2. **An agent hands the owner the page.** At the end of a resolve pass, the
   skill runs `decide` and gives the owner the address (or the written page),
   instead of leaving the remainder in its own report.
3. **No browser in reach (CI, a remote box).** `decide --no-serve` writes the
   page as one self-contained HTML file. Answering on it produces an answers
   file the owner saves; `decide --apply <file>` writes those answers.
4. **The next pass acts on the answers.** The resolve skill reads the
   decisions file, works each "fix the code" answer through the build skill,
   and makes each "change the contract" or "change the design" answer the
   owner recorded.

## Functional requirements

### Decisions

- FR1. `decide` runs `audit` and `lint` the way `report` runs `audit` (same
  checks, same config, no re-assembly) and works over their findings
  together. Findings already under `decided` are not asked again.
- FR2. Every finding is assigned exactly one **pile**: `code`, `contract`,
  `design`, `tokens-config` or `review`, by the table the resolve skill's
  step 3 states today. That table moves into one pure module in `core/`,
  which becomes its only home. The resolve skill points at it, through
  `decide --json`'s `pile` field, instead of restating it. A rule the
  table does not name is placed by a stated default that is never `code`.
- FR3. Findings in the `code` pile are not decisions. The page reports
  their count and says they are the resolve skill's to clear; the JSON lists
  them under `code`, which is what the resolve skill works.
- FR4. The other findings are grouped into one decision per `ruleId` and
  pile. A decision lists every entity it covers. An answer applies to the
  entities the owner leaves selected, which is all of them by default, so a
  group can be split without a second run.
- FR5. Each decision has a stable `id` derived only from its `ruleId`, pile
  and sorted entities, so the same audit yields the same ids.
- FR6. The answer options are `fix-code`, `change-contract`, `change-design`,
  `accept` (correct by design), `waive`, `track` (a known gap, with an
  issue reference) and, for a stale exemption, `remove-exemption`, which
  deletes it from the config. Each decision offers only the options that can clear
  its rule.
- FR7. Every decision carries one **recommended** option and a one-sentence
  reason. These come from a fixed table keyed by `ruleId`, in `core/`, so
  the same findings always get the same recommendation. A test fails when a
  registered rule has no entry, or when an entry recommends an option the
  rule does not offer.
- FR8. `decide --json` prints the decision list (ids, piles, rules,
  severities, entities, messages, options, recommendation and reason), the
  code-pile count and the snapshot age for design-side decisions. It writes
  nothing. Same inputs, same bytes.

### The page

- FR9. The page is one self-contained HTML file: no network request, no
  external script, style or font. It works offline, follows the viewer's
  light or dark preference, and meets basic accessibility (labeled
  controls, keyboard operable, visible focus).
- FR10. The recommended option is preselected and marked as recommended.
  `track` needs an issue reference before it can be saved, and
  `accept`/`waive` ask for a reason. A design-side decision shows when the
  design snapshot was gathered.
- FR11. Decisions the decisions file already answers (FR14) show as
  answered, with the recorded answer, and can be changed.

### Answering

- FR12. By default `decide` serves the page on `127.0.0.1` only, on
  `--port` or a free port, and prints the address. Saving posts the answers
  to that server, which accepts a post only when it carries the per-run
  token embedded in the page. After writing the answers it reports what it
  wrote and exits 0. Ctrl-C exits without writing.
- FR13. `--no-serve` writes the page to the report directory (or `--out`)
  and exits. On that page, saving produces an answers file for the owner to
  keep, and `decide --apply <file>` writes those answers exactly as a served
  save would. An answers file is validated against a schema in `schema/`.
  One naming a decision id the current audit does not produce is refused,
  naming the id, and nothing is written.
- FR14. `accept`, `waive` and `track` answers become `exemptions` entries
  under the rule in `design-delta.json` (or `--config`), as
  `{entity, decision, reason, issue}` objects in the shape the schema already
  defines. Existing keys, their order and `_`-prefixed comment keys are kept.
  The result is validated against `schema/config.schema.json` before it is
  written, and an invalid result writes nothing.
- FR15. `fix-code`, `change-contract` and `change-design` answers are
  written to a decisions file, at a new `paths.decisionsFile` (default
  `.agents/design-delta/decisions.json`), with a schema in `schema/`. Each
  entry records the decision id, rule, entities, answer and the owner's
  note. On each run, an entry whose findings are all gone is reported as
  done and removed.
- FR16. `decide` never edits a contract, a token, a component or a design
  file, and never changes a rule's severity or the config outside
  `exemptions`. `audit`, `lint`, `report` and `verify` stay read-only.

### The resolve skill

- FR17. `skills/design-delta-resolve/SKILL.md` reads the decisions file
  before it sorts. It works `fix-code` entries as code-pile work, and
  makes `change-contract` entries' contract changes, because the owner made
  that call. `change-design` entries go into the report for whoever edits
  the design file. Every other hard limit stands.
- FR18. The skill ends by running `decide` and handing the owner the address
  or the written page, in place of a report the owner has to find.

### Boundaries

- FR19. Nothing in the command, the page or the decisions names a vendor,
  framework or tracker. `__tests__/layering.test.js` keeps passing, and the
  issue reference is free text.

## Success criteria

- [ ] `design-delta decide --json` on a fixture project prints one decision per rule and pile, each with an id, a pile, options and a recommended option with a reason; code-pile findings are never decisions, listed under `code` with their count; two runs print the same bytes.
- [ ] A test fails when a registered rule has no recommendation entry, or when an entry recommends an option its rule does not offer.
- [ ] The resolve skill's pile table lives only in `core/`, and the skill points at `decide --json`'s `pile` instead of restating it.
- [ ] A served `decide` binds to `127.0.0.1` only, rejects a post without the run's token, and on a valid save writes the answers and exits 0.
- [ ] `accept`/`waive`/`track` answers appear as `exemptions` entries in `design-delta.json`, the existing keys and `_` comments unchanged, and the next `audit --json` lists those findings under `decided`.
- [ ] `fix-code`/`change-contract`/`change-design` answers appear in the decisions file. An entry whose findings are gone is reported done and removed on the next run.
- [ ] `decide --no-serve` writes one HTML file that makes no network request. `decide --apply` with its saved answers writes the same result a served save would. An answers file naming an unknown decision id writes nothing and exits 1.
- [ ] `docs/cli.md` documents `decide`, `docs/config-reference.md` is regenerated with `paths.decisionsFile`, and the resolve skill reads the decisions file and ends by handing over `decide`.
- [ ] **Runnable:** `npx jest __tests__/cli-decide.test.js` exits 0; this work adds that test file (exits 1 on develop: "No tests found").
- [ ] `npm run verify` exits 0.

## Out of scope

- Posting decisions to any chat tool or tracker, or filing issues: a
  project can do that from `decide --json` with its own tooling.
- Recommendations written by a model: the engine's recommendation is
  deterministic. A skill may add written reasoning in its own report.
- Opening a browser automatically: the address is printed.
