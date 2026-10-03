# Changelog — ODF Agent Team

## 1.5.1 (2026-10-03)

### Fixed
- Workflow persistence and recovery: Policy Gate writes fail closed, ARCHIVE retries repair partial OpenSpec/Engram writes, and replanning invalidates downstream artifacts (#104–#106).
- Native delegation safety: restore V2 delegation, guard direct tool calls, check seal context before child launch, and bind recovery to the exact idle child; handle multiline prompts, V2 result text, and transport banners safely (#86, #89, #93, #100, #101, #107, #108).
- Canonical workflow artifacts: terminal BUILD behavior is explicit, and nested assessment artifacts and block-YAML status maps are recognized (#87, #91, #102).
- VERIFY evidence is command-aware; warning is terminal only for a valid VERIFY report; a BUILD start proof does not replace persisted post-child validation evidence (#109, #110, #112).
- OpenCode V2 `/odf-new` normalizes sentence-final punctuation and binds workflow initialization to the active session workspace.

### Changed
- Preflight defaults, strict input validation, and the runtime/specification contract are synchronized (#111).
- Workflow route, recovery, archive, and metrics guidance reflects the merged behavior (#85, #94, #96, #97).
- Lifecycle metrics correlate mixed-flow events and deduplicate mirrored stages (#98, #99).

### Verification boundary
- CI on Node 22 passed for the implementation PRs #104 and #106–#112, whose merged suite contained 1,050 unit tests, 330 YAML scenarios, and 18 harness checks. The 1.5.1 release candidate adds one V2 `/odf-new` regression case; its local validation passed 1,051 unit tests, 330 YAML scenarios, and 18 harness checks.
- Odoo-specific release validation and end-to-end telemetry remain outside this harness patch release; ODF 2.0 readiness is not claimed.

## 1.5.0 (2026-09-29)

### Added
- **Native delegation (OpenCode V2)**: `odf_delegation_prepare` + `odf_delegation_seal` run a phase as a host `subagent` child session — visible agent, description and live status — while every ODF gate stays plugin-side: bounded `odf-tok-…` tokens under `.odf/` (prompt digest, two-hour TTL, workspace containment), child-session binding checks, composite gates and a proof-backed replay of the authoritative delegate (policy gate, validation evidence, workflow commit, attempt settlement, failure receipts). The sealed envelope matches `odf_delegate` for identical inputs (delegate/seal parity matrix).
- **Native parallel BUILD**: `odf_parallel_prepare` + `odf_parallel_seal` launch one `subagent` per branch (background allowed) and run the authoritative aggregate scheduler: per-branch validation evidence, the parallel-join artifact, one BUILD commit and one aggregate receipt on failure, with per-branch `task_session_id`.
- **Chokepoint guard**: the V2 `execute.before` hook blocks direct `subagent`/`task` calls from the orchestrator to registered ODF specialists without the prepared delegation marker; manual agent use from other sessions is untouched.
- The plugin exposes 26 runtime tools.

### Changed
- Orchestrator and phase commands document the native single and parallel delegation flows, their recovery reasons, and the fast-lane / cross-domain boundaries.
- Native seals record one aggregate `subagent` metric (the replayed delegate metrics are suppressed), including join counts for parallel BUILD.

### Fixed
- Heavy phases: VERIFY gets the same 900000 ms timeout budget as ASSESS/QA-PLAN/DESIGN, and the orchestrator documents expected duration, child-session visibility (`ODF <phase> → <agent> · <change>`, `/sessions` on the legacy path) and interruption semantics — interrupting aborts the child, settles the attempt as failed, applies the single transport relaunch, and `/odf-continue` resumes (#80).
- Parallel BUILD recovery: a persisted join left `running` after a host restart is recovered instead of dead-ending BUILD (#74, #75).
- Legacy status: progress-bearing artifacts (`implement-progress`, `apply-progress`, `tasks`, `explore-progress`, `fix-progress`) derive their state from content, so partial work renders as `in-progress` instead of `done` (#73, #75).
- Metrics: the entry-to-final-gate funnel breaks down per stage so the dominant bottleneck is localizable (#76, #77).
- Parallel scheduler tests use `waitFor` timeouts above the vitest 1 s default and no longer flake under load (#78, #79).

### Verification boundary
- Local repository checks cover 998 unit tests (37 files), 325 YAML scenarios, and 18 harness checks; CI runs the same suite on Node 22.
- Native delegation is covered by the prepare/seal flow tests, the delegate-vs-seal parity matrix (composite, proof-backed, inner-failed) and the parallel BUILD end-to-end tests; the real Odoo VERIFY run is recorded as release evidence.

## 1.4.0 (2026-09-28)

> **BREAKING — OpenCode V2 only.** The plugin entrypoint no longer exports the
> V1 `server` implementation, and `@opencode-ai/plugin` is not part of the
> runtime graph. Packs installed from this release require an OpenCode V2 host:
> a V1 host will not register the ODF plugin.

### Added
- Native delegation visibility under OpenCode V2: child sessions carry a descriptive `ODF <phase> → <agent> · <change>` title, the delegated agent is surfaced through tool progress while the phase runs, and the outer delegation envelope reports `task_session_id` (#54, #56).
- Source-authority `not_applicable` evidence: non-view DESIGN/IMPLEMENT work can return a bounded `not_applicable` envelope when the task names no concrete view/action XML ID or `inherit_id`/`search_view_id` relation; concrete references still require the deterministic `odf-toolkit lookup` (#50, #52).

### Changed
- **OpenCode V2 only**: the entrypoint `plugins/odf-delegation.ts` now default-exports the official `Plugin.define({ id, setup })` shape. The V1 `server` export, `OdfDelegationPlugin` and `createODFRuntimeHooks` were removed along with their V1 contract fixtures.
- Runtime code no longer imports `@opencode-ai/plugin`. The shared `tool` helper moved to `odf-plugin/odf-tool.ts` (identity function + `zod` schema namespace), so the plugin graph carries only the host-provided `@opencode/plugin` plus the declared `zod` and `yaml` dependencies. `@opencode-ai/plugin` and `@opencode-ai/sdk` are now devDependencies, used for types and the V1/V2 schema-parity fixtures.

### Fixed
- Registry/telemetry warm-up used to live inside the retired V1 `server` entrypoint, so the V2 host silently lost it. It is now `startOdfRuntime()`, awaited by `setupODFV2`: metrics flushing, the skills/permissions cache refresh, unregistered-skill discovery and the learning loop all run under OpenCode V2.
- OpenCode V2 now injects the one-shot context-pressure notice through the `session.context` hook, restoring parity with the retired V1 `experimental.chat.system.transform` seam.
- `install.sh` installs dependencies **before** exposing the plugin entrypoint, and reminds you to restart the OpenCode service afterwards (`--restart-service` / `ODF_RESTART_SERVICE=1` to do it immediately). A plugin that fails once stays `failed` inside a running service until it restarts — this was the root cause of the plugin never loading after a fresh install.
- Three new installer tests cover the dependency/plugin ordering, the default no-op dry run and the opt-in restart flag.
- Config-dir resolution no longer ignores `XDG_CONFIG_HOME` and no longer depends on the project launcher: a single resolver (`scripts/lib/config-dir.js`) orders `ODF_CONFIG_DIR` → the pack the running module ships in (when it carries `odf-registry.json`) → `$XDG_CONFIG_HOME/opencode` → `~/.config/opencode`, and the five CLI copies of that logic delegate to it. A pack installed under `<project>/.opencode` resolves itself, so running `opencode` directly there reads the right registry. The README's `XDG_CONFIG_HOME resolution` claim holds again, the `/odf-*` prompts default `PACK` to the same order, and the YAML suite now passes with `ODF_CONFIG_DIR` unset instead of reading the installed registry instead of the checkout.
- The installed pack is self-verifiable: `tsconfig.pack.json` ships and installs as both `tsconfig.json` and `tsconfig.pack.json`, so `/odf-health --full` can typecheck the installed pack (#32, #33).
- Engram persistence is project-scoped and store-aware end to end: `odf-init` readback no longer depends on the working directory, the plugin resolves one project identity, and archive/metrics respect the selected store (#37, #38).
- `odf_health` reports why the V2 context session is unavailable instead of a bare failure (#34), and an interrupted first `odf_health` stays retryable instead of dead-ending `/odf-new` with `workflow-start-unauthorized` (#35, #36).
- `odf_delegate` blocks every path inside the installed ODF pack with symlink-resolved containment: the pack root, a symlinked config dir, and pack subdirectories (#42, #45).
- The ODF Result text parser is section-authoritative: it prefers `## ODF Result`, parses nested bullet fields into objects (prototype-pollution safe), coerces `true`/`false`/`null`, accepts the dash-less bold form, and no longer lets an unrelated fenced JSON block replace the result (#51, #53).
- Workflow recovery: re-entering an archived stage reopens the archived state (#63), block-YAML `completed_canonical_stages` lists parse correctly (#65), Engram state resolution reads local state before Engram (#66), and orphan workflow locks are recovered instead of dead-ending delegation (#67).
- Delegation cancellation bounds the child abort wait after a timeout (#64), and the TUI installer reports a degraded install honestly instead of claiming success (#68).
- The installer only exposes the plugin entrypoint once runtime dependencies resolve (#47).

### Verification boundary
- Local repository checks cover 970 unit tests (35 files), 325 YAML scenarios, and 18 harness checks; CI runs the same suite on Node 22.
- This release is OpenCode V2 only (see the breaking note above); a V1 host cannot register the plugin.

## 1.3.1 (2026-09-24)

### Fixed
- Installer: `curl | bash` no longer dies silently — non-interactive stdin continues with an explicit notice (the TTY prompt is kept and tolerates EOF); regression tests cover the piped script and stdin at EOF (#17).
- OpenCode V2 entry authorization: the prompt hook detects the expanded `/odf-new` command document, and the V2 adapter shares the entry-authorization maps between the loop guard and the registered tools, so the capability minted after `odf_health` reaches `odf_workflow_bind` (#18).
- Stale IMPLEMENT attempts: audited `odf_workflow_override action=settle-attempt` appends a terminal settlement (preserving the running record and the override audit log) and requires `confirm_no_active_run` plus a human-approved reason; it refuses attempts still active in the runtime, unsafe ids, and already-terminal records (#9).
- BUILD/VERIFY starts accept the completion-shape proof after an audited BUILD re-entry instead of rejecting it as a phase mismatch; `odf_workflow_advance` accepts an explicit `null` candidate_stage for initial transitions and documents the start convention (#28).
- TUI installer parity with `install.sh`: copies `odf-plugin/`, `policies/`, and `package.json` (so `npm install` runs), syncs the stale-plugin cleanup list, and covers uninstall/backup; tool, command, and skill counts in the docs match the registry and are guarded by consistency tests.

### Added
- GitHub Actions CI with test-gated auto-merge: typecheck, unit tests, YAML scenarios, registry validation, and diff check run on every PR; passing same-repo PRs squash-merge automatically (Node 22, actions v7).

### Verification boundary
- Local repository checks cover 900 unit tests, 325 YAML scenarios, and 18 harness checks; CI runs the same suite on Node 22.
- ODF 2.0 remains gated on representative Odoo validation, canary/cohort evidence, and end-to-end `/odf-new`/`/odf-fix` telemetry; this release does not claim ODF 2.0 production readiness.

## 1.3.0 (2026-09-21)

### Added
- Fast-lane execution and V2 transport, including SDK child-session transport, shadow-route prediction, context manifests, and bounded implementation routing.
- Migration assessment routing, expanded agent and entry contracts, human Expectations, and stronger workflow and policy enforcement.
- Governance profiles and checks, provenance and disclosure updates, lifecycle and trace observability, installer/project-scope improvements, and resilience and ephemeral-subject validation.

### Verification boundary
- Local repository checks cover 844 unit tests, 154 YAML scenarios, and 17 harness checks.
- ODF 2.0 remains gated on representative Odoo validation, canary/cohort evidence, and end-to-end `/odf-new`/`/odf-fix` telemetry; this release does not claim ODF 2.0 production readiness.

## 1.2.1 (2026-08-23)

### Added
- Gate de precisión: `odf-toolkit lookup` (IDs de vista/modelos/campos en el source local con file:line) y `verify-refs` (cada ref=/model= del módulo debe resolverse; exit 1 si no). Reglas "nunca inventar IDs" en odoo-sources, odf-design, odf-implement y backend engineer; el orquestador reenvía `odoo_source_root`.
- README reescrito: estado honesto, matriz de dependencias/degradación, pipeline, CLIs y gate de precisión.

### Fixed
- TUI: Enter en `(Y/n)` confirmaba en vez de cancelar; listener raw que se tragaba el Enter siguiente; guard no-TTY con hint de automatización.

## 1.2.0 (2026-08-22)



### Added
- `execution_mode: auto` (piloto automático): auto-continuación de fases en `ok`/`warning`, deteniéndose solo en gates obligatorios (health, preflight, Expectations, Policy Gate, evidencia, VERIFY, receipts)
- CLIs deterministas: `odf-project-scan` (config completa del entorno Doodba: addons.yaml sources, compose, linting, git, CodeGraph, matriz de dependencias; persist verificado con checksum/diff/exit codes; `--deep` indexa repos activos) y `odf-toolkit` (context/state/result/resolve/evidence/metrics/manual-evidence/redundancy)
- Triage mejorado (ICE): señales de riesgo desde module/domain + `pii`, claridad de intent con pregunta agrupada, `standard-config` sin hechos, `known_modules` desde odf-init, signals/clarity auditables
- Redundancy pre-check en `/odf-new` (implementaciones existentes + `odf-learned/{project}` como base de rechazos)
- Ejecución manual de tests en VERIFY (`manual-evidence`, `executor: user-manual`)
- Completion criteria en odf-assess/design/implement/verify; smell baseline Fowler para el lens de readability; seams-first y anti-patrones de tests en implement/tdd; feedback-loop-first + redacción en odf-fix; handoff con Suggested Skills
- Descubrimiento de artefactos OpenSpec anidados (`design/design.md`, `qa-plan/plan.md`, ...)

### Fixed
- Agente DESIGN/PLAN bloqueado por `design_closed: "true"` (string): coerción `asBoolean` en el validador
- Resolver de agentes elegía frontend por el token genérico "odoo": scoring por coincidencias + stop word
- `odf-init` colgado buscando el pack: ruta determinista `$ODF_CONFIG_DIR` sin filesystem search
- Scan degradado con `--repo` relativo (resolución contra `odoo/custom/src`) + guarda anti-sobrescritura
- Persist de config truncado por el límite de ~50KB de Engram: persist compacto + readback verificado
- Falso positivo de seguridad con el guard obligatorio de base de datos (masking de prohibiciones)
- Hybrid BUILD/VERIFY escribía solo Engram: ahora escribe OpenSpec (autoridad) + espejo Engram
- `odf-qa` hardcodeaba `mem_save`: ahora persiste en el store seleccionado con `artifact_ref`

## 1.1.0 (2026-06-18)

### Added
- Orquestador conversacional (`agent/odoo_orchestrator.md`) con preflight gate y máquina de estados
- Comandos nativos `/odf-new`, `/odf-continue`, `/odf-status`, `/odf-explore` registrados en `odf-registry.json`
- Plugin `odf-delegation.ts` invoca la API nativa `task()` de OpenCode con fallback determinista
- `install.sh` idempotente con `--yes`, `--dry-run`, `--force`, backup con timestamp y soporte `ODF_SOURCE_DIR`
- `package.json` con dependencias, scripts de test y peer dependencies del plugin SDK
- Validación de Node.js 18+ en `install.sh`
- Resolución de rutas relativas en `odf-registry.json` con flag `use_relative_paths`
- Metadatos de paquete en `odf-registry.json` (name, version, repository, dependencies)
- `scripts/odf-registry-validate.js` para verificar que todas las rutas registradas resuelven
- Helpers de preflight y orchestrator en `scripts/lib/` con tests unitarios
- Parser CLI mínimo en `scripts/odf-cli.js` para los comandos nativos
- Tests unitarios con Vitest (92 tests) y escenarios YAML (118 aserciones)

### Changed
- README actualizado con instalación via `./install.sh`, referencia de comandos nativos y mención del orquestador/preflight
- Versión del proyecto a 1.1.0 (VERSION, package.json, odf-registry.json, install.sh)

## 1.0.0 (2026-05-14)

### Added
- 31 skills organizados por categoría (ODF, OCA Governance, OCA Style, Patterns)
- 12 agentes especializados en desarrollo Odoo
- Plugin `odf-delegation.ts` con auto-refresh, cache, métricas, y learning loop
- Pipeline completo: ASSESS → QA-PLAN → DESIGN → IMPLEMENT → VERIFY
- Skill Registry CLI (`/odf-registry-refresh`)
- Multi-profile switching (`/odf-profile` list|switch|create|delete)
- Backup & Rollback (`/odf-backup` create|list|restore)
- Skill version tracking (`/odf-skill-log`)
- Agent Observatory (`/odf-metrics`) con delegación metrics + learning loop
- Strict TDD mode (`/odf-tdd` on|off)
- Chained PRs para PRs >400 líneas
- PR Size Budget check (`/odf-pr-size`)
- Issue-First workflow check (`/odf-issue-check`)
- Health Checks (`/odf-health` --quick|--full)
- Uninstall Flow seguro (`/odf-uninstall`)
- 36 test cases para resolución de skills y agentes
- OCA commit messages con 12 tags y formato completo
- OCA work-unit commits
- Judgment Day adversarial review (3-pass: reviewer, maintainer, attacker)
- Auto-descubrimiento de skills en subagentes
- Perfiles de modelo: default (deepseek-r1 + kimi-k2.6), cheap (kimi-k2.6)

### Changed
- Todos los skills restructurados al estándar gentle-ai (180-450 tokens)
- Registry convertido a formato named profiles
- Plugin de 766→1044 líneas con metrics + learning loop

### Fixed
- Rutas relativas de skills → absolutas (34 archivos)
- Permisos de agentes (12 agentes con acceso completo)
- mgrep → fff/fff_grep en todos los skills

## 0.1.0 (2026-04-01)

### Added
- Initial ODF workflow with 5 phases
- Basic OCA compliance skills
- odf-registry.json with 22 skills
- ODF delegation plugin
