#!/usr/bin/env python3
"""Turn a `wrangler d1 export` dump into SQL that an empty D1 accepts.

Two D1 import problems are solved here (TSD 9.3):

1. Order: the export interleaves CREATE TABLE and INSERT per table in
   alphabetical order, so child rows can arrive before their parent table.
2. Size: D1 rejects any single SQL statement over 100,000 bytes
   (SQLITE_TOOBIG), but the export writes each row as one INSERT, so an
   attached HTML file (post_html.html / post_html_chunks.data, up to ~1.9 MB)
   cannot be imported as-is.

The dump is first loaded into an in-memory SQLite (no statement limit there).
The output is then generated row by row: all CREATE TABLE first, then rows,
then indexes. A text value too long for one statement is inserted as its
first piece and completed with `UPDATE ... SET col = col || '<piece>'`
statements, each kept under MAX_STATEMENT_BYTES.

Usage: python3 -I scripts/build-d1-restore.py backup.sql > restore.sql
"""
import sqlite3
import sys

MAX_STATEMENT_BYTES = 90_000  # D1 limit is 100,000; keep a margin
SKIP_TABLES = {"sqlite_sequence"}  # recreated by SQLite from AUTOINCREMENT ids


def ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    return "'" + value.replace("'", "''") + "'"


def utf8_len(s: str) -> int:
    return len(s.encode("utf-8"))


def split_text(text: str, budget: int):
    """Split text into pieces whose quoted literal stays within budget bytes."""
    pieces, start = [], 0
    while start < len(text):
        lo, hi = start + 1, len(text)
        # binary search the longest prefix whose escaped literal fits
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if utf8_len(literal(text[start:mid])) <= budget:
                lo = mid
            else:
                hi = mid - 1
        pieces.append(text[start:lo])
        start = lo
    return pieces


def row_statements(table: str, columns, pk_columns, row):
    cols = ", ".join(ident(c) for c in columns)
    values = [literal(v) for v in row]
    stmt = f"INSERT INTO {ident(table)} ({cols}) VALUES ({', '.join(values)});"
    if utf8_len(stmt) <= MAX_STATEMENT_BYTES:
        return [stmt]
    if not pk_columns:
        raise SystemExit(f"row in {table} exceeds the statement limit and the table has no primary key")

    # Insert with long text columns emptied, then append them piece by piece.
    long_cols = [i for i, v in enumerate(row) if isinstance(v, str) and utf8_len(literal(v)) > 1000]
    first = list(values)
    for i in long_cols:
        first[i] = "''"
    out = [f"INSERT INTO {ident(table)} ({cols}) VALUES ({', '.join(first)});"]
    where = " AND ".join(f"{ident(c)} = {literal(row[columns.index(c)])}" for c in pk_columns)
    for i in long_cols:
        col = ident(columns[i])
        overhead = utf8_len(f"UPDATE {ident(table)} SET {col} = {col} || ;  WHERE {where};") + 16
        for piece in split_text(row[i], MAX_STATEMENT_BYTES - overhead):
            out.append(f"UPDATE {ident(table)} SET {col} = {col} || {literal(piece)} WHERE {where};")
    for s in out:
        if utf8_len(s) > MAX_STATEMENT_BYTES:
            raise SystemExit(f"could not split a row of {table} under the statement limit")
    return out


def main() -> None:
    dump = open(sys.argv[1], encoding="utf-8").read()
    db = sqlite3.connect(":memory:")
    db.executescript("PRAGMA foreign_keys = OFF;\n" + dump)

    schema = db.execute(
        "SELECT type, name, tbl_name, sql FROM sqlite_master "
        "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid"
    ).fetchall()
    tables = [(n, sql) for t, n, _, sql in schema if t == "table" and n not in SKIP_TABLES]
    others = [sql for t, n, _, sql in schema if t in ("index", "trigger", "view")]

    out = sys.stdout
    out.write("PRAGMA defer_foreign_keys = on;\n")
    for _, sql in tables:
        out.write(sql.rstrip(";") + ";\n")
    total = 0
    for name, _ in tables:
        info = db.execute(f"PRAGMA table_info({ident(name)})").fetchall()
        columns = [r[1] for r in info]
        pk_columns = [r[1] for r in sorted(info, key=lambda r: r[5]) if r[5] > 0]
        for row in db.execute(f"SELECT {', '.join(ident(c) for c in columns)} FROM {ident(name)}"):
            for stmt in row_statements(name, columns, pk_columns, row):
                out.write(stmt + "\n")
            total += 1
    for sql in others:
        out.write(sql.rstrip(";") + ";\n")
    print(f"-- {len(tables)} tables, {total} rows, {len(others)} indexes/triggers", file=sys.stderr)


if __name__ == "__main__":
    main()
