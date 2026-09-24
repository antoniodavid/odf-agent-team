#!/usr/bin/env python3
"""
Migration script for OpenCode v1 -> v2 message format.

Problem: OpenCode 2 renders empty screens for sessions where user messages
remain in v1 format (have `text` at top level) while v2 expects `content` array.

This script converts v1 messages to v2 format in-place.

v1 user message shape:
  { "text": "...", "time": {"created": ...}, "agent": "...", "model": {...} }

v2 user message shape:
  { "content": [{"type": "text", "text": "..."}], ... }

Usage:
  python3 scripts/migrate-v1-messages.py [--dry-run] [--session <id>] [--all]

Options:
  --dry-run   Show what would be changed without modifying the database
  --session   Migrate only the specified session ID
  --all       Migrate all affected sessions
"""

import argparse
import json
import os
import sqlite3
import sys

DB_PATH = os.path.expanduser("~/.local/share/opencode/opencode.db")


def is_v1_message(data: dict) -> bool:
    return isinstance(data, dict) and isinstance(data.get("text"), str)


def convert_v1_to_v2(data: dict) -> dict:
    v2 = dict(data)
    v2["content"] = [{"type": "text", "text": data["text"]}]
    del v2["text"]
    # Normalize time to v2 shape
    if "time" in v2:
        if isinstance(v2["time"], dict) and "created" in v2["time"]:
            v2["time"] = {"created": v2["time"]["created"]}
        else:
            del v2["time"]
    # model field: v1 uses modelID, v2 uses id
    if "model" in v2 and isinstance(v2["model"], dict):
        m = dict(v2["model"])
        if "modelID" in m and "id" not in m:
            m["id"] = m.pop("modelID")
        v2["model"] = m
    return v2


def main():
    parser = argparse.ArgumentParser(description="Migrate OpenCode v1 messages to v2")
    parser.add_argument("--dry-run", action="store_true", help="Preview without changes")
    parser.add_argument("--session", type=str, help="Target a single session ID")
    parser.add_argument("--all", action="store_true", help="Migrate all sessions")
    args = parser.parse_args()

    if not os.path.exists(DB_PATH):
        print(f"Database not found: {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    db = sqlite3.connect(DB_PATH if args.dry_run else DB_PATH)
    if not args.dry_run:
        db.execute("PRAGMA journal_mode=WAL")

    where_clause = ""
    params = []
    if args.session:
        where_clause = "AND session_id = ?"
        params = [args.session]

    row = db.execute(f"""
        SELECT COUNT(*) FROM session_message
        WHERE json_extract(data, '$.text') IS NOT NULL
          AND json_extract(data, '$.content') IS NULL
          {where_clause}
    """, params).fetchone()
    total_v1 = row[0]

    if total_v1 == 0:
        print("No v1-format messages found. Nothing to migrate.")
        db.close()
        return

    row = db.execute(f"""
        SELECT COUNT(DISTINCT session_id) FROM session_message
        WHERE json_extract(data, '$.text') IS NOT NULL
          AND json_extract(data, '$.content') IS NULL
          {where_clause}
    """, params).fetchone()
    total_sessions = row[0]

    print(f"Found {total_v1} v1-format messages across {total_sessions} sessions.")

    if args.dry_run:
        print("\n--- DRY RUN (no changes) ---\n")
        samples = db.execute(f"""
            SELECT session_id, COUNT(*) as msg_count
            FROM session_message
            WHERE json_extract(data, '$.text') IS NOT NULL
              AND json_extract(data, '$.content') IS NULL
              {where_clause}
            GROUP BY session_id
            ORDER BY msg_count DESC
            LIMIT 10
        """, params).fetchall()
        print("Top affected sessions:")
        for sid, cnt in samples:
            print(f"  {sid}: {cnt} messages")

        example = db.execute(f"""
            SELECT id, data FROM session_message
            WHERE json_extract(data, '$.text') IS NOT NULL
              AND json_extract(data, '$.content') IS NULL
              {where_clause}
            LIMIT 1
        """, params).fetchone()
        if example:
            v1 = json.loads(example[1])
            v2 = convert_v1_to_v2(v1)
            print("\nConversion example:")
            print(f"  BEFORE: {json.dumps(v1, indent=2)[:300]}")
            print(f"  AFTER:  {json.dumps(v2, indent=2)[:300]}")

        db.close()
        return

    if not args.all and not args.session:
        print("\nThis will modify the database in-place.", file=sys.stderr)
        print("Use --all to confirm, or --session <id> to target one session.", file=sys.stderr)
        db.close()
        sys.exit(1)

    rows = db.execute(f"""
        SELECT id, data FROM session_message
        WHERE json_extract(data, '$.text') IS NOT NULL
          AND json_extract(data, '$.content') IS NULL
          {where_clause}
    """, params).fetchall()

    migrated = 0
    skipped = 0
    errors = 0

    for row_id, raw_data in rows:
        try:
            v1 = json.loads(raw_data)
            if not is_v1_message(v1):
                skipped += 1
                continue
            v2 = convert_v1_to_v2(v1)
            db.execute("UPDATE session_message SET data = ? WHERE id = ?",
                        (json.dumps(v2), row_id))
            migrated += 1
        except Exception as e:
            print(f"  Error migrating {row_id}: {e}", file=sys.stderr)
            errors += 1

    db.commit()
    db.close()

    print(f"\nMigration complete:")
    print(f"  Migrated: {migrated}")
    print(f"  Skipped:  {skipped}")
    print(f"  Errors:   {errors}")
    print(f"\nRestart OpenCode to see the fixed sessions.")


if __name__ == "__main__":
    main()
