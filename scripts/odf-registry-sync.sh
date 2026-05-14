#!/usr/bin/env bash
# ODF Registry Sync Script
# Extracts compact rules from SKILL.md files and updates odf-registry.json
# Usage: ./odf-registry-sync.sh [--engram]

set -euo pipefail

REGISTRY="${HOME}/.config/opencode/odf-registry.json"
SKILLS_DIR="${HOME}/.config/opencode/skills"
UPDATE_ENGRAM=false

if [[ "${1:-}" == "--engram" ]]; then
    UPDATE_ENGRAM=true
fi

if [[ ! -f "$REGISTRY" ]]; then
    echo "❌ Registry not found at $REGISTRY"
    exit 1
fi

# Backup registry
cp "$REGISTRY" "${REGISTRY}.backup.$(date +%Y%m%d_%H%M%S)"

echo "🔍 Scanning SKILL.md files in $SKILLS_DIR..."

# Create temporary file for updated registry
TMP_REGISTRY=$(mktemp)
trap 'rm -f "$TMP_REGISTRY"' EXIT

# Read current registry
jq '.' "$REGISTRY" > "$TMP_REGISTRY"

# Find all odoo_* skill directories
for skill_dir in "$SKILLS_DIR"/odoo_*; do
    if [[ ! -d "$skill_dir" ]]; then
        continue
    fi
    
    skill_file="$skill_dir/SKILL.md"
    if [[ ! -f "$skill_file" ]]; then
        echo "⚠️  No SKILL.md in $skill_dir"
        continue
    fi
    
    skill_name=$(basename "$skill_dir")
    echo "📄 Processing $skill_name..."
    
    # Extract ## Rules section (everything between "## Rules" and next ## heading)
    rules=$(awk '/^## Rules/{flag=1; next} /^## [^#]/{flag=0} flag' "$skill_file" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr '\n' '|' | sed 's/|$//')
    
    if [[ -z "$rules" ]]; then
        echo "  ⚠️  No ## Rules section found"
        continue
    fi
    
    # Convert pipe back to newlines for JSON
    rules_json=$(echo "$rules" | sed 's/|/\\n/g')
    
    # Check if skill exists in registry (normalize: dir uses _, registry may use -)
    name_normalized=$(echo "$skill_name" | tr '_' '-')
    existing=$(jq -r --arg name "$name_normalized" '.skills[] | select(.name == $name) | .name' "$TMP_REGISTRY" || true)
    
    if [[ -n "$existing" ]]; then
        # Update existing skill compact_rules
        jq --arg name "$name_normalized" --arg rules "$rules_json" '
            .skills |= map(
                if .name == $name then
                    .compact_rules = $rules
                else
                    .
                end
            )
        ' "$TMP_REGISTRY" > "${TMP_REGISTRY}.new"
        mv "${TMP_REGISTRY}.new" "$TMP_REGISTRY"
        echo "  ✅ Updated compact_rules"
    else
        echo "  ⚠️  Skill $name_normalized not found in registry — add manually"
    fi
    
    # Update Engram if requested
    if [[ "$UPDATE_ENGRAM" == true ]]; then
        echo "  🧠 Updating Engram..."
        # Note: This requires the Engram CLI to be available
        # For now, we just print the command
        echo "     mem_save topic_key=odf/agents/$skill_name type=architecture"
    fi
done

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
