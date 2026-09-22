import { Plugin } from "@opencode/plugin"
import { defineODFRuntime, ODF_PLUGIN_ID } from "./runtime-boundary.js"

const runtime = defineODFRuntime(({ directory }) => {
  // T1 establishes the V2 lifecycle seam. T2 will register tools and hooks.
  void directory
})

export const OdfDelegationPluginV2 = Plugin.define({
  id: ODF_PLUGIN_ID,
  setup: (context) => runtime.setup({ runtime: "v2", directory: context.location.directory }),
})

export default OdfDelegationPluginV2
