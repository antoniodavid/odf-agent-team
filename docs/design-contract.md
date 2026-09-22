# Design Contract (T12)

Defines the **design document** that the DESIGN phase must produce, and the
**closed design criterion** guaranteeing that IMPLEMENT never has to
re-investigate. A design that is not closed is **iterated in DESIGN**, never
improvised in IMPLEMENT.

## Governing principle

> IMPLEMENT does not re-investigate. If IMPLEMENT is missing a decision that
> should have been made in DESIGN, DESIGN is **reopened** — never improvised
> in IMPLEMENT.

The design document is the **single source** that IMPLEMENT consumes. It must
resolve EVERYTHING before IMPLEMENT: down to which module each file goes to.

## Inputs

| Input | Origin | Role in DESIGN |
|-------|--------|----------------|
| `assess` artifact (REQ-XX) | ASSESS phase / store | Technical plan to materialize |
| `expectations` artifact (EXP-XX) | Expectations contract (T9) | Immutable human contract to resolve |
| Target module source code | Local repository | Real context before designing |

**Rule**: a design document that does not resolve **all** `EXP-XX` is not
closed. Every `EXP-XX` must have a row in the resolution section.

## Mandatory design document sections

### 1. Context

| Field | Required | Description |
|-------|----------|-------------|
| `module` | ✅ | **Exact** target module: name if new, or the inherited one if extending. Set by DESIGN, never by IMPLEMENT. |
| `module_type` | ✅ | `new` (create module) or `inherit` (extend an existing one). |
| `odoo_version` | ✅ | 16 / 17 / 18 / 19. |
| `manifest_depends` | ✅ | Manifest dependencies (e.g. `["sale", "account"]`). |
| `artifact_store` | ✅ | `engram` / `openspec` / `hybrid`. |
| `change` | ✅ | Kebab-case change name. |

### 2. EXP-XX resolution

Table closing each human expectation with its technical translation:

| EXP-XX | Technical decision | Target file(s) | Verification |
|--------|--------------------|----------------|--------------|
| `EXP-01` | Model `X` with field `y`... | `models/x.py`, `views/x_views.xml` | Test `test_01` + criterion |

- **Closing rule**: the number of rows MUST be `≥` the number of `EXP-XX` in
  the `expectations` artifact. A row without a concrete technical decision =
  design not closed.

### 3. Data model

Per model:

| Field | Type | required | index | relation | default | constraint |
|-------|------|----------|-------|----------|---------|------------|

Plus, per model:
- `_name` and/or `_inherit` (explicit). If `_name` + `_inherit`, state the
  parent model.
- `_inherit` vs `_name`: chosen and justified in one line.
- Computed fields: `@api.depends`, `store` yes/no, `compute_sudo` logic.
- Onchange: `@api.onchange` and its logic.
- Constraints: `@api.constrains` / `_sql_constraints`.

### 4. Views and UI

| View | Type | Model | Fields | Domain | Action | Menu (parent) |
|------|------|-------|--------|--------|--------|---------------|

- Include wizard (TransientModel) if applicable, with its buttons/actions.
- Include actions (`ir.actions.act_window`) and menus with their `parent`.

### 5. Security

- `ir.model.access.csv`: rows per group (`group_id/id`, CRUD permissions).
- `ir.rule`: if applicable, with domain.
- New groups: XML IDs (`<record model="res.groups">`).

### 6. Data / migration

- `noupdate` yes/no and why.
- Demo data (`demo/`) if applicable.
- Migration scripts (`migrations/{ver}/`) if existing data changes.

### 7. IMPLEMENT plan

Task breakdown where **each task** references:
- **Exact** target file(s).
- The `EXP-XX` it resolves.
- The ASSESS `REQ-XX` it materializes.

Task format:

| Task | File(s) | EXP-XX | REQ-XX | Action |
|------|---------|--------|--------|--------|
| `T1` | `models/x.py`, `security/ir.model.access.csv` | `EXP-01` | `REQ-01` | Create model + access |

- Closing rule: if a task would need a decision not defined in this document,
  DESIGN is reopened (never improvised in IMPLEMENT).

### 8. Closed-design checklist

The document MUST pass ALL criteria before being returned:

- [ ] Target module defined (new vs inherited) with `manifest_depends`.
- [ ] All models with `_name`/`_inherit`, fields/types/constraints.
- [ ] All views, actions and menus defined.
- [ ] Security complete (`ir.model.access.csv` per group, `ir.rule` if applicable).
- [ ] Data/migration defined.
- [ ] **All `EXP-XX` resolved** (one row each, with file + verification).
- [ ] Every IMPLEMENT plan task tied to exact file(s) and EXP-XX.
- [ ] IMPLEMENT can proceed without re-investigating (no open decisions left).

### 9. Architecture Decisions (conditional)

Only when a decision meets all THREE conditions — hard to reverse, surprising
without context, and the result of a real trade-off (alternatives existed) —
is a block recorded:

| Decision | Options considered | Choice | Consequence |
|----------|--------------------|--------|-------------|

- A decision failing any of the three conditions is NOT recorded (no ADR noise).
- The block is optional: a design with no qualifying decisions omits it and is
  still closed.

## design_meta (for estimation and library)

Besides the full document, DESIGN derives a **structured summary**
`design_meta` feeding the similarity estimator (`scripts/odf-estimator.js`)
and a future design library. It is **derived** from the closed document, never
invented: no closed document, no `design_meta`.

```json
{
  "change": "<kebab>",
  "work_type": "feature|migration|security|small-change|standard-config|...",
  "risk": "low|medium|high",
  "module_type": "new|inherit",
  "odoo_version": 17,
  "models": 2,
  "fields": 9,
  "views": 3,
  "tasks": 6,
  "exp_count": 3,
  "manifest_depends": ["sale", "account"],
  "module_destination": "sale",
  "closed": true
}
```

### Field → meaning

| Field | Type | Origin in the closed document |
|-------|------|-------------------------------|
| `change` | string | Kebab-case change name. |
| `work_type` | string | Nature of the change: `feature` / `migration` / `security` / `small-change` / `standard-config` / ... |
| `risk` | string | `low` / `medium` / `high` — by design complexity and surface area. |
| `module_type` | string | `new` (create module) or `inherit` (extend) — from the "Fix the module" step. |
| `odoo_version` | int | 16 / 17 / 18 / 19 — from context. |
| `models` | int | Number of models defined in the data model section. |
| `fields` | int | Total defined fields (all models). |
| `views` | int | Number of views/actions/menus defined in the views section. |
| `tasks` | int | Number of IMPLEMENT plan rows (T1..Tn). |
| `exp_count` | int | Number of rows in the EXP-XX resolution table. |
| `manifest_depends` | string[] | Manifest dependencies, from context. |
| `module_destination` | string | Exact target module (new or inherited). |
| `closed` | bool | `true` if the design passed the closing checklist (§8). |

### Derivation

- Count: `models` (rows per model in data model), `fields` (field sum),
  `views` (views/actions/menus rows), `tasks` (IMPLEMENT plan rows),
  `exp_count` (EXP-XX resolution rows).
- `module_type` from the "Fix the module" step (new vs inherit).
- `manifest_depends` and `odoo_version` from context.
- `closed` = §8 checklist complete.

If DESIGN cannot derive a field (empty document or missing data), it returns
`design_meta: null` with `reason` — never invented values.

## Persistence

The design document is persisted in the selected store:

- Engram: `mem_save(title: "odf/{change}/design", ...)`.
- OpenSpec: `openspec/changes/{change}/design.md`.

Additionally, the ODF envelope summary reports `design_closed`.

## ODF Envelope (DESIGN Output Contract)

```markdown
## ODF Result
- **status**: ok | warning | blocked | failed
- **executive_summary**: {N modules, M models, V views, K tasks — closed design}
- **design_closed**: true | false
- **design_path**: {path of the persisted design.md}
- **artifacts_saved**: [{name: "odf/{change}/design", ...}]
- **next_recommended**: ["implement"]
- **risks**: [...]
- **odoo_version**: {version}
- **modules_affected**: [{module}]
```

If `design_closed: false`, DESIGN does NOT return ok: it iterates until closed
or returns `blocked` with the list of open decisions.
