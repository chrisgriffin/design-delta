/**
 * progress.mjs — the progress-event bus + its renderers (ADR-001 D8).
 *
 * Long audits used to run silent; this gives every domain module an optional
 * `onProgress` callback to narrate what it's doing without becoming impure.
 * Two invariants, both load-bearing, neither negotiable:
 *
 *   1. Progress writes go ONLY to stderr. stdout stays byte-deterministic —
 *      reports and `--json` are piped from there, and a stray progress line
 *      would corrupt them.
 *   2. Renderers never see domain objects, only flat, JSON-serializable
 *      progress events. Domain modules stay pure; they just call
 *      start/update/done/skip on the bus they were handed.
 *
 * Imports nothing beyond this file — no node: builtins, no siblings — so it
 * can be pulled into any layer without dragging in fs or network.
 */

const EVENT_TYPES = {
  start: "task:start",
  update: "task:update",
  done: "task:done",
  skip: "task:skip",
}

/**
 * Create a progress bus. `now` is the injectable clock — tests pass a fake
 * one so events stay deterministic; only the TTY renderer's own on-screen
 * display should ever see a real wall clock.
 */
export function createProgress({ now = () => Date.now() } = {}) {
  const listeners = new Set()

  function emit(type, task, detail, reason) {
    const event = { type, task, detail, reason, at: now() }
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // A renderer must never break the audit it's merely narrating.
      }
    }
    return event
  }

  return {
    start(task, detail) {
      return emit(EVENT_TYPES.start, task, detail, undefined)
    },
    update(task, detail) {
      return emit(EVENT_TYPES.update, task, detail, undefined)
    },
    done(task, detail) {
      return emit(EVENT_TYPES.done, task, detail, undefined)
    },
    skip(task, reason) {
      return emit(EVENT_TYPES.skip, task, undefined, reason)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * The CI-log renderer: one plain line per event, no ANSI, no cursor control.
 * Safe for any non-interactive stream (redirected stderr, log aggregators).
 */
export function plainRenderer(stream = process.stderr) {
  return event => {
    stream.write(`${formatPlainLine(event)}\n`)
  }
}

function formatPlainLine(event) {
  const prefix = `[design-delta] ${event.task}`
  switch (event.type) {
    case EVENT_TYPES.start:
      return event.detail ? `${prefix}: ${event.detail}` : `${prefix}: start`
    case EVENT_TYPES.update:
      return event.detail ? `${prefix}: ${event.detail}` : `${prefix}: update`
    case EVENT_TYPES.done:
      return event.detail
        ? `${prefix}: done (${event.detail})`
        : `${prefix}: done`
    case EVENT_TYPES.skip:
      return event.reason
        ? `${prefix}: skipped (${event.reason})`
        : `${prefix}: skipped`
    default:
      return prefix
  }
}

/**
 * The interactive renderer: a live single-line status per in-flight task,
 * redrawn in place with plain ANSI cursor/erase codes (no spinner library —
 * @clack/prompts lands in Phase 4, not here). Falls back gracefully when the
 * stream lacks TTY affordances (no cursorTo/clearLine): it just writes plain
 * lines instead of crashing.
 */
export function ttyRenderer(stream = process.stderr) {
  const target = stream
  const canRedraw =
    typeof target.cursorTo === "function" &&
    typeof target.clearLine === "function"
  const order = []
  const lastLineByTask = new Map()

  function redraw(task, line) {
    if (!lastLineByTask.has(task)) order.push(task)
    lastLineByTask.set(task, line)
    if (!canRedraw) {
      target.write(`${line}\n`)
      return
    }
    target.cursorTo(0)
    target.clearLine(0)
    target.write(line)
  }

  function finalize(task, line) {
    lastLineByTask.delete(task)
    const index = order.indexOf(task)
    if (index !== -1) order.splice(index, 1)
    if (!canRedraw) {
      target.write(`${line}\n`)
      return
    }
    target.cursorTo(0)
    target.clearLine(0)
    target.write(`${line}\n`)
  }

  return event => {
    switch (event.type) {
      case EVENT_TYPES.start:
        redraw(
          event.task,
          `[design-delta] ${event.task}${event.detail ? `: ${event.detail}` : "..."}`,
        )
        break
      case EVENT_TYPES.update:
        redraw(
          event.task,
          `[design-delta] ${event.task}${event.detail ? `: ${event.detail}` : ""}`,
        )
        break
      case EVENT_TYPES.done:
        finalize(
          event.task,
          `[design-delta] ${event.task}: done${event.detail ? ` (${event.detail})` : ""}`,
        )
        break
      case EVENT_TYPES.skip:
        finalize(
          event.task,
          `[design-delta] ${event.task}: skipped${event.reason ? ` (${event.reason})` : ""}`,
        )
        break
      default:
        break
    }
  }
}

/** The no-op renderer, for `--quiet`. */
export function silentRenderer() {
  return () => {}
}

/**
 * Choose the right renderer for the run: silent under `--quiet`, the live
 * single-line renderer when the target stream is an interactive TTY, plain
 * timestamp-free lines otherwise (CI logs). `isTTY` is overridable so tests
 * don't need a real terminal.
 */
export function pickRenderer({
  stream = process.stderr,
  quiet = false,
  isTTY,
} = {}) {
  if (quiet) return silentRenderer()
  const tty = isTTY !== undefined ? isTTY : Boolean(stream.isTTY)
  return tty ? ttyRenderer(stream) : plainRenderer(stream)
}

/** Subscribe a renderer to a bus; returns the same unsubscribe function. */
export function attachRenderer(bus, renderer) {
  return bus.subscribe(renderer)
}
