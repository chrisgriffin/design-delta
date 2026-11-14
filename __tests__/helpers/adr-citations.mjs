/**
 * adr-citations.mjs — the one scan for an ADR citation that does not name
 * design-delta as its owner (#12).
 *
 * Rule descriptions and the `_scaffold` notes the scaffolder writes are both
 * read inside a consumer's own repo, where a bare
 * `ADR-002` reads as that repo's ADR-002. Every test that guards one of them
 * imports this scan, so a widening here reaches all of them.
 */

import ts from "typescript"

// `ADR-002`, `ADR 002`, `ADR-2`: the hyphen or space is optional, the number
// any length. A citation counts as attributed only when `design-delta's`
// (straight or curly apostrophe) sits directly before it.
const CITATION = /(?<!design-delta['’]s )\bADR[- ]?\d+/g

/** Each ADR citation in `text` not written as `design-delta's ADR-NNN`. */
export function unattributedAdrs(text) {
  return [...text.matchAll(CITATION)].map(m => m[0])
}

/** Whether `text` cites any ADR at all, attributed or not. */
export function citesAdr(text) {
  return /\bADR[- ]?\d+/.test(text)
}

/**
 * Every `_scaffold` note anywhere in a contract document, as
 * `[jsonPointer, text]` — each string the note carries, so a note grown a
 * second field is still read.
 */
export function scaffoldNotes(value, pointer = "") {
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, child]) => {
    const at = `${pointer}/${key}`
    if (key !== "_scaffold") return scaffoldNotes(child, at)
    if (typeof child === "string") return [[at, child]]
    return Object.entries(child ?? {})
      .filter(([, text]) => typeof text === "string")
      .map(([field, text]) => [`${at}/${field}`, text])
  })
}

/**
 * Every string and template literal in a module's source, as `[line, text]`,
 * comments excluded — a source comment is read in this repo, where a bare
 * ADR-NNN is correct. A template's substitutions read as `${…}`, so a
 * citation in its fixed text is still one string.
 */
export function sourceLiterals(sourceText, fileName = "source.mjs") {
  const file = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  )
  const found = []
  const lineOf = node =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push([lineOf(node), node.text])
    } else if (ts.isTemplateExpression(node)) {
      const text = [
        node.head.text,
        ...node.templateSpans.map(span => span.literal.text),
      ].join("${…}")
      found.push([lineOf(node), text])
      node.templateSpans.forEach(span => visit(span.expression))
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}
