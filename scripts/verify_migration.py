#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import sqlalchemy as sa
from sqlalchemy import inspect

CRITICAL_TABLES = [
    'users',
    'fund_holdings',
    'transactions',
    'news_cache',
    'news_analysis',
    'user_news_relevance',
    'analysis_jobs',
    'analysis_job_runs',
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Validate SQLite -> PostgreSQL migration consistency')
    parser.add_argument('--source', default=os.getenv('SOURCE_DATABASE_URL') or os.getenv('SQLITE_DATABASE_URL'))
    parser.add_argument('--target', default=os.getenv('TARGET_DATABASE_URL') or os.getenv('POSTGRES_DATABASE_URL'))
    parser.add_argument('--sample-size', type=int, default=100)
    return parser.parse_args()


def row_count(conn: sa.Connection, table: sa.Table) -> int:
    return int(conn.execute(sa.select(sa.func.count()).select_from(table)).scalar_one())


def sample_hash(conn: sa.Connection, table: sa.Table, sample_size: int) -> str:
    pk_cols = list(table.primary_key.columns)
    select_stmt = sa.select(table)
    if pk_cols:
        select_stmt = select_stmt.order_by(*pk_cols)
    select_stmt = select_stmt.limit(sample_size)
    rows = conn.execute(select_stmt).fetchall()
    normalized = []
    for row in rows:
        item = {}
        for key, value in row._mapping.items():
            if isinstance(value, (bytes, bytearray)):
                item[key] = value.hex()
            else:
                item[key] = value.isoformat() if hasattr(value, 'isoformat') else value
        normalized.append(item)
    payload = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def check_table(
    source_conn: sa.Connection,
    target_conn: sa.Connection,
    source_table: sa.Table,
    target_table: sa.Table,
    sample_size: int,
) -> tuple[bool, dict]:
    source_count = row_count(source_conn, source_table)
    target_count = row_count(target_conn, target_table)
    source_hash = sample_hash(source_conn, source_table, sample_size)
    target_hash = sample_hash(target_conn, target_table, sample_size)

    ok = source_count == target_count and source_hash == target_hash
    return ok, {
        'table': source_table.name,
        'sourceCount': source_count,
        'targetCount': target_count,
        'sourceSampleHash': source_hash,
        'targetSampleHash': target_hash,
        'ok': ok,
    }


def main() -> int:
    args = parse_args()
    if not args.source or not args.target:
        print('ERROR: --source and --target are required (or set SOURCE_DATABASE_URL/TARGET_DATABASE_URL).')
        return 2

    source_engine = sa.create_engine(args.source)
    target_engine = sa.create_engine(args.target)

    source_meta = sa.MetaData()
    target_meta = sa.MetaData()
    source_meta.reflect(bind=source_engine)
    target_meta.reflect(bind=target_engine)

    source_tables = {table.name: table for table in source_meta.sorted_tables}
    target_tables = {table.name: table for table in target_meta.sorted_tables}

    inspector_source = inspect(source_engine)
    inspector_target = inspect(target_engine)

    report = []
    failed = False
    for table_name in CRITICAL_TABLES:
        if table_name not in source_tables or table_name not in target_tables:
            report.append({
                'table': table_name,
                'ok': False,
                'error': 'table missing in source or target',
            })
            failed = True
            continue

        source_columns = {column['name'] for column in inspector_source.get_columns(table_name)}
        target_columns = {column['name'] for column in inspector_target.get_columns(table_name)}
        if not source_columns.issubset(target_columns):
            report.append({
                'table': table_name,
                'ok': False,
                'error': 'target is missing columns',
                'missingColumns': sorted(list(source_columns - target_columns)),
            })
            failed = True
            continue

        with source_engine.connect() as source_conn, target_engine.connect() as target_conn:
            ok, detail = check_table(
                source_conn,
                target_conn,
                source_tables[table_name],
                target_tables[table_name],
                sample_size=max(10, args.sample_size),
            )
            report.append(detail)
            if not ok:
                failed = True

    print(json.dumps({'results': report}, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
