#!/usr/bin/env node
/**
 * generate-config-reference.mjs — renders `schema/config.schema.json` into
 * `docs/config-reference.md` (ADR-001 Phase 4: "config reference generated
 * from the schema").
 *
 * GENERATED, NOT HAND-WRITTEN, on purpose: the schema's own `description`
 * fields are already the carefully-reasoned source of truth for what each
 * field means and why its default is what it is (every field description in
 * `schema/config.schema.json` already carries that reasoning — this script
 * invents no new prose, it only walks and renders what is already there).
 * A hand-maintained copy would drift the first time a field is added or a
 * description is reworded; `scripts/ci/check-schemas.mjs`-style drift is
 * exactly the class of bug this repo does not tolerate elsewhere, and a
 * config reference is no different.
 *
 * DETERMINISTIC: reads one file, walks it in a fixed order (object key
 * insertion order, which JSON.parse preserves), writes one file. No wall
 * clock, no environment, so `--check` (below) can assert the committed doc
 * is EXACTLY what running this script now would produce.
 *
 * Usage:
 *   node scripts/generate-config-reference.mjs           # writes docs/config-reference.md
 *   node scripts/generate-config-reference.mjs --check    # exits 1 if the committed file is stale
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { listProviders, loadProvider } from "../src/providers/index.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCHEMA_PATH = join(REPO_ROOT, "schema", "config.schema.json")
const OUT_PATH = join(REPO_ROOT, "docs", "config-reference.md")

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))

// `design.options` is opaque to `schema/config.schema.json`: each provider
// validates it against its own `configSchema` (ADR-003 Amendment 3), so its
// keys would never reach this doc from the schema walk alone (issue #488).
// They are rendered from that provider schema instead, one table per
// provider, in `listProviders()` order.
const providerOptions = []
for (const key of listProviders()) {
  const loaded = await loadProvider({ design: { provider: key } })
  const properties = loaded.ok
    ? loaded.provider.configSchema?.properties
    : undefined
  if (properties) providerOptions.push([key, properties])
}

// ---------------------------------------------------------------------------
// $ref resolution — only ever `#/$defs/<name>`, which is the only ref shape
// this schema uses (confirmed by reading it: no external refs, no $recursiveRef).
// ---------------------------------------------------------------------------

function resolveRef(ref) {
  const name = ref.replace("#/$defs/", "")
  const def = schema.$defs?.[name]
  if (!def) throw new Error(`unresolved $ref: ${ref}`)
  return def
}

// A node's EFFECTIVE schema: if it is a bare `$ref`, resolve it; if it is a
// `$ref` alongside its own `description` (several properties in this schema
// do this deliberately, to override the shared def's generic description
// with a field-specific one), merge the resolved shape under the local
// description.
function resolve(node) {
  if (node.$ref) {
    const resolved = resolveRef(node.$ref)
    return node.description
      ? { ...resolved, description: node.description }
      : resolved
  }
  return node
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

// Markdown table cells break on a literal `|` (GFM reads it as a column
// delimiter) — every value that lands in a cell, including a rendered type
// label, has to go through this before being joined into a row.
function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function typeLabel(node) {
  if (node.enum)
    return `enum: ${node.enum.map(v => `\`${JSON.stringify(v)}\``).join(", ")}`
  if (node.oneOf) return "one of several shapes — see description"
  if (node.type === "array") {
    const items = node.items ? resolve(node.items) : null
    return items ? `array of ${typeLabel(items)}` : "array"
  }
  if (node.type === "object") return "object"
  return node.type || "any"
}

function renderDefault(node) {
  if (!("default" in node)) return ""
  return ` Default: \`${JSON.stringify(node.default)}\`.`
}

// An array-of-objects property (e.g. `lint.vocabularies`) needs its entry
// shape spelled out, or a reader has no way to know what one array element
// looks like from the type column alone. Rendered as a compact inline
// signature via a table cell's `<br>` line breaks (GFM supports these inside
// a cell; a literal newline does not), not a nested table — a table cannot
// nest another table inside one of its own cells.
function entryShapeSignature(node) {
  if (node.type !== "array") return ""
  const items = node.items ? resolve(node.items) : null
  if (!items || items.type !== "object" || !items.properties) return ""
  const fields = Object.entries(items.properties).map(([name, raw]) => {
    const field = resolve(raw)
    const required = items.required?.includes(name) ? "" : "?"
    return `${name}${required}: ${typeLabel(field)}`
  })
  // Defensive escaping even though no current field's typeLabel produces a
  // `|` here (only an enum does, and no `vocabularies`-shaped entry in this
  // schema nests one today) — a future schema change easily could, and a
  // silently broken table is worse than a slightly paranoid render.
  return `<br>Each entry: ${escapeCell(`\`{ ${fields.join(", ")} }\``)}`
}

// One row per sub-property of an object node, as a markdown table — the
// common case every top-level block in this schema follows.
function renderPropertyTable(properties) {
  const rows = Object.entries(properties).map(([name, raw]) => {
    const node = resolve(raw)
    const description = escapeCell(node.description || "")
    return `| \`${name}\` | ${escapeCell(typeLabel(node))} | ${description}${renderDefault(node)}${entryShapeSignature(node)} |`
  })
  return [
    "| Field | Type | Description |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function renderTopLevelSection(name, raw) {
  const node = resolve(raw)
  const lines = [`## \`${name}\``, ""]
  if (node.description) lines.push(node.description, "")
  lines.push(`**Type:** ${typeLabel(node)}${renderDefault(node)}`, "")

  if (node.type === "object" && node.properties) {
    lines.push(renderPropertyTable(node.properties), "")
  } else if (node.type === "array" && node.items) {
    const items = resolve(node.items)
    if (items.type === "object" && items.properties) {
      lines.push("Each entry:", "", renderPropertyTable(items.properties), "")
    }
  } else if (node.additionalProperties && node.additionalProperties.$ref) {
    const entryShape = resolve(node.additionalProperties)
    if (entryShape.description)
      lines.push(`Each value: ${entryShape.description}`, "")
  }

  return lines.join("\n")
}

function render() {
  const lines = [
    "# Config reference",
    "",
    "Generated from [`schema/config.schema.json`](../schema/config.schema.json) — " +
      "**do not hand-edit this file**, it is overwritten by " +
      "`node scripts/generate-config-reference.mjs` (checked in CI via the same " +
      "script's `--check` flag).",
    "",
    schema.description || "",
    "",
    "## Fields",
    "",
    ...Object.keys(schema.properties).map(
      name => `- [\`${name}\`](#${name.replace(/\$/g, "").toLowerCase()})`,
    ),
    "",
  ]

  for (const [name, raw] of Object.entries(schema.properties)) {
    lines.push(renderTopLevelSection(name, raw), "")
    if (name !== "design") continue
    for (const [key, properties] of providerOptions) {
      lines.push(
        `### \`design.options\` — provider \`${key}\``,
        "",
        renderPropertyTable(properties),
        "",
      )
    }
  }

  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  )
}

const rendered = render()

if (process.argv.includes("--check")) {
  const committed = (() => {
    try {
      return readFileSync(OUT_PATH, "utf8")
    } catch {
      return null
    }
  })()
  if (committed !== rendered) {
    console.error(
      `FAIL  docs/config-reference.md is stale relative to schema/config.schema.json.\n` +
        `      Run: node scripts/generate-config-reference.mjs`,
    )
    process.exit(1)
  }
  console.log("OK    docs/config-reference.md is current")
  process.exit(0)
}

writeFileSync(OUT_PATH, rendered)
console.log(`Wrote ${OUT_PATH}`)
