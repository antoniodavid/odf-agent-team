# ODF Agent Team

> Sistema de agentes y skills para desarrollo **Odoo** con OpenCode — pipeline spec-driven, CLIs deterministas y gates de precisión.

**ODF (Odoo Development Framework)** orquesta el desarrollo de módulos Odoo con una pipeline de fases delegadas a agentes especializados, respaldada por **lógica determinista en CLIs** (scan del entorno, lookup de IDs, evidencia de tests) para que los agentes encuentren el codebase en vez de inventarlo.

## Estado honesto

- **Maduro y testeado**: 619 tests Vitest + 150 escenarios YAML + smoke integral del harness (`npm run test:harness`). Cada release se verifica de punta a punta.
- **Portable**: se instala en cualquier entorno de OpenCode (Linux/macOS/Windows vía Git Bash/WSL), con resolución `XDG_CONFIG_HOME` y reescritura de paths al destino.
- **Limitaciones conocidas**:
  - El entrypoint del plugin (`plugins/odf-delegation.ts`, ~6k líneas) sigue siendo un monolito para el núcleo de delegación/workflow; las secciones autocontenidas ya viven en módulos (`odf-plugin/odf-delegation-{shared,metrics,health,policy,loopguard}.ts`).
  - El store `engram` requiere el **MCP de Engram** (o el CLI para estado); sin él, los flujos OpenSpec funcionan y los Engram-only bloquean temprano con mensaje claro.
  - `codegraph`/`fff`/`context7` son **opcionales**: degradan a búsqueda nativa/FFF con warnings (ver matriz abajo).
  - El modelo de fases es estricto por diseño; el escape hatch es `odf_workflow_override` (skip/re-enter/re-plan auditado), no el bypass.

## Instalación

```bash
# Release-pinned (recomendado)
curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/v1.2.1/install.sh | BRANCH=v1.2.1 bash
# O con flags: --yes (no interactivo) --force --with-codegraph --configure-mcp

# TUI interactiva (modo, componentes, perfil, MCP)
./install.sh --tui

# Desde el repo
./install.sh --yes --force
```

Variables útiles: `ODF_DIR` / `ODF_CONFIG_DIR` / `XDG_CONFIG_HOME` (destino), `ODF_SOURCE_DIR` (instalación local), `ODF_SKIP_NPM=1`, `ODF_SKIP_SELFTEST=1`, `BRANCH=<tag>` (pinned).

### Dependencias y degradación

| Dependencia | Falta | Impacto |
|---|---|---|
| Node.js 18+ | — | El pack no corre |
| `engram` (CLI) | OpenSpec OK; Engram-only bloquea con `engram-cli-unavailable` | Opcional |
| `engram` (MCP) | Store=engram bloquea temprano (instalar MCP o usar `openspec`) | Opcional |
| `codegraph` | Context packs desactivados → FFF/nativo | Opcional |
| `fff` / `context7` | Fallback a búsqueda nativa / fuentes locales | Opcional |
| `git` / `docker` | Digests/evidence o test-command desactivados | Recomendado |

Ver la matriz completa con: `node <pack>/scripts/odf-toolkit.js deps`

## Pipeline

```
init → preflight → DECIDE → optional PLAN → BUILD → VERIFY → archived
```

- `execution_mode`: `interactive` · `batch` · **`auto`** (piloto automático: fases encadenadas, gates obligatorios intactos).
- Fases legacy = adaptadores: `DECIDE`=PROPOSE+ASSESS, `PLAN`=QA-PLAN+DESIGN, `BUILD`=IMPLEMENT, `VERIFY` independiente.
- **Override auditado**: `odf_workflow_override` — skip (solo DECIDE/PLAN), re-enter (invalida etapas posteriores), re-plan (con revisiones de Expectations `revision/supersedes/replan_from`). Cada llamada se registra en `.odf/override-{change}.jsonl`.
- **Preflight**: `artifact_store` (openspec/engram/hybrid), `delivery_strategy`, `review_budget_lines`, `validation_mode` (automated/manual-acceptance), `odoo_version`, TDD, chain strategy.

## CLIs deterministas (el "cerebro" fuera del LLM)

| CLI | Subcomandos |
|---|---|
| `odf-project-scan` | Scan completo del entorno Doodba (addons.yaml sources, compose, linting, git, CodeGraph, matriz de dependencias) + persist verificado, checksum, `--diff`, `--deep`, exit codes |
| `odf-toolkit` | `context` (CodeGraph explore) · `state` · `result` · `resolve` · `evidence` · `metrics` · `manual-evidence` · `redundancy` · `deps` · **`lookup`** · **`verify-refs`** |

### Gate de precisión (nunca inventar IDs)

```bash
# Encontrar un XML ID / modelo / campo en el source local (file:line)
odf-toolkit lookup --source <odoo-src-root> [--repos <src-dir>] --id <xmlid> | --model <model>

# VERIFY: cada ref=/model= del módulo debe resolverse (exit 1 si no)
odf-toolkit verify-refs --repo <module-dir> --source <odoo-src-root> [--repos <src-dir>]
```

Diseño e implementación **deben** verificar cada ID de vista, modelo y `_inherit` contra el source local; un ID sin resolver es una decisión abierta, nunca un guess.

## Qué incluye

- **32 skills** (OCA governance/style, patrones Odoo, fases ODF, convenciones compartidas), **13 agentes** especializados (backend, frontend, QA, functional, DBA, APIs, migraciones, stock-lot, proposer, etc.), comandos `/odf-*`.
- **Plugin** (`plugins/odf-delegation.ts` + 5 módulos en `odf-plugin/`): delegación vía `task()`, policy gate, evidence seal, receipts, override, bind, loop guard.
- **Instalador** idempotente con backup, TUI, `--configure-mcp`, probe de dependencias.
- **Tests**: `npm test` (Vitest + escenarios YAML), `npm run test:harness` (smoke integral), `node scripts/odf-registry-validate.js`.

## Desarrollo

```bash
npm test                 # 619 vitest + 150 escenarios
npm run test:harness     # smoke integral del harness
npm run typecheck        # tsc --noEmit
node scripts/odf-registry-validate.js   # paths del registry
```

Versión: `VERSION` + `odf-registry.json` + `CHANGELOG.md` deben ir sincronizados. Releases: tag semver + `gh release create`.

## Repositorio

- `agent/` — instrucciones de los agentes.
- `skills/` — skills (OCA + ODF + compartidas).
- `command/` — slash commands.
- `odf-plugin/` — módulos deterministas (workflow, status, triage, expectations, candidate-manifest, delegation-*).
- `scripts/` — CLIs y tests.
- `plugins/odf-delegation.ts` — entrypoint del plugin.
- `docs/` — arquitectura, contratos de diseño/expectations.
