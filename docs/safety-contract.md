# ODF Pre-Tool Safety Contract (T11)

Deterministic, pre-execution safety inspection for ODF delegation. This
adapter is a **complement to, not a substitute for**, OpenCode's native
permissions layer (`permission.allow`/`deny` in `opencode.json`).

## What native permissions already do

Native OpenCode permissions gate a tool call by **tool + resolved path** at the
platform boundary. If a path or tool is denied, the host blocks it before the
tool runs. This is the first line of defense and stays authoritative.

## What this adapter adds

Native permissions cannot see **dangerous arguments inside an allowed tool's
payload**: a destructive command passed to `bash`, a `../` escape in a `read`
arg, a secret literal being echoed, or prompt-injection text being delegated to
a sub-agent. `scripts/odf-safety.js` inspects those argument strings
deterministically before `odf_delegate` launches a sub-agent.

It never executes commands — it only matches regexes against string/args and
returns an `allow`/`block` decision.

## Classes blocked

| Class | What matches | Example |
|-------|--------------|---------|
| `destructive` | dropdb / DROP DATABASE / TRUNCATE / DROP TABLE / `rm -rf /` | `dropdb mydb` |
| `path-escape` | `../` traversal, `..%2f` / `%2e%2e` | `../../etc/passwd` |
| `secrets-pii` | `password=`, `api_key=`, `secret=`, `token=`, emails | `password=secret123` |
| `injection` | "ignore previous instructions", "you are now the system" | prompt override |
| `jailbreak` | "DAN", "do anything now", "no restrictions" | override phrases |
| `cross-root-write` | write/copy/move escaping `authorized_roots` (evaluated only when roots are supplied) | `echo x > /etc/evil` |

## Every rejection names an executable continuation

Each block returns a `safe_continuation` — a real command/action the agent can
run instead, never a dead-end like "stop". Examples:

- `destructive`: "Run the command in a scratch worktree or request explicit user
  consent for the exact target: `mkdir -p /tmp/odf-scratch && cd /tmp/odf-scratch`."
- `path-escape`: "Operate inside `<root>`: `cd <root>` and use relative paths, or
  get explicit authorization for the external path."
- `secrets-pii`: "Store the value in the environment or a secret manager; read it
  via `$VARIABLE` at runtime, never inline."
- `injection`/`jailbreak`: "Pass data as arguments, never concatenated into a prompt."

## How false positives are measured before widening policy

The corpus is deliberately narrow to keep the false-positive rate near zero on
normal ODF flow. Two guards enforce this:

1. `scripts/odf-safety.test.ts` has a `allows-benign` + `corpus-false-positive-rate`
   suite asserting normal commands (`echo`, `ls`, `cat models/product.py`) and
   ordinary ODF prompts (`create a new model`, `add a constraint`) are **not**
   blocked.
2. The adapter scans **only the user task payload** (`args.prompt`), never the
   enriched delegation prompt — the latter embeds system-instructive material
   (skill rules, the executor boundary) that legitimately names "DROP DATABASE"
   and would otherwise be a false-positive machine.

Before adding a new pattern or class, extend the benign corpus and confirm the
false-positive rate stays zero; only widen scope for a proven real argument gap
(e.g. a destructive command native permissions cannot catch).

## Schema

`SAFETY_SCHEMA_VERSION = 1`. `inspectToolArgs` output always carries
`schema_version` so policy changes are versioned and auditable.
