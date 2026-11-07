/**
 * layering.test.js — the architectural guard for the engine's module
 * boundaries.
 *
 * ADR-001 D4 defines the engine as layers, and the whole "harden one module at a time"
 * plan depends on those layers holding: a domain module that can reach the
 * filesystem is a module you cannot test with injected data, and v1's worst
 * couplings (`lib/codegen-code-connect` importing the 2,005-line linter for one
 * constant; engines owning fs, git and argv) were exactly this rule going
 * unenforced. A comment cannot enforce it; this test can.
 *
 * The rules, from the ADR plus one clarification:
 *
 *   core     → nothing internal OUTSIDE core (siblings within core/ are fine —
 *              the alternative is duplicating the severity constants, which is
 *              the v1 sin the ADR calls out by name)
 *   sources  → core (+ own siblings)
 *   spec     → core (+ own siblings)
 *   modules  → core, spec (+ own siblings) — NEVER sources: modules take
 *              snapshots as arguments and never acquire them
 *   cli      → any layer
 *
 * A relative import that resolves OUTSIDE these layers is also a failure. That
 * rule began life as the strangler boundary (D11: no new file may import the
 * old engine) and outlived it — the old engine is deleted, but "a layer file
 * reaching somewhere that is not a layer" is still exactly the edge worth
 * refusing, now for stray paths rather than legacy ones.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src")

const LAYERS = ["core", "sources", "spec", "providers", "modules", "cli"]

// layer → the set of OTHER layers it may import from.
const ALLOWED = {
  core: [],
  sources: ["core"],
  spec: ["core"],
  providers: ["core"],
  modules: ["core", "spec"],
  cli: ["core", "sources", "spec", "providers", "modules"],
}

function walk(dir) {
  let out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out // layer dir not created yet — vacuously fine
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out = out.concat(walk(full))
    else if (name.endsWith(".mjs")) out.push(full)
  }
  return out
}

// Every static `import ... from "x"` / `export ... from "x"` specifier, plus
// dynamic `import("x")` with a literal argument. Deliberately regex-based: the
// engine ships no parser dependency, and the source is plain ESM with imports at
// the top — a parser here would be more machinery than the rule is worth.
function importsOf(file) {
  const src = readFileSync(file, "utf8")
  const specs = []
  const staticRe =
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g
  const bareRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g
  const dynamicRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g
  for (const re of [staticRe, bareRe, dynamicRe]) {
    let m
    while ((m = re.exec(src))) specs.push(m[1])
  }
  return specs
}

// Which layer does an on-disk path belong to? null when it isn't under one.
function layerOf(absPath) {
  const rel = relative(SRC, absPath)
  if (rel.startsWith("..")) return null
  const [top] = rel.split(/[\\/]/)
  return LAYERS.includes(top) ? top : null
}

const layerFiles = LAYERS.flatMap(layer => walk(join(SRC, layer)))

describe("module layering (ADR-001 D4)", () => {
  test("there is at least one source file to check", () => {
    // Guards against the whole suite passing vacuously if the dirs vanish or a
    // path assumption breaks — a green layering test must mean something.
    expect(layerFiles.length).toBeGreaterThan(0)
  })

  test.each(LAYERS)("%s respects its allowed imports", layer => {
    const violations = []
    for (const file of walk(join(SRC, layer))) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith(".")) continue // node: builtin or external package
        const target = resolve(dirname(file), spec)
        const targetLayer = layerOf(target)
        const rel = relative(SRC, file)

        if (targetLayer === null) {
          violations.push(
            `${rel} imports "${spec}" — which resolves outside the declared layers.`,
          )
          continue
        }
        if (targetLayer === layer) continue // sibling within the same layer
        if (!ALLOWED[layer].includes(targetLayer)) {
          violations.push(
            `${rel} imports "${spec}" (layer "${targetLayer}") — "${layer}" may import ` +
              `${ALLOWED[layer].length ? ALLOWED[layer].map(l => `"${l}"`).join(", ") : "no other layer"}.`,
          )
        }
      }
    }
    expect(violations).toEqual([])
  })

  test("modules never import sources (they receive snapshots, never acquire them)", () => {
    // Called out separately from the table above because it is the rule most
    // likely to be broken by a well-meaning change ("I just need to read the
    // snapshot here"), and the one that would cost the most: a module that
    // touches the filesystem cannot be driven by injected fixture data, which
    // is how every domain module is tested.
    const offenders = []
    for (const file of walk(join(SRC, "modules"))) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith(".")) continue
        if (layerOf(resolve(dirname(file), spec)) === "sources") {
          offenders.push(`${relative(SRC, file)} → ${spec}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // -------------------------------------------------------------------------
  // The FRAMEWORK boundary (ADR-001 D16), the symmetric twin of D12's rule
  // that no vendor may be named outside its provider.
  // -------------------------------------------------------------------------

  // Deliberately a SUBSTRING match, not `\b…\b`. The first version of this
  // guard used word boundaries and caught nothing: `\bjsx\b` does not match
  // `jsxNode` (no non-word char follows), and `\bjsx` does not match
  // `describeJsxNode` either — so it would have missed the exact identifiers
  // that prompted it. The cost is that an innocent word like "reactive"
  // trips it; rewording is cheap, a silently-decorative guard is not.
  const FRAMEWORK_TERMS = /(jsx|react|angular|vue|svelte|tsx)/i

  // The one permanent exemption, by exact line content rather than line
  // number so it cannot drift onto a different line. `core/config.mjs` must
  // name the DEFAULT framework (`code.framework`), and that default cannot
  // come from `sources/`: `ALLOWED.core` is empty, so core imports nothing
  // internal outside itself. The second line is the comment pointing at the
  // adapter that now owns the non-component file suffixes (#117). Anything
  // else framework-flavoured in the file is reported like anywhere else.
  const FRAMEWORK_ALLOWED = {
    [join("core", "config.mjs")]: new Set([
      'export const DEFAULT_CODE = { framework: "react" }',
      "// framework adapter supplies them (sources/react/adapter.mjs) and a project",
    ]),
  }

  function frameworkOffenders(rel, text) {
    const allowed = FRAMEWORK_ALLOWED[rel] ?? new Set()
    const offenders = []
    text.split("\n").forEach((line, i) => {
      if (FRAMEWORK_TERMS.test(line) && !allowed.has(line.trim())) {
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`)
      }
    })
    return offenders
  }

  test("core/ and modules/ never name a UI framework", () => {
    // `sources/<framework>/` is the only place a framework may be named. The
    // layers below it compare NORMALIZED CENSUSES — a props list and a
    // `{kind, tag, name, children}` tree — and neither shape has anything
    // React-specific in it; an Angular template or a web component's shadow
    // DOM maps onto the same structure.
    //
    // This is enforced rather than left to convention because the leak that
    // actually happened was VOCABULARY, not imports: `modules/anatomy.mjs`
    // carried `jsxNode`, `describeJsxNode`, and a `"rendered JSX"` message
    // while its logic was already framework-neutral. Import-based layering
    // could never have caught that, and the finding MESSAGE is a public
    // surface — consumers read it in reports — so renaming it after release
    // would be a breaking change.
    const offenders = []
    for (const layer of ["core", "modules"]) {
      for (const file of walk(join(SRC, layer))) {
        const rel = relative(SRC, file)
        offenders.push(...frameworkOffenders(rel, readFileSync(file, "utf8")))
      }
    }
    expect(offenders).toEqual([])
  })

  test("the framework-term guard actually matches something (negative control)", () => {
    // Without this, the test above would pass just as happily if the regex
    // were broken or the walk returned nothing — the exact way a guard rots
    // into decoration. The React adapter is where these terms BELONG, so it
    // is the honest place to prove the detector still fires.
    const adapterFiles = walk(join(SRC, "sources", "react"))
    expect(adapterFiles.length).toBeGreaterThan(0)
    const matched = adapterFiles.filter(file =>
      FRAMEWORK_TERMS.test(readFileSync(file, "utf8")),
    )
    expect(matched.length).toBe(adapterFiles.length)
  })

  test("the core/config.mjs allowance covers only its documented default (negative control)", () => {
    // The allowance must stay as small as the lines it names: the real file
    // is clean, and any OTHER framework term added to it is still reported.
    const rel = join("core", "config.mjs")
    const text = readFileSync(join(SRC, rel), "utf8")
    expect(frameworkOffenders(rel, text)).toEqual([])
    const leaked = `${text}\nif (code.framework === "react") useJsxDefaults()\n`
    expect(frameworkOffenders(rel, leaked)).toHaveLength(1)
    // ...and an allowed line outside config.mjs is no exemption at all.
    expect(
      frameworkOffenders(join("core", "other.mjs"), text).length,
    ).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // The VENDOR boundary (ADR-001 D12, ADR-003 Amendment 1) — the symmetric
  // twin of the framework guard above, but deliberately WIDER: core/ +
  // spec/ + sources/ + modules/ + schema/*.json, not just core/ + modules/.
  // `sources/<framework>/` is out of the framework guard's scope by design
  // (that's where an adapter is SUPPOSED to name its framework); a vendor
  // leak has no equivalent safe harbor, and the two worst violations found
  // before this guard shipped sat in spec/ and schema/*.json — a
  // core/+modules/ scope would have reported this guard green while
  // `spec/codegen.mjs` imported `@figma/code-connect`. That file is now
  // `providers/figma/codegen.mjs` (Phase 5.1) — `providers/` is out of this
  // guard's scan entirely, by construction: D12 names it as the ONE place a
  // vendor MAY be named, so scanning it would just assert the opposite of
  // what D12 says. The one-release `spec/codegen.mjs` exemption Amendment 1
  // named is gone with the move, not decorated over. cli/ is left OUT of
  // this guard's scan too: it selects a provider by config key and
  // dynamic-imports it, never a hardcoded import — the structural leak D12
  // exists to prevent. A cli/ docblock is still free to name the vendor when
  // describing real product behavior (e.g. an `init` prompt), the same way
  // README.md does; that's product prose, not the engine reasoning about a
  // vendor it shouldn't know. Match style borrowed from the framework guard
  // above: a case-insensitive substring, not a word boundary.
  // -------------------------------------------------------------------------

  test("core/, spec/, sources/, modules/, and schema/*.json never name a design-tool vendor", () => {
    const VENDOR_TERMS = /figma/i

    const offenders = []
    for (const layer of ["core", "spec", "sources", "modules"]) {
      for (const file of walk(join(SRC, layer))) {
        const rel = relative(SRC, file)
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (VENDOR_TERMS.test(line)) {
              offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`)
            }
          })
      }
    }

    const SCHEMA_DIR = resolve(SRC, "..", "schema")
    for (const name of readdirSync(SCHEMA_DIR)) {
      if (!name.endsWith(".json")) continue
      readFileSync(join(SCHEMA_DIR, name), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (VENDOR_TERMS.test(line)) {
            offenders.push(
              `schema/${name}:${i + 1}  ${line.trim().slice(0, 80)}`,
            )
          }
        })
    }

    expect(offenders).toEqual([])
  })

  test("the vendor-term guard actually matches something (negative control)", () => {
    // Without this, the test above would pass just as happily if the regex
    // or the walk were broken — the exact way a guard rots into decoration.
    // `providers/figma/` is out of THIS guard's scan by design (D12: it's
    // the ONE place allowed to name the vendor), so — mirroring the
    // framework guard's own negative control exactly — point the SAME
    // walk+regex machinery at that directory instead: every real file
    // there genuinely does mention Figma, so if this ever reports zero,
    // the walk or the regex broke, not the repo.
    const VENDOR_TERMS = /figma/i
    const providerFiles = walk(join(SRC, "providers", "figma"))
    expect(providerFiles.length).toBeGreaterThan(0)
    const matched = providerFiles.filter(file =>
      VENDOR_TERMS.test(readFileSync(file, "utf8")),
    )
    expect(matched.length).toBe(providerFiles.length)
  })

  test("no layer file imports anything outside the layers", () => {
    const offenders = []
    for (const file of layerFiles) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith(".")) continue
        const target = resolve(dirname(file), spec)
        if (layerOf(target) === null) {
          offenders.push(`${relative(SRC, file)} → ${spec}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Diagnostic messages must not carry an absolute filesystem path (issue #133).
//
// Every diagnostic already reports a repo-relative `file`; several then
// repeated the path ABSOLUTELY inside `message`, putting the checkout location
// into the report. Two things break: determinism, which ADR-001's working
// method makes a gate (the same commit produced different reports on two
// machines, and in CI vs. locally), and privacy — `$HOME` ends up in reports
// consumers commit, paste into PRs, and publish.
//
// A source-text guard rather than a behavioral one because it prevents
// REINTRODUCTION: the fix is to interpolate the relative label already in
// scope, and the way it regresses is someone reaching for the absolute
// variable again.
// ---------------------------------------------------------------------------

describe("diagnostics never embed an absolute path", () => {
  // The variables holding an absolute path in `sources/`. A message template
  // interpolating one of these is the defect.
  const ABSOLUTE_IN_MESSAGE =
    /message:\s*`[^`]*\$\{(filePath|absPath|dirAbs|fileAbs)\}/

  function offendersIn(dir) {
    return walk(dir).filter(file =>
      ABSOLUTE_IN_MESSAGE.test(readFileSync(file, "utf8")),
    )
  }

  test("no message template in sources/ interpolates an absolute path", () => {
    expect(offendersIn(join(SRC, "sources"))).toEqual([])
  })

  test("the guard actually fires on an injected violation (negative control)", () => {
    // Without this the test above passes just as happily if the regex is
    // wrong — which is exactly how the framework guard shipped matching
    // NOTHING (`\bjsx\b` never matches `jsxNode`). Prove the detector fires.
    const violation = [
      "return fail({",
      "  code: 'missing-tokens-file',",
      "  message: `no tokens file at ${absPath}`,",
      "})",
    ].join("\n")
    expect(ABSOLUTE_IN_MESSAGE.test(violation)).toBe(true)

    // ...and does NOT fire on the fixed form, or it would be unsatisfiable.
    const fixed = violation.replace("${absPath}", "${tokensFile}")
    expect(ABSOLUTE_IN_MESSAGE.test(fixed)).toBe(false)
  })
})
