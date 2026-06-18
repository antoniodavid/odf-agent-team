#!/usr/bin/env bash
# ODF Agent Team — Idempotent Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.sh | bash
#
# Installs the ODF Agent Team into ~/.config/opencode/ (or $ODF_CONFIG_DIR).
# Backs up existing ODF configuration before overwriting. Safe to run multiple times.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ODF_DIR="${ODF_DIR:-${ODF_CONFIG_DIR:-${HOME}/.config/opencode}}"
ODF_SOURCE_DIR="${ODF_SOURCE_DIR:-}"
REPO="${REPO:-https://github.com/antoniodavid/odf-agent-team}"
BRANCH="${BRANCH:-main}"
VERSION="1.0.0"

BACKUP_DIR="${ODF_DIR}/backups/install-$(date +%Y%m%d_%H%M%S)"

# Non-interactive / dry-run / force flags
INSTALL_YES=false
INSTALL_DRY_RUN=false
INSTALL_FORCE=false

for arg in "$@"; do
  case "$arg" in
    --yes) INSTALL_YES=true ;;
    --dry-run) INSTALL_DRY_RUN=true ;;
    --force) INSTALL_FORCE=true ;;
    -h|--help)
      echo "Usage: $0 [--yes] [--dry-run] [--force]"
      echo "  --yes          Auto-accept confirmation prompt"
      echo "  --dry-run      Show what would be installed without modifying anything"
      echo "  --force        Skip confirmation and overwrite without prompting"
      echo "Environment: ODF_DIR, ODF_CONFIG_DIR, ODF_SOURCE_DIR, ODF_INSTALL_NONINTERACTIVE, REPO, BRANCH"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

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
    die "❌ python3 required but not installed. Install: apt install python3 | brew install python3"
  fi

  if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
    die "❌ curl or wget required but neither is installed."
  fi

  log_ok "✅ python3 $(python3 --version | cut -d' ' -f2)"
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

  if [[ ! -d "$ODF_DIR" ]]; then
    return 0
  fi

  log_warn "📦 Backing up existing config..."
  mkdir -p "$BACKUP_DIR"

  [[ -f "$ODF_DIR/odf-registry.json" ]] && cp "$ODF_DIR/odf-registry.json" "$BACKUP_DIR/"
  for dir in agent skills plugins command scripts; do
    if [[ -d "$ODF_DIR/$dir" ]]; then
      cp -r "$ODF_DIR/$dir" "$BACKUP_DIR/" 2>/dev/null || true
    fi
  done

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

install_files() {
  local src_dir="$1"

  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_warn "📁 [dry-run] Would install ODF files to ${ODF_DIR}"
  else
    log_warn "📁 Installing ODF files to ${ODF_DIR}..."
    mkdir -p "$ODF_DIR"/{agent,skills,plugins,command,scripts,backups}
  fi

  [[ -f "$src_dir/odf-registry.json" ]] && copy_dir "$src_dir/odf-registry.json" "$ODF_DIR/odf-registry.json"
  copy_dir "$src_dir/agent" "$ODF_DIR/agent"
  copy_dir "$src_dir/skills" "$ODF_DIR/skills"
  copy_dir "$src_dir/plugins" "$ODF_DIR/plugins"
  copy_dir "$src_dir/command" "$ODF_DIR/command"
  copy_dir "$src_dir/scripts" "$ODF_DIR/scripts"
  copy_dir "$src_dir/openspec" "$ODF_DIR/openspec"

  if [[ -f "$src_dir/package.json" ]]; then
    copy_dir "$src_dir/package.json" "$ODF_DIR/package.json"
  fi
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
  if ! node "$ODF_DIR/scripts/odf-test-runner.js"; then
    log_error "❌ Self-test failed. Your installation is kept at ${ODF_DIR}"
    if [[ -d "$BACKUP_DIR" ]]; then
      log_warn "   Backup: ${BACKUP_DIR}"
    fi
    exit 1
  fi
}

print_summary() {
  local status="$1"
  local existing_status="$2"

  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    log_warn "\n🏁 Dry-run complete. No changes were made."
    log_info "   Target:        ${ODF_DIR}"
    log_info "   Existing:      ${existing_status}"
    log_info "   Source:        ${ODF_SOURCE_DIR:-${REPO}@${BRANCH}}"
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
  echo -e "${CYAN}"
  echo "╔═══════════════════════════════════════════════════╗"
  echo "║         ODF Agent Team Installer v${VERSION}          ║"
  echo "╚═══════════════════════════════════════════════════╝"
  echo -e "${NC}"

  check_prerequisites

  local existing_status
  existing_status="$(detect_existing_install)"

  echo ""
  log_info "Target directory: ${ODF_DIR}"
  log_info "Existing install: ${existing_status}"
  log_info "Source:           ${ODF_SOURCE_DIR:-${REPO}@${BRANCH}}"

  # Confirmation
  if [[ "$INSTALL_DRY_RUN" == false && "$INSTALL_YES" == false && "$INSTALL_FORCE" == false ]]; then
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

  # npm install
  run_npm_install

  # Verify registry present (skip in dry-run because no files were written)
  if [[ "$INSTALL_DRY_RUN" == false && ! -f "$ODF_DIR/odf-registry.json" ]]; then
    die "❌ Installation failed: registry not found at ${ODF_DIR}/odf-registry.json"
  fi

  # Self-test
  run_self_test

  # Report
  if [[ "$INSTALL_DRY_RUN" == true ]]; then
    print_summary "dry-run" "$existing_status"
  else
    print_summary "installed" "$existing_status"
  fi
}

main "$@"
