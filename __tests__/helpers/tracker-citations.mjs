/**
 * tracker-citations.mjs — the one scan for a tracker issue cited by number or
 * by link (#16, #18).
 *
 * Text a consumer reads — `docs/rules.md`, the shipped schemas' descriptions,
 * the reference docs — cannot cite an issue: the numbers come from the tracker
 * the engine was built in, read as an issue in the consumer's own repo, and a
 * link to one 404s. Every test that guards such text imports this scan, so a
 * widening here reaches all of them.
 */

/**
 * A tracker issue cited by number, in every form it is written: `issue #400`,
 * `(#640)`, `roadmap #216`, `retargeted by #417`, `issue#12`, and a citation
 * into another repo, `other-tool#640` or `acme/tool#440`.
 *
 * Not a citation: a `#` followed by digits and then a letter, `_` or `-` (a
 * colour such as `#1a2b3c`, or a heading anchor such as `#1-overview`); a
 * colour written as code (`` `#111111` ``); an HTML entity (`&#123;`); and the
 * `owner/repo#12` placeholder a schema uses to show the form an issue
 * reference takes.
 */
const TRACKER_CITATION = /(?<![&`])(?<!\bowner\/repo)#\d+(?![\w-])/

/** A link to an issue or pull request on any GitHub tracker. */
const TRACKER_LINK = /github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/\d+/

/** The lines of `text` that cite a tracker issue, by number or by link. */
export function linesCitingIssues(text) {
  return text
    .split("\n")
    .filter(line => TRACKER_CITATION.test(line) || TRACKER_LINK.test(line))
}
