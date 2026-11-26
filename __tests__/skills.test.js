/**
 * skills.test.js — every skill this package ships says true things about the
 * engine it ships with.
 *
 * A packaged skill claims to describe "exactly the version installed", and a
 * consumer's agent follows it literally. So a skill that names a subcommand,
 * a flag, a rule id or a config key the engine no longer has is a bug a
 * consumer hits one repo away, as an agent running a command that does not
 * exist. Nothing here is a hand-written list of what is valid: every expected
 * name is read from the registry the engine itself dispatches, parses or
 * validates from, so renaming one fails this suite until the skill follows.
 *
 * Only CODE is checked — fenced blocks and backtick spans. Every command name
 * is also an ordinary English word ("a design-delta audit", "the report"), so
 * prose is no evidence either way.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { GLOBAL_FLAGS_HELP, SUBCOMMANDS, run } from "../src/cli/main.mjs"
import { buildFullRuleRegistry } from "../src/cli/rule-registry.mjs"
import { listProviders } from "../src/providers/index.mjs"
import { createSyntheticProject } from "./helpers/synthetic-project.mjs"

const ROOT = join(import.meta.dirname, "..")
const SKILLS_DIR = join(ROOT, "skills")

const SKILLS = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => ({
    name: entry.name,
    file: join("skills", entry.name, "SKILL.md"),
    text: readFileSync(join(SKILLS_DIR, entry.name, "SKILL.md"), "utf8"),
  }))

const SUBCOMMAND_NAMES = Object.keys(SUBCOMMANDS)
const GLOBAL_FLAGS = GLOBAL_FLAGS_HELP.flatMap(([flags]) =>
  flags.split(",").map(flag => flag.trim().split(" ")[0]),
)
const RULE_IDS = new Set(buildFullRuleRegistry().ids())
const RULE_SURFACES = new Set([...RULE_IDS].map(id => id.split("/")[0]))
const CONFIG_SCHEMA = JSON.parse(
  readFileSync(join(ROOT, "schema/config.schema.json"), "utf8"),
)

/** `{ audit: ["--components", …], … }`, read from each command's own parser spec. */
const FLAGS = Object.fromEntries(
  await Promise.all(
    SUBCOMMAND_NAMES.map(async name => {
      const { FLAG_SPEC } = await import(`../src/cli/commands/${name}.mjs`)
      return [name, [...FLAG_SPEC.boolean, ...(FLAG_SPEC.value ?? [])]]
    }),
  ),
)

/**
 * The frontmatter block's `key: value` lines, or null when the file does not
 * open with one — a skill with no frontmatter is not discoverable at all.
 */
function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (!match) return null
  return Object.fromEntries(
    match[1].split("\n").map(line => {
      const at = line.indexOf(": ")
      return at === -1 ? [line, ""] : [line.slice(0, at), line.slice(at + 2)]
    }),
  )
}

/** Every piece of code in a skill: each fenced or indented line, each span. */
function codeOf(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "")
  const fenced = [...body.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap(
    ([, block]) => block.split("\n"),
  )
  const outside = body.replace(/^```[^\n]*\n[\s\S]*?^```/gm, "")
  const indented = outside.split("\n").filter(line => /^ {4}\S/.test(line))
  const spans = [...outside.matchAll(/`([^`\n]+)`/g)].map(([, span]) => span)
  return [...fenced, ...indented, ...spans]
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * Each `design-delta <word> …` invocation in a piece of code, as
 * `{ subcommand, flags }`. The package name followed by a space and a word is
 * an invocation; `design-delta@1.2.3`, `design-delta-doctor`,
 * `--repo owner/design-delta --json` and `npm view design-delta version`
 * (npm's own argument, the package's name) are not.
 */
function invocations(code) {
  return [
    ...code.matchAll(
      /(?:^|[\s"'(])(?<!npm \w+ )design-delta ([a-z][\w-]*)([^|;&]*)/g,
    ),
  ].map(([, subcommand, rest]) => ({
    subcommand,
    flags: [...rest.matchAll(/(?:^|\s)(--[a-z][\w-]*)/g)].map(m => m[1]),
  }))
}

/** What a skill's code says about the engine that the engine does not have. */
function problems(skill) {
  const found = []
  for (const code of codeOf(skill.text)) {
    for (const { subcommand, flags } of invocations(code)) {
      if (!SUBCOMMAND_NAMES.includes(subcommand)) {
        found.push(`${skill.file}: no subcommand \`${subcommand}\``)
        continue
      }
      for (const flag of flags) {
        if (!FLAGS[subcommand].includes(flag) && !GLOBAL_FLAGS.includes(flag)) {
          found.push(`${skill.file}: \`${subcommand}\` takes no \`${flag}\``)
        }
      }
    }
    // A bare `<subcommand> --flag` span: `audit --check`, `verify --json`.
    const bare = code.match(/^([a-z]+)((?: --[a-z][\w-]*)+)$/)
    if (bare && SUBCOMMAND_NAMES.includes(bare[1])) {
      for (const flag of bare[2].trim().split(" ")) {
        if (!FLAGS[bare[1]].includes(flag) && !GLOBAL_FLAGS.includes(flag)) {
          found.push(`${skill.file}: \`${bare[1]}\` takes no \`${flag}\``)
        }
      }
    }
    // A span shaped like a rule id: `<surface>/<kebab-name>`.
    const rule = code.match(/^([a-z]+)\/[a-z][a-z-]*$/)
    if (rule && RULE_SURFACES.has(rule[1]) && !RULE_IDS.has(code)) {
      found.push(`${skill.file}: no rule \`${code}\``)
    }
    // A span shaped like a config key: `paths.tokensFile`, `conventions`.
    const key = code.match(/^(paths|conventions)\.([A-Za-z]+)$/)
    if (key && !CONFIG_SCHEMA.properties[key[1]].properties[key[2]]) {
      found.push(`${skill.file}: no config key \`${code}\``)
    }
  }
  return found
}

const PROVIDERS = listProviders()

/** The registered providers' names a text carries, matched case-insensitively. */
function vendorsNamed(text) {
  const lower = text.toLowerCase()
  return PROVIDERS.filter(name => lower.includes(name.toLowerCase()))
}

/**
 * Each piece of a skill's code that names a fixed path under a system
 * temporary directory. A fixed path outlives an interrupted run and is shared
 * by every run on the machine, so the next run fails on it or reads another
 * run's files (#39). The directory is named literally (`/tmp/`, `/var/tmp/`,
 * `/private/tmp/`) or through `$TMPDIR` (`$TMPDIR/x`, `"${TMPDIR:-/tmp}/x"`);
 * only `mktemp`'s own template argument (`"${TMPDIR:-/tmp}/name.XXXXXX"`)
 * makes a path that is not fixed, so that argument is the one not matched.
 */
const MKTEMP_ARGUMENT =
  /\bmktemp((?:\s+-[A-Za-z]+)*)\s+(?:"[^"]*"|'[^']*'|\S+)/g
const LITERAL_TEMP_DIR = /(?:^|[^\w.-])\/(?:private\/)?(?:var\/)?tmp\//
const TMPDIR_VARIABLE = /\$\{?TMPDIR\b/

function fixedTempPaths(skill) {
  return codeOf(skill.text)
    .filter(code => {
      const rest = code.replace(MKTEMP_ARGUMENT, "mktemp$1")
      return LITERAL_TEMP_DIR.test(rest) || TMPDIR_VARIABLE.test(rest)
    })
    .map(code => `${skill.file}: fixed temporary path in \`${code}\``)
}

/**
 * Each piece of a skill's code that pastes a `<work>` path unquoted. `mktemp`
 * prints a path under `$TMPDIR`, which can hold a space, and an unquoted
 * `rm -rf <work>` then removes the wrong paths and leaves the real one.
 */
function unquotedWorkPaths(skill) {
  return codeOf(skill.text)
    .filter(code => code !== "<work>" && /(?:^|[^"])<work>/.test(code))
    .map(code => `${skill.file}: unquoted <work> in \`${code}\``)
}

describe("the packaged skills", () => {
  it("ships the audit, authoring, build, design-build, docs, doctor, refresh and resolve skills", () => {
    expect(SKILLS.map(skill => skill.name)).toEqual(
      expect.arrayContaining([
        "design-delta",
        "design-delta-author",
        "design-delta-build",
        "design-delta-build-design",
        "design-delta-docs",
        "design-delta-doctor",
        "design-delta-refresh",
        "design-delta-resolve",
      ]),
    )
  })

  it("has registries to check against", () => {
    // Non-vacuity: an empty registry would pass every skill by matching nothing.
    expect(SUBCOMMAND_NAMES.length).toBeGreaterThan(0)
    expect(GLOBAL_FLAGS).toEqual(
      expect.arrayContaining(["--config", "--quiet"]),
    )
    expect(FLAGS.audit).toContain("--json")
    expect(RULE_IDS.size).toBeGreaterThan(0)
    expect(CONFIG_SCHEMA.properties.paths.properties.tokensFile).toBeDefined()
  })

  describe.each(SKILLS)("$file", skill => {
    it("opens with frontmatter naming its own directory, with a description", () => {
      const fields = frontmatter(skill.text)
      expect(fields).not.toBeNull()
      expect(fields.name).toBe(skill.name)
      expect(fields.description.trim().length).toBeGreaterThan(0)
    })

    it("names only subcommands, flags, rules and config keys the engine has", () => {
      expect(problems(skill)).toEqual([])
    })

    it("has code to check", () => {
      expect(codeOf(skill.text).length).toBeGreaterThan(0)
    })

    it("#39 names no fixed path under a system temporary directory", () => {
      expect(fixedTempPaths(skill)).toEqual([])
    })

    // A skill describes the engine, and the engine names a design tool only
    // inside its provider (ADR-001 D12). A skill that names one reads as
    // written for that tool, and sends an agent connected to another one
    // after tools it does not have.
    it("names no design tool a provider is registered for", () => {
      expect(vendorsNamed(skill.text)).toEqual([])
    })
  })

  it("has providers to look for, and finds a vendor where one is named", () => {
    expect(PROVIDERS.length).toBeGreaterThan(0)
    expect(
      vendorsNamed(`Open the file in ${PROVIDERS[0].toUpperCase()}.`),
    ).toEqual([PROVIDERS[0]])
  })

  it("#39 the doctor skill makes one temporary directory per run and removes it", () => {
    const code = codeOf(
      SKILLS.find(skill => skill.name === "design-delta-doctor").text,
    )
    const made = code.filter(line => line.includes("mktemp -d"))
    expect(made).toHaveLength(1)
    // The worktree's branch carries a per-run suffix, never one fixed name.
    const added = code.filter(line => line.startsWith("git worktree add "))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatch(/ -b \S*<suffix>/)
    expect(code).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^git worktree remove --force "<work>\/project"$/,
        ),
        expect.stringMatching(/^rm -rf "<work>"$/),
      ]),
    )
  })

  it("#39 the doctor skill quotes every <work> path it pastes into a command", () => {
    const doctor = SKILLS.find(skill => skill.name === "design-delta-doctor")
    expect(codeOf(doctor.text).some(code => code.includes('"<work>'))).toBe(
      true,
    )
    expect(unquotedWorkPaths(doctor)).toEqual([])
  })

  // The failure paths. Without these, a scrape that found nothing would pass
  // every skill above.
  describe("a skill that has gone stale", () => {
    const stale = text => problems({ file: "skills/x/SKILL.md", text })

    it("is caught naming a subcommand the engine lacks", () => {
      expect(
        stale("Run:\n\n```\nnpx design-delta frobnicate --json\n```\n"),
      ).toEqual(["skills/x/SKILL.md: no subcommand `frobnicate`"])
    })

    it("is caught naming a flag its subcommand does not take", () => {
      expect(stale("Run `design-delta audit --component badge`.\n")).toEqual([
        "skills/x/SKILL.md: `audit` takes no `--component`",
      ])
      expect(stale("The gate is `verify --strict`.\n")).toEqual([
        "skills/x/SKILL.md: `verify` takes no `--strict`",
      ])
      expect(stale("    npx design-delta contracts --fix\n")).toEqual([
        "skills/x/SKILL.md: `contracts` takes no `--fix`",
      ])
    })

    it("is caught naming a rule or a config key that does not exist", () => {
      expect(stale("Fix every `styles/not-a-rule`.\n")).toEqual([
        "skills/x/SKILL.md: no rule `styles/not-a-rule`",
      ])
      expect(stale("Read `paths.tokenFile`.\n")).toEqual([
        "skills/x/SKILL.md: no config key `paths.tokenFile`",
      ])
    })

    it("accepts what the engine does have, and leaves prose alone", () => {
      expect(
        stale(
          "Ask for a design-delta frobnication. Run `npx design-delta audit --json --config x.json`, " +
            "then `verify --fail-on warn`; see `coverage/uncontracted-component` and `paths.tokensFile`.\n" +
            "`gh release view --repo owner/design-delta --json tagName`, `npm view design-delta version` and `design-delta@1.0.0` are not invocations.\n",
        ),
      ).toEqual([])
    })

    it("#39 is caught naming a fixed temporary path, and a mktemp template is not", () => {
      const paths = text => fixedTempPaths({ file: "skills/x/SKILL.md", text })
      expect(
        paths("Run:\n\n```\ngit worktree add /tmp/trial main\n```\n"),
      ).toEqual([
        "skills/x/SKILL.md: fixed temporary path in `git worktree add /tmp/trial main`",
      ])
      expect(paths("Write `audit --json > /var/tmp/a.json`.\n")).toHaveLength(1)
      expect(paths("Read `/private/tmp/a.json`.\n")).toHaveLength(1)
      // The same fixed path, written through $TMPDIR.
      expect(
        paths(
          'Write `audit --json > "${TMPDIR:-/tmp}/drift-baseline.json"`.\n',
        ),
      ).toHaveLength(1)
      expect(paths("Run `cd $TMPDIR/doctor`.\n")).toHaveLength(1)
      expect(paths('Run `cd "${TMPDIR}/doctor"`.\n')).toHaveLength(1)
      expect(
        paths(
          'Run `mktemp -d "${TMPDIR:-/tmp}/a.XXXXXX" && cd "$TMPDIR/doctor"`.\n',
        ),
      ).toHaveLength(1)
      expect(
        paths(
          'Run `mktemp -d "${TMPDIR:-/tmp}/trial.XXXXXX"`, then `cd <work>/project`; ' +
            "see `docs/tmp/notes.md`. A run in /tmp/prose is not code.\n",
        ),
      ).toEqual([])
    })

    it("#39 is caught pasting <work> unquoted, and a quoted one is not", () => {
      const unquoted = text =>
        unquotedWorkPaths({ file: "skills/x/SKILL.md", text })
      expect(unquoted("Run:\n\n```\nrm -rf <work>\n```\n")).toEqual([
        "skills/x/SKILL.md: unquoted <work> in `rm -rf <work>`",
      ])
      expect(unquoted("Run `cd <work>/project`.\n")).toHaveLength(1)
      expect(unquoted("Write `audit --json > <work>/a.json`.\n")).toHaveLength(
        1,
      )
      expect(
        unquoted(
          'That path is `<work>`. Run `rm -rf "<work>"` and `cd "<work>/project"`.\n',
        ),
      ).toEqual([])
    })

    it("is caught with no frontmatter, or one missing its name", () => {
      expect(frontmatter("# A skill\n")).toBeNull()
      expect(frontmatter("---\ndescription: x\n---\n\n# A skill\n").name).toBe(
        undefined,
      )
    })
  })
})

// The build skill tells an agent which of `audit --json`'s findings belong to
// one component: those whose `entity` is the contract's id, or the id followed
// by `.` and an element. That is a claim about the engine's output, so it is
// pinned against a real run: the synthetic project's `badge` carries
// deliberate drift, and every finding the contract surfaces raise must be
// attributable to a contract that way.
describe("the entity form the build skill filters on", () => {
  it("every contract-surface finding names a contract id, or an element under one", async () => {
    const project = createSyntheticProject()
    const cwd = process.cwd()
    const capture = async argv => {
      const out = []
      const code = await run([...argv, "--config", project.configPath], {
        stdout: { write: chunk => out.push(chunk) },
        stderr: { write() {} },
      })
      return { code, payload: JSON.parse(out.join("")) }
    }
    let audit
    let contracts
    process.chdir(project.root)
    try {
      audit = await capture(["audit", "--json", "--code-only"])
      contracts = await capture(["contracts", "--json"])
    } finally {
      process.chdir(cwd)
      project.cleanup()
    }
    expect(audit.code).toBe(0)
    const ids = contracts.payload.contracts.map(contract => contract.id)
    expect(ids).toContain("badge")

    const owned = audit.payload.findings.filter(finding =>
      ["components", "styles", "anatomy"].includes(finding.surface),
    )
    expect(owned.length).toBeGreaterThan(0)
    for (const finding of owned) {
      expect(
        ids.some(
          id => finding.entity === id || finding.entity.startsWith(`${id}.`),
        ),
      ).toBe(true)
    }
    expect(owned.some(finding => finding.entity === "badge")).toBe(true)
  })
})

// The docs skill tells an agent where each thing a contract states goes on a
// component's documentation page. A contract field the skill never names is a
// field no page will ever carry, and nobody would notice: the page would just
// be quietly incomplete. So every name is read from the contract schema, and
// a field added there fails this until the skill says where it goes (or that
// it stays off the page). That covers every object the schema defines a
// contract's fields in: the top level, a prop, an anatomy node and a rendered
// shape, a subcomponent, the sources, an element's styles and a style
// override's `when`. The one set it does not walk is the style property
// names themselves (`padding`, `color`, …): the skill places every one of
// them in a single row, as a binding's property, so a property added to the
// schema already has its place on the page.
describe("the docs skill covers what a contract can state", () => {
  const schema = JSON.parse(
    readFileSync(join(ROOT, "schema/contract.schema.json"), "utf8"),
  )
  const docs = SKILLS.find(skill => skill.name === "design-delta-docs")
  /** Whether some piece of the skill's code carries `name` as a whole word. */
  const names = (text, name) =>
    codeOf(text).some(code => code.split(/[^A-Za-z$_]+/).includes(name))
  const unnamed = fields => fields.filter(field => !names(docs.text, field))

  it("reads a schema that has the fields to check", () => {
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["props", "anatomy", "styles", "intent"]),
    )
    expect(schema.$defs.prop.properties.type.enum).toContain("slot")
    expect(Object.keys(schema.$defs.anatomyNode.properties)).toContain(
      "presentIf",
    )
  })

  it("names every top-level contract field", () => {
    expect(unnamed(Object.keys(schema.properties))).toEqual([])
  })

  it("names every prop field and every prop type", () => {
    expect(unnamed(Object.keys(schema.$defs.prop.properties))).toEqual([])
    expect(unnamed(schema.$defs.prop.properties.type.enum)).toEqual([])
  })

  it("names every anatomy node field, and the rendered-shape block", () => {
    expect(unnamed(Object.keys(schema.$defs.anatomyNode.properties))).toEqual(
      [],
    )
    expect(unnamed(["$variants"])).toEqual([])
  })

  it("names every intent and codegen field", () => {
    expect(unnamed(Object.keys(schema.properties.intent.properties))).toEqual(
      [],
    )
    expect(unnamed(Object.keys(schema.$defs.codegen.properties))).toEqual([])
  })

  it("names every subcomponent, sources and element-styles field", () => {
    expect(unnamed(Object.keys(schema.$defs.subcomponent.properties))).toEqual(
      [],
    )
    expect(unnamed(Object.keys(schema.$defs.sources.properties))).toEqual([])
    expect(
      unnamed(Object.keys(schema.$defs.sources.properties.code.properties)),
    ).toEqual([])
    expect(unnamed(Object.keys(schema.$defs.elementStyles.properties))).toEqual(
      [],
    )
  })

  it("names a style override's and a rendered shape's own keys", () => {
    const styleProps = Object.keys(schema.$defs.styleProps.properties)
    const ownKeys = Object.keys(schema.$defs.styleVariant.properties).filter(
      key => !styleProps.includes(key),
    )
    expect(ownKeys).toContain("when")
    expect(unnamed(ownKeys)).toEqual([])
    expect(
      unnamed(Object.keys(schema.$defs.anatomyVariant.properties)),
    ).toEqual([])
  })

  it("is caught when a field is missing, and prose does not count", () => {
    const text = "The page lists props. See `anatomy` and `intent.usedFor`.\n"
    expect(names(text, "anatomy")).toBe(true)
    expect(names(text, "usedFor")).toBe(true)
    expect(names(text, "props")).toBe(false)
    expect(names(text, "used")).toBe(false)
  })
})

// The design-build skill tells an agent what each construct the design side is
// compared on becomes in a design-tool component. A marker, a mechanism, a
// prop type or an anatomy field it never names is one the agent builds by
// guess, and the audit then reports drift the procedure caused. So every name
// is read from the contract schema: the top-level fields (each one either
// built or stated to stay off the design side), every prop type, both
// deviation markers' values and the rename's keys, every mechanism, and every
// anatomy node field.
describe("the design-build skill covers what the design side is compared on", () => {
  const schema = JSON.parse(
    readFileSync(join(ROOT, "schema/contract.schema.json"), "utf8"),
  )
  const skill = SKILLS.find(entry => entry.name === "design-delta-build-design")
  /** Whether some piece of the skill's code carries `name` as a whole word. */
  const names = name =>
    codeOf(skill.text).some(code => code.split(/[^A-Za-z$_]+/).includes(name))
  const unnamed = fields => fields.filter(field => !names(field))
  const designDeviation = schema.$defs.designDeviation.oneOf
  const rename = designDeviation.find(shape => shape.type === "object")

  it("reads a schema that has the fields to check", () => {
    expect(designDeviation.map(shape => shape.const)).toEqual(
      expect.arrayContaining(["none", "unverified"]),
    )
    expect(rename.properties.mechanism.enum).toContain("toggle")
    expect(Object.keys(schema.$defs.anatomyNode.properties)).toContain(
      "designLayer",
    )
  })

  it("names every top-level contract field", () => {
    expect(unnamed(Object.keys(schema.properties))).toEqual([])
  })

  it("names every prop type, and both sides' deviation markers", () => {
    expect(unnamed(schema.$defs.prop.properties.type.enum)).toEqual([])
    expect(
      unnamed(designDeviation.map(shape => shape.const).filter(Boolean)),
    ).toEqual([])
    expect(unnamed(Object.keys(rename.properties))).toEqual([])
    expect(unnamed(rename.properties.mechanism.enum)).toEqual([])
    expect(unnamed(schema.$defs.codeDeviation.enum)).toEqual([])
  })

  it("names every anatomy node field, and the rendered-shape block", () => {
    expect(unnamed(Object.keys(schema.$defs.anatomyNode.properties))).toEqual(
      [],
    )
    expect(unnamed(["$variants"])).toEqual([])
  })
})
