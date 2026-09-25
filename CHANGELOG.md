# Changelog — ODF Agent Team

## 1.4.0 (2026-09-24)

> **BREAKING — OpenCode V2 only.** The plugin entrypoint no longer exports the
> V1 `server` implementation, and `@opencode-ai/plugin` is not part of the
> runtime graph. Packs installed from this release require an OpenCode V2 host:
> a V1 host will not register the ODF plugin.

### Changed
- **OpenCode V2 only**: the entrypoint `plugins/odf-delegation.ts` now default-exports the official `Plugin.define({ id, setup })` shape. The V1 `server` export, `OdfDelegationPlugin` and `createODFRuntimeHooks` were removed along with their V1 contract fixtures.
- Runtime code no longer imports `@opencode-ai/plugin`. The shared `tool` helper moved to `odf-plugin/odf-tool.ts` (identity function + `zod` schema namespace), so the plugin graph carries only the host-provided `@opencode/plugin` plus the declared `zod` and `yaml` dependencies. `@opencode-ai/plugin` and `@opencode-ai/sdk` are now devDependencies, used for types and the V1/V2 schema-parity fixtures.

### Fixed
- Registry/telemetry warm-up used to live inside the retired V1 `server` entrypoint, so the V2 host silently lost it. It is now `startOdfRuntime()`, awaited by `setupODFV2`: metrics flushing, the skills/permissions cache refresh, unregistered-skill discovery and the learning loop all run under OpenCode V2.
- OpenCode V2 now injects the one-shot context-pressure notice through the `session.context` hook, restoring parity with the retired V1 `experimental.chat.system.transform` seam.
- `install.sh` installs dependencies **before** exposing the plugin entrypoint, and reminds you to restart the OpenCode service afterwards (`--restart-service` / `ODF_RESTART_SERVICE=1` to do it immediately). A plugin that fails once stays `failed` inside a running service until it restarts — this was the root cause of the plugin never loading after a fresh install.
- Three new installer tests cover the dependency/plugin ordering, the default no-op dry run and the opt-in restart flag.
- Config-dir resolution no longer ignores `XDG_CONFIG_HOME` and no longer depends on the project launcher: a single resolver (`scripts/lib/config-dir.js`) orders `ODF_CONFIG_DIR` → the pack the running module ships in (when it carries `odf-registry.json`) → `$XDG_CONFIG_HOME/opencode` → `~/.config/opencode`, and the five CLI copies of that logic delegate to it. A pack installed under `<project>/.opencode` resolves itself, so running `opencode` directly there reads the right registry. The README's `XDG_CONFIG_HOME resolution` claim holds again, the `/odf-*` prompts default `PACK` to the same order, and the YAML suite now passes with `ODF_CONFIG_DIR` unset instead of reading the installed registry instead of the checkout.

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
