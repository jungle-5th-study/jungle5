#!/usr/bin/env python3
"""Round-trip check for scripts/build-d1-restore.py (TSD 9.3), local only.

1. Applies every migration to a fresh local D1 in a temp directory and fills
   it with large attached HTML: an identity file (TEXT pieces of ~1.8 MB with
   Hangul, quotes and newlines) and a gzip file whose blob pieces are the
   largest the app writes (950,000 bytes, random), plus a small blob.
2. Exports it with `wrangler d1 export --local` (BLOBs come out as X'<hex>').
3. Builds restore SQL with build-d1-restore.py and checks every statement is
   at most 90,000 bytes (D1 refuses statements over 100,000).
4. Executes it on a second, empty local D1 (`--persist-to <tmp>`) and checks
   that every table has the same rows, with byte-identical TEXT and BLOB
   values (compared by SHA-256 of hex(...)), and no foreign key violations.

Never touches remote D1 or the developer's .wrangler state. Needs pnpm.
Usage: python3 -I scripts/test-d1-restore.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "scripts", "build-d1-restore.py")
MAX_STATEMENT_BYTES = 90_000

MEMBER = "01900000-0000-7000-8000-00000000a001"
CATEGORY = "01900000-0000-7000-8000-000000000001"  # seeded 기타
POST_ID = "01900000-0000-7000-8000-00000000b00{}"


def wrangler(*args: str, cwd: str) -> str:
    cmd = ["pnpm", "--silent", "--dir", ROOT, "exec", "wrangler", *args]
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"wrangler {' '.join(args[:3])} failed:\n{res.stdout[-2000:]}\n{res.stderr[-2000:]}")
    return res.stdout


def write_config(directory: str, name: str) -> str:
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, "wrangler.jsonc")
    config = {
        "name": f"{name}-check",
        "compatibility_date": "2026-10-01",
        "d1_databases": [
            {
                "binding": "DB",
                "database_name": name,
                "database_id": "00000000-0000-0000-0000-000000000000",
                "migrations_dir": os.path.join(ROOT, "migrations"),
            }
        ],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f)
    return path


def query(name: str, config: str, cwd: str, sql: str, persist: str | None = None) -> list[dict]:
    args = ["d1", "execute", name, "--local", "-c", config, "--json", "--command", sql]
    if persist:
        args += ["--persist-to", persist]
    out = wrangler(*args, cwd=cwd)
    return json.loads(out)[0]["results"]


def execute_file(name: str, config: str, cwd: str, path: str, persist: str | None = None) -> None:
    args = ["d1", "execute", name, "--local", "-c", config, "--file", path, "-y"]
    if persist:
        args += ["--persist-to", persist]
    wrangler(*args, cwd=cwd)


SEED = f"""
INSERT INTO members (id, discord_user_id, display_name, is_admin, is_guild_member, verified_at, created_at)
  VALUES ('{MEMBER}', '1', '복원 검사', 0, 1, 1, 1);
INSERT INTO posts (id, title, body, category_id, author_id, links, created_at, updated_at) VALUES
  ('{POST_ID.format(1)}', '조각 글', '본문 ''따옴표''', '{CATEGORY}', '{MEMBER}', '[]', 1, 1),
  ('{POST_ID.format(2)}', '압축 글', '본문', '{CATEGORY}', '{MEMBER}', '[]', 2, 2),
  ('{POST_ID.format(3)}', '작은 압축 글', '본문', '{CATEGORY}', '{MEMBER}', '[]', 3, 3);
INSERT INTO post_html (post_id, html, filename, size, uploaded_at, uploaded_via, chunk_count, encoding, stored_size) VALUES
  ('{POST_ID.format(1)}', replace(hex(zeroblob(600000)), '00', '가'), 'a.html', 0, 1, 'site', 1, 'identity', 0),
  ('{POST_ID.format(2)}', '', 'b.html', 50000000, 2, 'site', 0, 'gzip', 2000001),
  ('{POST_ID.format(3)}', '', 'c.html', 30, 3, 'discord', 0, 'gzip', 21);
INSERT INTO post_html_chunks (post_id, seq, data) VALUES
  ('{POST_ID.format(1)}', 1, replace(replace(hex(zeroblob(150000)), '00', '''<p>"x"''' || char(10)), 'x', '😀'));
INSERT INTO post_html_blobs (post_id, seq, data) VALUES
  ('{POST_ID.format(2)}', 0, randomblob(950000)),
  ('{POST_ID.format(2)}', 1, randomblob(950000)),
  ('{POST_ID.format(2)}', 2, randomblob(100001)),
  ('{POST_ID.format(3)}', 0, X'1f8b0800000000000003010000ffff000000000000000000');
"""

# Tables compared value by value; every column is hashed as hex() so TEXT and
# BLOB bytes (and types) must match exactly.
CHECKS = {
    "post_html_blobs": ["post_id", "seq"],
    "post_html_chunks": ["post_id", "seq"],
    "post_html": ["post_id"],
    "posts": ["id"],
    "members": ["id"],
    "categories": ["id"],
}


def split_statements(path: str) -> list[str]:
    """Statements of a SQL file (literals may hold newlines)."""
    statements, buf = [], ""
    with open(path, encoding="utf-8") as f:
        for line in f:
            buf += line
            if sqlite3.complete_statement(buf):
                statements.append(buf.strip())
                buf = ""
    if buf.strip():
        statements.append(buf.strip())
    return statements


def snapshot(name: str, config: str, cwd: str, persist: str | None = None) -> dict:
    snap = {}
    for table, keys in CHECKS.items():
        cols = [r["name"] for r in query(name, config, cwd, f"PRAGMA table_info({table})", persist)]
        exprs = ", ".join(f'typeof("{c}") || \':\' || coalesce(hex("{c}"), \'NULL\') AS "{c}"' for c in cols)
        rows = query(name, config, cwd, f"SELECT {exprs} FROM {table} ORDER BY {', '.join(keys)}", persist)
        snap[table] = [{k: hashlib.sha256(v.encode()).hexdigest() for k, v in r.items()} for r in rows]
    return snap


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="d1-restore-check-") as tmp:
        src_dir, dst_dir = os.path.join(tmp, "src"), os.path.join(tmp, "dst")
        src_cfg, dst_cfg = write_config(src_dir, "restore-src"), write_config(dst_dir, "restore-dst")
        dst_state = os.path.join(tmp, "dst-state")

        # 1. Source: all migrations, then large data. State lives under src_dir/.wrangler.
        wrangler("d1", "migrations", "apply", "restore-src", "--local", "-c", src_cfg, cwd=src_dir)
        seed = os.path.join(tmp, "seed.sql")
        with open(seed, "w", encoding="utf-8") as f:
            f.write(SEED)
        execute_file("restore-src", src_cfg, src_dir, seed)
        sizes = query("restore-src", src_cfg, src_dir, "SELECT seq, length(data) AS n, typeof(data) AS t FROM post_html_blobs ORDER BY post_id, seq")
        print(f"source blobs: {[(r['seq'], r['n'], r['t']) for r in sizes]}", file=sys.stderr)
        before = snapshot("restore-src", src_cfg, src_dir)

        # 2. Export, as the weekly backup does (but local).
        dump = os.path.join(tmp, "backup.sql")
        wrangler("d1", "export", "restore-src", "--local", "-c", src_cfg, "--output", dump, cwd=src_dir)
        with open(dump, encoding="utf-8") as f:
            text = f.read()
        if "X'" not in text:
            sys.exit("the export holds no X'<hex>' blob literal; the check would prove nothing")
        longest_dump = max(len(st.encode()) for st in split_statements(dump))

        # 3. Build restore SQL.
        restore = os.path.join(tmp, "restore.sql")
        with open(restore, "w", encoding="utf-8") as out:
            res = subprocess.run([sys.executable, "-I", BUILD, dump], stdout=out, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0:
            sys.exit(f"build-d1-restore.py failed: {res.stderr}")
        statements = split_statements(restore)
        longest = max(len(s.encode()) for s in statements)
        if longest > MAX_STATEMENT_BYTES:
            sys.exit(f"a restore statement has {longest} bytes (> {MAX_STATEMENT_BYTES})")
        unhex_updates = sum(1 for s in statements if "unhex(hex(" in s)
        if unhex_updates == 0:
            sys.exit("no blob was appended with unhex(); the check would prove nothing")

        # 4. Restore into an empty D1 and compare.
        execute_file("restore-dst", dst_cfg, dst_dir, restore, dst_state)
        after = snapshot("restore-dst", dst_cfg, dst_dir, dst_state)
        fk = query("restore-dst", dst_cfg, dst_dir, "PRAGMA foreign_key_check", dst_state)
        for table in CHECKS:
            if before[table] != after[table]:
                sys.exit(f"{table}: restored rows differ ({len(before[table])} before, {len(after[table])} after)")
        if fk:
            sys.exit(f"foreign key violations after restore: {fk}")
        print(
            f"OK: longest dump statement {longest_dump} bytes → {len(statements)} restore statements "
            f"(max {longest} bytes, {unhex_updates} unhex appends); "
            + ", ".join(f"{t} {len(before[t])} rows" for t in CHECKS)
            + " byte-identical; no FK violations",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
