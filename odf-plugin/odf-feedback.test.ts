import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createODFFeedbackSubmit } from "./odf-feedback.js"
import { metricsBuffer, recordMetrics } from "./odf-delegation-metrics.js"
import type { ToolContext } from "./odf-tool.js"

const sessionID = "session-private-abc"
const change = "change-private-name"
const now = new Date("2026-10-09T12:00:00.000Z")

function sessionHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8)
}

function metric(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: now.toISOString(),
    schema_version: 1,
    session_hash: sessionHash(sessionID),
    change,
    event: "run",
    lifecycle: "finished",
    run_id: "run-001",
    status: "ok",
    duration_ms: 1000,
    tokens: { input: 120, output: 30, estimated: 999 },
    cost_usd: 0.125,
    task: "private prompt text",
    ...overrides,
  }
}

function writeMetrics(directory: string, records: Record<string, unknown>[]): void {
  const filename = `delegations-${now.toISOString().slice(0, 10)}.jsonl`
  fs.writeFileSync(path.join(directory, filename), records.map(record => JSON.stringify(record)).join("\n") + "\n")
}

function makeContext(currentSessionID = sessionID): ToolContext {
  return {
    sessionID: currentSessionID,
    messageID: "message-id",
    agent: "odoo_orchestrator",
    directory: "/private/project",
    worktree: "/private/project",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    ask: vi.fn(async () => undefined),
  }
}

function outputText(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object" && "output" in result && typeof result.output === "string") {
    return result.output
  }
  return JSON.stringify(result)
}

function confirmationToken(result: unknown): string {
  const match = outputText(result).match(/Confirmation token \(one-time, valid 5 minutes\): ([A-Za-z0-9_-]{32})/)
  if (!match) throw new Error("Preview did not return a confirmation token")
  return match[1]
}

describe("ODF online feedback submission", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
    metricsBuffer.length = 0
    vi.restoreAllMocks()
  })

  function setup(env: Record<string, string | undefined> = {
    ODF_FEEDBACK_ENDPOINT: "https://feedback.example.test/v1/odf",
    ODF_FEEDBACK_RETENTION_DAYS: "30",
  }, clock: () => Date = () => now) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "odf-feedback-"))
    tempDirs.push(tempDir)
    writeMetrics(tempDir, [metric()])
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const feedbackTool = createODFFeedbackSubmit({
      env,
      fetch: fetcher,
      metricsDir: tempDir,
      now: clock,
    })
    return { feedbackTool, fetcher, metricsDir: tempDir }
  }

  const args = {
    action: "preview" as const,
    change,
    rating: 4,
    confirm_remote_submission: false,
  }

  it("previews the bounded aggregate locally without sending it", async () => {
    const { feedbackTool, fetcher } = setup()

    const result = await feedbackTool.execute(args, makeContext())
    const output = outputText(result)

    expect(fetcher).not.toHaveBeenCalled()
    expect(output).toContain("feedback.example.test")
    expect(output).toContain('"quality_rating":4')
    expect(output).toContain('"input_tokens":120')
    expect(output).toContain('"output_tokens":30')
    expect(output).toContain('"cost_usd":0.125')
    expect(output).toMatch(/Confirmation token \(one-time, valid 5 minutes\): [A-Za-z0-9_-]{32}/)
    expect(output).not.toContain("session-private-abc")
    expect(output).not.toContain("change-private-name")
    expect(output).not.toContain("private prompt text")
    expect(output).not.toContain("/private/project")
    expect(output).not.toContain('"estimated"')
  })

  it("requires a separate explicit confirmation before submitting", async () => {
    const { feedbackTool, fetcher } = setup()

    const result = await feedbackTool.execute({ ...args, action: "submit" }, makeContext())

    expect(fetcher).not.toHaveBeenCalled()
    expect(outputText(result)).toContain("explicit confirmation")
  })

  it("sends only the aggregate allowlist once after confirmation", async () => {
    const { feedbackTool, fetcher } = setup({
      ODF_FEEDBACK_ENDPOINT: "https://feedback.example.test/v1/odf",
      ODF_FEEDBACK_RETENTION_DAYS: "30",
      ODF_FEEDBACK_BEARER_TOKEN: "secret-bearer-token",
    })

    const preview = await feedbackTool.execute(args, makeContext())
    expect(fetcher).not.toHaveBeenCalled()
    const result = await feedbackTool.execute({
      ...args,
      action: "submit",
      confirm_remote_submission: true,
      confirmation_token: confirmationToken(preview),
    }, makeContext())

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0]
    expect(url.toString()).toBe("https://feedback.example.test/v1/odf")
    expect(request).toMatchObject({ method: "POST", redirect: "error" })
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer secret-bearer-token")
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>
    expect(body).toEqual({
      schema_version: 1,
      retention_days: 30,
      quality_rating: 4,
      aggregate: {
        finished_runs: 1,
        latest_phase_status: "ok",
        duration_ms: 1000,
        input_tokens: 120,
        input_token_runs: 1,
        output_tokens: 30,
        output_token_runs: 1,
        cost_usd: 0.125,
        cost_runs: 1,
      },
    })
    const serialized = JSON.stringify(body)
    for (const privateValue of [sessionID, change, "run-001", "private prompt text", "/private/project", "secret-bearer-token"]) {
      expect(serialized).not.toContain(privateValue)
    }
    expect(outputText(result)).toContain("submitted")
  })

  it("aggregates distinct finished runs only for the current session and change", async () => {
    const { feedbackTool, metricsDir } = setup()
    writeMetrics(metricsDir, [
      metric({ lifecycle: "started", run_id: "run-001", status: "ok" }),
      metric({ run_id: "run-001", duration_ms: 1000, tokens: { input: 120, output: 30, estimated: 500 }, cost_usd: 0.125 }),
      metric({ run_id: "run-002", timestamp: "2026-10-09T12:01:00.000Z", status: "error", duration_ms: 2000, tokens: { input: null, output: 45, estimated: 700 }, cost_usd: null }),
      metric({ run_id: "run-other-session", session_hash: "ffffffff", duration_ms: 3000, cost_usd: 999 }),
      metric({ run_id: "run-other-change", change: "another-change", duration_ms: 4000, cost_usd: 888 }),
    ])

    const result = await feedbackTool.execute({ ...args, action: "preview" }, makeContext())
    const output = outputText(result)

    expect(output).toContain('"finished_runs":2')
    expect(output).toContain('"latest_phase_status":"error"')
    expect(output).toContain('"duration_ms":3000')
    expect(output).toContain('"input_tokens":120')
    expect(output).toContain('"output_tokens":75')
    expect(output).toContain('"cost_usd":0.125')
    expect(output).not.toContain("run-other-session")
  })

  it("does not report estimated usage as actual tokens or cost", async () => {
    const { feedbackTool, metricsDir } = setup()
    writeMetrics(metricsDir, [metric({ tokens: { input: null, output: null, estimated: 999 }, cost_usd: null })])

    const result = await feedbackTool.execute({ ...args, action: "preview" }, makeContext())
    const output = outputText(result)

    expect(output).toContain('"input_tokens":null')
    expect(output).toContain('"output_tokens":null')
    expect(output).toContain('"cost_usd":null')
    expect(output).not.toContain("999")
  })

  it("fails closed when endpoint, retention, or rating configuration is unsafe", async () => {
    const invalidEnvs = [
      {},
      { ODF_FEEDBACK_ENDPOINT: "http://feedback.example.test", ODF_FEEDBACK_RETENTION_DAYS: "30" },
      { ODF_FEEDBACK_ENDPOINT: "https://user:password@feedback.example.test", ODF_FEEDBACK_RETENTION_DAYS: "30" },
      { ODF_FEEDBACK_ENDPOINT: "https://feedback.example.test/path?token=secret", ODF_FEEDBACK_RETENTION_DAYS: "30" },
      { ODF_FEEDBACK_ENDPOINT: "https://feedback.example.test", ODF_FEEDBACK_RETENTION_DAYS: "31" },
      { ODF_FEEDBACK_ENDPOINT: "https://feedback.example.test", ODF_FEEDBACK_RETENTION_DAYS: "" },
    ]

    for (const env of invalidEnvs) {
      const { feedbackTool, fetcher } = setup(env)
      const result = await feedbackTool.execute({ ...args, action: "submit", confirm_remote_submission: true }, makeContext())
      expect(fetcher).not.toHaveBeenCalled()
      expect(outputText(result)).toContain("Nothing was sent")
    }
  })

  it("does not send when there is no matching local completed run", async () => {
    const { feedbackTool, fetcher } = setup()

    const result = await feedbackTool.execute({ ...args, action: "preview", change: "missing-change" }, makeContext())

    expect(fetcher).not.toHaveBeenCalled()
    expect(outputText(result)).toContain("nothing was sent")
  })

  it("binds confirmation to the reviewed aggregate and current session", async () => {
    const { feedbackTool, fetcher, metricsDir } = setup()
    const preview = await feedbackTool.execute(args, makeContext())
    const token = confirmationToken(preview)
    writeMetrics(metricsDir, [metric({ cost_usd: 99 })])

    const changed = await feedbackTool.execute({ ...args, action: "submit", confirm_remote_submission: true, confirmation_token: token }, makeContext())
    expect(fetcher).not.toHaveBeenCalled()
    expect(outputText(changed)).toContain("data changed after preview")

    const freshPreview = await feedbackTool.execute(args, makeContext())
    const wrongSession = await feedbackTool.execute({
      ...args,
      action: "submit",
      confirm_remote_submission: true,
      confirmation_token: confirmationToken(freshPreview),
    }, makeContext("another-session"))
    expect(fetcher).not.toHaveBeenCalled()
    expect(outputText(wrongSession)).toContain("does not match this session")
  })

  it("expires the one-time preview token after five minutes", async () => {
    let currentTime = new Date(now)
    const { feedbackTool, fetcher } = setup(undefined, () => currentTime)
    const preview = await feedbackTool.execute(args, makeContext())
    currentTime = new Date(now.getTime() + 5 * 60_000)

    const result = await feedbackTool.execute({
      ...args,
      action: "submit",
      confirm_remote_submission: true,
      confirmation_token: confirmationToken(preview),
    }, makeContext())

    expect(fetcher).not.toHaveBeenCalled()
    expect(outputText(result)).toContain("expired")
  })

  it("can preview finished metrics still held in the bounded in-memory buffer", async () => {
    const { feedbackTool, fetcher, metricsDir } = setup()
    fs.rmSync(path.join(metricsDir, `delegations-${now.toISOString().slice(0, 10)}.jsonl`))
    metricsBuffer.length = 0
    recordMetrics({
      timestamp: now.toISOString(),
      session_id: sessionID,
      phase: "VERIFY",
      agent: "odoo_qa_engineer",
      skills_injected: [],
      skill_resolution: "none",
      duration_ms: 500,
      token_estimate: 0,
      status: "ok",
      task_api_source: "unavailable",
      event: "run",
      lifecycle: "finished",
      change,
      run_id: "run-buffered",
      tokens: { input: 12, output: 3 },
      cost_usd: 0.01,
    })

    const result = await feedbackTool.execute({ ...args, action: "preview" }, makeContext())

    expect(fetcher).not.toHaveBeenCalled()
    expect(outputText(result)).toContain('"finished_runs":1')
    expect(outputText(result)).toContain('"cost_usd":0.01')
  })

  it("makes no retry when the endpoint rejects or the response is lost", async () => {
    const { feedbackTool, fetcher } = setup()
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))

    const rejectedPreview = await feedbackTool.execute(args, makeContext())
    const rejectedToken = confirmationToken(rejectedPreview)
    const rejected = await feedbackTool.execute({ ...args, action: "submit", confirm_remote_submission: true, confirmation_token: rejectedToken }, makeContext())
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(outputText(rejected)).toContain("503")
    const reused = await feedbackTool.execute({ ...args, action: "submit", confirm_remote_submission: true, confirmation_token: rejectedToken }, makeContext())
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(outputText(reused)).toContain("already used")

    fetcher.mockRejectedValueOnce(new Error("connection lost"))
    const lostPreview = await feedbackTool.execute(args, makeContext())
    const lost = await feedbackTool.execute({ ...args, action: "submit", confirm_remote_submission: true, confirmation_token: confirmationToken(lostPreview) }, makeContext())
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(outputText(lost)).toContain("unknown")
    expect(outputText(lost)).not.toContain("connection lost")
  })
})
