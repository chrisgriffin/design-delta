/**
 * decisions.mjs — turn findings into decisions, and answers into writes
 * (issue #62).
 *
 * Most findings are not code's to clear: which side of a disagreement is
 * wrong is the owner's call. `buildDecisions` groups every finding outside
 * the code pile into one decision per rule and pile, each with the answers
 * that can clear it and a recommended one. `applyAnswers` turns the owner's
 * answers into the two places the engine and the resolve skill read them:
 *
 *   - accept / waive / track       an `exemptions` entry in the config
 *   - remove-exemption             a stale `exemptions` entry deleted
 *   - fix-code / change-contract /
 *     change-design                an entry in the decisions file, which
 *                                  the resolve skill works
 *
 * Both functions are pure: they take plain objects and return new ones. The
 * command owns the filesystem and the server.
 *
 * IDS. A decision's id is a hash of its rule, pile and entities, so the same
 * audit yields the same ids, and an answers file saved from one run applies
 * only to the run that produced it: a finding that appeared or went away in
 * between changes the id, and the answer is refused rather than applied to a
 * group the owner never saw.
 *
 * `core/`: imports nothing outside `core/`.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import Ajv from "ajv/dist/2020.js"

import { PILES, pileOf } from "./piles.mjs"
import {
  ACTION_ANSWERS,
  EXEMPTION_ANSWERS,
  recommendationFor,
} from "./recommendations.mjs"

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

export const DECISIONS_SCHEMA_FILE = join(
  PACKAGE_ROOT,
  "schema",
  "decisions.schema.json",
)
export const ANSWERS_SCHEMA_FILE = join(
  PACKAGE_ROOT,
  "schema",
  "decide-answers.schema.json",
)

const ajv = new Ajv({ allErrors: true, strict: false })
const runDecisionsSchema = ajv.compile(
  JSON.parse(readFileSync(DECISIONS_SCHEMA_FILE, "utf8")),
)
const runAnswersSchema = ajv.compile(
  JSON.parse(readFileSync(ANSWERS_SCHEMA_FILE, "utf8")),
)

function schemaErrors(run, doc) {
  if (run(doc)) return []
  return (run.errors || []).map(
    err => `${err.instancePath || "(root)"} ${err.message}`,
  )
}

/** @param {unknown} doc @returns {string[]} */
export const validateDecisionsFile = doc =>
  schemaErrors(runDecisionsSchema, doc)

/** @param {unknown} doc @returns {string[]} */
export const validateAnswers = doc => schemaErrors(runAnswersSchema, doc)

/** An empty decisions file, the shape a project starts from. */
export const EMPTY_DECISIONS_FILE = { version: 1, entries: [] }

const SEVERITY_RANK = { error: 0, warn: 1, review: 2 }
const STALE = "coverage/stale-exemption"

/**
 * The key an owner selects a finding by. A stale-exemption finding names the
 * exempted entity, which two rules can share, so its key carries the rule
 * the exemption sits under.
 */
function keyOf(finding) {
  if (finding.ruleId === STALE && finding.data?.ruleId)
    return `${finding.data.ruleId} ${finding.entity}`
  return finding.entity
}

function decisionId(ruleId, pile, keys) {
  return createHash("sha256")
    .update(`${ruleId}\n${pile}\n${keys.join("\n")}`)
    .digest("hex")
    .slice(0, 12)
}

/**
 * Group findings into decisions.
 *
 * @param {object} input
 * @param {object[]} input.findings audit and lint findings together; already
 *   exempted ones (`decided`) are never passed here
 * @param {{entries: object[]}} [input.previous] the decisions file, if any
 * @returns {{decisions: object[], code: object[], codeCount: number, done: object[]}}
 *   `code` is the code pile's findings themselves, for the resolve skill
 */
export function buildDecisions({ findings, previous = EMPTY_DECISIONS_FILE }) {
  const groups = new Map()
  const code = []
  const seen = new Set()

  for (const finding of findings) {
    const pile = pileOf(finding)
    if (pile === "code") {
      code.push(finding)
      continue
    }
    const key = keyOf(finding)
    const dedupe = `${finding.ruleId}\n${pile}\n${key}\n${finding.message}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)

    const groupKey = `${finding.ruleId}\n${pile}`
    if (!groups.has(groupKey))
      groups.set(groupKey, {
        ruleId: finding.ruleId,
        pile,
        severity: finding.severity,
        surface: finding.surface,
        items: [],
      })
    const group = groups.get(groupKey)
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[group.severity])
      group.severity = finding.severity
    group.items.push({
      key,
      entity: finding.entity,
      message: finding.message,
      ...(finding.ruleId === STALE && finding.data?.ruleId
        ? { exemptedFrom: finding.data.ruleId }
        : {}),
    })
  }

  const entries = previous?.entries || []
  const decisions = [...groups.values()].map(group => {
    group.items.sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : a.message < b.message ? -1 : 1,
    )
    const keys = [...new Set(group.items.map(item => item.key))]
    const answered = entries
      .filter(entry => entry.ruleId === group.ruleId)
      .map(entry => ({
        answer: entry.answer,
        note: entry.note,
        entities: entry.entities.filter(e => keys.includes(e)),
      }))
      .filter(entry => entry.entities.length > 0)
    return {
      id: decisionId(group.ruleId, group.pile, keys),
      ruleId: group.ruleId,
      pile: group.pile,
      severity: group.severity,
      surface: group.surface,
      entities: keys,
      items: group.items,
      ...recommendationFor(group.ruleId, group.pile),
      ...(answered.length > 0 ? { answered } : {}),
    }
  })

  decisions.sort(
    (a, b) =>
      PILES.indexOf(a.pile) - PILES.indexOf(b.pile) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0),
  )

  // An entry is done when no current finding of its rule names any of its
  // entities: the resolve skill (or the owner) made the change it asked for.
  const live = new Set()
  for (const finding of findings)
    live.add(`${finding.ruleId}\n${keyOf(finding)}`)
  const done = entries.filter(
    entry => !entry.entities.some(e => live.has(`${entry.ruleId}\n${e}`)),
  )

  return { decisions, code, codeCount: code.length, done }
}

function exemptionEntity(entry) {
  return typeof entry === "string" ? entry : entry?.entity
}

/**
 * Apply the owner's answers. Every answer is checked before anything
 * changes: one bad answer refuses the whole set, so a save is never half
 * written.
 *
 * @param {object} input
 * @param {object} input.config the project's config, as read from disk
 * @param {{version: 1, entries: object[]}} input.decisionsFile
 * @param {object[]} input.decisions from `buildDecisions`
 * @param {{answers: object[]}} input.answers what the page saved
 * @param {{entries: object[]}} [input.done] entries to drop as done
 * @returns {{config: object, decisionsFile: object, written: object[]}}
 * @throws {Error} with `errors: string[]` when any answer is invalid
 */
export function applyAnswers({
  config,
  decisionsFile,
  decisions,
  answers,
  done = [],
}) {
  const errors = validateAnswers(answers)
  if (errors.length > 0) throw answersError(errors)

  const byId = new Map(decisions.map(d => [d.id, d]))
  const used = new Set()
  for (const [index, answer] of answers.answers.entries()) {
    const where = `answer ${index + 1} (${answer.id})`
    const decision = byId.get(answer.id)
    if (!decision) {
      errors.push(
        `${where}: no such decision in this audit; the findings changed since the page was made, so run decide again`,
      )
      continue
    }
    if (used.has(answer.id)) errors.push(`${where}: answered twice`)
    used.add(answer.id)
    if (!decision.options.includes(answer.answer))
      errors.push(
        `${where}: "${answer.answer}" is not an option for ${decision.ruleId} (options: ${decision.options.join(", ")})`,
      )
    const unknown = (answer.entities || []).filter(
      e => !decision.entities.includes(e),
    )
    if (unknown.length > 0)
      errors.push(`${where}: not in this decision: ${unknown.join(", ")}`)
    if (answer.answer === "track" && !answer.issue?.trim())
      errors.push(`${where}: track needs an issue reference`)
    if (
      (answer.answer === "accept" || answer.answer === "waive") &&
      !answer.reason?.trim()
    )
      errors.push(`${where}: ${answer.answer} needs a reason`)
  }
  if (errors.length > 0) throw answersError(errors)

  const nextConfig = structuredClone(config)
  const doneIds = new Set(done.map(entry => JSON.stringify(entry)))
  const nextFile = {
    version: 1,
    entries: (decisionsFile?.entries || []).filter(
      entry => !doneIds.has(JSON.stringify(entry)),
    ),
  }
  const written = []

  for (const answer of answers.answers) {
    const decision = byId.get(answer.id)
    const keys = answer.entities || decision.entities
    const items = decision.items.filter(item => keys.includes(item.key))

    if (EXEMPTION_ANSWERS[answer.answer]) {
      nextConfig.exemptions ??= {}
      const list = (nextConfig.exemptions[decision.ruleId] ??= [])
      for (const entity of [...new Set(items.map(item => item.entity))]) {
        if (list.some(entry => exemptionEntity(entry) === entity)) continue
        list.push({
          entity,
          decision: EXEMPTION_ANSWERS[answer.answer],
          ...(answer.reason?.trim() ? { reason: answer.reason.trim() } : {}),
          ...(answer.issue?.trim() ? { issue: answer.issue.trim() } : {}),
        })
      }
      written.push({
        id: decision.id,
        ruleId: decision.ruleId,
        answer: answer.answer,
        entities: keys,
        to: "config",
      })
    } else if (answer.answer === "remove-exemption") {
      for (const item of items) {
        const list = nextConfig.exemptions?.[item.exemptedFrom]
        if (!Array.isArray(list)) continue
        nextConfig.exemptions[item.exemptedFrom] = list.filter(
          entry => exemptionEntity(entry) !== item.entity,
        )
        if (nextConfig.exemptions[item.exemptedFrom].length === 0)
          delete nextConfig.exemptions[item.exemptedFrom]
      }
      written.push({
        id: decision.id,
        ruleId: decision.ruleId,
        answer: answer.answer,
        entities: keys,
        to: "config",
      })
    } else if (ACTION_ANSWERS.includes(answer.answer)) {
      nextFile.entries = nextFile.entries.filter(
        entry =>
          entry.ruleId !== decision.ruleId ||
          !entry.entities.some(e => keys.includes(e)),
      )
      nextFile.entries.push({
        id: decision.id,
        ruleId: decision.ruleId,
        pile: decision.pile,
        entities: keys,
        answer: answer.answer,
        ...(answer.note?.trim() ? { note: answer.note.trim() } : {}),
      })
      written.push({
        id: decision.id,
        ruleId: decision.ruleId,
        answer: answer.answer,
        entities: keys,
        to: "decisions",
      })
    }
  }

  return { config: nextConfig, decisionsFile: nextFile, written }
}

function answersError(errors) {
  const error = new Error(errors.join("\n"))
  error.errors = errors
  return error
}
