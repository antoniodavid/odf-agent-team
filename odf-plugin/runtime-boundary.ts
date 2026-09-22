/**
 * Small host-neutral seam shared by the V1 and V2 entrypoints.
 *
 * The boundary deliberately carries lifecycle and workspace identity only.
 * Tool and hook adaptation belongs to the V2 implementation task.
 */

export const ODF_PLUGIN_ID = "odf-delegation" as const

export type ODFRuntime = "v1" | "v2"

export interface ODFRuntimeContext {
  readonly runtime: ODFRuntime
  readonly directory: string
}

export type ODFRuntimeCleanup = () => Promise<void> | void

export type ODFRuntimeSetup = (
  context: ODFRuntimeContext,
) => ODFRuntimeCleanup | void | Promise<ODFRuntimeCleanup | void>

export interface ODFRuntimeBoundary {
  readonly id: typeof ODF_PLUGIN_ID
  readonly setup: ODFRuntimeSetup
}

export function defineODFRuntime(setup: ODFRuntimeSetup): ODFRuntimeBoundary {
  return { id: ODF_PLUGIN_ID, setup }
}
