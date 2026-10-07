#!/usr/bin/env python3
"""Reorder a `wrangler d1 export` dump so it can be restored into an empty D1.

The export interleaves CREATE TABLE and INSERT per table in alphabetical order,
so rows of a child table (auth_sessions) arrive before its parent table
(members) exists and the import fails with "no such table". This rewrites the
dump as: PRAGMAs -> all CREATE TABLE -> all INSERT -> indexes/triggers/views.

Usage: python3 -I scripts/reorder-d1-dump.py backup.sql > restore.sql
"""
import sqlite3
import sys


def statements(text: str):
    buf = ""
    for line in text.splitlines(keepends=True):
        buf += line
        # complete_statement understands quotes, so a ';' inside text data is safe
        if sqlite3.complete_statement(buf):
            yield buf.strip()
            buf = ""
    if buf.strip():
        raise SystemExit(f"incomplete trailing statement: {buf[:80]!r}")


def main() -> None:
    src = open(sys.argv[1], encoding="utf-8").read()
    pragmas, tables, rows, rest = [], [], [], []
    for stmt in statements(src):
        head = stmt.lstrip().upper()
        if head.startswith("PRAGMA"):
            pragmas.append(stmt)
        elif head.startswith("CREATE TABLE"):
            tables.append(stmt)
        elif head.startswith("INSERT"):
            rows.append(stmt)
        else:
            rest.append(stmt)
    out = sys.stdout
    for group in (pragmas, tables, rows, rest):
        for stmt in group:
            out.write(stmt + "\n")
    print(
        f"-- reordered: {len(tables)} tables, {len(rows)} inserts, {len(rest)} other",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
