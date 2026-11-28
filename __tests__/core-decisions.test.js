/**
 * core-decisions.test.js — findings become decisions, answers become writes
 * (issue #62). Pure functions, so plain objects in and out.
 */

import {
  EMPTY_DECISIONS_FILE,
  applyAnswers,
  buildDecisions,
  validateDecisionsFile,
} from "../src/core/decisions.mjs"

const f = (ruleId, entity, over = {}) => ({
  ruleId,
  severity: "review",
  surface: ruleId.split("/")[0],
  side: "code",
  entity,
  message: `${ruleId} on ${entity}`,
  ...over,
})

const FINDINGS = [
  f("components/prop-missing", "badge", { severity: "error" }),
  f("tokens/token-unreferenced", "brand.red"),
  f("tokens/token-unreferenced", "brand.blue"),
  f("coverage/uncontracted-component", "src/Card.tsx", {
    surface: "coverage",
    severity: "warn",
  }),
  f("coverage/stale-exemption", "old.token", {
    surface: "coverage",
    side: "spec",
    data: { ruleId: "tokens/token-unreferenced", entity: "old.token" },
  }),
]

const byRule = (decisions, ruleId) => decisions.find(d => d.ruleId === ruleId)

describe("buildDecisions", () => {
  it("groups non-code findings into one decision per rule and pile, and counts the code pile", () => {
    const { decisions, code, codeCount } = buildDecisions({
      findings: FINDINGS,
    })
    expect(codeCount).toBe(1)
    expect(code.map(c => c.ruleId)).toEqual(["components/prop-missing"])
    expect(decisions.map(d => d.ruleId)).toEqual([
      "coverage/uncontracted-component",
      "coverage/stale-exemption",
      "tokens/token-unreferenced",
    ])
    const tokens = byRule(decisions, "tokens/token-unreferenced")
    expect(tokens.entities).toEqual(["brand.blue", "brand.red"])
    expect(tokens.options).toContain(tokens.recommended)
    expect(tokens.reason).toBeTruthy()
  })

  it("derives ids from the rule, pile and entities only, whatever the order", () => {
    const a = buildDecisions({ findings: FINDINGS }).decisions
    const b = buildDecisions({ findings: [...FINDINGS].reverse() }).decisions
    expect(a.map(d => d.id)).toEqual(b.map(d => d.id))
    const fewer = buildDecisions({ findings: FINDINGS.slice(0, 2) }).decisions
    expect(byRule(fewer, "tokens/token-unreferenced").id).not.toBe(
      byRule(a, "tokens/token-unreferenced").id,
    )
  })

  it("keys a stale exemption by the rule it sits under", () => {
    const stale = byRule(
      buildDecisions({ findings: FINDINGS }).decisions,
      "coverage/stale-exemption",
    )
    expect(stale.entities).toEqual(["tokens/token-unreferenced old.token"])
    expect(stale.items[0].exemptedFrom).toBe("tokens/token-unreferenced")
  })

  it("marks answered decisions, and reports entries whose findings are gone as done", () => {
    const previous = {
      version: 1,
      entries: [
        {
          id: "x",
          ruleId: "tokens/token-unreferenced",
          pile: "tokens-config",
          entities: ["brand.red"],
          answer: "fix-code",
        },
        {
          id: "y",
          ruleId: "tokens/token-unreferenced",
          pile: "tokens-config",
          entities: ["gone.token"],
          answer: "fix-code",
        },
      ],
    }
    const { decisions, done } = buildDecisions({ findings: FINDINGS, previous })
    expect(byRule(decisions, "tokens/token-unreferenced").answered).toEqual([
      { answer: "fix-code", note: undefined, entities: ["brand.red"] },
    ])
    expect(done.map(e => e.id)).toEqual(["y"])
  })

  it("lists every answered entry of a rule, not only the first", () => {
    const entry = (id, entities, answer, note) => ({
      id,
      ruleId: "tokens/token-unreferenced",
      pile: "tokens-config",
      entities,
      answer,
      ...(note ? { note } : {}),
    })
    const { decisions } = buildDecisions({
      findings: FINDINGS,
      previous: {
        version: 1,
        entries: [
          entry("a", ["brand.red"], "fix-code", "use it"),
          entry("b", ["brand.blue"], "change-contract"),
        ],
      },
    })
    expect(byRule(decisions, "tokens/token-unreferenced").answered).toEqual([
      { answer: "fix-code", note: "use it", entities: ["brand.red"] },
      { answer: "change-contract", note: undefined, entities: ["brand.blue"] },
    ])
  })

  it("never reports an entry done when its rule did not run", () => {
    const gone = {
      id: "y",
      ruleId: "coverage/design-missing",
      pile: "design",
      entities: ["Chip"],
      answer: "change-design",
    }
    const previous = { version: 1, entries: [gone] }
    expect(
      buildDecisions({
        findings: FINDINGS,
        previous,
        wasEvaluated: () => false,
      }).done,
    ).toEqual([])
    const asked = []
    const { done } = buildDecisions({
      findings: FINDINGS,
      previous,
      wasEvaluated: e => (asked.push(e), true),
    })
    expect(done).toEqual([gone])
    expect(asked).toEqual([gone])
  })

  it("routes an invalid contract's code-side findings to the contract pile", () => {
    const { decisions, codeCount } = buildDecisions({
      findings: FINDINGS,
      invalidContracts: { ids: ["badge"], files: [] },
    })
    expect(codeCount).toBe(0)
    expect(byRule(decisions, "components/prop-missing")).toMatchObject({
      pile: "contract",
      entities: ["badge"],
    })
  })
})

describe("applyAnswers", () => {
  const setup = () => {
    const { decisions, done } = buildDecisions({ findings: FINDINGS })
    const config = {
      _comment: "kept",
      paths: { componentsDir: "ui" },
      exemptions: {
        _note: "kept too",
        "tokens/token-unreferenced": [
          "old.token",
          { entity: "brand.red", decision: "waived", reason: "earlier" },
        ],
      },
    }
    return { decisions, done, config, decisionsFile: EMPTY_DECISIONS_FILE }
  }
  const id = (decisions, ruleId) => byRule(decisions, ruleId).id

  it("writes accept, waive and track as exemptions, keeping every existing key", () => {
    const s = setup()
    const before = structuredClone(s.config)
    const { config, written } = applyAnswers({
      ...s,
      answers: {
        version: 1,
        answers: [
          {
            id: id(s.decisions, "tokens/token-unreferenced"),
            answer: "accept",
            reason: "keeps the scale complete",
          },
          {
            id: id(s.decisions, "coverage/uncontracted-component"),
            answer: "track",
            issue: "acme/ui#4",
          },
        ],
      },
    })
    expect(s.config).toEqual(before)
    expect(Object.keys(config)).toEqual(["_comment", "paths", "exemptions"])
    expect(config.exemptions._note).toBe("kept too")
    expect(config.exemptions["tokens/token-unreferenced"]).toEqual([
      "old.token",
      { entity: "brand.red", decision: "waived", reason: "earlier" },
      {
        entity: "brand.blue",
        decision: "accepted",
        reason: "keeps the scale complete",
      },
    ])
    expect(config.exemptions["coverage/uncontracted-component"]).toEqual([
      { entity: "src/Card.tsx", decision: "tracked", issue: "acme/ui#4" },
    ])
    expect(written.map(w => w.to)).toEqual(["config", "config"])
  })

  it("removes a stale exemption", () => {
    const s = setup()
    const { config } = applyAnswers({
      ...s,
      answers: {
        version: 1,
        answers: [
          {
            id: id(s.decisions, "coverage/stale-exemption"),
            answer: "remove-exemption",
          },
        ],
      },
    })
    expect(config.exemptions["tokens/token-unreferenced"]).toEqual([
      { entity: "brand.red", decision: "waived", reason: "earlier" },
    ])
  })

  it("records change answers in the decisions file, replacing an earlier answer for the same entities", () => {
    const s = setup()
    const tokens = id(s.decisions, "tokens/token-unreferenced")
    const first = applyAnswers({
      ...s,
      answers: {
        version: 1,
        answers: [{ id: tokens, answer: "fix-code", entities: ["brand.blue"] }],
      },
    })
    expect(first.config).toEqual(s.config)
    const second = applyAnswers({
      ...s,
      decisionsFile: first.decisionsFile,
      answers: {
        version: 1,
        answers: [
          {
            id: id(s.decisions, "coverage/uncontracted-component"),
            answer: "change-contract",
            note: "write it",
          },
          { id: tokens, answer: "fix-code", note: "use both" },
        ],
      },
    })
    expect(second.decisionsFile.entries).toEqual([
      {
        id: id(s.decisions, "coverage/uncontracted-component"),
        ruleId: "coverage/uncontracted-component",
        pile: "contract",
        entities: ["src/Card.tsx"],
        answer: "change-contract",
        note: "write it",
      },
      {
        id: tokens,
        ruleId: "tokens/token-unreferenced",
        pile: "tokens-config",
        entities: ["brand.blue", "brand.red"],
        answer: "fix-code",
        note: "use both",
      },
    ])
    expect(validateDecisionsFile(second.decisionsFile)).toEqual([])
  })

  it("narrows an earlier change answer to the entities a new one leaves, never dropping them", () => {
    const s = setup()
    const tokens = id(s.decisions, "tokens/token-unreferenced")
    const earlier = {
      id: tokens,
      ruleId: "tokens/token-unreferenced",
      pile: "tokens-config",
      entities: ["brand.blue", "brand.red"],
      answer: "change-contract",
      note: "both belong in the contract",
    }
    const { decisionsFile } = applyAnswers({
      ...s,
      decisionsFile: { version: 1, entries: [earlier] },
      answers: {
        version: 1,
        answers: [{ id: tokens, answer: "fix-code", entities: ["brand.red"] }],
      },
    })
    expect(decisionsFile.entries).toEqual([
      { ...earlier, entities: ["brand.blue"] },
      {
        id: tokens,
        ruleId: "tokens/token-unreferenced",
        pile: "tokens-config",
        entities: ["brand.red"],
        answer: "fix-code",
      },
    ])
    expect(validateDecisionsFile(decisionsFile)).toEqual([])
  })

  it("drops done entries", () => {
    const s = setup()
    const doneEntry = {
      id: "y",
      ruleId: "tokens/token-unreferenced",
      pile: "tokens-config",
      entities: ["gone.token"],
      answer: "fix-code",
    }
    const { decisionsFile } = applyAnswers({
      ...s,
      decisionsFile: { version: 1, entries: [doneEntry] },
      done: [doneEntry],
      answers: { version: 1, answers: [] },
    })
    expect(decisionsFile.entries).toEqual([])
  })

  it.each([
    [{ id: "nope", answer: "accept", reason: "r" }, /no such decision/],
    [
      { answer: "accept", reason: "r", rule: "tokens" },
      /not an option|is not an option/,
    ],
    [{ answer: "accept" }, /needs a reason/],
    [{ answer: "waive", reason: "  " }, /needs a reason/],
    [{ answer: "track" }, /needs an issue/],
    [
      { answer: "accept", reason: "r", entities: ["other"] },
      /not in this decision/,
    ],
  ])("refuses %j and changes nothing", (partial, message) => {
    const s = setup()
    const ruleId =
      partial.rule === "tokens"
        ? "coverage/stale-exemption"
        : "tokens/token-unreferenced"
    const { rule, ...answer } = partial
    void rule
    expect(() =>
      applyAnswers({
        ...s,
        answers: {
          version: 1,
          answers: [{ id: id(s.decisions, ruleId), ...answer }],
        },
      }),
    ).toThrow(message)
  })

  it("refuses a document that is not an answers file", () => {
    const s = setup()
    expect(() => applyAnswers({ ...s, answers: { answers: "x" } })).toThrow(
      /version|answers/,
    )
  })
})
