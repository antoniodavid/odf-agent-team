#!/usr/bin/env node
/**
 * ODF CLI entrypoint. Thin wrapper: all behavior lives in
 * scripts/lib/install-core.mjs so it can be unit tested without spawning a
 * process.
 *
 * Usage: odf install [flags] | odf doctor | odf version
 */

import path from "node:path"
import { fileURLToPath } from "node:url"
import { runCli } from "../scripts/lib/install-core.mjs"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const exitCode = runCli({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  sourceRoot,
})

process.exit(exitCode)
