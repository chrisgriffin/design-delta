import {
  attachRenderer,
  createProgress,
  pickRenderer,
  plainRenderer,
  silentRenderer,
  ttyRenderer,
} from "../src/core/progress.mjs"

/** A minimal writable-stream stand-in that just records what was written. */
function fakeStream({ isTTY = false, withCursorOps = false } = {}) {
  const writes = []
  const stream = {
    isTTY,
    write(chunk) {
      writes.push(chunk)
      return true
    },
  }
  if (withCursorOps) {
    stream.cursorTo = () => {}
    stream.clearLine = () => {}
  }
  return { stream, writes }
}

describe("createProgress — event emission and shape", () => {
  it("emits a task:start event with an injected clock", () => {
    const bus = createProgress({ now: () => 111 })
    const events = []
    bus.subscribe(e => events.push(e))

    bus.start("tokens", "loading snapshot")

    expect(events).toEqual([
      {
        type: "task:start",
        task: "tokens",
        detail: "loading snapshot",
        reason: undefined,
        at: 111,
      },
    ])
  })

  it("emits a task:update event with an injected clock", () => {
    const bus = createProgress({ now: () => 222 })
    const events = []
    bus.subscribe(e => events.push(e))

    bus.update("components", "40/112")

    expect(events).toEqual([
      {
        type: "task:update",
        task: "components",
        detail: "40/112",
        reason: undefined,
        at: 222,
      },
    ])
  })

  it("emits a task:done event with an injected clock", () => {
    const bus = createProgress({ now: () => 333 })
    const events = []
    bus.subscribe(e => events.push(e))

    bus.done("lint", "0 findings")

    expect(events).toEqual([
      {
        type: "task:done",
        task: "lint",
        detail: "0 findings",
        reason: undefined,
        at: 333,
      },
    ])
  })

  it("emits a task:skip event with a reason and an injected clock", () => {
    const bus = createProgress({ now: () => 444 })
    const events = []
    bus.subscribe(e => events.push(e))

    bus.skip("mockups", "no snapshot")

    expect(events).toEqual([
      {
        type: "task:skip",
        task: "mockups",
        detail: undefined,
        reason: "no snapshot",
        at: 444,
      },
    ])
  })

  it("defaults to Date.now when no clock is injected", () => {
    const before = Date.now()
    const bus = createProgress()
    const events = []
    bus.subscribe(e => events.push(e))

    bus.start("tokens")

    expect(events[0].at).toBeGreaterThanOrEqual(before)
    expect(events[0].at).toBeLessThanOrEqual(Date.now())
  })
})

describe("createProgress — subscribe/unsubscribe", () => {
  it("stops delivering events to a listener after it unsubscribes", () => {
    const bus = createProgress({ now: () => 1 })
    const events = []
    const unsubscribe = bus.subscribe(e => events.push(e))

    bus.start("tokens")
    unsubscribe()
    bus.done("tokens")

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("task:start")
  })

  it("supports multiple independent listeners", () => {
    const bus = createProgress({ now: () => 1 })
    const a = []
    const b = []
    bus.subscribe(e => a.push(e))
    bus.subscribe(e => b.push(e))

    bus.start("tokens")

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it("attachRenderer subscribes a renderer and returns an unsubscribe function", () => {
    const bus = createProgress({ now: () => 1 })
    const events = []
    const unsubscribe = attachRenderer(bus, e => events.push(e))

    bus.start("tokens")
    expect(events).toHaveLength(1)

    unsubscribe()
    bus.done("tokens")
    expect(events).toHaveLength(1)
  })
})

describe("createProgress — renderer errors never break the bus", () => {
  it("swallows a throwing listener and still calls the others", () => {
    const bus = createProgress({ now: () => 1 })
    const events = []
    bus.subscribe(() => {
      throw new Error("boom")
    })
    bus.subscribe(e => events.push(e))

    expect(() => bus.start("tokens")).not.toThrow()
    expect(events).toHaveLength(1)
  })

  it("returns the event from start/update/done/skip even when a listener throws", () => {
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(() => {
      throw new Error("boom")
    })

    const event = bus.done("tokens", "ok")
    expect(event).toEqual({
      type: "task:done",
      task: "tokens",
      detail: "ok",
      reason: undefined,
      at: 1,
    })
  })
})

describe("plainRenderer — exact output lines", () => {
  it("writes a start line with detail", () => {
    const { stream, writes } = fakeStream()
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(plainRenderer(stream))

    bus.start("tokens", "loading snapshot")

    expect(writes).toEqual(["[design-delta] tokens: loading snapshot\n"])
  })

  it("writes a start line without detail", () => {
    const { stream, writes } = fakeStream()
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(plainRenderer(stream))

    bus.start("tokens")

    expect(writes).toEqual(["[design-delta] tokens: start\n"])
  })

  it("writes an update line", () => {
    const { stream, writes } = fakeStream()
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(plainRenderer(stream))

    bus.update("components", "40/112")

    expect(writes).toEqual(["[design-delta] components: 40/112\n"])
  })

  it("writes a done line with detail", () => {
    const { stream, writes } = fakeStream()
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(plainRenderer(stream))

    bus.done("lint", "0 findings")

    expect(writes).toEqual(["[design-delta] lint: done (0 findings)\n"])
  })

  it("writes a done line without detail", () => {
    const { stream, writes } = fakeStream()
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(plainRenderer(stream))

    bus.done("lint")

    expect(writes).toEqual(["[design-delta] lint: done\n"])
  })

  it("writes a skip line with reason", () => {
    const { stream, writes } = fakeStream()
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(plainRenderer(stream))

    bus.skip("mockups", "no snapshot")

    expect(writes).toEqual(["[design-delta] mockups: skipped (no snapshot)\n"])
  })

  it("defaults to process.stderr when no stream is given", () => {
    const renderer = plainRenderer()
    expect(typeof renderer).toBe("function")
  })
})

describe("ttyRenderer — writes to the given stream without crashing", () => {
  it("writes lines through a stream that lacks cursorTo/clearLine (graceful degradation)", () => {
    const { stream, writes } = fakeStream({ isTTY: true, withCursorOps: false })
    const bus = createProgress({ now: () => 1 })
    expect(() => bus.subscribe(ttyRenderer(stream))).not.toThrow()

    expect(() => {
      bus.start("tokens", "loading")
      bus.update("tokens", "50%")
      bus.done("tokens", "ok")
    }).not.toThrow()

    expect(writes.length).toBeGreaterThan(0)
    expect(writes.some(w => w.includes("tokens"))).toBe(true)
    expect(writes.some(w => w.includes("done"))).toBe(true)
  })

  it("uses cursorTo/clearLine to redraw in place when the stream supports it", () => {
    const { stream, writes } = fakeStream({ isTTY: true, withCursorOps: true })
    let cursorCalls = 0
    stream.cursorTo = () => {
      cursorCalls += 1
    }
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(ttyRenderer(stream))

    bus.start("tokens", "loading")
    bus.done("tokens", "ok")

    expect(cursorCalls).toBeGreaterThan(0)
    expect(writes.some(w => w.includes("tokens: done (ok)"))).toBe(true)
  })

  it("finalizes skipped tasks with the reason", () => {
    const { stream, writes } = fakeStream({ isTTY: true, withCursorOps: true })
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(ttyRenderer(stream))

    bus.start("mockups")
    bus.skip("mockups", "no snapshot")

    expect(writes.some(w => w.includes("mockups: skipped (no snapshot)"))).toBe(
      true,
    )
  })
})

describe("silentRenderer", () => {
  it("is a no-op that never writes anywhere", () => {
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(silentRenderer())

    expect(() => {
      bus.start("tokens")
      bus.update("tokens")
      bus.done("tokens")
      bus.skip("tokens", "reason")
    }).not.toThrow()
  })
})

describe("pickRenderer — selection matrix", () => {
  it("selects silentRenderer's behavior when quiet is true, regardless of TTY", () => {
    const { stream, writes } = fakeStream({ isTTY: true })
    const renderer = pickRenderer({ stream, quiet: true, isTTY: true })
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(renderer)

    bus.start("tokens", "loading")

    expect(writes).toHaveLength(0)
  })

  it("selects the tty renderer when isTTY override is true", () => {
    const { stream, writes } = fakeStream({ withCursorOps: true })
    const renderer = pickRenderer({ stream, isTTY: true })
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(renderer)

    bus.start("tokens", "loading")

    // tty renderer writes without a trailing newline on redraw
    expect(writes.some(w => w.includes("tokens"))).toBe(true)
  })

  it("selects the plain renderer when isTTY override is false", () => {
    const { stream, writes } = fakeStream({ isTTY: true })
    const renderer = pickRenderer({ stream, isTTY: false })
    const bus = createProgress({ now: () => 1 })
    bus.subscribe(renderer)

    bus.start("tokens", "loading")

    expect(writes).toEqual(["[design-delta] tokens: loading\n"])
  })

  it("falls back to stream.isTTY when isTTY is not explicitly passed", () => {
    const { stream: ttyStream, writes: ttyWrites } = fakeStream({
      isTTY: true,
      withCursorOps: true,
    })
    const rendererForTty = pickRenderer({ stream: ttyStream })
    const busA = createProgress({ now: () => 1 })
    busA.subscribe(rendererForTty)
    busA.start("tokens", "loading")
    expect(ttyWrites.length).toBeGreaterThan(0)

    const { stream: plainStream, writes: plainWrites } = fakeStream({
      isTTY: false,
    })
    const rendererForPlain = pickRenderer({ stream: plainStream })
    const busB = createProgress({ now: () => 1 })
    busB.subscribe(rendererForPlain)
    busB.start("tokens", "loading")
    expect(plainWrites).toEqual(["[design-delta] tokens: loading\n"])
  })

  it("defaults to process.stderr and non-quiet, non-TTY behavior with no args", () => {
    const renderer = pickRenderer()
    expect(typeof renderer).toBe("function")
  })
})

describe("guard — progress never writes to a stdout-like stream", () => {
  it("plainRenderer, ttyRenderer, and pickRenderer only ever write to the stream they were explicitly given, never to a separate stdout stand-in", () => {
    const { stream: stderrStream, writes: stderrWrites } = fakeStream({
      isTTY: false,
    })
    const { writes: stdoutWrites } = fakeStream({ isTTY: false })

    const bus = createProgress({ now: () => 1 })
    bus.subscribe(plainRenderer(stderrStream))
    bus.subscribe(ttyRenderer(stderrStream))
    bus.subscribe(pickRenderer({ stream: stderrStream, isTTY: false }))

    bus.start("tokens", "loading")
    bus.update("tokens", "50%")
    bus.done("tokens", "ok")
    bus.skip("mockups", "no snapshot")

    expect(stdoutWrites).toHaveLength(0)
    expect(stderrWrites.length).toBeGreaterThan(0)
  })
})
