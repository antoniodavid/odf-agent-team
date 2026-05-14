#!/usr/bin/env bash
# ODF Agent Team — Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/antoniodavid/odf-agent-team/main/install.sh | bash
#
# Installs the ODF Agent Team into ~/.config/opencode/
# Backs up existing ODF configuration before installing.

set -euo pipefail

ODF_DIR="${HOME}/.config/opencode"
BACKUP_DIR="${ODF_DIR}/backups/install-$(date +%Y%m%d_%H%M%S)"
REPO="https://github.com/antoniodavid/odf-agent-team"
BRANCH="main"
VERSION="1.0.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════╗"
echo "║         ODF Agent Team Installer v${VERSION}          ║"
echo "╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ python3 required but not installed.${NC}"
    echo "   Install: apt install python3 | brew install python3"
    exit 1
fi

if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
    echo -e "${RED}❌ curl or wget required${NC}"
    exit 1
fi

echo -e "${GREEN}✅ python3 $(python3 --version | cut -d' ' -f2)${NC}"
echo -e "${GREEN}✅ $(curl --version | head -1 | cut -d' ' -f1-2 || echo 'wget')${NC}"

# Confirm
echo ""
echo -e "Target directory: ${BLUE}${ODF_DIR}${NC}"
echo -e "Repository:       ${BLUE}${REPO}${NC}"
echo ""
read -p "Continue with installation? [Y/n] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ ! -z $REPLY ]]; then
    echo -e "${YELLOW}Installation cancelled.${NC}"
    exit 0
fi

# 1. Backup existing ODF config
if [[ -d "$ODF_DIR" ]]; then
    echo -e "\n${YELLOW}📦 Backing up existing config...${NC}"
    mkdir -p "$BACKUP_DIR"
    
    [[ -f "$ODF_DIR/odf-registry.json" ]] && cp "$ODF_DIR/odf-registry.json" "$BACKUP_DIR/"
    [[ -d "$ODF_DIR/agent" ]] && cp -r "$ODF_DIR/agent" "$BACKUP_DIR/agent/" 2>/dev/null || true
    [[ -d "$ODF_DIR/skills" ]] && cp -r "$ODF_DIR/skills" "$BACKUP_DIR/skills/" 2>/dev/null || true
    [[ -d "$ODF_DIR/plugins" ]] && cp -r "$ODF_DIR/plugins" "$BACKUP_DIR/plugins/" 2>/dev/null || true
    [[ -d "$ODF_DIR/command" ]] && cp -r "$ODF_DIR/command" "$BACKUP_DIR/command/" 2>/dev/null || true
    [[ -d "$ODF_DIR/scripts" ]] && cp -r "$ODF_DIR/scripts" "$BACKUP_DIR/scripts/" 2>/dev/null || true
    
    echo -e "${GREEN}✅ Backed up to ${BACKUP_DIR}${NC}"
fi

# 2. Download
echo -e "\n${YELLOW}⬇️  Downloading ODF Agent Team...${NC}"

TMP=$(mktemp -d)
trap "rm -rf ${TMP}" EXIT

if command -v curl &> /dev/null; then
    curl -sL "${REPO}/archive/${BRANCH}.tar.gz" | tar xz -C "$TMP" 2>/dev/null || {
        echo -e "${RED}❌ Download failed. Check: ${REPO}${NC}"
        exit 1
    }
else
    wget -qO- "${REPO}/archive/${BRANCH}.tar.gz" | tar xz -C "$TMP" 2>/dev/null || {
        echo -e "${RED}❌ Download failed. Check: ${REPO}${NC}"
        exit 1
    }
fi

SRC="$TMP/odf-agent-team-${BRANCH}"
if [[ ! -d "$SRC" ]]; then
    # Try common archive naming patterns
    SRC=$(find "$TMP" -maxdepth 1 -type d | tail -1)
fi

echo -e "${GREEN}✅ Downloaded${NC}"

# 3. Install
echo -e "\n${YELLOW}📁 Installing...${NC}"

mkdir -p "$ODF_DIR"/{agent,skills,plugins,command,scripts,backups}

# Copy files safely (merge directories)
copy_dir() {
    local src="$1"
    local dst="$2"
    if [[ -d "$src" ]]; then
        mkdir -p "$dst"
        for item in "$src"/*; do
            [[ -e "$item" ]] && cp -r "$item" "$dst/"
        done
    fi
}

[[ -f "$SRC/odf-registry.json" ]] && cp "$SRC/odf-registry.json" "$ODF_DIR/"
copy_dir "$SRC/agent" "$ODF_DIR/agent"
copy_dir "$SRC/skills" "$ODF_DIR/skills"
copy_dir "$SRC/plugins" "$ODF_DIR/plugins"
copy_dir "$SRC/command" "$ODF_DIR/command"
copy_dir "$SRC/scripts" "$ODF_DIR/scripts"

echo -e "${GREEN}✅ Files installed${NC}"

# 4. Verify
echo -e "\n${YELLOW}🔍 Verifying...${NC}"

if [[ -f "$ODF_DIR/odf-registry.json" ]]; then
    SKILLS=$(python3 -c "
import json
try:
    r = json.load(open('${ODF_DIR}/odf-registry.json'))
    print(len(r['skills']))
except: print('?')
" 2>/dev/null || echo "?")
    
    AGENTS=$(python3 -c "
import json
try:
    r = json.load(open('${ODF_DIR}/odf-registry.json'))
    print(len(r.get('agents', [])))
except: print('?')
" 2>/dev/null || echo "?")

    # Verify plugin
    if [[ -f "$ODF_DIR/plugins/odf-delegation.ts" ]]; then
        PLUGIN_LINES=$(wc -l < "$ODF_DIR/plugins/odf-delegation.ts")
        echo -e "${GREEN}✅ Plugin: ${PLUGIN_LINES} lines${NC}"
    fi

    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║         ODF Agent Team v${VERSION} installed!        ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "  ${BLUE}Skills:${NC} ${SKILLS}"
    echo -e "  ${BLUE}Agents:${NC} ${AGENTS}"
    echo -e "  ${BLUE}Config:${NC} ${ODF_DIR}"
    echo ""
    echo -e "  ${YELLOW}Next steps:${NC}"
    echo "  1. Open OpenCode in your Odoo project"
    echo "  2. Run /odf-init to detect your project context"
    echo "  3. Run /odf-health to verify everything works"
    echo "  4. Run /odf-new my-feature to start your first change"
    echo ""

    # Test runner
    if [[ -f "$ODF_DIR/scripts/odf-test-runner.js" ]]; then
        echo -e "${YELLOW}🧪 Running self-test...${NC}"
        node "$ODF_DIR/scripts/odf-test-runner.js" 2>&1 | tail -3
    fi
else
    echo -e "${RED}❌ Installation failed: registry not found${NC}"
    echo -e "${YELLOW}  Backup at: ${BACKUP_DIR}${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Installation complete!${NC}"
