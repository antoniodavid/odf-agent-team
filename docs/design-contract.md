# Design Contract (T12)

Define el **documento design** que la fase DESIGN debe producir, y el
**criterio de diseño cerrado** que garantiza que IMPLEMENT no tiene que
re-investigar. Un diseño que no está cerrado se **itera en DESIGN**, no se
improvisa en IMPLEMENT.

## Principio rector

> IMPLEMENT no re-investiga. Si en IMPLEMENT falta una decisión que debería
> haberse tomado en DESIGN, se **reabre DESIGN** — nunca se improvisa en
> IMPLEMENT.

El documento design es la **fuente única** que consume IMPLEMENT. Debe
resolver TODO antes de IMPLEMENT: hasta en qué módulo va cada archivo.

## Entradas

| Entrada | Origen | Rol en DESIGN |
|---------|--------|---------------|
| Artefacto `assess` (REQ-XX) | Fase ASSESS / store | Plan técnico a materializar |
| Artefacto `expectations` (EXP-XX) | Contrato de expectations (T9) | Contrato humano inmutable a resolver |
| Código fuente del módulo destino | Repositorio local | Contexto real antes de diseñar |

**Regla**: un documento design que no resuelve **todas** las `EXP-XX` no está
cerrado. Cada `EXP-XX` debe tener fila en la sección de resolución.

## Secciones OBLIGATORIAS del documento design

### 1. Contexto

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| `module` | ✅ | Módulo destino **exacto**: nombre si es nuevo, o el que se hereda si se extiende. Lo fija DESIGN, nunca IMPLEMENT. |
| `module_type` | ✅ | `new` (crear módulo) o `inherit` (extender uno existente). |
| `odoo_version` | ✅ | 16 / 17 / 18 / 19. |
| `manifest_depends` | ✅ | Dependencias del manifest (p.ej. `["sale", "account"]`). |
| `artifact_store` | ✅ | `engram` / `openspec` / `hybrid`. |
| `change` | ✅ | Nombre del cambio kebab-case. |

### 2. Resolución de EXP-XX

Tabla que cierra cada expectativa humana con su traducción técnica:

| EXP-XX | Decisión técnica | Archivo(s) destino | Verificación |
|--------|------------------|--------------------|--------------|
| `EXP-01` | Modelo `X` con campo `y`... | `models/x.py`, `views/x_views.xml` | Test `test_01` + criterio |

- **Regla de cierre**: el número de filas DEBE ser `≥` número de `EXP-XX` del
  artefacto `expectations`. Una fila sin decisión técnica concreta = diseño no
  cerrado.

### 3. Data model

Por cada modelo:

| Campo | Tipo | required | index | relation | default | constraint |
|-------|------|----------|-------|----------|---------|------------|

Más, por modelo:
- `_name` y/o `_inherit` (explícito). Si `_name` + `_inherit`, indicar el
  modelo padre.
- `_inherit` vs `_name`: elegido y justificado en una línea.
- Computed fields: `@api.depends`, `store` sí/no, lógica de `compute_sudo`.
- Onchange: `@api.onchange` y su lógica.
- Constraints: `@api.constrains` / `_sql_constraints`.

### 4. Vistas y UI

| Vista | Tipo | Modelo | Campos | Dominio | Acción | Menú (parent) |
|-------|------|--------|--------|---------|--------|---------------|

- Incluir wizard (TransientModel) si aplica, con sus botones/acciones.
- Incluir acciones (`ir.actions.act_window`) y menús con su `parent`.

### 5. Seguridad

- `ir.model.access.csv`: filas por grupo (`group_id/id`, permisos CRUD).
- `ir.rule`: si aplica, con dominio.
- Grupos nuevos: XML IDs (`<record model="res.groups">`).

### 6. Data / migración

- `noupdate` sí/no y por qué.
- Datos demo (`demo/`) si aplica.
- Scripts de migración (`migrations/{ver}/`) si cambian datos existentes.

### 7. Plan de IMPLEMENT

Task breakdown donde **cada tarea** referencia:
- Archivo(s) destino **exacto(s)**.
- `EXP-XX` que resuelve.
- `REQ-XX` de ASSESS que materializa.

Formato de task:

| Task | Archivo(s) | EXP-XX | REQ-XX | Acción |
|------|-----------|--------|--------|--------|
| `T1` | `models/x.py`, `security/ir.model.access.csv` | `EXP-01` | `REQ-01` | Crear modelo + acceso |

- Regla de cierre: si una tarea necesitaría una decisión no definida en este
  documento, DESIGN se reabre (no se improvisa en IMPLEMENT).

### 8. Checklist de diseño cerrado

El documento DEBE pasar TODOS los criterios antes de devolverse:

- [ ] Módulo destino definido (nuevo vs heredado) con `manifest_depends`.
- [ ] Todos los modelos con `_name`/`_inherit`, campos/tipos/constraints.
- [ ] Todas las vistas, acciones y menús definidos.
- [ ] Seguridad completa (`ir.model.access.csv` por grupo, `ir.rule` si aplica).
- [ ] Data/migración definida.
- [ ] **Todas las `EXP-XX` resueltas** (1 fila cada una, con archivo + verificación).
- [ ] Cada tarea del plan de IMPLEMENT ligada a archivo(s) exacto(s) y EXP-XX.
- [ ] IMPLEMENT puede proceder sin re-investigar (no quedan decisiones abiertas).

## Persistencia

El documento design se persiste en el store seleccionado:

- Engram: `mem_save(title: "odf/{change}/design", ...)`.
- OpenSpec: `openspec/changes/{change}/design.md`.

Además, el summary del envelope ODF lo resume y reporta `design_closed`.

## Envelope ODF (Output Contract de DESIGN)

```markdown
## ODF Result
- **status**: ok | warning | blocked | failed
- **executive_summary**: {N módulos, M modelos, V vistas, K tareas — diseño cerrado}
- **design_closed**: true | false
- **design_path**: {ruta del design.md persistido}
- **artifacts_saved**: [{name: "odf/{change}/design", ...}]
- **next_recommended**: ["implement"]
- **risks**: [...]
- **odoo_version**: {version}
- **modules_affected**: [{module}]
```

Si `design_closed: false`, DESIGN NO devuelve ok: itera hasta cerrarlo o
devuelve `blocked` con la lista de decisiones abiertas.
