# ODF Agent Team

> Tu equipo de desarrollo Odoo con IA — skills, agentes y workflow OCA-compliant para OpenCode.

**ODF (Odoo Development Framework)** es un sistema de agentes AI especializados en desarrollo Odoo. Incluye 31 skills, 12 agentes, pipeline completo de desarrollo (ASSESS → DESIGN → IMPLEMENT → VERIFY), y observabilidad.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.sh | bash
```

## Requisitos

- **OpenCode** v1.14+ (sistema de agentes AI)
- **Python** 3.8+
- **Node.js** 18+
- **Odoo** 14, 15, 16, 17, 18, o 19

## Qué Incluye

| Componente | Cantidad | Descripción |
|------------|----------|-------------|
| **Skills** | 31 | Patrones de desarrollo, OCA compliance, PR workflow, TDD, chained PRs |
| **Agentes** | 12 | Especialistas: backend, frontend, QA, functional, DBA, APIs, migraciones |
| **Comandos** | 14 | `/odf-init`, `/odf-new`, `/odf-fix`, `/odf-profile`, `/odf-backup`, `/odf-metrics`, etc. |
| **Plugin** | 1 | `odf-delegation.ts` — auto-refresh, métricas, learning loop |
| **Perfiles** | 2 | `default` (deepseek-r1 + kimi-k2.6), `cheap` (kimi-k2.6 todas las fases) |
| **Tests** | 36 | Test runner para verificar resolución de skills y agentes |

## Uso Rápido

```bash
# 1. Abre OpenCode en tu proyecto Odoo
# 2. Inicializa el proyecto
/odf-init

# 3. Verifica que todo funciona
/odf-health --full

# 4. Arranca un cambio nuevo
/odf-new mi-feature

# 5. Corrige un bug rápido
/odf-fix sale-tax-rounding

# 6. Cambia de perfil de modelos
/odf-profile list
/odf-profile switch cheap

# 7. Crea un backup
/odf-backup create

# 8. Revisa métricas de los agentes
/odf-metrics --days 7
```

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

| Agente | Rol | Fases |
|--------|-----|-------|
| `odoo_orchestrator` | Coordinador principal | ALL |
| `odoo_functional_consultant` | Análisis standard vs custom | ASSESS |
| `odoo_backend_engineer` | Python models, views, security | DESIGN, IMPLEMENT |
| `odoo_frontend_engineer` | OWL, JS/TS, SCSS, QWeb | DESIGN, IMPLEMENT |
| `odoo_qa_engineer` | Test strategy, coverage | QA-PLAN, VERIFY |
| `odoo_api_integrator` | HTTP controllers, webhooks | DESIGN, IMPLEMENT |
| `odoo_dba_devops` | PostgreSQL, Docker, performance | ANY |
| `odoo_upgrade_migrator` | OpenUpgrade, migrations | ANY |
| `odoo_code_reviewer` | Code review | VERIFY |
| `odoo_context_gatherer` | Pattern discovery | ASSESS |
| `odoo_skill_finder` | Skill lookup fallback | DESIGN, IMPLEMENT |
| `odoo_stock_lot_specialist` | Lot/serial, FEFO, traceability | DESIGN, IMPLEMENT |

## Arquitectura

```
ODF Agent Team
├── Registry (31 skills, 12 agents, 2 profiles)
├── Orchestrator (odoo_orchestrator)
│   ├── ASSESS     → odoo_functional_consultant
│   ├── QA-PLAN   → odoo_qa_engineer
│   ├── DESIGN    → odoo_backend_engineer (or custom agent)
│   ├── IMPLEMENT → odoo_backend_engineer (or custom agent)
│   └── VERIFY    → odoo_qa_engineer + Judgment Day
├── Plugin (auto-refresh, metrics, learning loop)
├── Commands (14 slash commands)
└── Observatory (metrics, tests, health checks)
```

## Desarrollo

```bash
# Correr tests
node ~/.config/opencode/scripts/odf-test-runner.js

# Refresh registry después de cambios
/odf-registry-refresh

# Ver health
/odf-health --full
```

## Licencia

MIT — ver [LICENSE](LICENSE) para detalles.
