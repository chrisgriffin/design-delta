/**
 * synthetic-project.mjs — the "nothing consumer-specific" fixture harness.
 *
 * ADR-001 D11 names the synthetic-project test the gate on every phase: "the
 * proof that nothing consumer-specific re-enters the engine." v1's version
 * (`__tests__/synthetic-project.test.js`, now superseded) materialized a temp
 * project whose conventions differed from the consuming project's on every
 * parameterized axis and ran the engine against it — if a check secretly
 * assumed `components/`, `--system-`, or `.module.scss`, this fixture is what
 * made that assumption fail loudly instead of quietly passing forever
 * because the only real-world data anyone ever throws at the engine happens
 * to already match those defaults.
 *
 * this harness raises the bar one level: the synthetic values below must differ not
 * only from a real project's layout but from the engine's OWN neutral
 * defaults (`src/core/config.mjs`'s `DEFAULT_PATHS` / `DEFAULT_CONVENTIONS` /
 * `DEFAULT_REPORT`) on every axis this harness parameterizes. Otherwise a
 * regression that silently falls back to an engine default instead of
 * reading the resolved config would go undetected — this fixture would just
 * happen to produce the same values either way. `__tests__/synthetic-
 * project.test.js` asserts that divergence directly.
 *
 * Extending this per phase (per ADR-001 "Working method"): as each phase
 * lands a domain module (contracts.mjs in Phase 2, state.mjs's first real
 * use in Phase 1, etc.), grow the shared defaults here — a new default
 * component, a richer contract shape, additional snapshot fields — so every
 * phase's tests share one materialized project instead of forking their own
 * fixture. One-off variations for a single test belong in that test's
 * `overrides` argument, not a fork of this file. Whatever you add, keep the
 * invariant above: a synthetic value must never equal an engine default or a
 * convention borrowed from a real project.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DEFAULT_CONFIG_PATH, validateConfig } from "../../src/core/config.mjs"

// ---------------------------------------------------------------------------
// The synthetic conventions — every axis deliberately unlike BOTH
// a real project's layout (components/, --system-, .module.scss,
// .figma.tsx, app/(site)) AND the engine's own neutral defaults in
// src/core/config.mjs.
// ---------------------------------------------------------------------------

/** @type {typeof import("../../src/core/config.mjs").DEFAULT_PATHS} */
export const SYNTHETIC_PATHS = {
  snapshotDir: "snap",
  stateFile: "snap/drift-state.json",
  tokensFile: "design/tokens.json",
  // Deliberately non-empty, unlike the engine default: the anti-hardcoding
  // guard below requires every path axis to differ from DEFAULT_PATHS, and a
  // field left at its default would make this harness stop proving anything
  // about it.
  resolvedTokensFile: "design/generated/parsed.tokens.json",
  componentsDir: "src/ui",
  styleRoots: ["src/theme"],
  contractsDir: "specs",
  reportDir: "reports",
}

/** @type {typeof import("../../src/core/config.mjs").DEFAULT_CONVENTIONS} */
export const SYNTHETIC_CONVENTIONS = {
  stylesSuffix: ".styles.scss",
  codeConnectSuffix: ".cc.tsx",
  contractSuffix: ".spec.json",
  cssVarPrefix: "--acme-",
  // Kept internally consistent with `codeConnectSuffix` above (Phase 1,
  // issue #98): this fixture's own sidecar suffix must be listed here too, or
  // a component-file scan would wrongly try to extract a Code Connect sidecar
  // as a component. Every entry still differs from
  // `DEFAULT_CONVENTIONS.nonComponentFileSuffixes` (which ships no Code
  // Connect suffix of its own — ADR-003 Amendment 1).
  nonComponentFileSuffixes: [".story.tsx", ".spec.tsx", ".cc.tsx"],
}

/** @type {typeof import("../../src/core/config.mjs").DEFAULT_REPORT} */
export const SYNTHETIC_REPORT = {
  timeZone: "Australia/Sydney",
}

export const SYNTHETIC_FILE_KEYS = {
  tokens: "ACME123",
  components: "ACME123",
}

// A minimal DTCG token file. The "acme" top-level namespace is fixture
// content (a real project names this whatever it wants) — never read for
// its literal name by anything in `core/`.
const DEFAULT_TOKENS = {
  acme: {
    color: {
      fg: { $type: "color", $value: "#111111" },
      bg: { $type: "color", $value: "#fafafa" },
      danger: { $type: "color", $value: "#b00020" },
    },
  },
}

// ---------------------------------------------------------------------------
// merge helper — shallow-per-block, deep within a block; a config's LIST
// value replaces the default wholesale, matching src/core/config.mjs's own
// resolve* convention (a project overriding a list supplies its whole list).
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function deepMerge(base, override) {
  if (override === undefined) return base
  if (Array.isArray(override)) return override.slice()
  if (isPlainObject(base) && isPlainObject(override)) {
    const out = { ...base }
    for (const key of Object.keys(override)) {
      out[key] = deepMerge(base[key], override[key])
    }
    return out
  }
  return override
}

// ---------------------------------------------------------------------------
// Default component fixtures — rendered from the (already-merged) paths /
// conventions / fileKeys, so overriding e.g. `conventions.cssVarPrefix` keeps
// the generated SCSS, contract, and Code Connect content internally
// consistent rather than drifting from whatever prefix the config declares.
//
// Two components, mirroring v1's proven pattern: "field" is fully clean;
// "badge" carries one deliberate, narrow inconsistency (the contract's `size`
// enum includes "lg", the code component does not) so a later phase's
// conformance checkers have something real to catch without this harness
// having to grow a second fixture for that purpose.
// ---------------------------------------------------------------------------

function renderField(merged) {
  const { conventions, paths, fileKeys } = merged
  const dir = `${paths.componentsDir}/field`
  return {
    name: "field",
    tsx: `import type { HTMLAttributes } from "react"

export type FieldProps = {
  tone?: "neutral" | "danger"
  label: string
} & HTMLAttributes<HTMLDivElement>

export function Field({ tone = "neutral", label }: FieldProps) {
  return (
    <div className="acmeField" data-tone={tone}>
      {label}
    </div>
  )
}
`,
    styles: `.acmeField {
  color: var(${conventions.cssVarPrefix}color-fg);
  background-color: var(${conventions.cssVarPrefix}color-bg);
}
`,
    codeConnect: `import figma from "@figma/code-connect"

import { Field } from "./field"

figma.connect(Field, "https://www.figma.com/design/${fileKeys.components}?node-id=10-20", {
  props: {
    tone: figma.enum("Tone", {
      neutral: "neutral",
      danger: "danger",
    }),
    label: figma.string("Label"),
  },
  example: props => <Field {...props} />,
})
`,
    contract: {
      id: "field",
      title: "Field",
      status: "published",
      sources: {
        design: { fileKey: fileKeys.components, nodeId: "10:20" },
        code: {
          path: `${dir}/field.tsx`,
          styles: `${dir}/field${conventions.stylesSuffix}`,
        },
      },
      anatomy: {
        root: {
          type: "container",
          element: "div",
          content: { $prop: "label" },
        },
      },
      props: {
        // `required: false` mirrors the code's own optionality (`tone =
        // "neutral"` in field.tsx) — the props/API parity checker (Phase 1,
        // issue #98) is the first reader of this field, which is what
        // surfaced its earlier omission.
        tone: {
          type: "enum",
          values: ["neutral", "danger"],
          default: "neutral",
          required: false,
        },
        label: { type: "string" },
      },
      styles: {
        root: {
          base: {
            color: { token: "acme.color.fg" },
            background: { token: "acme.color.bg" },
          },
        },
      },
      codegen: { className: true },
    },
  }
}

function renderBadge(merged) {
  const { conventions, paths, fileKeys } = merged
  const dir = `${paths.componentsDir}/badge`
  return {
    name: "badge",
    tsx: `export type BadgeProps = {
  size?: "sm" | "md"
  label: string
}

export function Badge({ size = "sm", label }: BadgeProps) {
  return (
    <span className="acmeBadge" data-size={size}>
      {label}
    </span>
  )
}
`,
    styles: `.acmeBadge {
  color: var(${conventions.cssVarPrefix}color-fg);
}
`,
    codeConnect: `import figma from "@figma/code-connect"

import { Badge } from "./badge"

figma.connect(Badge, "https://www.figma.com/design/${fileKeys.components}?node-id=30-40", {
  props: {
    size: figma.enum("Size", {
      sm: "sm",
      md: "md",
    }),
    label: figma.string("Label"),
  },
  example: props => <Badge {...props} />,
})
`,
    // DELIBERATE, narrow inconsistency: the contract declares the full "lg"
    // size the code component above does not ship. See the module docblock.
    contract: {
      id: "badge",
      title: "Badge",
      status: "published",
      sources: {
        design: { fileKey: fileKeys.components, nodeId: "30:40" },
        code: {
          path: `${dir}/badge.tsx`,
          styles: `${dir}/badge${conventions.stylesSuffix}`,
        },
      },
      anatomy: {
        root: {
          type: "container",
          element: "span",
          content: { $prop: "label" },
        },
      },
      props: {
        // `required: false` mirrors the code's own optionality (`size =
        // "sm"` in badge.tsx) — see the matching note on field's `tone`
        // above. Badge's ONE deliberate drift stays the "lg" enum value.
        size: {
          type: "enum",
          values: ["sm", "md", "lg"],
          default: "sm",
          required: false,
        },
        label: { type: "string" },
      },
      styles: {
        root: { base: { color: { token: "acme.color.fg" } } },
      },
      codegen: { className: true },
    },
  }
}

// ADR-003 Phase 5.3's real `design-tokens.json` shape: `{tokens: [{name,
// value}]}`, matched against the code-side token census by VALUE, never by
// name (see modules/tokens.mjs's docblock) — so these two entries are
// deliberately named nothing like the DTCG ids they happen to agree with in
// VALUE, proving the check really doesn't look at names. Both values match
// `DEFAULT_TOKENS`'s `acme.color.fg`/`acme.color.bg` exactly, so the default
// synthetic project is clean (zero `tokens/design-value-untracked`
// findings), the same "clean unless a test asks for drift" convention
// `renderDesignComponents` follows for Field/Badge.
function renderDesignTokens() {
  return {
    tokens: [
      { name: "fg/default", value: "#111111" },
      { name: "bg/default", value: "#fafafa" },
    ],
  }
}

// `fileKey` lives PER-COMPONENT, not at the document's top level
// (`schema/design-components.schema.json`, ADR-003 Phase 5.1) — a project
// can address more than one design file, so the join key against a
// contract's `sources.design` has to travel with each entry.
function renderDesignComponents(merged) {
  return {
    components: [
      {
        fileKey: merged.fileKeys.components,
        name: "Field",
        nodeId: "10:20",
        type: "COMPONENT_SET",
        variantProperties: { tone: ["neutral", "danger"] },
        propertyDefinitions: { "label#1:0": { type: "TEXT", name: "label" } },
        usedVars: ["color/fg", "color/bg"],
        rawProps: {},
        icon: false,
        treeHash: "synthetic-field-v1",
      },
      {
        fileKey: merged.fileKeys.components,
        name: "Badge",
        nodeId: "30:40",
        type: "COMPONENT_SET",
        // The design tool's symbol declares the full size scale — Badge's
        // drift (see renderBadge above) is purely code-side.
        variantProperties: { size: ["sm", "md", "lg"] },
        propertyDefinitions: { "label#2:0": { type: "TEXT", name: "label" } },
        // Binds an extra var the SCSS never references — a var-design-only
        // drift a later token-usage checker can catch.
        usedVars: ["color/fg", "color/danger"],
        rawProps: {},
        icon: false,
        treeHash: "synthetic-badge-v1",
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Disk writers
// ---------------------------------------------------------------------------

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(path, content) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function writeContract(path, content) {
  const text =
    typeof content === "string"
      ? content
      : `${JSON.stringify(content, null, 2)}\n`
  writeText(path, text)
}

/**
 * Materialize a synthetic project in a fresh temp dir: a valid
 * `design-delta.json`, a DTCG-ish `tokens.json`, two
 * component dirs (each with a `.tsx`, style file, and Code Connect sidecar),
 * their `*.spec.json` contracts, and a `design-tokens.json` /
 * `design-components.json` snapshot pair (ADR-001 D7) — every path and
 * naming convention deliberately unlike both a real project's layout
 * and the engine's own defaults.
 *
 * @param {object} [overrides] Deep-merged onto the synthetic defaults.
 *   Recognized top-level keys: `paths`, `conventions`, `report`, `fileKeys`
 *   (fixture-authoring only — seeds `sources.design.fileKey`/snapshot
 *   content, never written into `design-delta.json` itself, per ADR-003
 *   Amendment 1's deletion of `config.fileKeys`), `tokens`, `designTokens`,
 *   `designComponents` (each deep-merged onto its default), `design` (e.g.
 *   `{provider: "figma"}` — no synthetic default, same "absent means
 *   unconfigured" reasoning as `rules`/`exemptions`/`lint` below), and
 *   `components` (an array that, if given, REPLACES the default
 *   two-component set wholesale — each entry `{name, dir?, tsx, styles,
 *   codeConnect, contract}`; a later phase supplying its own components is
 *   responsible for keeping them internally consistent, the same way
 *   overriding `conventions`/`paths` here keeps the generated defaults
 *   consistent).
 * @returns {{root: string, config: object, configPath: string, paths: object, cleanup: () => void}}
 */
export function createSyntheticProject(overrides = {}) {
  const merged = {
    paths: deepMerge(SYNTHETIC_PATHS, overrides.paths),
    conventions: deepMerge(SYNTHETIC_CONVENTIONS, overrides.conventions),
    report: deepMerge(SYNTHETIC_REPORT, overrides.report),
    fileKeys: deepMerge(SYNTHETIC_FILE_KEYS, overrides.fileKeys),
    // `rules`/`exemptions` have NO synthetic default — an absent block means
    // "every rule at its registry default", which is the state most tests
    // want. They are mergeable because severity configuration is a
    // first-class config feature, and without this no test could exercise it
    // through the harness at all.
    ...(overrides.rules ? { rules: overrides.rules } : {}),
    ...(overrides.exemptions ? { exemptions: overrides.exemptions } : {}),
    // Same reasoning as the two above: absent means "the lint surface is
    // silent", which is its documented default and not something a synthetic
    // default may quietly override.
    ...(overrides.lint ? { lint: overrides.lint } : {}),
    // Same reasoning again: `design.provider` has no engine default either
    // (ADR-003 Phase 5.1) — absent means no design side configured, and a
    // synthetic default here would make every OTHER test's fixture silently
    // start doing provider I/O it never asked for.
    ...(overrides.design ? { design: overrides.design } : {}),
    // No engine default to protect here either: absent means no mapping.
    ...(overrides.tokenMapping ? { tokenMapping: overrides.tokenMapping } : {}),
  }
  const tokens = deepMerge(DEFAULT_TOKENS, overrides.tokens)
  const designTokens = deepMerge(
    renderDesignTokens(merged),
    overrides.designTokens,
  )
  const designComponents = deepMerge(
    renderDesignComponents(merged),
    overrides.designComponents,
  )
  const components = overrides.components || [
    renderField(merged),
    renderBadge(merged),
  ]

  const root = mkdtempSync(join(tmpdir(), "design-delta-fixture-"))

  const config = {
    $schema: "./node_modules/design-delta/schema/config.schema.json",
    paths: merged.paths,
    conventions: merged.conventions,
    report: merged.report,
    // Omitted entirely unless a test asked for them: an ABSENT block means
    // every rule at its registry default, which is not the same statement as
    // an empty one, and the difference is exactly what severity-override
    // tests need to be able to express.
    ...(merged.rules ? { rules: merged.rules } : {}),
    ...(merged.exemptions ? { exemptions: merged.exemptions } : {}),
    ...(merged.lint ? { lint: merged.lint } : {}),
    ...(merged.design ? { design: merged.design } : {}),
    ...(merged.tokenMapping ? { tokenMapping: merged.tokenMapping } : {}),
  }
  const { valid, errors } = validateConfig(config)
  if (!valid) {
    rmSync(root, { recursive: true, force: true })
    throw new Error(
      `createSyntheticProject: assembled an invalid config:\n${errors.map(e => `  - ${e}`).join("\n")}`,
    )
  }

  const configPath = join(root, DEFAULT_CONFIG_PATH)
  writeJson(configPath, config)

  const tokensPath = join(root, merged.paths.tokensFile)
  writeJson(tokensPath, tokens)

  // The synthetic project has no prep step, so the document the parser would
  // resolve is identical to the authored one — but it must EXIST, because
  // declaring `resolvedTokensFile` and not building it is itself a reported
  // state (issue #176). Tests that want that state override the path.
  if (merged.paths.resolvedTokensFile) {
    writeJson(join(root, merged.paths.resolvedTokensFile), tokens)
  }

  const componentPaths = {}
  for (const component of components) {
    const compDir = join(
      root,
      merged.paths.componentsDir,
      component.dir || component.name,
    )
    const tsxPath = join(compDir, `${component.name}.tsx`)
    writeText(tsxPath, component.tsx)

    let stylesPath = null
    if (merged.conventions.stylesSuffix && component.styles) {
      stylesPath = join(
        compDir,
        `${component.name}${merged.conventions.stylesSuffix}`,
      )
      writeText(stylesPath, component.styles)
    }

    let codeConnectPath = null
    if (merged.conventions.codeConnectSuffix && component.codeConnect) {
      codeConnectPath = join(
        compDir,
        `${component.name}${merged.conventions.codeConnectSuffix}`,
      )
      writeText(codeConnectPath, component.codeConnect)
    }

    let contractPath = null
    if (merged.conventions.contractSuffix && component.contract) {
      contractPath = join(
        root,
        merged.paths.contractsDir,
        `${component.name}${merged.conventions.contractSuffix}`,
      )
      writeContract(contractPath, component.contract)
    }

    componentPaths[component.name] = {
      dir: compDir,
      tsx: tsxPath,
      styles: stylesPath,
      codeConnect: codeConnectPath,
      contract: contractPath,
    }
  }

  const snapshotDir = join(root, merged.paths.snapshotDir)
  const designTokensPath = join(snapshotDir, "design-tokens.json")
  const designComponentsPath = join(snapshotDir, "design-components.json")
  writeJson(designTokensPath, designTokens)
  writeJson(designComponentsPath, designComponents)

  // reportDir is an OUTPUT location (where a future `--report` write lands) —
  // pre-created so its path resolves, deliberately left empty. stateFile is
  // likewise never pre-written: a fresh project has no prior run, and D6's
  // "everything is new" first run is itself part of what later phases need
  // to exercise faithfully.
  const reportDir = join(root, merged.paths.reportDir)
  mkdirSync(reportDir, { recursive: true })

  return {
    root,
    config,
    configPath,
    paths: {
      root,
      configPath,
      tokensFile: tokensPath,
      componentsDir: join(root, merged.paths.componentsDir),
      contractsDir: join(root, merged.paths.contractsDir),
      snapshotDir,
      designTokensFile: designTokensPath,
      designComponentsFile: designComponentsPath,
      reportDir,
      stateFile: join(root, merged.paths.stateFile),
      components: componentPaths,
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

// Exposed so tests can assert the resolved config matches these exact
// synthetic values (and that they differ from the engine's own defaults)
// without hardcoding a second copy of every literal here.
export const SYNTHETIC_DEFAULTS = {
  paths: SYNTHETIC_PATHS,
  conventions: SYNTHETIC_CONVENTIONS,
  report: SYNTHETIC_REPORT,
  fileKeys: SYNTHETIC_FILE_KEYS,
}
