#!/usr/bin/env bash
# ODF Agent Team — Idempotent Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.sh | bash
#
# Installs the ODF Agent Team into ~/.config/opencode/ (or $ODF_CONFIG_DIR),
# or into a project's .opencode/ directory with --scope project.
# Backs up existing ODF configuration before overwriting. Safe to run multiple times.

set -euo pipefail

ODF_SOURCE_DIR="${ODF_SOURCE_DIR:-}"
REPO="${REPO:-https://github.com/antoniodavid/odf-agent-team}"
BRANCH="${BRANCH:-main}"
VERSION="1.2.1"
STALE_ODF_PLUGIN_FILES=(
  candidate-manifest.test.ts
  candidate-manifest.ts
  entry-triage.test.ts
  entry-triage.ts
  odf-delegation.test.ts
  odf-expectations.test.ts
  odf-expectations.ts
  odf-parallel-join.ts
  odf-workflow-status.test.ts
  odf-workflow-status.ts
  odf-workflow.test.ts
  odf-workflow.ts
)
# Auto-detect local source when running from inside the cloned repo.
# Respects explicit ODF_SOURCE_DIR if set.
detect_local_source() {
  if [[ -n "${ODF_SOURCE_DIR:-}" ]]; then
    return 0
  fi

  local cwd
  cwd="$(pwd)"
  if [[ -f "${cwd}/odf-registry.json" && -f "${cwd}/package.json" && -d "${cwd}/skills" && -f "${cwd}/install.sh" ]]; then
    ODF_SOURCE_DIR="${cwd}"
  fi
}

# Non-interactive / dry-run / force flags
INSTALL_YES=false
INSTALL_DRY_RUN=false
INSTALL_FORCE=false
INSTALL_UPDATE=false
INSTALL_TUI=false
INSTALL_SCOPE="global"
INSTALL_PROJECT=""

INSTALL_CODEGRAPH=false
INSTALL_CONFIGURE_MCP=false

INSTALL_ARGS=("$@")
arg_index=0
while [[ "$arg_index" -lt "${#INSTALL_ARGS[@]}" ]]; do
  arg="${INSTALL_ARGS[$arg_index]}"
  case "$arg" in
    --yes) INSTALL_YES=true ;;
    --dry-run) INSTALL_DRY_RUN=true ;;
    --force) INSTALL_FORCE=true ;;
    --update) INSTALL_UPDATE=true ;;
    --tui|--interactive) INSTALL_TUI=true ;;
    --with-codegraph) INSTALL_CODEGRAPH=true ;;
    --configure-mcp) INSTALL_CONFIGURE_MCP=true ;;
    --scope)
      arg_index=$((arg_index + 1))
      if [[ "$arg_index" -ge "${#INSTALL_ARGS[@]}" ]]; then
        echo "Missing value for --scope" >&2
        exit 1
      fi
      INSTALL_SCOPE="${INSTALL_ARGS[$arg_index]}"
      ;;
    --scope=*) INSTALL_SCOPE="${arg#*=}" ;;
    --project)
      arg_index=$((arg_index + 1))
      if [[ "$arg_index" -ge "${#INSTALL_ARGS[@]}" ]]; then
        echo "Missing value for --project" >&2
        exit 1
      fi
      INSTALL_PROJECT="${INSTALL_ARGS[$arg_index]}"
      ;;
    --project=*) INSTALL_PROJECT="${arg#*=}" ;;
    -h|--help)
      echo "Usage: $0 [--yes] [--dry-run] [--force] [--update] [--scope global|project] [--project /absolute/project] [--tui] [--with-codegraph]"
      echo ""
      echo "Modes:"
      echo "  (no flags)        Interactive install with prompts"
      echo "  --yes             Non-interactive install (auto-confirm)"
      echo "  --dry-run         Show what would be done without modifying anything"
      echo "  --force           Skip confirmation, overwrite without prompting"
      echo "  --update          Update existing installation (pull latest + backup + reinstall)"
      echo "  --scope project   Install into <project>/.opencode with a project launcher"
      echo "  --project PATH    Project root (absolute existing directory; defaults to cwd in project scope)"
      echo "  --tui, --interactive  Launch Node.js TUI installer (rich interactive UI)"
      echo ""
      echo "Options:"
      echo "  --with-codegraph   Install CodeGraph (npm package) after ODF files"
      echo "  --configure-mcp    Merge known-good MCP servers (context7, engram) into opencode.json (backup first)"
      echo ""
      echo "Performance tip: set OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true in your"
      echo "  OpenCode process environment to enable parallel sub-agent exploration."
      echo ""
      echo "Environment:"
      echo "  ODF_DIR, ODF_CONFIG_DIR     Config directory (default: \$XDG_CONFIG_HOME/opencode or ~/.config/opencode)"
      echo "  ODF_SOURCE_DIR              Local repo source for offline install"
      echo "  ODF_SKIP_NPM=1              Skip npm install"
  echo "  XDG_CONFIG_HOME              Base for the config dir (any platform)"
      echo "  ODF_SKIP_SELFTEST=1         Skip self-test after install"
      echo "  ODF_INSTALL_NONINTERACTIVE=1 Auto-confirm (same as --yes)"
      echo "  REPO, BRANCH                Git repo to pull from (default: odf-agent-team main)"
      echo ""
      echo "  Release-pinned install:"
      echo "    curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/v1.2.1/install.sh | BRANCH=v1.2.1 bash"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
  arg_index=$((arg_index + 1))
done

if [[ "$INSTALL_SCOPE" != "global" && "$INSTALL_SCOPE" != "project" ]]; then
  echo "Invalid scope: ${INSTALL_SCOPE} (expected global or project)" >&2
  exit 1
fi

if [[ "$INSTALL_SCOPE" == "global" && -n "$INSTALL_PROJECT" ]]; then
  echo "--project requires --scope project" >&2
  exit 1
fi

if [[ "${ODF_INSTALL_NONINTERACTIVE:-}" == "1" || "${ODF_INSTALL_NONINTERACTIVE:-}" == "true" ]]; then
  INSTALL_YES=true
fi

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log_info()  { echo -e "${BLUE}$1${NC}"; }
log_ok()    { echo -e "${GREEN}$1${NC}"; }
log_warn()  { echo -e "${YELLOW}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}" >&2; }

die() {
  log_error "$1"
  exit 1
}

# Portable config dir resolution for ANY OpenCode environment:
#   ODF_DIR -> ODF_CONFIG_DIR -> $XDG_CONFIG_HOME/opencode -> ~/.config/opencode
#   (falls back to %USERPROFILE%/.config/opencode on Windows/Git Bash)
PROJECT_MODE=false
PROJECT_META_DIR=""
if [[ "$INSTALL_SCOPE" == "project" ]]; then
  PROJECT_MODE=true
  if [[ -z "$INSTALL_PROJECT" ]]; then
    INSTALL_PROJECT="$(pwd -P)" || die "❌ Could not resolve the current working directory."
  fi
  if [[ "$INSTALL_PROJECT" != /* || ! -d "$INSTALL_PROJECT" ]]; then
    die "❌ Project path must be an existing absolute directory: ${INSTALL_PROJECT}"
  fi
  INSTALL_PROJECT="$(cd "$INSTALL_PROJECT" && pwd -P)" || die "❌ Could not resolve project path: ${INSTALL_PROJECT}"
  ODF_DIR="${INSTALL_PROJECT}/.opencode"
  PROJECT_META_DIR="${INSTALL_PROJECT}/.odf"
  export ODF_CONFIG_DIR="$ODF_DIR"
else
  if [[ -n "${ODF_DIR:-}" ]]; then
    ODF_DIR="$ODF_DIR"
  elif [[ -n "${ODF_CONFIG_DIR:-}" ]]; then
    ODF_DIR="$ODF_CONFIG_DIR"
  elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    ODF_DIR="${XDG_CONFIG_HOME}/opencode"
  elif [[ -n "${HOME:-}" ]]; then
    ODF_DIR="${HOME}/.config/opencode"
  elif [[ -n "${USERPROFILE:-}" ]]; then
    ODF_DIR="${USERPROFILE}/.config/opencode"
  else
    ODF_DIR="${HOME}/.config/opencode"
  fi
fi

BACKUP_DIR="${ODF_DIR}/backups/install-$(date +%Y%m%d_%H%M%S)"
PLUGIN_ENTRYPOINT="${ODF_DIR}/plugins/odf-delegation.ts"
PLUGIN_SUPPORT_DIR="${ODF_DIR}/odf-plugin"
PROJECT_LAUNCHER="${PROJECT_META_DIR}/opencode"
PROJECT_LOCK="${PROJECT_META_DIR}/odf.lock"
if [[ "$PROJECT_MODE" != true ]]; then
  PROJECT_LAUNCHER=""
  PROJECT_LOCK=""
fi

node_major() {
  local v
  v="$(node --version 2>/dev/null | sed 's/^v//')"
  if [[ -z "$v" ]]; then
    echo "0"
    return
  fi
  echo "$v" | cut -d'.' -f1
}

check_prerequisites() {
  log_info "🔍 Checking prerequisites..."

  if ! command -v python3 &> /dev/null; then
    log_warn "⚠️  python3 not found; the install summary will not count skills/agents. Install python3 or ignore this warning."
  fi

  if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
    die "❌ curl or wget required but neither is installed."
  fi

  if command -v python3 &> /dev/null; then log_ok "✅ python3 $(python3 --version | cut -d' ' -f2)"; fi
  log_ok "✅ $(curl --version 2>/dev/null | head -1 | cut -d' ' -f1-2 || echo 'wget available')"
}

check_node_version() {
  local src_dir="$1"
  if [[ ! -f "$src_dir/package.json" ]]; then
    return 0
  fi

  if ! command -v node &> /dev/null; then
    die "❌ Node.js is required because package.json is present. Please install Node.js 18+."
  fi

  local major
  major="$(node_major)"
  if [[ "$major" -lt 18 ]]; then
    die "❌ Node.js ${major}.x is too old. Node.js 18+ is required."
  fi

  log_ok "✅ Node.js $(node --version)"
}

detect_existing_install() {
  if [[ -d "$ODF_DIR" && -f "$ODF_DIR/odf-registry.json" ]]; then
    echo "existing"
  else
    echo "new"
  fi
}

create_backup() {
  local src_dir="$1"
  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_warn "📦 [dry-run] Would back up existing config to ${BACKUP_DIR}"
    return 0
  fi

  if [[ ! -d "$ODF_DIR" && ! -f "$PROJECT_LAUNCHER" && ! -f "$PROJECT_LOCK" ]]; then
    return 0
  fi

  if [[ -e "$BACKUP_DIR" ]]; then
    local backup_base="$BACKUP_DIR"
    local backup_index=1
    while [[ -e "${backup_base}-${backup_index}" ]]; do
      backup_index=$((backup_index + 1))
    done
    BACKUP_DIR="${backup_base}-${backup_index}"
  fi

  log_warn "📦 Backing up existing config..."
  mkdir -p "$BACKUP_DIR"

  [[ -f "$ODF_DIR/odf-registry.json" ]] && cp "$ODF_DIR/odf-registry.json" "$BACKUP_DIR/"
  for dir in agent skills plugins odf-plugin command scripts; do
    if [[ -d "$ODF_DIR/$dir" ]]; then
      cp -r "$ODF_DIR/$dir" "$BACKUP_DIR/" 2>/dev/null || true
    fi
  done

  if [[ "$PROJECT_MODE" == true ]]; then
    if [[ -f "$PROJECT_LAUNCHER" ]]; then
      mkdir -p "$BACKUP_DIR/project-meta"
      cp "$PROJECT_LAUNCHER" "$BACKUP_DIR/project-meta/opencode"
    fi
    if [[ -f "$PROJECT_LOCK" ]]; then
      mkdir -p "$BACKUP_DIR/project-meta"
      cp "$PROJECT_LOCK" "$BACKUP_DIR/project-meta/odf.lock"
    fi
  fi

  log_ok "✅ Backed up to ${BACKUP_DIR}"
}

copy_dir() {
  local src="$1"
  local dst="$2"
  if [[ ! -e "$src" ]]; then
    return 0
  fi

  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_info "    [dry-run] Would copy $src -> $dst"
    return 0
  fi

  if [[ -d "$src" ]]; then
    mkdir -p "$dst"
    for item in "$src"/*; do
      [[ -e "$item" ]] && cp -r "$item" "$dst/"
    done
  else
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
}

cleanup_stale_odf_plugins() {
  local name
  local stale_path
  for name in "${STALE_ODF_PLUGIN_FILES[@]}"; do
    stale_path="${ODF_DIR}/plugins/${name}"
    [[ -e "$stale_path" ]] || continue
    if [[ "$INSTALL_DRY_RUN" == true ]]; then
      log_info "    [dry-run] Would remove stale ODF plugin file $stale_path"
    else
      rm -f -- "$stale_path"
    fi
  done
}

install_files() {
  local src_dir="$1"

  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_warn "📁 [dry-run] Would install ODF files to ${ODF_DIR}"
  else
    log_warn "📁 Installing ODF files to ${ODF_DIR}..."
    mkdir -p "$ODF_DIR"/{agent,skills,plugins,odf-plugin,command,scripts,docs,backups}
  fi

  log_info "    Plugin entrypoint: ${PLUGIN_ENTRYPOINT}"
  log_info "    Plugin support:    ${PLUGIN_SUPPORT_DIR}"
  log_info "    Cleanup:           known stale ODF helpers/tests in ${ODF_DIR}/plugins"
  cleanup_stale_odf_plugins

  # Rewrite the author's absolute config path to THIS environment's ODF_DIR so
  # the installed pack works on any machine. The repo keeps its original paths.
  rewrite_config_paths() {
    local old_path="/home/adruban/.config/opencode"
    local f
    # Do not traverse dependency trees or historical/non-runtime artifacts.
    while IFS= read -r -d '' f; do
      sed -i "s|${old_path}|${ODF_DIR}|g" "$f"
    done < <(
      find "$ODF_DIR" \
        \( -type d \( -name backups -o -name node_modules -o -name .git -o -name .hg -o -name .svn -o -name .cache -o -name coverage -o -name dist -o -name tmp -o -name logs \) -prune \) -o \
        -type f \( -name '*.md' -o -name '*.ts' -o -name '*.json' -o -name '*.js' \) -print0 2>/dev/null
    )
    log_info "    Rewrote config paths to ${ODF_DIR}"
  }

  # Copy installer itself so self-test can find it
  [[ -f "$src_dir/install.sh" ]] && copy_dir "$src_dir/install.sh" "$ODF_DIR/install.sh"

  [[ -f "$src_dir/odf-registry.json" ]] && copy_dir "$src_dir/odf-registry.json" "$ODF_DIR/odf-registry.json"
  copy_dir "$src_dir/agent" "$ODF_DIR/agent"
  copy_dir "$src_dir/skills" "$ODF_DIR/skills"
  copy_dir "$src_dir/plugins/odf-delegation.ts" "$PLUGIN_ENTRYPOINT"
  copy_dir "$src_dir/odf-plugin" "$PLUGIN_SUPPORT_DIR"
  copy_dir "$src_dir/command" "$ODF_DIR/command"
  copy_dir "$src_dir/scripts" "$ODF_DIR/scripts"
  copy_dir "$src_dir/openspec" "$ODF_DIR/openspec"
  # Install only the contracts consumed by ODF phases.
  copy_dir "$src_dir/docs/design-contract.md" "$ODF_DIR/docs/design-contract.md"
  copy_dir "$src_dir/docs/expectations-contract.md" "$ODF_DIR/docs/expectations-contract.md"

  if [[ -f "$src_dir/package.json" ]]; then
    copy_dir "$src_dir/package.json" "$ODF_DIR/package.json"
  fi

  if [[ "$INSTALL_DRY_RUN" != true ]]; then
    rewrite_config_paths
  fi
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | cut -d' ' -f1
  else
    node -e 'const crypto = require("node:crypto"); const fs = require("node:fs"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$file"
  fi
}

write_project_launcher() {
  [[ "$PROJECT_MODE" == true ]] || return 0

  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_info "    [dry-run] Would write launcher ${PROJECT_LAUNCHER}"
    return 0
  fi

  local project_literal
  local pack_literal
  printf -v project_literal '%q' "$INSTALL_PROJECT"
  printf -v pack_literal '%q' "$ODF_DIR"
  mkdir -p "$PROJECT_META_DIR"
  {
    printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' ''
    printf '%s\n' '# ODF project launcher: this project-local pack is the active ODF runtime.'
    printf 'PROJECT_ROOT=%s\n' "$project_literal"
    printf 'PROJECT_PACK=%s\n' "$pack_literal"
    cat <<'LAUNCHER'

ORIGINAL_ODF_CONFIG_DIR="${ODF_CONFIG_DIR:-}"
ORIGINAL_ODF_DIR="${ODF_DIR:-}"
ORIGINAL_OPENCODE_CONFIG="${OPENCODE_CONFIG:-}"
GLOBAL_CONFIG="${XDG_CONFIG_HOME:-${HOME:-$PROJECT_ROOT/.config}}/opencode"
HOME_CONFIG="${HOME:-$PROJECT_ROOT}/.config/opencode"

has_odf_marker() {
  local root="$1"
  if [[ -f "$root" ]]; then
    grep -Eiq 'odf-delegation|odf-agent-team' "$root"
    return $?
  fi
  if [[ -f "$root/plugins/odf-delegation.ts" ||
        -f "$root/plugins/odf-delegation.js" ||
        -f "$root/plugin/odf-delegation.ts" ||
        -f "$root/plugin/odf-delegation.js" ]]; then
    return 0
  fi
  local config
  for config in "$root/opencode.json" "$root/opencode.jsonc"; do
    if [[ -f "$config" ]] && grep -Eiq 'odf-delegation|odf-agent-team' "$config"; then
      return 0
    fi
  done
  return 1
}

for candidate in "$ORIGINAL_ODF_CONFIG_DIR" "$ORIGINAL_ODF_DIR" "$ORIGINAL_OPENCODE_CONFIG" "$GLOBAL_CONFIG" "$HOME_CONFIG"; do
  [[ -n "$candidate" && "$candidate" != "$PROJECT_PACK" ]] || continue
  if { [[ -d "$candidate" ]] || [[ -f "$candidate" ]]; } && has_odf_marker "$candidate"; then
    printf 'ODF project launcher refused to start: conflicting global ODF plugin/config detected at:\n  %s\n' "$candidate" >&2
    printf 'The global and project odf-delegation plugins must not load together.\n' >&2
    if [[ -f "$candidate" ]]; then
      printf 'Remediation: remove or disable only the ODF plugin entry in "%s", then rerun:\n  %s\n' "$candidate" "$PROJECT_ROOT/.odf/opencode" >&2
    else
      printf 'Remediation: remove or disable only the global ODF plugin/config at "%s" (for auto-discovery, remove "%s/plugins/odf-delegation.ts"), then rerun:\n  %s\n' "$candidate" "$candidate" "$PROJECT_ROOT/.odf/opencode" >&2
    fi
    exit 1
  fi
done

export ODF_CONFIG_DIR="$PROJECT_PACK"
cd "$PROJECT_ROOT"
exec opencode "$@"
LAUNCHER
  } > "$PROJECT_LAUNCHER"
  chmod +x "$PROJECT_LAUNCHER"
  log_ok "✅ Wrote project launcher ${PROJECT_LAUNCHER}"
}

write_project_lock() {
  local src_dir="$1"
  [[ "$PROJECT_MODE" == true ]] || return 0

  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_info "    [dry-run] Would write lock metadata ${PROJECT_LOCK}"
    return 0
  fi

  local source
  if [[ -n "$ODF_SOURCE_DIR" ]]; then
    source="local:$(cd "$src_dir" && pwd -P)"
  else
    source="${REPO}@${BRANCH}"
  fi
  local checksum
  checksum="$(sha256_file "$ODF_DIR/odf-registry.json")"

  mkdir -p "$PROJECT_META_DIR"
  node -e '
    const fs = require("node:fs")
    const [lockPath, version, source, checksum, configDir] = process.argv.slice(1)
    const lock = {
      format: 1,
      package: "odf-agent-team",
      scope: "project",
      version,
      source,
      checksum,
      config_dir: configDir,
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n")
  ' "$PROJECT_LOCK" "$VERSION" "$source" "$checksum" "$ODF_DIR"
  log_ok "✅ Wrote project lock metadata ${PROJECT_LOCK}"
}

run_npm_install() {
  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_warn "📦 [dry-run] Would run npm install in ${ODF_DIR}"
    return 0
  fi

  if [[ ! -f "$ODF_DIR/package.json" ]]; then
    return 0
  fi

  if [[ "${ODF_SKIP_NPM:-}" == "1" ]]; then
    log_warn "📦 Skipping npm install (ODF_SKIP_NPM=1)"
    return 0
  fi

  if ! command -v npm &> /dev/null; then
    log_warn "⚠️  npm not found; skipping npm install. Some self-tests may not run."
    return 0
  fi

  log_warn "📦 Running npm install..."
  (
    cd "$ODF_DIR"
    npm install --no-audit --no-fund || true
  )
}

run_self_test() {
  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_warn "🧪 [dry-run] Would run self-test: node ${ODF_DIR}/scripts/odf-test-runner.js"
    return 0
  fi

  if [[ "${ODF_SKIP_SELFTEST:-}" == "1" ]]; then
    log_warn "🧪 Skipping self-test (ODF_SKIP_SELFTEST=1)"
    return 0
  fi

  if [[ ! -f "$ODF_DIR/scripts/odf-test-runner.js" ]]; then
    log_warn "⚠️  Self-test runner not found; skipping."
    return 0
  fi

  log_warn "🧪 Running self-test..."
  if ! ODF_CONFIG_DIR="$ODF_DIR" node "$ODF_DIR/scripts/odf-test-runner.js"; then
    log_error "❌ Self-test failed. Your installation is kept at ${ODF_DIR}"
    if [[ -d "$BACKUP_DIR" ]]; then
      log_warn "   Backup: ${BACKUP_DIR}"
    fi
    exit 1
  fi
}


probe_environment() {
  log_warn "🔍 Environment dependencies:"
  for tool in engram codegraph git node docker python3; do
    if command -v "$tool" >/dev/null 2>&1; then
      log_ok "  ✓ ${tool}"
    else
      log_warn "  ✗ ${tool} (missing — see impact below)"
    fi
  done
  log_warn "  Impact: engram missing blocks Engram-only workflows (OpenSpec OK); codegraph missing disables context packs (FFF fallback); docker missing disables test-command detection."
}

configure_mcp() {
  local cfg="${ODF_DIR}/opencode.json"
  if [[ ! -f "$cfg" ]]; then
    log_info "    No existing opencode.json; creating a fresh one with MCP entries."
    printf '{\n  "$schema": "https://opencode.ai/config.json"\n}\n' > "$cfg"
  else
    cp "$cfg" "${ODF_DIR}/backups/opencode.json.$(date +%Y%m%d_%H%M%S)"
    log_info "    Backed up opencode.json before merging MCP entries."
  fi
  export ODF_MCP_ENGRAM=0
  if command -v engram >/dev/null 2>&1 && engram mcp --help >/dev/null 2>&1; then
    ODF_MCP_ENGRAM=1
    log_ok "    ✓ engram MCP entry (verified \"engram mcp\")"
  else
    log_warn "    ✗ engram MCP entry skipped (\"engram mcp\" not available on this host)"
  fi
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    cfg.mcp = cfg.mcp || {};
    cfg.mcp.context7 = { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true };
    if (process.env.ODF_MCP_ENGRAM === "1") {
      cfg.mcp.engram = { type: "local", command: ["engram", "mcp"], enabled: true };
    }
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  ' "$cfg"
  log_ok "    ✓ context7 MCP entry merged"
  log_warn "  Manual checklist (not auto-configured): codegraph MCP and fff MCP — add their server entries to opencode.json per their docs."
}


probe_environment() {
  log_warn "🔍 Environment dependencies:"
  for tool in engram codegraph git node docker python3; do
    if command -v "$tool" >/dev/null 2>&1; then
      log_ok "  ✓ ${tool}"
    else
      log_warn "  ✗ ${tool} (missing — see impact below)"
    fi
  done
  log_warn "  Impact: engram missing blocks Engram-only workflows (OpenSpec OK); codegraph missing disables context packs (FFF fallback); docker missing disables test-command detection."
}

print_summary() {
  local status="$1"
  local existing_status="$2"

  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_warn "\n🏁 Dry-run complete. No changes were made."
    log_info "   Target:        ${ODF_DIR}"
    log_info "   Existing:      ${existing_status}"
    if [[ -n "${ODF_SOURCE_DIR:-}" ]]; then
      log_info "   Source:        local: ${ODF_SOURCE_DIR}"
    else
      log_info "   Source:        ${REPO}@${BRANCH}"
    fi
    return 0
  fi

  local skills="?"
  local agents="?"
  if [[ -f "$ODF_DIR/odf-registry.json" ]]; then
    skills="$(python3 -c "import json; print(len(json.load(open('${ODF_DIR}/odf-registry.json')).get('skills',[])))" 2>/dev/null || echo "?")"
    agents="$(python3 -c "import json; print(len(json.load(open('${ODF_DIR}/odf-registry.json')).get('agents',[])))" 2>/dev/null || echo "?")"
  fi

  log_ok "\n╔═══════════════════════════════════════════════════╗"
  log_ok "║         ODF Agent Team v${VERSION} — ${status}        ║"
  log_ok "╚═══════════════════════════════════════════════════╝"
  log_info "  Target:        ${ODF_DIR}"
  if [[ "$PROJECT_MODE" == true ]]; then
    log_info "  Launcher:      ${PROJECT_LAUNCHER}"
    log_info "  Lock:          ${PROJECT_LOCK}"
  fi
  log_info "  Previous:      ${existing_status}"
  log_info "  Skills:        ${skills}"
  log_info "  Agents:        ${agents}"
  if [[ -d "$BACKUP_DIR" ]]; then
    log_info "  Backup:        ${BACKUP_DIR}"
  fi
  log_warn "\n  Next steps:"
  log_info "  1. Open OpenCode in your Odoo project"
  log_info "  2. Run /odf-init to detect your project context"
  log_info "  3. Run /odf-health to verify everything works"
  log_info "  4. Run /odf-new my-feature to start your first change"
}

# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------
main() {
  # TUI mode: launch Node.js TUI installer and exit
  if [[ "$INSTALL_TUI" == true ]]; then
    local tui_script="$(dirname "$0")/scripts/odf-install-tui.mjs"
    if [[ ! -f "$tui_script" ]]; then
      # Fall back to repo-relative or config dir
      tui_script="${ODF_DIR}/scripts/odf-install-tui.mjs"
    fi
    if [[ -f "$tui_script" ]]; then
      exec node "$tui_script" "$@"
    else
      log_warn "⚠️ TUI script not found at scripts/odf-install-tui.mjs. Falling back to standard installer."
    fi
  fi

  echo -e "${CYAN}"
  echo "╔═══════════════════════════════════════════════════╗"
  echo "║         ODF Agent Team Installer v${VERSION}          ║"
  echo "╚═══════════════════════════════════════════════════╝"
  echo -e "${NC}"

  check_prerequisites

  # Auto-detect local source before displaying info
  detect_local_source

  local existing_status
  existing_status="$(detect_existing_install)"

  local source_display
  if [[ -n "${ODF_SOURCE_DIR:-}" ]]; then
    source_display="local: ${ODF_SOURCE_DIR}"
  else
    source_display="${REPO}@${BRANCH}"
  fi

  echo ""
  # In update mode, always show what's happening
  if [[ "$INSTALL_UPDATE" == true ]]; then
    log_info "🔄 Update mode — will back up current install and update from source"
  fi
  log_info "Target directory: ${ODF_DIR}"
  log_info "Existing install: ${existing_status}"
  log_info "Source:           ${source_display}"

  # Confirmation (skip in update mode — backup protects you)
  if [[ "$INSTALL_UPDATE" == false && "$INSTALL_DRY_RUN" == false && "$INSTALL_YES" == false && "$INSTALL_FORCE" == false ]]; then
    echo ""
    read -p "Continue with installation? [Y/n] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ -n $REPLY ]]; then
      log_warn "Installation cancelled."
      exit 0
    fi
  fi

  # Resolve source
  local src_dir
  if [[ -n "$ODF_SOURCE_DIR" ]]; then
    src_dir="$ODF_SOURCE_DIR"
    if [[ ! -d "$src_dir" ]]; then
      die "❌ ODF_SOURCE_DIR does not exist: ${src_dir}"
    fi
  else
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap '[[ -n "${tmp_dir:-}" ]] && rm -rf "${tmp_dir}"' EXIT

    log_warn "⬇️  Downloading ODF Agent Team..."
    if command -v curl &> /dev/null; then
      if ! curl -sL "${REPO}/archive/${BRANCH}.tar.gz" | tar xz -C "$tmp_dir" 2>/dev/null; then
        die "❌ Download failed. Check: ${REPO}"
      fi
    else
      if ! wget -qO- "${REPO}/archive/${BRANCH}.tar.gz" | tar xz -C "$tmp_dir" 2>/dev/null; then
        die "❌ Download failed. Check: ${REPO}"
      fi
    fi

    src_dir="${tmp_dir}/odf-agent-team-${BRANCH}"
    if [[ ! -d "$src_dir" ]]; then
      src_dir="$(find "$tmp_dir" -maxdepth 1 -type d | tail -1)"
    fi

    log_ok "✅ Downloaded"
  fi

  # Node version check (when package.json present)
  check_node_version "$src_dir"

  # Backup existing config
  create_backup "$src_dir"

  # Install / merge files
  install_files "$src_dir"

  # Verify registry present (skip in dry-run because no files were written)
  if [[ "$INSTALL_DRY_RUN" == false && ! -f "$ODF_DIR/odf-registry.json" ]]; then
    die "❌ Installation failed: registry not found at ${ODF_DIR}/odf-registry.json"
  fi

  if [[ "$PROJECT_MODE" == true ]]; then
    write_project_launcher
    write_project_lock "$src_dir"
  fi

  # npm install
  run_npm_install

  # Community tools: CodeGraph
  if [[ "$INSTALL_CODEGRAPH" == true ]]; then
    if [[ "$INSTALL_DRY_RUN" == true ]]; then
      log_warn "🔧 [dry-run] Would install CodeGraph: npm install -g @colbymchenry/codegraph@latest"
    else
      log_warn "🔧 Installing CodeGraph community tool..."
      if command -v npm &> /dev/null; then
        npm install -g @colbymchenry/codegraph@latest 2>/dev/null || log_warn "⚠️ CodeGraph npm install failed (non-fatal)"
        log_ok "✅ CodeGraph installed"
      else
        log_warn "⚠️ npm not found; skipping CodeGraph install"
      fi
    fi
  fi

  # Self-test
  run_self_test

  # Report
  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    print_summary "dry-run" "$existing_status"
  else
    probe_environment
  if [[ "$INSTALL_CONFIGURE_MCP" == true ]]; then
    log_warn "🔌 Configuring MCP servers (--configure-mcp)..."
    configure_mcp
  fi
  print_summary "installed" "$existing_status"
  fi
}

main "$@"
