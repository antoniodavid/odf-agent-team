#!/usr/bin/env bash
# ODF Agent Team — Unix bootstrap for the portable Node installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.sh | bash
#   bash install.sh [--yes] [--dry-run] [--scope project] ...
#
# This script only locates a pack source (local checkout, $ODF_SOURCE_DIR, or a
# downloaded tarball) and delegates to bin/odf.mjs. Every install step lives in
# Node (scripts/lib/install-core.mjs) so Linux, macOS and Windows behave the
# same and the logic is covered by the Vitest suite.

set -euo pipefail

REPO="${REPO:-https://github.com/antoniodavid/odf-agent-team}"
BRANCH="${BRANCH:-main}"

die() {
  echo "❌ $1" >&2
  exit 1
}

script_dir() {
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    (cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
  fi
}

# Node is a hard prerequisite: the pack plugin and this installer both run on
# Node 18+.
if ! command -v node >/dev/null 2>&1; then
  die "Node.js is required. Please install Node.js 18+."
fi
NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [[ "${NODE_MAJOR:-0}" -lt 18 ]]; then
  die "Node.js ${NODE_MAJOR}.x is too old. Node.js 18+ is required."
fi

# TUI fast-path: the TUI reads ODF_DIR/ODF_CONFIG_DIR before the Node core runs.
for arg in "$@"; do
  if [[ "$arg" == "--tui" || "$arg" == "--interactive" ]]; then
    if [[ -n "${ODF_DIR:-}" ]]; then
      ODF_DIR_RESOLVED="$ODF_DIR"
    elif [[ -n "${ODF_CONFIG_DIR:-}" ]]; then
      ODF_DIR_RESOLVED="$ODF_CONFIG_DIR"
    elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
      ODF_DIR_RESOLVED="${XDG_CONFIG_HOME}/opencode"
    elif [[ -n "${HOME:-}" ]]; then
      ODF_DIR_RESOLVED="${HOME}/.config/opencode"
    elif [[ -n "${USERPROFILE:-}" ]]; then
      ODF_DIR_RESOLVED="${USERPROFILE}/.config/opencode"
    else
      ODF_DIR_RESOLVED="${HOME}/.config/opencode"
    fi

    SCRIPT_DIR="$(script_dir || true)"
    TUI_SCRIPT=""
    if [[ -n "$SCRIPT_DIR" && -f "${SCRIPT_DIR}/scripts/odf-install-tui.mjs" ]]; then
      TUI_SCRIPT="${SCRIPT_DIR}/scripts/odf-install-tui.mjs"
    elif [[ -f "${ODF_DIR_RESOLVED}/scripts/odf-install-tui.mjs" ]]; then
      TUI_SCRIPT="${ODF_DIR_RESOLVED}/scripts/odf-install-tui.mjs"
    fi

    if [[ -n "$TUI_SCRIPT" ]]; then
      ODF_DIR="$ODF_DIR_RESOLVED" ODF_CONFIG_DIR="$ODF_DIR_RESOLVED" exec node "$TUI_SCRIPT" "$@"
    fi
    echo "⚠️ TUI script not found at scripts/odf-install-tui.mjs. Falling back to standard installer." >&2
    break
  fi
done

# Resolve the pack source without downloading when a local checkout is present.
SRC=""
if [[ -n "${ODF_SOURCE_DIR:-}" ]]; then
  [[ -d "$ODF_SOURCE_DIR" ]] || die "ODF_SOURCE_DIR does not exist: ${ODF_SOURCE_DIR}"
  SRC="$(cd "$ODF_SOURCE_DIR" && pwd -P)"
else
  SCRIPT_DIR="$(script_dir || true)"
  if [[ -n "$SCRIPT_DIR" && -f "${SCRIPT_DIR}/odf-registry.json" && -f "${SCRIPT_DIR}/install.sh" && -d "${SCRIPT_DIR}/skills" ]]; then
    SRC="$SCRIPT_DIR"
  elif [[ -f "${PWD}/odf-registry.json" && -f "${PWD}/package.json" && -d "${PWD}/skills" && -f "${PWD}/install.sh" ]]; then
    SRC="$(pwd -P)"
  fi
fi

if [[ -z "$SRC" ]]; then
  TMP_DIR="$(mktemp -d)"
  cleanup() { [[ -n "${TMP_DIR:-}" ]] && rm -rf "$TMP_DIR"; }
  trap cleanup EXIT INT TERM

  echo "⬇️  Downloading ODF Agent Team..."
  if command -v curl >/dev/null 2>&1; then
    curl -sL "${REPO}/archive/${BRANCH}.tar.gz" | tar xz -C "$TMP_DIR" || die "Download failed. Check: ${REPO}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "${REPO}/archive/${BRANCH}.tar.gz" | tar xz -C "$TMP_DIR" || die "Download failed. Check: ${REPO}"
  else
    die "curl or wget required but neither is installed."
  fi
  SRC="${TMP_DIR}/odf-agent-team-${BRANCH}"
  if [[ ! -d "$SRC" ]]; then
    SRC="$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)"
  fi
  [[ -d "$SRC" ]] || die "Download failed. Check: ${REPO}"
  echo "✅ Downloaded"
fi

[[ -f "${SRC}/bin/odf.mjs" ]] || die "ODF source at ${SRC} does not contain bin/odf.mjs"

set +e
node "${SRC}/bin/odf.mjs" install --source "$SRC" "$@"
STATUS=$?
set -e
exit "$STATUS"
