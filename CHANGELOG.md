# Changelog — ODF Agent Team

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
