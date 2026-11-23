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
compares against it. Copy `design-components.json` and `design-tokens.json`
(under `paths.snapshotDir`) aside with it, as they are now: step 6 restores
one of them if an ingest has to be re-run. Then read its `provenance`:

| `provenance` says                              | Means                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `designComponents: null`, `designTokens: null` | that snapshot is absent or invalid: this is a first gather, or a repair                    |
| an object with `gatheredAt`                    | when that snapshot was gathered                                                            |
| an empty object                                | the snapshot predates provenance; date it from the snapshot file's commit history instead  |
| `normalizationStale`                           | the snapshot was normalized by an older engine and has to be re-gathered whatever its date |
| `unavailable`                                  | the provider failed to load: fix that first, with the reason given                         |

The two snapshots (`design-components.json` and `design-tokens.json`, under
`paths.snapshotDir`) are dated separately and refreshed by separate passes.
The bindings pass is not dated at all: `ingest --bindings` merges into
`design-components.json` and leaves its `provenance` as it was, so that date
is the components pass's, never the bindings pass's.

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

Check `targets` on **each** pass's plan, not just the components plan from
step 1. The passes do not draw on the same addresses, so one plan can be empty
while another is not. A pass whose plan has `"targets": []` has nothing to
gather: do not run its `ingest` (with no files it exits `1`), and report it
under "Not run" with that reason.

For each name, check the session actually has that tool. Then:

- **All present**: carry on.
- **Some missing**: run the passes whose tools you have, and report each pass
  you could not run, naming the tool it needs. A components-only ingest
  carries the bindings pass's fields forward from the previous snapshot, but
  only for components that are in the new census. A component missing from
  it (a skipped file, an incomplete response) loses those fields, and nothing
  but a bindings pass puts them back. So a components-only refresh is safe
  only when its ingest skipped nothing and `bindingsDropped` is `0` (step 6);
  either way it is partial, and the report has to say the bindings-pass
  fields were not refreshed.
- **None present**: stop. Report the tools the plans name and that this
  session has none of them. The refresh needs a session connected to the
  design tool.

**Never substitute.** A different tool that "returns the same information"
returns it in a different shape. `ingest` normalizes the shape the plan's
tool returns, so a substituted response is either skipped or, worse, read as
a design system with those parts missing.

### 5. Run the plan, and save each response whole

For every target in the plan:

1. Call the target's `tool` (or, where the target names none, the plan's
   `tool`) with exactly its `args`. Where a target names a file to open, as
   `fileUrl` on the target or `args.fileUrl` in its arguments, that file has
   to be the one the design tool has open before the call: a tool that reads
   the open file returns another file's data under this target's `fileKey`,
   and `ingest` accepts it.
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

- `counts.filesIngested` against the number of files you passed: the
  difference is how many files were left out. Then `skipped`, whose entries
  are of three kinds, and only the first is a file to fix:
  - **A file left out.** The file could not be read, lacks a required
    envelope field, its payload is not the shape the plan's tool returns, or
    it carries no node results. The snapshot was written **without** it. Fix
    it by going back to step 5 for that target: write the envelope fields
    the plan gives, or call the tool again and save its response whole. Never
    edit the payload. Then run that pass's `ingest` again with all of its
    files, as below.
  - **Entries left out of a file that went in.** The reason counts raw
    entries skipped, or names one token or one node (`<fileKey>:<nodeId>`)
    and why it could not be read or matched. The rest of that file is in the
    snapshot (a bindings file that addresses one node is that one entry, so
    nothing of it went in). Report each as it is. The payload is the tool's response and
    stays as it was: editing it to make an entry go in is the corruption this
    procedure exists to prevent.
  - **The previous snapshot**, as `file: "design-components.json"`: the
    previous `design-components.json` could not be read, so nothing was
    carried forward, or some of its bindings records match no component in
    this gather (`bindingsDropped`, below). Report it; there is no file to
    fix.

  To re-run a pass after fixing a file left out:
  - **components**: the first run already wrote a census without the skipped
    file's components, and dropped their bindings-pass fields with them. A
    re-run carries forward from that damaged snapshot, so first put back the
    `design-components.json` you copied aside in step 2, then re-run. If you
    cannot put it back, the bindings pass has to run after this one.
  - **tokens**: each run writes the whole snapshot from the files it is
    given; re-run it.
  - **bindings**: each run merges into the existing `design-components.json`
    rather than writing it whole; re-run it, after the components pass if
    that one was re-run too.

- `counts.bindingsCarriedForward`: on a components-only ingest, how many
  components kept their bindings-pass fields from the previous snapshot.
  Those fields are still at their old date.
- `counts.bindingsDropped`: previous bindings records whose component is not
  in the new census. Either the component was removed from the design file,
  or the components response was incomplete. Check which before going on.
  Their bindings-pass fields are gone from the snapshot; if the component is
  still in the design file, the bindings pass has to run to put them back.

Exit `1` writes nothing, and the previous snapshot stands. The message says
why; report it as it is.

### 7. Audit again, and compare

```
npx design-delta audit --json
```

First check the refresh took: `provenance` now shows the new `gatheredAt` for
each snapshot a components or tokens pass refreshed, and no
`normalizationStale`. A bindings pass changes no `provenance`, so it cannot
be checked this way; its evidence is step 6's ingest output. Then read
`skipped`:

- `skipped.design` or `skipped.designTokens` means that snapshot did not
  load: the components snapshot, or the tokens snapshot. If that pass ran, go
  back to step 6.
- `skipped.designBindings` and `skipped.designAnatomy` can appear on a
  healthy run. `designBindings` counts declared bindings the comparison did
  not reach; `designAnatomy` says no component in the snapshot carries a
  layer tree. After a components-only refresh it appears only when no earlier
  bindings pass left a layer tree to carry forward. When one did, the
  components ingest carried those `layers` forward and the entry is absent,
  but those layers are still at the earlier bindings pass's date, not this
  refresh's: say so in the report. It can also stay after a bindings pass
  whose responses carry no layer tree. Report them; neither means a snapshot
  failed to load, and neither is a reason to re-ingest.

A pass you did not run belongs under "Not run" in the report, with whatever
`skipped` says about it.

Then compare the findings with step 2's, matching on `ruleId`, `entity`,
`side` and `data` together (`message` where a finding has no `data`).
`ruleId` and `entity` alone are not unique: one rule can fire several times
on one component, once per prop, with the prop in `data`, and a pair that
lost one prop and gained another would read as no change. Only the design
side should have moved: findings with `"side": "design"`, the rules
`coverage/design-only` and `coverage/design-missing`, the `tokens` rules
whose name starts with `design-`, and `tokens/code-token-undesigned`, which
is `side: "code"` but fires only under groups the design token snapshot
covers, so a tokens refresh moves it. For each one that appeared and each one that disappeared,
say which and, where the snapshot shows it, why (a component added to the
design file, a variant renamed, a variable's value changed).

Any other code-side finding that changed between the two audits did not
come from the refresh. Something else in the project moved while you worked; report it
separately.

### 8. Report

- **Provider and scope**: the provider, and which passes ran.
- **Not run**: each pass or target that did not run, and why (a tool the
  session lacks, a response that could not be saved whole, a call that
  errored). "None" is a valid entry; leaving the section out is not.
- **Age**: each snapshot's date before and after, and what the comparison
  with the design source in step 2 showed, or that it could not be made. For
  a bindings pass, that it ran and when; it has no date in the snapshot.
- **Ingest**: per pass, files given, files ingested, each skipped file with
  its reason, and the carried-forward and dropped counts.
- **What changed on the design side**: findings that appeared and findings
  that disappeared, by `ruleId`, `entity` and what in `data` tells them
  apart, and the design-side counts before and after.
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
dock` writes a stub at `.claude/skills/design-delta-refresh/SKILL.md` that
points here, the same way it links the other packaged skills; the stub
carries no procedure of its own, so it cannot disagree with the installed
version.
