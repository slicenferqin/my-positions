"""add watchlist_items table

Revision ID: 20260303_0002
Revises: 20260228_0001
Create Date: 2026-03-03 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = '20260303_0002'
down_revision = '20260228_0001'
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(table_name)


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = inspect(bind)
    if not inspector.has_table(table_name):
        return False
    return any(idx['name'] == index_name for idx in inspector.get_indexes(table_name))


def upgrade() -> None:
    if not _has_table('watchlist_items'):
        op.create_table(
            'watchlist_items',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('instrument_type', sa.String(length=16), nullable=False, server_default='fund'),
            sa.Column('market', sa.String(length=8), nullable=True),
            sa.Column('code', sa.String(length=20), nullable=False),
            sa.Column('name', sa.String(length=160), nullable=False),
            sa.Column('sort_order', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('added_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('user_id', 'instrument_type', 'code', name='uix_user_watchlist_code'),
        )

    if _has_table('watchlist_items') and not _has_index('watchlist_items', 'idx_watchlist_user_sort'):
        op.create_index('idx_watchlist_user_sort', 'watchlist_items', ['user_id', 'sort_order'], unique=False)

    if _has_table('watchlist_items') and not _has_index('watchlist_items', 'idx_watchlist_user_asset'):
        op.create_index('idx_watchlist_user_asset', 'watchlist_items', ['user_id', 'instrument_type', 'code'], unique=False)


def downgrade() -> None:
    if _has_table('watchlist_items'):
        if _has_index('watchlist_items', 'idx_watchlist_user_asset'):
            op.drop_index('idx_watchlist_user_asset', table_name='watchlist_items')
        if _has_index('watchlist_items', 'idx_watchlist_user_sort'):
            op.drop_index('idx_watchlist_user_sort', table_name='watchlist_items')
        op.drop_table('watchlist_items')
