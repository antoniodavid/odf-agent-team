/**
 * Host-neutral replacement for the V1 `tool` helper from `@opencode-ai/plugin`.
 *
 * OpenCode V2 plugin code should not carry a runtime dependency on the V1
 * plugin package: the V2 host loads local plugins from the config directory and
 * the V1 package is not part of the supported V2 surface. The original helper
 * is an identity function whose `tool.schema` namespace is plain Zod, so this
 * module reproduces exactly that shape on top of the `zod` dependency that ODF
 * declares directly. Keeping a single Zod instance across the plugin graph is
 * what makes `z.object(args)` accept every schema built through `tool.schema`.
 *
 * Type-only imports of the V1 package remain safe — they are erased before the
 * host resolves any module — but every runtime import goes through here.
 */
import { z } from "zod"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  /**
   * Current project directory for this session.
   * Prefer this over process.cwd() when resolving relative paths.
   */
  directory: string
  /**
   * Project worktree root for this session.
   * Useful for creating stable hashes or path.relative(workspace, absPath).
   */
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, any> }): void
  ask(input: AskInput): Promise<void>
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: Record<string, any>
}

export type ToolAttachment = {
  type: "file"
  mime: string
  url: string
  filename?: string
}

export type ToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: Record<string, any>
      attachments?: ToolAttachment[]
    }

export type ToolInput<Args extends z.ZodRawShape> = {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}

function defineTool<Args extends z.ZodRawShape>(input: ToolInput<Args>): ToolInput<Args> {
  return input
}

/**
 * Drop-in stand-in for the V1 helper: `tool({ description, args, execute })`
 * with `tool.schema` exposing the Zod namespace used to declare tool arguments.
 */
export const tool = Object.assign(defineTool, { schema: z })

export type ToolDefinition = ReturnType<typeof tool>
