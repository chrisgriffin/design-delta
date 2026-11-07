/**
 * cli-lint.test.js — `design-delta lint`'s exemptions wiring (issue #181).
 *
 * `audit` got its exemptions coverage first, on the argument that "a
 * unit-tested module that no command calls would reproduce the bug exactly".
 * That argument applies one command over: `lint` reads the same `exemptions`
 * block, and nothing exercised it here.
 *
 * The case these pin is specifically the one a findings-derived
 * `wasEvaluated` gets WRONG. A rule that ran and came back completely clean
 * emits nothing, so a set built from `findings.map(f => f.ruleId)` does not
 * contain it — and its exemptions are then never stale-checked at all. That is
 * the fully-rotted waiver list, which is the case the stale report exists for.
 * The set has to come from the gates the run took, not from what it emitted.
 */

import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { run } from "../src/cli/main.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function lintJson(project, extraArgv = []) {
  const { stream: stdout, writes: outWrites } = fakeStream()
  const { stream: stderr, writes: errWrites } = fakeStream()
  const cwd = process.cwd()
  process.chdir(project.root)
  try {
    const code = await run(
      ["--config", project.configPath, "lint", "--json", ...extraArgv],
      { stdout, stderr },
    )
    return {
      code,
      ...JSON.parse(outWrites.join("")),
      stderr: errWrites.join(""),
    }
  } finally {
    process.chdir(cwd)
  }
}

// A raw, non-JSON-parsing capture — for the validation-failure paths below,
// where nothing is ever written to stdout and `lintJson`'s JSON.parse would
// throw on the empty string before the assertion ever ran.
async function lintCapture(project, extraArgv = []) {
  const { stream: stdout, writes: outWrites } = fakeStream()
  const { stream: stderr, writes: errWrites } = fakeStream()
  const cwd = process.cwd()
  process.chdir(project.root)
  try {
    const code = await run(
      ["--config", project.configPath, "lint", ...extraArgv],
      { stdout, stderr },
    )
    return { code, stdout: outWrites.join(""), stderr: errWrites.join("") }
  } finally {
    process.chdir(cwd)
  }
}

// The fixture's default tokens are `acme.color.{fg,bg,danger}` — governing
// `acme.color` with all three leaves in the set means the rule RUNS and
// finds nothing. That is the point: a clean run is a run that happened, not
// one that never started.
const CLEAN_VOCABULARY = {
  vocabularies: [{ paths: ["acme.color"], values: ["fg", "bg", "danger"] }],
}

// Omits `danger`, so `acme.color.danger` violates — a real finding to waive.
const VIOLATING_VOCABULARY = {
  vocabularies: [{ paths: ["acme.color"], values: ["fg", "bg"] }],
}

// Omits BOTH `bg` and `danger` — two independent violations, so a test can
// prove an exemption waives the ONE entity it names and not the whole rule.
const TWO_VIOLATIONS_VOCABULARY = {
  vocabularies: [{ paths: ["acme.color"], values: ["fg"] }],
}

describe("design-delta lint — exemptions (#181)", () => {
  it("stale-checks a rule that ran CLEAN, not just one that reported", async () => {
    const project = createSyntheticProject({
      lint: CLEAN_VOCABULARY,
      exemptions: { "lint/vocabulary-invalid": ["long.gone.token"] },
    })
    try {
      const result = await lintJson(project)
      // Precondition: the rule really did report nothing.
      expect(
        result.findings.filter(f => f.ruleId === "lint/vocabulary-invalid"),
      ).toEqual([])

      const stale = result.findings.filter(
        f => f.ruleId === "coverage/stale-exemption",
      )
      expect(stale).toHaveLength(1)
      expect(stale[0].entity).toBe("long.gone.token")
    } finally {
      project.cleanup()
    }
  })

  it("filters a lint finding the exemption actually matches", async () => {
    const project = createSyntheticProject({
      lint: TWO_VIOLATIONS_VOCABULARY,
      exemptions: { "lint/vocabulary-invalid": ["acme.color.danger"] },
    })
    try {
      const result = await lintJson(project)
      const invalid = result.findings.filter(
        f => f.ruleId === "lint/vocabulary-invalid",
      )
      expect(invalid.map(f => f.entity)).not.toContain("acme.color.danger")
      // The OTHER violation is untouched — an exemption waives one entity,
      // not the rule.
      expect(invalid.map(f => f.entity)).toContain("acme.color.bg")
      expect(
        result.findings.filter(f => f.ruleId === "coverage/stale-exemption"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("does not report OTHER rules' exemptions stale when --rule narrows", async () => {
    // `--rule` filters the output. A rule whose findings were filtered away
    // has no evidence behind it, so narrowing to one rule must not turn every
    // other rule's exemptions into stale reports.
    const project = createSyntheticProject({
      lint: CLEAN_VOCABULARY,
      exemptions: { "lint/vocabulary-invalid": ["long.gone.token"] },
    })
    try {
      const result = await lintJson(project, ["--rule", "core/valid-color"])
      expect(
        result.findings.filter(f => f.ruleId === "coverage/stale-exemption"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("does not stale-check a rule turned off", async () => {
    // A disabled rule returns before producing anything, so it has reported
    // nothing for the same "no evidence" reason as a surface that never ran.
    const project = createSyntheticProject({
      lint: CLEAN_VOCABULARY,
      rules: { "lint/vocabulary-invalid": "off" },
      exemptions: { "lint/vocabulary-invalid": ["long.gone.token"] },
    })
    try {
      const result = await lintJson(project)
      expect(
        result.findings.filter(f => f.ruleId === "coverage/stale-exemption"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("does not stale-check lint/token-rule when no lint rules are configured", async () => {
    // `censusTokenLint` returns `ok: true` on its "nothing to delegate" path,
    // so `ok` alone cannot distinguish "ran and found nothing" from "never
    // ran". Only `delegated` can, and this is the case that tells them apart:
    // no `lint.rules` block at all.
    const project = createSyntheticProject({
      exemptions: { "lint/token-rule": ["some.token"] },
    })
    try {
      const result = await lintJson(project)
      expect(
        result.findings.filter(f => f.ruleId === "coverage/stale-exemption"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("reports how many findings the exemptions hid", async () => {
    // A waiver that silences findings without saying so turns "0 findings"
    // into a claim the run did not earn.
    const project = createSyntheticProject({
      lint: VIOLATING_VOCABULARY,
      exemptions: { "lint/vocabulary-invalid": ["acme.color.danger"] },
    })
    try {
      const result = await lintJson(project)
      expect(result.counts.exempted).toBe(1)
    } finally {
      project.cleanup()
    }
  })

  it("never reports a glob stale", async () => {
    const project = createSyntheticProject({
      lint: CLEAN_VOCABULARY,
      exemptions: { "lint/vocabulary-invalid": ["acme.color.legacy-*"] },
    })
    try {
      const result = await lintJson(project)
      expect(
        result.findings.filter(f => f.ruleId === "coverage/stale-exemption"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })
})

describe("design-delta lint — unknown rule ids fail loudly (#188)", () => {
  it("exits 1 on a typo'd id in `rules`, naming it on stderr", async () => {
    const project = createSyntheticProject({
      lint: CLEAN_VOCABULARY,
      rules: { "lint/vocabulary-invlid": "warn" },
    })
    try {
      const { code, stdout, stderr } = await lintCapture(project)
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toMatch(
        /unknown rule id 'lint\/vocabulary-invlid' in rules/,
      )
      expect(stderr).toMatch(/did you mean 'lint\/vocabulary-invalid'/)
    } finally {
      project.cleanup()
    }
  })

  it("exits 1 on a typo'd id in `exemptions`, naming it on stderr", async () => {
    const project = createSyntheticProject({
      lint: CLEAN_VOCABULARY,
      exemptions: { "lint/vocabulary-invlid": ["acme.color.danger"] },
    })
    try {
      const { code, stdout, stderr } = await lintCapture(project)
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toMatch(
        /unknown rule id 'lint\/vocabulary-invlid' in exemptions/,
      )
    } finally {
      project.cleanup()
    }
  })

  it("checks against the full engine registry, not only lint's own rules", async () => {
    const project = createSyntheticProject({
      lint: CLEAN_VOCABULARY,
      rules: { "tokens/token-unreferened": "off" },
    })
    try {
      const { code, stderr } = await lintCapture(project)
      expect(code).toBe(1)
      expect(stderr).toMatch(/unknown rule id 'tokens\/token-unreferened'/)
    } finally {
      project.cleanup()
    }
  })

  it("a valid rules/exemptions config is unaffected", async () => {
    const project = createSyntheticProject({
      lint: CLEAN_VOCABULARY,
      rules: { "lint/vocabulary-invalid": "warn" },
      exemptions: { "lint/vocabulary-invalid": ["long.gone.token"] },
    })
    try {
      const { code, stderr } = await lintCapture(project)
      expect(code).toBe(0)
      expect(stderr).not.toMatch(/unknown rule id/)
    } finally {
      project.cleanup()
    }
  })

  it('treats --config "" as a named-but-missing config, not the default', async () => {
    const { stream: stdout } = fakeStream()
    const { stream: stderr, writes } = fakeStream()
    const code = await run(["--config", "", "lint"], { stdout, stderr })
    expect(code).toBe(1)
    expect(writes.join("")).toContain("design-delta lint: no config at ")
  })
})

// ---------------------------------------------------------------------------
// Document-level diagnostics, reported ONCE (issue #352)
// ---------------------------------------------------------------------------

describe("design-delta lint — diagnostics are not double-reported (#352)", () => {
  // With a ported rule configured, this command runs TWO censuses over the
  // same tokens file — the delegating lint census and the token census. Both
  // judge the document's aliases, so before the dedupe every document-level
  // diagnostic appeared twice in one report.
  const ALIASED_TOKENS = {
    acme: {
      color: {
        brand: { $type: "color", $value: "{acme.color.primary}" },
      },
    },
  }

  // The same document PLUS the alias target, standing in for a prep step
  // that folds something in — which is what makes the authored file's alias
  // `alias-resolved-after-preprocessing` rather than plainly broken.
  function writeResolved(project) {
    writeFileSync(
      join(project.root, "design/generated/parsed.tokens.json"),
      JSON.stringify({
        acme: {
          color: {
            fg: { $type: "color", $value: "#111111" },
            bg: { $type: "color", $value: "#fafafa" },
            danger: { $type: "color", $value: "#b00020" },
            primary: { $type: "color", $value: "#0000ff" },
            brand: { $type: "color", $value: "{acme.color.primary}" },
          },
        },
      }),
    )
  }

  it("reports an alias diagnostic once when a ported rule is configured", async () => {
    const project = createSyntheticProject({
      tokens: ALIASED_TOKENS,
      lint: { ...CLEAN_VOCABULARY, rules: { "core/valid-color": "error" } },
    })
    writeResolved(project)
    try {
      const result = await lintJson(project)
      const alias = result.diagnostics.filter(
        d => d.code === "alias-resolved-after-preprocessing",
      )
      // Precondition: the diagnostic really did fire — a dedupe that passed
      // because nothing was emitted would prove nothing.
      expect(alias).toHaveLength(1)
      expect(alias[0].tokenId).toBe("acme.color.brand")
    } finally {
      project.cleanup()
    }
  })

  it("still reports it when only the delegating census runs", async () => {
    const project = createSyntheticProject({
      tokens: ALIASED_TOKENS,
      lint: { rules: { "core/valid-color": "error" } },
    })
    writeResolved(project)
    try {
      const result = await lintJson(project)
      expect(
        result.diagnostics.filter(
          d => d.code === "alias-resolved-after-preprocessing",
        ),
      ).toHaveLength(1)
    } finally {
      project.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Contract lint (issue #406) through the command: the contracts are loaded
// only when `lint.contracts` is configured, and a finding reaches the
// payload with the exemption machinery seeing the rule as evaluated.
// ---------------------------------------------------------------------------

describe("design-delta lint — contract lint (#406)", () => {
  it("loads the contracts and reports an enum outside the configured vocabulary", async () => {
    // The synthetic badge declares size: sm|md|lg; governing `size` with only
    // sm|md makes "lg" the one finding.
    const project = createSyntheticProject({
      lint: {
        contracts: {
          nameCase: "camelCase",
          enumVocabularies: [{ props: ["size"], values: ["sm", "md"] }],
        },
      },
    })
    try {
      const result = await lintJson(project)
      const enumFindings = result.findings.filter(
        f => f.ruleId === "lint/contract-enum-invalid",
      )
      expect(enumFindings).toHaveLength(1)
      expect(enumFindings[0].entity).toBe("badge")
      expect(enumFindings[0].data.invalid).toEqual(["lg"])
      // Every synthetic contract is camelCase — the case rule ran and found
      // nothing, which is a run that happened, not one that never started.
      expect(
        result.findings.filter(f => f.ruleId === "lint/contract-name-case"),
      ).toEqual([])
    } finally {
      project.cleanup()
    }
  })

  it("stale-checks a contract-lint exemption only when the rule ran", async () => {
    const project = createSyntheticProject({
      lint: { contracts: { nameCase: "camelCase" } },
      exemptions: { "lint/contract-name-case": ["long-gone"] },
    })
    try {
      const result = await lintJson(project)
      const stale = result.findings.filter(
        f => f.ruleId === "coverage/stale-exemption",
      )
      expect(stale.map(f => f.entity)).toEqual(["long-gone"])
    } finally {
      project.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Design naming lint (issue #407) through the command: snapshots are read
// only when patterns are configured, and a missing design side is a stated
// diagnostic, never silence.
// ---------------------------------------------------------------------------

describe("design-delta lint — design naming (#407)", () => {
  it("reports design names that miss the configured patterns", async () => {
    // Synthetic snapshots: variables fg/default + bg/default, components
    // Field + Badge. A variables pattern requiring an underscore fails both
    // variables; the component pattern accepts both.
    const project = createSyntheticProject({
      design: { provider: "figma" },
      lint: {
        designNames: {
          variablePattern: "^[a-z]+_[a-z]+$",
          componentPattern: "^[A-Z]",
        },
      },
    })
    try {
      const result = await lintJson(project)
      const named = result.findings.filter(
        f => f.ruleId === "lint/design-name-invalid",
      )
      expect(named.map(f => f.entity)).toEqual(["bg/default", "fg/default"])
      expect(named.every(f => f.side === "design")).toBe(true)
    } finally {
      project.cleanup()
    }
  })

  it("states an unreadable design side as a diagnostic instead of silently checking nothing", async () => {
    const project = createSyntheticProject({
      // No design.provider configured — the check cannot load a provider.
      lint: { designNames: { variablePattern: "^[a-z]+$" } },
    })
    try {
      const result = await lintJson(project)
      expect(
        result.findings.filter(f => f.ruleId === "lint/design-name-invalid"),
      ).toEqual([])
      expect(
        result.diagnostics.some(
          d =>
            d.code === "design-side-unavailable" &&
            d.message.includes("design naming lint skipped"),
        ),
      ).toBe(true)
    } finally {
      project.cleanup()
    }
  })
})
