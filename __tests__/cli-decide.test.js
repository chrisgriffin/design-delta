/**
 * cli-decide.test.js — `design-delta decide` end to end (issue #62): the
 * decisions it reports, the page it writes or serves, and what a save writes
 * back into the project.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runAudit } from "../src/cli/commands/audit.mjs"
import { runDecide } from "../src/cli/commands/decide.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

function streams() {
  const out = []
  const err = []
  return {
    io: {
      stdout: { write: c => (out.push(c), true) },
      stderr: { write: c => (err.push(c), true) },
    },
    out: () => out.join(""),
    err: () => err.join(""),
  }
}

async function inProject(project, fn) {
  const cwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn()
  } finally {
    process.chdir(cwd)
  }
}

async function decide(project, argv) {
  const s = streams()
  const code = await inProject(project, () =>
    runDecide(argv, { io: s.io, globalOpts: { config: project.configPath } }),
  )
  return { code, stdout: s.out(), stderr: s.err() }
}

async function auditJson(project) {
  const s = streams()
  await inProject(project, () =>
    runAudit(["--json"], {
      io: s.io,
      globalOpts: { config: project.configPath },
    }),
  )
  return JSON.parse(s.out())
}

const readConfig = project =>
  JSON.parse(readFileSync(project.configPath, "utf8"))
const decisionsPath = project =>
  join(project.root, project.config.paths.decisionsFile)

async function decisionsOf(project) {
  const { code, stdout } = await decide(project, ["--json"])
  expect(code).toBe(0)
  return JSON.parse(stdout)
}

function writeAnswers(project, answers) {
  const path = join(project.root, "answers.json")
  writeFileSync(path, JSON.stringify({ version: 1, answers }))
  return path
}

describe("design-delta decide", () => {
  let project
  beforeEach(() => {
    project = createSyntheticProject()
  })
  afterEach(() => project.cleanup?.())

  it("--json reports one decision per rule and pile, counts the code pile, and writes nothing", async () => {
    const before = readFileSync(project.configPath, "utf8")
    const first = await decide(project, ["--json"])
    const second = await decide(project, ["--json"])
    expect(first.code).toBe(0)
    expect(first.stdout).toBe(second.stdout)

    const result = JSON.parse(first.stdout)
    expect(result.codeCount).toBeGreaterThan(0)
    expect(result.code).toHaveLength(result.codeCount)
    expect(result.decisions.length).toBeGreaterThan(0)
    for (const d of result.decisions) {
      expect(d.id).toMatch(/^[0-9a-f]{12}$/)
      expect(d.pile).not.toBe("code")
      expect(d.options).toContain(d.recommended)
      expect(d.reason).toBeTruthy()
    }
    const keys = result.decisions.map(d => `${d.ruleId} ${d.pile}`)
    expect(new Set(keys).size).toBe(keys.length)

    expect(readFileSync(project.configPath, "utf8")).toBe(before)
    expect(existsSync(decisionsPath(project))).toBe(false)
  })

  it("--apply writes an accept as an exemption, and the next audit lists it as decided", async () => {
    const { decisions } = await decisionsOf(project)
    const target = decisions.find(d => d.ruleId === "tokens/token-unreferenced")
    const { code, stderr } = await decide(project, [
      "--apply",
      writeAnswers(project, [
        { id: target.id, answer: "accept", reason: "keeps the scale complete" },
      ]),
    ])
    expect(code).toBe(0)
    expect(stderr).toContain("accept tokens/token-unreferenced")

    const config = readConfig(project)
    expect(config.exemptions["tokens/token-unreferenced"]).toEqual(
      target.entities.map(entity => ({
        entity,
        decision: "accepted",
        reason: "keeps the scale complete",
      })),
    )
    const audit = await auditJson(project)
    expect(
      audit.decided.map(d => d.ruleId).filter(r => r === target.ruleId).length,
    ).toBe(target.entities.length)
    expect(
      audit.findings.some(f => f.ruleId === "tokens/token-unreferenced"),
    ).toBe(false)
    const after = await decisionsOf(project)
    expect(after.decisions.find(d => d.id === target.id)).toBeUndefined()
  })

  it("--apply records a change answer in the decisions file, and drops it once its findings are gone", async () => {
    const { decisions } = await decisionsOf(project)
    const target = decisions.find(d => d.ruleId === "tokens/token-unreferenced")
    expect(
      (
        await decide(project, [
          "--apply",
          writeAnswers(project, [
            { id: target.id, answer: "fix-code", note: "use it in Badge" },
          ]),
        ])
      ).code,
    ).toBe(0)
    const file = JSON.parse(readFileSync(decisionsPath(project), "utf8"))
    expect(file.entries).toEqual([
      {
        id: target.id,
        ruleId: target.ruleId,
        pile: target.pile,
        entities: target.entities,
        answer: "fix-code",
        note: "use it in Badge",
      },
    ])
    expect((await decisionsOf(project)).decisions[0].answered).toBeTruthy()

    // An entry no current finding names is done: reported, then removed.
    file.entries.push({
      id: "000000000000",
      ruleId: target.ruleId,
      pile: target.pile,
      entities: ["long.gone"],
      answer: "fix-code",
    })
    writeFileSync(decisionsPath(project), JSON.stringify(file))
    expect((await decisionsOf(project)).done).toHaveLength(1)
    const { stderr } = await decide(project, [
      "--apply",
      writeAnswers(project, []),
    ])
    expect(stderr).toContain("done, removed")
    expect(
      JSON.parse(readFileSync(decisionsPath(project), "utf8")).entries,
    ).toHaveLength(1)
  })

  it("removes done entries on a run that saves nothing, and never on --json", async () => {
    const { decisions } = await decisionsOf(project)
    const target = decisions.find(d => d.ruleId === "tokens/token-unreferenced")
    const gone = {
      id: "000000000000",
      ruleId: target.ruleId,
      pile: target.pile,
      entities: ["long.gone"],
      answer: "fix-code",
    }
    writeFileSync(
      decisionsPath(project),
      JSON.stringify({ version: 1, entries: [gone] }),
    )
    expect((await decisionsOf(project)).done).toEqual([gone])
    expect(
      JSON.parse(readFileSync(decisionsPath(project), "utf8")).entries,
    ).toHaveLength(1)

    const { code, stderr } = await decide(project, [
      "--no-serve",
      "--no-timestamp",
    ])
    expect(code).toBe(0)
    expect(stderr).toContain("done, removed")
    expect(
      JSON.parse(readFileSync(decisionsPath(project), "utf8")).entries,
    ).toEqual([])
  })

  it("keeps an entry whose rule did not run: turned off, or a design rule with no snapshot", async () => {
    const off = createSyntheticProject({
      rules: { "tokens/token-unreferenced": "off" },
    })
    try {
      const entries = [
        {
          id: "000000000000",
          ruleId: "tokens/token-unreferenced",
          pile: "tokens-config",
          entities: ["long.gone"],
          answer: "fix-code",
        },
        {
          id: "111111111111",
          ruleId: "coverage/design-missing",
          pile: "design",
          entities: ["long.gone"],
          answer: "change-design",
        },
      ]
      writeFileSync(decisionsPath(off), JSON.stringify({ version: 1, entries }))
      expect((await decisionsOf(off)).done).toEqual([])
      expect((await decide(off, ["--no-serve", "--no-timestamp"])).code).toBe(0)
      expect(
        JSON.parse(readFileSync(decisionsPath(off), "utf8")).entries,
      ).toEqual(entries)
    } finally {
      off.cleanup?.()
    }
  })

  it("--apply refuses an answers file naming an unknown decision, and writes nothing", async () => {
    const before = readFileSync(project.configPath, "utf8")
    const { code, stderr } = await decide(project, [
      "--apply",
      writeAnswers(project, [
        { id: "ffffffffffff", answer: "accept", reason: "r" },
      ]),
    ])
    expect(code).toBe(1)
    expect(stderr).toContain("ffffffffffff")
    expect(readFileSync(project.configPath, "utf8")).toBe(before)
    expect(existsSync(decisionsPath(project))).toBe(false)
  })

  it("--no-serve writes one self-contained page whose saved answers apply like a served save", async () => {
    const { code, stderr } = await decide(project, [
      "--no-serve",
      "--no-timestamp",
    ])
    expect(code).toBe(0)
    const page = join(
      project.root,
      project.config.paths.reportDir,
      "decisions.html",
    )
    expect(stderr).toContain("decisions.html")
    const html = readFileSync(page, "utf8")
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).not.toMatch(/\b(src|href)=["']?(https?:)?\/\//i)
    expect(html).not.toContain('"token"')
  })

  it("serves on 127.0.0.1 only, refuses a post without the token, and exits 0 after a valid save", async () => {
    const { decisions } = await decisionsOf(project)
    const target = decisions.find(d => d.ruleId === "tokens/token-unreferenced")
    const s = streams()
    const cwd = process.cwd()
    process.chdir(project.root)
    let running
    try {
      running = runDecide(["--port", "0"], {
        io: s.io,
        globalOpts: { config: project.configPath },
      })
      let url
      for (let i = 0; i < 200 && !url; i++) {
        url = s.out().match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0]
        if (!url) await new Promise(r => setTimeout(r, 25))
      }
      expect(url).toBeTruthy()

      const page = await fetch(url)
      expect(page.status).toBe(200)
      const html = await page.text()
      const token = html.match(/"token":"([0-9a-f]+)"/)[1]

      const body = JSON.stringify({
        version: 1,
        answers: [
          { id: target.id, answer: "waive", reason: "not this release" },
        ],
      })
      const post = headers =>
        fetch(`${url}answers`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body,
        })

      expect((await post({})).status).toBe(403)
      expect((await post({ "x-design-delta-token": "wrong" })).status).toBe(403)
      expect(readConfig(project).exemptions).toBeUndefined()

      const saved = await post({ "x-design-delta-token": token })
      expect(saved.status).toBe(200)
      expect((await saved.json()).written).toHaveLength(1)
      expect(await running).toBe(0)
    } finally {
      process.chdir(cwd)
    }
    expect(
      readConfig(project).exemptions["tokens/token-unreferenced"][0],
    ).toMatchObject({ decision: "waived", reason: "not this release" })
  })

  it("refuses a served save when the config changed on disk while the page was open", async () => {
    const { decisions } = await decisionsOf(project)
    const target = decisions.find(d => d.ruleId === "tokens/token-unreferenced")
    const s = streams()
    const cwd = process.cwd()
    process.chdir(project.root)
    let running
    try {
      running = runDecide(["--port", "0"], {
        io: s.io,
        globalOpts: { config: project.configPath },
      })
      let url
      for (let i = 0; i < 200 && !url; i++) {
        url = s.out().match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0]
        if (!url) await new Promise(r => setTimeout(r, 25))
      }
      const token = (await (await fetch(url)).text()).match(
        /"token":"([0-9a-f]+)"/,
      )[1]

      const save = () =>
        fetch(`${url}answers`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-design-delta-token": token,
          },
          body: JSON.stringify({
            version: 1,
            answers: [{ id: target.id, answer: "waive", reason: "later" }],
          }),
        })
      const original = readFileSync(project.configPath, "utf8")
      const edited = { ...readConfig(project), _note: "edited while open" }
      writeFileSync(project.configPath, JSON.stringify(edited, null, 2))
      const refused = await save()
      expect(refused.status).toBe(400)
      expect((await refused.json()).errors.join(" ")).toContain(
        "changed on disk",
      )
      expect(readConfig(project)).toEqual(edited)

      // Put back as it was read, the same save goes through.
      writeFileSync(project.configPath, original)
      expect((await save()).status).toBe(200)
      expect(await running).toBe(0)
    } finally {
      process.chdir(cwd)
    }
  })

  it("rejects --port that is not a port", async () => {
    const { code, stderr } = await decide(project, ["--port", "http"])
    expect(code).toBe(1)
    expect(stderr).toContain("--port")
  })
})

describe("handleDecideRequest", () => {
  it("refuses a request whose Host is not the loopback address it serves", async () => {
    const { handleDecideRequest } =
      await import("../src/cli/commands/decide.mjs")
    const ctx = { page: "<p>", token: "t", port: 4000, onAnswers: () => ({}) }
    const req = host => ({
      method: "GET",
      url: "/",
      headers: { host },
      body: "",
    })
    expect(handleDecideRequest(req("evil.example:4000"), ctx).status).toBe(421)
    expect(handleDecideRequest(req("127.0.0.1:4000"), ctx).status).toBe(200)
    expect(handleDecideRequest(req("localhost:4000"), ctx).status).toBe(200)
    expect(
      handleDecideRequest(
        {
          method: "POST",
          url: "/answers",
          headers: {
            host: "127.0.0.1:4000",
            "x-design-delta-token": "t",
            "content-type": "text/plain",
          },
          body: "{}",
        },
        ctx,
      ).status,
    ).toBe(415)
  })
})
