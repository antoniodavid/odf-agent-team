# ODF Agent Team

> Tu equipo de desarrollo Odoo con IA — skills, agentes y workflow OCA-compliant para OpenCode.

**ODF (Odoo Development Framework)** es un sistema de agentes AI especializados en desarrollo Odoo. Incluye 31 skills, 12 agentes, 21 comandos, pipeline thin-spine de desarrollo (`preflight → DECIDE → optional PLAN → BUILD → VERIFY → archived`), orquestador conversacional con preflight gate, e instalador idempotente.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.sh | bash
```

O con más control:

```bash
# Descarga el instalador
./install.sh --yes          # Instalación no interactiva
./install.sh --dry-run      # Ver qué haría sin modificar nada
./install.sh --force        # Sobrescribir sin preguntar
```

Variables de entorno útiles:

- `ODF_DIR` — destino de la instalación (por defecto `~/.config/opencode`)
- `ODF_SOURCE_DIR` — instalar desde una copia local del repo
- `ODF_INSTALL_NONINTERACTIVE=1` — equivalente a `--yes`
- `ODF_SKIP_NPM=1` — omitir `npm install` durante la instalación
- `ODF_SKIP_SELFTEST=1` — omitir el self-test tras instalar

## Requisitos

- **OpenCode** v1.15+ (sistema de agentes AI)
- **Python** 3.8+
- **Node.js** 18+
- **Odoo** 16, 17, 18 o 19

## Qué Incluye

| Componente | Cantidad | Descripción |
|------------|----------|-------------|
| **Skills** | 31 | Patrones de desarrollo, OCA compliance, PR workflow, TDD, chained PRs |
| **Agentes** | 12 | Especialistas: backend, frontend, QA, functional, DBA, APIs, migraciones |
| **Comandos** | 21 | Definiciones de slash commands en `command/` |
| **Comandos nativos** | 4 | `/odf-new`, `/odf-continue`, `/odf-status`, `/odf-explore` registrados en el orchestrator |
| **Plugin** | 1 | `odf-delegation.ts` — delegación real vía `task()`, inyección de skills, métricas, fallback |
| **Perfiles** | 2 | `default` (deepseek-r1 + kimi-k2.6), `cheap` (kimi-k2.6 todas las fases) |
| **Tests** | 307 | 188 unit tests (Vitest) + 119 aserciones de escenarios YAML |

## Uso Rápido

```bash
# 1. Abre OpenCode en tu proyecto Odoo
# 2. Inicializa el proyecto
/odf-init

# 3. Verifica que todo funciona
/odf-health --full

# 4. Arranca un cambio nuevo con preflight gate
/odf-new mi-feature

# 5. Continúa el último cambio activo
/odf-continue

# 6. Revisa el estado de los cambios activos
/odf-status

# 7. Investiga un tema sin crear un cambio formal
/odf-explore "cómo funciona el stock.move.line"

# 8. Corrige un bug rápido
/odf-fix sale-tax-rounding

# 9. Cambia de perfil de modelos
/odf-profile list
/odf-profile switch cheap

# 10. Crea un backup
/odf-backup create

# 11. Revisa métricas de los agentes
/odf-metrics --days 7
```

## Preflight y Orchestrator

ODF ahora incluye un **preflight gate** que captura las decisiones del proyecto antes de delegar fases:

- Modo de ejecución (`interactive` / `batch`)
- Almacén de artefactos (`openspec` / `engram` / `hybrid`)
- Estrategia de entrega (`ask-always`, `ask-on-risk`, `auto-chain`, `single-pr`)
- Presupuesto de líneas por PR (por defecto 400)
- Versión de Odoo (16, 17, 18, 19)
- Modo TDD (`true` / `false`)
- Estrategia de solución (`standard` / `custom` / `pending`)
- Estrategia de cadena de PRs (`none` / `chained` / `feature-branch`)

El **orchestrator** (`agent/odoo_orchestrator.md`) coordina el flujo thin-spine:

```
init → preflight → DECIDE → optional PLAN → BUILD → VERIFY → archived
```

Las fases legacy siguen funcionando como adaptadores compatibles:

- `DECIDE` = `PROPOSE` + `ASSESS`
- `PLAN` = `QA-PLAN` + `DESIGN` (opcional; ver ejemplos de enrutado)
- `BUILD` = `IMPLEMENT`
- `VERIFY` se mantiene como etapa independiente

`QA-PLAN`/`QA-REVIEW`/`QA-AGGREGATE`/`QA-REPORT` son lentes de QA anidadas en `PLAN`, `BUILD` y `VERIFY`, no etapas canónicas obligatorias. La ruta concreta se decide por tipo de trabajo (config estándar, cambio pequeño, normal, cross-domain, migración, bugfix, investigación).

Cada fase se delega al agente especializado a través del plugin `odf_delegate`, que invoca la API nativa `task()` de OpenCode y devuelve un resultado estructurado. Si `task()` no está disponible, el plugin devuelve un envelope de fallback con el prompt enriquecido.

## Comandos Nativos

| Comando | Uso | Descripción |
|---------|-----|-------------|
| `/odf-new` | `/odf-new <nombre> ["descripción"] [--fast]` | Inicia un cambio con preflight y orquestador |
| `/odf-continue` | `/odf-continue [nombre]` | Reanuda el cambio activo más reciente o uno nombrado |
| `/odf-status` | `/odf-status [nombre]` | Lista cambios activos o muestra detalle de uno |
| `/odf-explore` | `/odf-explore <tema> [--version N] [--module M]` | Investigación profunda sin crear un cambio formal |

Otros comandos públicos (en `command/`) siguen disponibles: `/odf-fix` (diagnose → BUILD → VERIFY), `/odf-apply` (alias de BUILD vía adaptador IMPLEMENT), `/odf-verify` (ejecuta VERIFY), `/odf-qa` (lente de QA), `/odf-archive`, `/odf-profile`, `/odf-tdd-toggle`, `/odf-health`, `/odf-metrics`, etc.

## Skills Destacados

| Skill | Propósito |
|-------|-----------|
| `oca-commit-messages` | Formato OCA para commits (`[FIX] module: desc`) |
| `oca-work-unit-commits` | Commits como unidades revisables |
| `oca-pr-workflow` | PR checklist + workflow OCA |
| `oca-chained-pr` | Split de PRs >400 líneas |
| `oca-cognitive-doc-design` | Documentos con baja carga cognitiva |
| `oca-comment-writer` | Comentarios humanos en PRs |
| `odf-tdd` | Strict TDD mode (opt-in) |
| `odf-fix` | Bugfix rápido 3-step |
| `odf-verify` | Quality gate + Judgment Day adversarial review |

## Agentes

| Agente | Rol | Etapas |
|--------|-----|--------|
| `odoo_orchestrator` | Coordinador principal | ALL |
| `odoo_functional_consultant` | Propuesta y análisis standard vs custom | DECIDE (PROPOSE, ASSESS) |
| `odoo_backend_engineer` | Python models, views, security | PLAN, BUILD |
| `odoo_frontend_engineer` | OWL, JS/TS, SCSS, QWeb | PLAN, BUILD |
| `odoo_qa_engineer` | Test strategy, coverage | PLAN (lente QA), VERIFY |
| `odoo_api_integrator` | HTTP controllers, webhooks | PLAN, BUILD |
| `odoo_dba_devops` | PostgreSQL, Docker, performance | ANY |
| `odoo_upgrade_migrator` | OpenUpgrade, migrations | ANY |
| `odoo_code_reviewer` | Code review | VERIFY |
| `odoo_context_gatherer` | Pattern discovery | DECIDE |
| `odoo_skill_finder` | Skill lookup fallback | PLAN, BUILD |
| `odoo_stock_lot_specialist` | Lot/serial, FEFO, traceability | PLAN, BUILD |

## Arquitectura

```
ODF Agent Team
├── Registry (31 skills, 12 agents, 2 profiles, package metadata)
├── Orchestrator (odoo_orchestrator) — preflight gate + thin-spine state machine
│   ├── DECIDE    → odoo_functional_consultant (PROPOSE + ASSESS adapters)
│   ├── PLAN      → odoo_qa_engineer + odoo_backend/frontend_engineer (optional)
│   ├── BUILD     → odoo_backend_engineer (or custom agent)
│   └── VERIFY    → odoo_qa_engineer + Judgment Day
├── Plugin (odf-delegation.ts: task() invocation, skill injection, metrics, fallback)
│   ├── odf_workflow_route — canonical thin-spine routing
│   ├── odf_workflow_status — OpenSpec-first status adapter (read-only)
│   ├── odf_policy_gate / odf_receipt — TDD gate + failure receipts
│   └── odf_status — legacy Engram status fallback
├── Commands (21 slash commands, 4 nativos en registry)
├── Installer (idempotent install.sh + package.json)
└── Observatory (metrics, tests, health checks)
```

## Desarrollo

```bash
# Correr todos los tests
npm test

# Solo unit tests
npm run test:unit

# Solo escenarios YAML
npm run test:yaml

# Type check
npm run typecheck

# Validar el registry
node scripts/odf-registry-validate.js

# Refresh registry después de cambios
/odf-registry-refresh

# Ver health
/odf-health --full
```

## Documentación

- `docs/intended-usage.md` — modelo mental de uso de ODF
- `docs/architecture.md` — mapa de componentes e interacciones
- `docs/skill-style-guide.md` — reglas de autoría de skills ODF

## Licencia

MIT — ver [LICENSE](LICENSE) para detalles.
