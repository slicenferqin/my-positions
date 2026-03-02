#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence

import sqlalchemy as sa


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='One-time data migration: SQLite -> PostgreSQL')
    parser.add_argument('--source', default=os.getenv('SOURCE_DATABASE_URL') or os.getenv('SQLITE_DATABASE_URL'))
    parser.add_argument('--target', default=os.getenv('TARGET_DATABASE_URL') or os.getenv('POSTGRES_DATABASE_URL'))
    parser.add_argument('--chunk-size', type=int, default=1000)
    parser.add_argument('--truncate-target', action='store_true', help='truncate target tables before import')
    return parser.parse_args()


def quote_identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def iter_rows(conn: sa.Connection, query: sa.sql.Select, chunk_size: int):
    result = conn.execution_options(stream_results=True).execute(query)
    while True:
        rows = result.fetchmany(chunk_size)
        if not rows:
            break
        yield rows


def ordered_tables(metadata: sa.MetaData) -> list[sa.Table]:
    skip = {'alembic_version'}
    return [table for table in metadata.sorted_tables if table.name not in skip]


def migrate_table(
    source_conn: sa.Connection,
    target_conn: sa.Connection,
    source_table: sa.Table,
    target_table: sa.Table,
    chunk_size: int,
    truncate_target: bool,
) -> tuple[int, int]:
    common_columns = [col.name for col in source_table.columns if col.name in target_table.c]
    if not common_columns:
        return 0, 0

    if truncate_target:
        target_conn.execute(sa.text(f'TRUNCATE TABLE {quote_identifier(target_table.name)} RESTART IDENTITY CASCADE'))

    select_stmt = sa.select(*[source_table.c[name] for name in common_columns]).order_by(
        *[source_table.c[col.name] for col in source_table.primary_key.columns]
    ) if source_table.primary_key.columns else sa.select(*[source_table.c[name] for name in common_columns])

    inserted = 0
    for rows in iter_rows(source_conn, select_stmt, chunk_size):
        payload = [{column: row._mapping[column] for column in common_columns} for row in rows]
        if payload:
            target_conn.execute(target_table.insert(), payload)
            inserted += len(payload)

    source_count = source_conn.execute(sa.select(sa.func.count()).select_from(source_table)).scalar_one()
    return int(source_count), inserted


def main() -> int:
    args = parse_args()
    if not args.source or not args.target:
        print('ERROR: --source and --target are required (or set SOURCE_DATABASE_URL/TARGET_DATABASE_URL).')
        return 2

    source_engine = sa.create_engine(args.source)
    target_engine = sa.create_engine(args.target)

    source_metadata = sa.MetaData()
    target_metadata = sa.MetaData()
    source_metadata.reflect(bind=source_engine)
    target_metadata.reflect(bind=target_engine)

    source_tables = {table.name: table for table in ordered_tables(source_metadata)}
    target_tables = {table.name: table for table in ordered_tables(target_metadata)}

    common_names = [name for name in source_tables if name in target_tables]
    if not common_names:
        print('ERROR: no common tables detected between source and target schema.')
        return 2

    print(f'Migrating {len(common_names)} tables from source to target...')

    with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
        for table_name in common_names:
            source_table = source_tables[table_name]
            target_table = target_tables[table_name]
            try:
                source_count, inserted = migrate_table(
                    source_conn,
                    target_conn,
                    source_table,
                    target_table,
                    chunk_size=max(100, args.chunk_size),
                    truncate_target=args.truncate_target,
                )
                print(f' - {table_name}: source={source_count}, inserted={inserted}')
            except Exception as exc:
                print(f'ERROR migrating table {table_name}: {exc}')
                raise

    print('Migration completed.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('Interrupted by user.')
        sys.exit(130)
