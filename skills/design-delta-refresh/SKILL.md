---
name: design-delta-refresh
description: Refresh the design side of a design-delta project — confirm a design provider is configured, read how old each committed design snapshot is, run gather, execute the plan it prints with the session's design-tool tools, save each raw response where the plan says, ingest, then audit and report what changed on the design side. Use when asked to refresh, re-gather or update the design snapshot, when a design-side finding may rest on a stale snapshot, or before trusting any contract-to-design result.
---

# design-delta refresh — bringing the design snapshot up to date

This file ships inside `design-delta` and describes **exactly the version
installed** in this project. Its sibling
[`skills/design-delta/SKILL.md`](../design-delta/SKILL.md) explains the model
and how to read a finding; the full reference for the two commands used here
is [cli.md](../../docs/cli.md).

**The engine never calls a design tool.** Every design-side result an audit
prints is a comparison against snapshot files committed in the project.
`gather` only prints a plan; an agent session that has the design tool's
tools runs it and saves what comes back; `ingest` turns those saved files
into the snapshot. So the design side is exactly as current as the last time
somebody did this, and an audit run today against a snapshot from last
quarter reads the same as one against this morning's.

**You are the only step that can corrupt it.** `gather` and `ingest` are
deterministic. Between them, a response that was trimmed, summarized, saved
under the wrong name or fetched with a different tool still ingests, and the
snapshot it produces says the design system is smaller or different than it
is. Every rule below about saving a response whole exists for that reason.

## Steps

### 1. Is there a design side to refresh?

```
npx design-delta gather
```

- **Exit `1`**: the message is the reason, usually that no `design.provider`
  is configured, or that the configured one is unknown. Stop and report that
  message as it is. A project with no provider has no design side, and its
  audits skip it by design; nothing here applies.
- **Exit `0` with `"targets": []`**: a provider is configured, and nothing
  addresses a design file. No contract carries a `sources.design`, and
  `design.files` in `design-delta.json` lists none. Stop and say so: there is
  nothing to gather until one of those names a file. Do not invent an
  address.
- **Exit `0` with targets**: carry on. Keep this output; it is the components
  plan for step 4.

### 2. Read what the project has now

Take the audit before touching anything, and keep it:

```
npx design-delta audit --json
```

Save the document somewhere outside the project's tracked files; step 7
compares against it. Then read its `provenance`:

| `provenance` says                              | Means                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `designComponents: null`, `designTokens: null` | that snapshot is absent or invalid: this is a first gather, or a repair                    |
| an object with `gatheredAt`                    | when that snapshot was gathered                                                            |
| an empty object                                | the snapshot predates provenance; date it from the snapshot file's commit history instead  |
| `normalizationStale`                           | the snapshot was normalized by an older engine and has to be re-gathered whatever its date |
| `unavailable`                                  | the provider failed to load: fix that first, with the reason given                         |

The two snapshots (`design-components.json` and `design-tokens.json`, under
`paths.snapshotDir`) are dated separately and refreshed by separate passes.

**Compare that age to the design source, if you can.** If the session's
design-tool tools can say when the design file last changed, or list its
versions, compare. A snapshot older than the file's last change is stale; one
newer is current, and you can say so and stop unless a refresh was asked for
outright. If the session cannot read that, report the snapshot's age as a
fact and do not call it current or stale: the engine cannot know either, and
neither can you.

### 3. Choose the passes

There are three, each with its own plan and its own `ingest`:

| Pass       | Plan                                 | Ingest                                             | Refreshes                                                            |
| ---------- | ------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| components | `npx design-delta gather`            | `npx design-delta ingest <raw-file...>`            | `design-components.json`: which components exist, and their props    |
| bindings   | `npx design-delta gather --bindings` | `npx design-delta ingest <raw-file...> --bindings` | the same file: each component's bound variables, variants and layers |
| tokens     | `npx design-delta gather --tokens`   | `npx design-delta ingest <raw-file...> --tokens`   | `design-tokens.json`: the design tool's variables and text styles    |

A full refresh is all three, components first: the bindings pass merges onto
the components census and fails when there is none. Asked for one thing ("the
tokens look stale"), run that pass; the others keep their own dates, and your
report says which passes ran.

### 4. Check the session has the tools the plans name

Run each chosen pass's `gather` and read the plan: `tool` at the top, and a
`tool` on each target where targets differ. Those names are the provider's;
this file does not list them, because the plan is where they live.

For each name, check the session actually has that tool. Then:

- **All present**: carry on.
- **Some missing**: run the passes whose tools you have, and report each pass
  you could not run, naming the tool it needs. A components-only ingest keeps
  the bindings pass's fields from the previous snapshot rather than dropping
  them, so a partial refresh is safe; it is also partial, and the report has
  to say which half is still at the old date.
- **None present**: stop. Report the tools the plans name and that this
  session has none of them. The refresh needs a session connected to the
  design tool.

**Never substitute.** A different tool that "returns the same information"
returns it in a different shape. `ingest` normalizes the shape the plan's
tool returns, so a substituted response is either skipped or, worse, read as
a design system with those parts missing.

### 5. Run the plan, and save each response whole

For every target in the plan:

1. Call the target's tool with exactly its `args`. Where a target carries a
   `fileUrl`, that file has to be the one the design tool has open before the
   call.
2. Write one JSON file at the target's `outputPath`, in this shape:

```
{
  "provider": "<the plan's provider>",
  "planHash": "<the plan's planHash>",
  "fileKey": "<the target's fileKey>",
  "tool": "<the target's tool, when the target names one>",
  "gatheredAt": "<now, as an ISO 8601 timestamp>",
  "payload": <the tool's response, exactly as returned>
}
```

`provider`, `fileKey` and `payload` are required: a file without them is
skipped. `gatheredAt` and `planHash` become the snapshot's `provenance`, which
is how the next person dates it, so never leave them out. `tool` is how
`ingest` tells one token response from another.

**The payload is the response, untouched.** Not the part that looked
relevant, not a summary, not reformatted, nothing computed from it. If the
response is too large to pass through you intact, or the tool truncated or
paginated it, it must still reach the file complete: use whatever the tool
offers to write or page its full result. If it cannot be saved whole, do not
save part of it. Skip that target and report it. A partial payload ingests
without complaint and reads as components that were deleted.

A call that errors writes no file. Report the target and the error.

The raw files are working files. Whether the project tracks them is its own
choice; check its ignore rules before assuming either way, and do not change
them.

### 6. Ingest, and read what it skipped

Per pass, with every file that pass's plan named:

```
npx design-delta ingest <raw-file...> --json
```

(adding the pass's flag from step 3). Exit `0` does **not** mean every file
went in: it is also the exit code when every file was skipped. Read the
payload:

- `counts.filesIngested` against the number of files you passed, and
  `skipped`, which names each file left out and why. A skipped file means the
  snapshot was written **without** it. Fix the file (the reason says what is
  wrong with it) and run the same `ingest` again with all of that pass's
  files, not just the fixed one: each run writes the whole snapshot from the
  files it is given.
- `counts.bindingsCarriedForward`: on a components-only ingest, how many
  components kept their bindings-pass fields from the previous snapshot.
  Those fields are still at their old date.
- `counts.bindingsDropped`: previous bindings records whose component is not
  in the new census. Either the component was removed from the design file,
  or the components response was incomplete. Check which before going on.

Exit `1` writes nothing. The message says why: no files given, no census for
a bindings pass to merge onto, or a snapshot that failed its own schema.

### 7. Audit again, and compare

```
npx design-delta audit --json
```

First check the refresh took: `provenance` now shows the new `gatheredAt` for
each snapshot you refreshed, and no `normalizationStale`. Then read `skipped`.
A pass you did not run leaves its reason there, and that is expected: after a
components-only refresh, `skipped.designAnatomy` says no component carries a
layer tree and names the bindings pass. Each such entry belongs under "Not
run" in the report. An entry for a pass you did run means that pass's
snapshot did not load; go back to step 6.

Then compare the findings with step 2's, matching on `ruleId` and `entity`
together. Only the design side should have moved: findings with
`"side": "design"`, the rules `coverage/design-only` and
`coverage/design-missing`, and the `tokens` rules whose name starts with
`design-`. For each one that appeared and each one that disappeared,
say which and, where the snapshot shows it, why (a component added to the
design file, a variant renamed, a variable's value changed).

A code-side finding that changed between the two audits did not come from
the refresh. Something else in the project moved while you worked; report it
separately.

### 8. Report

- **Provider and scope**: the provider, and which passes ran.
- **Not run**: each pass or target that did not run, and why (a tool the
  session lacks, a response that could not be saved whole, a call that
  errored). "None" is a valid entry; leaving the section out is not.
- **Age**: each snapshot's date before and after, and what the comparison
  with the design source in step 2 showed, or that it could not be made.
- **Ingest**: per pass, files given, files ingested, each skipped file with
  its reason, and the carried-forward and dropped counts.
- **What changed on the design side**: findings that appeared and findings
  that disappeared, by `ruleId` and `entity`, and the design-side counts
  before and after.
- **Files changed**: the snapshot files written. They are uncommitted;
  committing them follows the project's own workflow.

## What this does not cover

- **Fixing a design-side finding.** A finding that the design tool's
  component disagrees with its contract is settled in the design tool or by a
  contract decision. This procedure edits neither. Reading and working down
  findings is the audit skill's subject.
- **Connecting the session to a design tool.** If the tools are not there,
  step 4 stops and says so.
- **Deciding which design files the project addresses.** The scope is what
  the contracts and `design.files` name. An address nobody declared is not
  gathered.
- **The code side.** `snapshot`, `movers` and `state.json` are a separate,
  code-only mechanism and are not touched here.

## Hard limits

- Never edit a snapshot file by hand. It is written by `ingest` and by
  nothing else.
- Never save part of a response, or anything derived from one.
- Never call a tool the plan did not name in place of one it did.
- Never report a snapshot as refreshed for a pass that did not run, or for a
  file `ingest` skipped.
- Never call a snapshot current because an audit ran against it.
- Never create, edit or delete anything in the design tool.

## How a consumer links this file

Claude Code does not discover skills inside `node_modules`. `design-delta
init` and `design-delta dock` each write a stub at `.claude/skills/design-delta-refresh/SKILL.md` that
points here, the same way they link the other packaged skills; the stub
carries no procedure of its own, so it cannot disagree with the installed
version.
