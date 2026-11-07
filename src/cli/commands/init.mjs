/**
 * init.mjs — the `design-delta init` subcommand (ADR-001 D8, Phase 4): the
 * interactive setup wizard that writes `design-delta.json`.
 *
 *   design-delta init [--yes] [--config <path>]
 *
 * Prompts for `design.provider` (ADR-003 Phase 5) alongside the code-side
 * fields below, offering every provider `src/providers/index.mjs` can
 * actually resolve plus an explicit "none" choice that writes no `design`
 * block at all. `design.options` stays out of scope (issue #280): its
 * shape is not defined until a provider declares its own `configSchema`.
 *
 * DETECT, THEN CONFIRM, NEVER SILENTLY ASSERT. `init-detect.mjs` suggests
 * values from real filesystem evidence; every suggestion is still a PROMPT
 * default the user can overwrite, never written unconfirmed. `--yes` accepts
 * every detected/existing value without asking — CI scaffolding, not a way to
 * skip the same decisions silently.
 *
 * UPDATE, NEVER OVERWRITE — for `design-delta.json`. Re-running `init`
 * against an existing config reads the RAW file first and merges the
 * wizard's answers into it — `lint`, `rules`, `report`, and everything else a
 * prior run or hand-edit added survive untouched. Only
 * `paths.{tokensFile,componentsDir,contractsDir}`, `conventions.cssVarPrefix`,
 * and `design.provider` are ever written to that file by this command.
 *
 * The one other file is the linked skill stub (issue #336): `init` also
 * writes `.claude/skills/design-delta/SKILL.md` through `dock`'s own
 * template + writer (`writeTemplateFile` in `./dock.mjs`) — one scaffold
 * path, not two. That write is guarded by `dock`'s `GENERATED_MARKER`, and
 * so is neither this command's merge nor `dock`'s plain overwrite: a file
 * already at that path without the marker is a consumer's own skill, left
 * untouched and reported as `skipped`. `skills/design-delta/` is a name a
 * project may well have used before installing this package.
 *
 * `@clack/prompts` (ADR-001 D8: "Decided (decided 2026-07-30): adopted") is
 * INJECTABLE (`opts.prompts`, defaulting to the real module) — the same
 * convention `sources/` uses for `fs`, so a test drives the interactive path
 * with a scripted fake rather than a real TTY.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_PATHS,
  DEFAULT_CONVENTIONS,
} from "../../core/config.mjs"
import {
  DEFAULT_DIR as DEFAULT_DOCK_DIR,
  GENERATED_MARKER,
  SKILL_STUB_RELATIVE_PATH,
  renderSkillStubTemplate,
  writeTemplateFile,
} from "./dock.mjs"
import { detectProject } from "../init-detect.mjs"
import { parseFlags } from "../flags.mjs"
import { listProviders } from "../../providers/index.mjs"

const FLAG_SPEC = {
  boolean: ["--yes"],
}

// The explicit "no design tool" choice — distinct from `undefined` (never
// asked) so a re-run can tell "user picked none" (clears an existing
// `design.provider`) from "field untouched" (existing value survives).
const NONE_PROVIDER = "none"

const SCHEMA_RELATIVE_PATH =
  "./node_modules/design-delta/schema/config.schema.json"

// ---------------------------------------------------------------------------
// Loading the raw, unresolved existing config (if any) — never the
// `resolveConfig`-defaulted view, which would make every unset field look
// "already there" and get written back as a literal.
// ---------------------------------------------------------------------------

function loadRawConfig(path, fs) {
  if (!fs.existsSync(path)) return {}
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"))
  } catch {
    // A malformed existing file is treated as absent — `init` is what fixes
    // it, not something that should refuse to run over it.
    return {}
  }
}

// ---------------------------------------------------------------------------
// The answers -> the config PATCH. Only ever `paths.{tokensFile,
// componentsDir,contractsDir,styleRoots}`, `conventions.cssVarPrefix`, and
// `design.provider`; everything else in an existing config is untouched by
// the merge below.
// ---------------------------------------------------------------------------

function buildPatch({
  tokensFile,
  componentsDir,
  contractsDir,
  cssVarPrefix,
  styleRoots,
  designProvider,
}) {
  const patch = { paths: {}, conventions: {} }
  if (tokensFile) patch.paths.tokensFile = tokensFile
  if (componentsDir) patch.paths.componentsDir = componentsDir
  if (contractsDir) patch.paths.contractsDir = contractsDir
  // Travels with cssVarPrefix, never independently — see
  // `init-detect.mjs`'s `detectStyleRoots` docblock: a config that took the
  // suggested prefix without these would scan componentsDir alone at
  // runtime and miss every declaration the prefix suggestion was itself
  // evidence of.
  if (Array.isArray(styleRoots) && styleRoots.length > 0)
    patch.paths.styleRoots = styleRoots
  if (typeof cssVarPrefix === "string")
    patch.conventions.cssVarPrefix = cssVarPrefix
  // `provider: undefined` on the NONE_PROVIDER branch is deliberate, not a
  // no-op — it clears an existing `design.provider` on merge (below) rather
  // than leaving a stale one in place when the user actively picks "none".
  if (designProvider !== undefined)
    patch.design = {
      provider: designProvider === NONE_PROVIDER ? undefined : designProvider,
    }
  if (Object.keys(patch.paths).length === 0) delete patch.paths
  if (Object.keys(patch.conventions).length === 0) delete patch.conventions
  return patch
}

function mergeConfig(existing, patch) {
  const merged = {
    ...existing,
    $schema: existing.$schema || SCHEMA_RELATIVE_PATH,
    ...(patch.paths
      ? { paths: { ...(existing.paths || {}), ...patch.paths } }
      : {}),
    ...(patch.conventions
      ? {
          conventions: {
            ...(existing.conventions || {}),
            ...patch.conventions,
          },
        }
      : {}),
    ...(patch.design
      ? { design: { ...(existing.design || {}), ...patch.design } }
      : {}),
  }
  // A merged `design` left with no defined keys (provider cleared, no
  // pre-existing `options`) writes no block at all — "none" means absent,
  // not `"design": {}`.
  if (
    merged.design &&
    Object.values(merged.design).every(value => value === undefined)
  )
    delete merged.design
  return merged
}

// ---------------------------------------------------------------------------
// Answer resolution — existing config wins over detection (the update-flow
// invariant: re-running init must not silently revert a hand-edited value),
// detection wins over the engine's own generic default.
// ---------------------------------------------------------------------------

function currentOrDetected(existingValue, detectedValue) {
  return existingValue !== undefined ? existingValue : detectedValue
}

// ---------------------------------------------------------------------------
// --yes: accept every current-or-detected value with no prompts at all.
// ---------------------------------------------------------------------------

function resolveYesAnswers(existing, detected) {
  return {
    tokensFile: currentOrDetected(
      existing.paths?.tokensFile,
      detected.tokensFile,
    ),
    componentsDir: currentOrDetected(
      existing.paths?.componentsDir,
      detected.componentsDir,
    ),
    contractsDir: currentOrDetected(
      existing.paths?.contractsDir,
      detected.contractsDir,
    ),
    cssVarPrefix: currentOrDetected(
      existing.conventions?.cssVarPrefix,
      detected.cssVarPrefix,
    ),
    styleRoots: currentOrDetected(
      existing.paths?.styleRoots,
      detected.styleRoots,
    ),
    // No filesystem detection exists for the design provider (unlike the
    // fields above) — the existing value is the only thing to fall back to,
    // "none" otherwise, per the update-flow invariant.
    designProvider: existing.design?.provider ?? NONE_PROVIDER,
  }
}

// ---------------------------------------------------------------------------
// Interactive: one `text` prompt per field, defaulted to current-or-detected,
// engine default as the placeholder when neither exists. Cancellation (Ctrl-C
// mid-wizard) at ANY prompt aborts the whole run — nothing partial is ever
// written.
// ---------------------------------------------------------------------------

const CANCELLED = Symbol("design-delta-init-cancelled")

async function promptText(prompts, { message, defaultValue, placeholder }) {
  const answer = await prompts.text({ message, placeholder, defaultValue })
  if (prompts.isCancel(answer)) return CANCELLED
  return answer
}

async function promptSelect(prompts, { message, options, initialValue }) {
  const answer = await prompts.select({ message, options, initialValue })
  if (prompts.isCancel(answer)) return CANCELLED
  return answer
}

function designProviderOptions() {
  return [
    { value: NONE_PROVIDER, label: "None — no design tool" },
    ...listProviders().map(key => ({ value: key, label: key })),
  ]
}

async function resolveInteractiveAnswers(prompts, existing, detected) {
  prompts.intro("design-delta init")

  const tokensFile = await promptText(prompts, {
    message:
      "Where do your DTCG tokens live? (a JSON file, or a directory of them)",
    defaultValue: currentOrDetected(
      existing.paths?.tokensFile,
      detected.tokensFile,
    ),
    placeholder: DEFAULT_PATHS.tokensFile,
  })
  if (tokensFile === CANCELLED) return CANCELLED

  const componentsDir = await promptText(prompts, {
    message: "Where do your components live?",
    defaultValue: currentOrDetected(
      existing.paths?.componentsDir,
      detected.componentsDir,
    ),
    placeholder: DEFAULT_PATHS.componentsDir,
  })
  if (componentsDir === CANCELLED) return CANCELLED

  const contractsDir = await promptText(prompts, {
    message: "Where do your contracts live?",
    defaultValue: currentOrDetected(
      existing.paths?.contractsDir,
      detected.contractsDir,
    ),
    placeholder: DEFAULT_PATHS.contractsDir,
  })
  if (contractsDir === CANCELLED) return CANCELLED

  const cssVarPrefix = await promptText(prompts, {
    message: "What prefix do your CSS custom properties use?",
    defaultValue: currentOrDetected(
      existing.conventions?.cssVarPrefix,
      detected.cssVarPrefix,
    ),
    placeholder: DEFAULT_CONVENTIONS.cssVarPrefix,
  })
  if (cssVarPrefix === CANCELLED) return CANCELLED

  // Not its own prompt — plain directory existence, no judgment call, and it
  // has to travel with cssVarPrefix (see `buildPatch`). Still honors the
  // update-flow invariant: an existing config's own styleRoots wins over a
  // fresh detection.
  const styleRoots = currentOrDetected(
    existing.paths?.styleRoots,
    detected.styleRoots,
  )

  const designProvider = await promptSelect(prompts, {
    message: "Which design tool do you use?",
    options: designProviderOptions(),
    initialValue: existing.design?.provider ?? NONE_PROVIDER,
  })
  if (designProvider === CANCELLED) return CANCELLED

  return {
    tokensFile,
    componentsDir,
    contractsDir,
    cssVarPrefix,
    styleRoots,
    designProvider,
  }
}

// ---------------------------------------------------------------------------
// Suggested npm scripts — printed, never written to package.json (D8: a
// consumer wires these themselves; this command only ever touches its own
// config file).
// ---------------------------------------------------------------------------

function suggestedScripts() {
  return {
    "drift:audit": "design-delta audit",
    "drift:lint": "design-delta lint",
    "drift:verify": "design-delta verify",
  }
}

/**
 * One line reporting what happened to the linked skill stub. `skipped` is
 * the case worth explaining: the consumer already owns a file at that path,
 * so nothing was written and they need to know the link is not there.
 *
 * @param {{path: string, action: "wrote" | "up-to-date" | "skipped"}} stub
 * @returns {string}
 */
function renderStubLine(stub) {
  if (stub.action !== "skipped") return `${stub.action} ${stub.path}`
  return (
    `skipped ${stub.path} — it already exists and is not generated by ` +
    "design-delta, so it was left untouched. Move it aside and re-run to " +
    "get the linked stub."
  )
}

function renderScripts(scripts) {
  const lines = ['Suggested npm scripts (add to package.json "scripts"):', ""]
  for (const [name, command] of Object.entries(scripts))
    lines.push(`  "${name}": "${command}"`)
  return lines.join("\n") + "\n"
}

/**
 * Run the subcommand. Returns the exit code; never calls `process.exit`.
 *
 * @param {string[]} cmdArgv
 * @param {{globalOpts: object, io: {stdout: object, stderr: object}, prompts?: object, fs?: object, root?: string}} ctx
 *   `prompts`/`fs`/`root` are injectable for tests; production omits them and
 *   gets the real `@clack/prompts`, real `node:fs`, and `process.cwd()`.
 * @returns {Promise<number>}
 */
export async function runInit(cmdArgv, ctx) {
  const { io, globalOpts = {} } = ctx
  const fs = ctx.fs || {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
  }
  const root = ctx.root || process.cwd()
  const { opts, errors } = parseFlags(cmdArgv, FLAG_SPEC)

  if (errors.length > 0) {
    for (const error of errors) io.stderr.write(`design-delta init: ${error}\n`)
    return 1
  }

  const configPath = globalOpts.config
    ? isAbsolute(globalOpts.config)
      ? globalOpts.config
      : join(root, globalOpts.config)
    : join(root, DEFAULT_CONFIG_PATH)

  const existing = loadRawConfig(configPath, fs)
  const detected = detectProject(
    root,
    { contractSuffix: existing.conventions?.contractSuffix },
    fs,
  )

  let answers
  if (opts.yes) {
    answers = resolveYesAnswers(existing, detected)
  } else {
    const prompts = ctx.prompts || (await import("@clack/prompts"))
    answers = await resolveInteractiveAnswers(prompts, existing, detected)
    if (answers === CANCELLED) {
      prompts.cancel("Cancelled — nothing was written.")
      return 1
    }
  }

  const patch = buildPatch(answers)
  const merged = mergeConfig(existing, patch)
  // `--config some/nested/path.json` naming a directory that does not exist
  // yet is a normal first run, not an error — create it rather than fail on
  // a plain `writeFileSync`, which never makes parent directories itself.
  fs.mkdirSync(dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n")

  // The linked skill stub (issue #336) — a third `dock` template, written
  // through `dock`'s own writer so there is one scaffold path, not two, and
  // guarded by `dock`'s marker so an existing file this package did not
  // generate is reported rather than destroyed.
  const stub = writeTemplateFile(
    fs,
    root,
    DEFAULT_DOCK_DIR,
    SKILL_STUB_RELATIVE_PATH,
    renderSkillStubTemplate(),
    { requireMarker: GENERATED_MARKER },
  )

  const scripts = suggestedScripts()
  if (opts.yes) {
    io.stdout.write(`design-delta init: wrote ${configPath}\n`)
    io.stdout.write(`design-delta init: ${renderStubLine(stub)}\n\n`)
    io.stdout.write(renderScripts(scripts))
  } else {
    const prompts = ctx.prompts || (await import("@clack/prompts"))
    prompts.outro(`Wrote ${configPath}\n${renderStubLine(stub)}`)
    io.stdout.write("\n" + renderScripts(scripts))
  }

  return 0
}
