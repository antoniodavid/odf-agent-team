# Changelog — ODF Agent Team

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
