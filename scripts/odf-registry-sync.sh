#!/usr/bin/env bash
# ODF Registry Sync Script
# Extracts compact rules from SKILL.md files and updates odf-registry.json
# Usage: ./scripts/odf-registry-sync.sh [--engram]
#
# Scans all skill directories: odf-*, oca, odoo_*. Existing registry entries are
# updated in place; missing entries are reported so they can be curated manually.

set -euo pipefail

CONFIG_DIR="${ODF_CONFIG_DIR:-${HOME}/.config/opencode}"
REGISTRY="${CONFIG_DIR}/odf-registry.json"
SKILLS_DIR="${CONFIG_DIR}/skills"
UPDATE_ENGRAM=false

if [[ "${1:-}" == "--engram" ]]; then
    UPDATE_ENGRAM=true
fi

if [[ ! -f "$REGISTRY" ]]; then
    echo "❌ Registry not found at $REGISTRY"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "❌ jq is required for registry sync"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "❌ python3 is required for registry sync"
    exit 1
fi

# Backup registry
cp "$REGISTRY" "${REGISTRY}.backup.$(date +%Y%m%d_%H%M%S)"

echo "🔍 Scanning SKILL.md files in $SKILLS_DIR..."

# Create temporary file for updated registry
TMP_REGISTRY=$(mktemp)
trap 'rm -f "$TMP_REGISTRY"' EXIT

cp "$REGISTRY" "$TMP_REGISTRY"

# Determine whether to write relative paths
USE_RELATIVE=$(jq -r '.flags.use_relative_paths // false' "$TMP_REGISTRY")

process_skill_file() {
    local skill_file="$1"
    local rel_path="${skill_file#${SKILLS_DIR}/}"
    local registry_path="skills/${rel_path}"
    local skill_name
    skill_name=$(basename "$skill_file" .md | tr '_' '-')

    # Extract ## Rules section (everything between "## Rules" and the next ## heading)
    local rules
    rules=$(awk '/^## Rules/{flag=1; next} /^## [^#]/{flag=0} flag' "$skill_file")

    if [[ -z "$rules" ]]; then
        echo "  ⚠️  No ## Rules section found in $rel_path"
        return 0
    fi

    # Normalize path for registry
    local stored_path="$registry_path"
    if [[ "$USE_RELATIVE" == "true" ]]; then
        stored_path="$registry_path"
    else
        stored_path="${CONFIG_DIR}/${registry_path}"
    fi

    # Check if skill exists in registry
    local existing
    existing=$(jq -r --arg name "$skill_name" '.skills[]? | select(.name == $name) | .name' "$TMP_REGISTRY" || true)

    if [[ -n "$existing" ]]; then
        # Update existing skill compact_rules and path
        rules_escaped=$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()), end="")' <<< "$rules")
        jq --arg name "$skill_name" --arg rules "$rules" --arg path "$stored_path" '
            .skills |= map(
                if .name == $name then
                    .compact_rules = $rules | .path = $path
                else
                    .
                end
            )
        ' "$TMP_REGISTRY" > "${TMP_REGISTRY}.new"
        mv "${TMP_REGISTRY}.new" "$TMP_REGISTRY"
        echo "  ✅ Updated $skill_name"
    else
        echo "  ⚠️  Skill $skill_name not found in registry — add manually"
    fi

    if [[ "$UPDATE_ENGRAM" == true ]]; then
        echo "  🧠 Would update Engram topic_key=odf/agents/$skill_name"
    fi
}

# Scan all .md files under skills/ except the root index
while IFS= read -r -d '' skill_file; do
    process_skill_file "$skill_file"
done < <(find "$SKILLS_DIR" -type f -name '*.md' -not -path "*/.git/*" -print0 | sort -z)

# Update last_updated timestamp
jq --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.last_updated = $date' "$TMP_REGISTRY" > "${TMP_REGISTRY}.new"
mv "${TMP_REGISTRY}.new" "$TMP_REGISTRY"

# Validate JSON before writing
if ! jq empty "$TMP_REGISTRY" 2>/dev/null; then
    echo "❌ Generated registry is invalid JSON"
    exit 1
fi

# Write updated registry
mv "$TMP_REGISTRY" "$REGISTRY"
echo ""
echo "✅ Registry updated successfully at $REGISTRY"
echo "📝 Backup created"
