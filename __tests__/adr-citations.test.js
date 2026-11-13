/**
 * adr-citations.test.js — every ADR a rule description or a scaffold note
 * cites names design-delta as its owner (#12).
 *
 * Both are read inside a consumer's own repo: a rule's `description` in
 * `docs/rules.md` and in reports, a `_scaffold` note in the contract file the
 * scaffolder drafts there. A bare `ADR-002` in either reads as the consumer's
 * own ADR-002. This holds the attribution over every registered rule and
 * every note a scaffold writes, wherever in the contract it sits, through the
 * one scan in `helpers/adr-citations.mjs`.
 */

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { runScaffold } from "../src/cli/commands/scaffold.mjs"
import * as index from "../src/index.mjs"
import { buildScaffoldAnatomy } from "../src/spec/scaffold.mjs"
import {
  citesAdr,
  scaffoldNotes,
  sourceLiterals,
  unattributedAdrs,
} from "./helpers/adr-citations.mjs"
import { ruleArraysOf } from "./helpers/rule-arrays.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

// The one module that writes `_scaffold` notes (`src/spec/contracts.mjs`
// only reads them back).
const SCAFFOLD_SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/spec/scaffold.mjs",
)

// Every rule array the package exports, found by shape exactly as
// `rules-reference.test.js` finds the ones `docs/rules.md` must document, so
// a registry exported under any name is scanned here too.
const rules = ruleArraysOf(index).flat()

/** `<rule id>: bare <citation>` for each unattributed citation. */
function ruleProblems(ruleList) {
  return ruleList.flatMap(rule =>
    unattributedAdrs(rule.description ?? "").map(
      adr => `${rule.id}: bare ${adr}`,
    ),
  )
}

/** `<file>:<line>: bare <citation>` for each unattributed citation. */
function literalProblems(file, sourceText) {
  return sourceLiterals(sourceText, file).flatMap(([line, text]) =>
    unattributedAdrs(text).map(adr => `${file}:${line}: bare ${adr}`),
  )
}

/** `<file><pointer>: bare <citation>` for each unattributed citation. */
function noteProblems(contracts) {
  return contracts.flatMap(([file, contract]) =>
    scaffoldNotes(contract).flatMap(([at, text]) =>
      unattributedAdrs(text).map(adr => `${file}${at}: bare ${adr}`),
    ),
  )
}

// Three branches, two rendering the same root: the drafted variant carries
// the `when` note and `$variants` the undraftable-branch note — the two notes
// that cite an ADR today.
const SHARED_ROOT_BRANCHES_TSX = `export type TrackedLinkProps = {
  href?: string
  pending?: boolean
  label: string
}

export function TrackedLink({ href, pending, label }: TrackedLinkProps) {
  if (href) return <a href={href}>{label}</a>
  if (pending) return <span>{label}</span>
  return <span>unavailable</span>
}
`

// Two branches sharing a root, disagreeing below it: the first child's text
// differs (an unresolved position) and the list renders a different number
// of items (an unresolved child count).
const TOGGLE_TSX = `export type ToggleProps = {
  on: boolean
}

export function Toggle({ on }: ToggleProps) {
  if (on) {
    return (
      <div>
        <span>On</span>
        <ul>
          <li>a</li>
          <li>b</li>
        </ul>
      </div>
    )
  }
  return (
    <div>
      <span>Off</span>
      <ul>
        <li>a</li>
      </ul>
    </div>
  )
}
`

// Every other place a note lands: an instance node, content bound to a
// local, two content values in one position, content the census cannot
// classify, and a style element and style variant whose `var()` matches no
// token or several.
const CARD_TSX = `export type CardProps = {
  size?: "sm" | "lg"
}

export function Card({ size = "sm" }: CardProps) {
  const greeting = "hi"
  return (
    <div className="acmeCard">
      <Icon />
      <span>{greeting}</span>
      <p>Hello {greeting}</p>
      <em>{String(size)}</em>
    </div>
  )
}
`

const CARD_STYLES = `.acmeCard {
  color: var(--acme-color-unknown);
  background-color: var(--acme-color-fg);

  &.lg {
    color: var(--acme-color-absent);
  }
}
`

// Each kind of note the scaffolder writes, by the phrase that identifies it.
// `src/spec/scaffold.mjs` writes each one at a single site, so a fixture
// reaching every phrase reaches every site. A new note the fixtures do reach
// fails the "unrecognized" check below; one they never reach is still held
// by the scan of the module's string and template literals, further down.
const NOTE_KINDS = {
  instance: "confirm instanceOf",
  "drafted variant": "`when` is documentation",
  "undraftable branch": "are not drafted",
  "unresolved position": "structure here could not be resolved",
  "unresolved child count": "child count here could not be resolved",
  "several content values": "values, which one `content` binding",
  "non-prop binding": "which is not a declared prop",
  "unclassified content": "content here could not be classified",
  "token-bound style": "is token-bound",
  "multi-token style": "matches multiple tokens",
}

/** The `NOTE_KINDS` names a note's text carries (a style note joins several). */
function kindsOf(text) {
  return Object.entries(NOTE_KINDS)
    .filter(([, phrase]) => text.includes(phrase))
    .map(([kind]) => kind)
}

async function scaffoldEverything() {
  const project = createSyntheticProject({
    components: [
      {
        name: "tracked-link",
        dir: "tracked-link",
        tsx: SHARED_ROOT_BRANCHES_TSX,
        contract: undefined,
      },
      {
        name: "toggle",
        dir: "toggle",
        tsx: TOGGLE_TSX,
        contract: undefined,
      },
      {
        name: "card",
        dir: "card",
        tsx: CARD_TSX,
        styles: CARD_STYLES,
        contract: undefined,
      },
    ],
    // `acme.colorFg` and the default `acme.color.fg` derive the same CSS var,
    // so `--acme-color-fg` matches two tokens.
    tokens: { acme: { colorFg: { $type: "color", $value: "#222222" } } },
  })
  const originalCwd = process.cwd()
  process.chdir(project.root)
  let stderr = ""
  try {
    const code = await runScaffold(["--uncontracted"], {
      globalOpts: { config: project.configPath },
      io: {
        stdout: { write: () => {} },
        stderr: { write: t => (stderr += t) },
      },
      bus: undefined,
    })
    if (code !== 0) return { code, stderr, contracts: [] }
    const dir = join(project.root, SYNTHETIC_PATHS.contractsDir)
    const contracts = readdirSync(dir, { recursive: true })
      .filter(name => name.endsWith(".json"))
      .map(name => [name, JSON.parse(readFileSync(join(dir, name), "utf8"))])
    return { code, stderr, contracts }
  } finally {
    process.chdir(originalCwd)
    project.cleanup()
  }
}

describe("rule and scaffold ADR citations (#12)", () => {
  it("every ADR a registered rule's description cites names design-delta", () => {
    expect(rules.length).toBeGreaterThan(0)
    expect(
      rules.filter(rule => citesAdr(rule.description ?? "")).length,
    ).toBeGreaterThan(0)
    expect(ruleProblems(rules)).toEqual([])
  })

  it("every ADR a scaffolded note cites names design-delta, wherever the note sits", async () => {
    const { code, stderr, contracts } = await scaffoldEverything()
    expect({ code, stderr }).toEqual({ code: 0, stderr: expect.any(String) })

    // The two anatomy notes the adapter never reaches through a component: a
    // census whose root is itself content, a non-prop binding or an
    // unclassified expression. Drafted directly, and scanned like the rest.
    const rootNotes = [
      ["root-expression.spec.json", { kind: "expression", prop: "x" }],
      ["root-unknown.spec.json", { kind: "unknown" }],
    ].map(([file, root]) => [
      file,
      { anatomy: buildScaffoldAnatomy(root, new Set()) },
    ])
    const scanned = [...contracts, ...rootNotes]

    const notes = scanned.flatMap(([, contract]) => scaffoldNotes(contract))
    const at = notes.map(([pointer]) => pointer)
    // The fixtures reach every place a note is written; a fixture that
    // silently drafted less would make the scan below pass vacuously.
    expect(at).toEqual(
      expect.arrayContaining([
        "/anatomy/$variants/_scaffold/todo",
        "/anatomy/$variants/asSpan/_scaffold/todo",
        "/styles/root/_scaffold/todo",
        "/styles/root/variants/0/_scaffold/todo",
      ]),
    )
    expect(at.some(p => /^\/anatomy\/[^$][^/]*\/_scaffold/.test(p))).toBe(true)
    // Every kind of note is reached, and every note is a known kind.
    const reached = new Set(notes.flatMap(([, text]) => kindsOf(text)))
    expect([...reached].sort()).toEqual(Object.keys(NOTE_KINDS).sort())
    expect(notes.filter(([, text]) => kindsOf(text).length === 0)).toEqual([])
    expect(notes.filter(([, text]) => citesAdr(text)).length).toBeGreaterThan(1)

    expect(noteProblems(scanned)).toEqual([])
  })

  it("every ADR a string or template literal in the scaffolder cites names design-delta, whether or not a fixture reaches it", () => {
    const source = readFileSync(SCAFFOLD_SOURCE, "utf8")
    const literals = sourceLiterals(source, SCAFFOLD_SOURCE)
    // Not vacuous: the two notes that cite an ADR are among the literals read.
    expect(
      literals.filter(([, text]) => citesAdr(text)).length,
    ).toBeGreaterThan(1)
    expect(literalProblems("src/spec/scaffold.mjs", source)).toEqual([])
  })

  it("fails naming the rule id, or the note's file and pointer, and the citation", () => {
    expect(
      ruleProblems([
        { id: "x/attributed", description: "(design-delta's ADR-001 D1)" },
        { id: "x/bare", description: "per (ADR-004) and ADR 2" },
      ]),
    ).toEqual(["x/bare: bare ADR-004", "x/bare: bare ADR 2"])

    expect(
      noteProblems([
        [
          "deep.spec.json",
          {
            anatomy: {
              root: { _scaffold: { todo: "fine" } },
              $variants: {
                asB: {
                  children: [{ _scaffold: { todo: "see ADR-002 D4" } }],
                },
              },
            },
          },
        ],
      ]),
    ).toEqual([
      "deep.spec.json/anatomy/$variants/asB/children/0/_scaffold/todo: bare ADR-002",
    ])

    // A note behind a census kind no fixture renders, in every literal form;
    // a comment's bare citation is this repo's own and is not read.
    const source = [
      "// per ADR-002 D5, read in this repo",
      "/* ADR-003 */",
      'const a = { todo: "see ADR-002 D4" }',
      "const b = { todo: 'see ADR 003' }",
      "const c = { todo: `see ADR-4` }",
      "const d = { todo: `${x} per ADR-005 ${y}` }",
      "const e = { todo: `ok (design-delta's ADR-002 D4) ${`nested ADR-6`}` }",
    ].join("\n")
    expect(literalProblems("fake.mjs", source)).toEqual([
      "fake.mjs:3: bare ADR-002",
      "fake.mjs:4: bare ADR 003",
      "fake.mjs:5: bare ADR-4",
      "fake.mjs:6: bare ADR-005",
      "fake.mjs:7: bare ADR-6",
    ])
  })

  it("reads every spelling of a citation, and either apostrophe as attribution", () => {
    expect(unattributedAdrs("ADR-001, ADR 002, ADR-3 and ADR4")).toEqual([
      "ADR-001",
      "ADR 002",
      "ADR-3",
      "ADR4",
    ])
    expect(
      unattributedAdrs("design-delta's ADR-002 and design-delta’s ADR 005"),
    ).toEqual([])
    expect(unattributedAdrs("design-delta ADR-002")).toEqual(["ADR-002"])
    expect(unattributedAdrs("GADR-1 is no citation")).toEqual([])
  })
})
