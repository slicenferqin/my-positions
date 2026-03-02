"""news intelligence v1 baseline

Revision ID: 20260228_0001
Revises: 
Create Date: 2026-02-28 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = '20260228_0001'
down_revision = None
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = inspect(bind)
    if not inspector.has_table(table_name):
        return False
    columns = {column['name'] for column in inspector.get_columns(table_name)}
    return column_name in columns


def _ensure_index(table_name: str, index_name: str, columns: list[str], unique: bool = False) -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if not inspector.has_table(table_name):
        return
    existing = {idx['name'] for idx in inspector.get_indexes(table_name)}
    if index_name in existing:
        return
    op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    if _has_table('users'):
        if not _has_column('users', 'role'):
            op.add_column('users', sa.Column('role', sa.String(length=16), nullable=False, server_default='user'))
        if not _has_column('users', 'status'):
            op.add_column('users', sa.Column('status', sa.String(length=16), nullable=False, server_default='active'))
        if not _has_column('users', 'last_login_at'):
            op.add_column('users', sa.Column('last_login_at', sa.DateTime(), nullable=True))
    _ensure_index('users', 'idx_users_role', ['role'])

    if _has_table('fund_holdings') and not _has_column('fund_holdings', 'updated_at'):
        op.add_column('fund_holdings', sa.Column('updated_at', sa.DateTime(), nullable=True))

    if _has_table('user_news_relevance'):
        if not _has_column('user_news_relevance', 'relevance_level'):
            op.add_column('user_news_relevance', sa.Column('relevance_level', sa.String(length=16), nullable=True, server_default='low'))
        if not _has_column('user_news_relevance', 'matched_entities'):
            op.add_column('user_news_relevance', sa.Column('matched_entities', sa.Text(), nullable=True))
        if not _has_column('user_news_relevance', 'reason_codes'):
            op.add_column('user_news_relevance', sa.Column('reason_codes', sa.Text(), nullable=True))
        if not _has_column('user_news_relevance', 'computed_at'):
            op.add_column('user_news_relevance', sa.Column('computed_at', sa.DateTime(), nullable=True))

    if not _has_table('news_items'):
        op.create_table(
            'news_items',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('source', sa.String(length=64), nullable=False, server_default='cls'),
            sa.Column('external_id', sa.String(length=128), nullable=False),
            sa.Column('title', sa.Text(), nullable=True),
            sa.Column('content', sa.Text(), nullable=True),
            sa.Column('brief', sa.Text(), nullable=True),
            sa.Column('published_at', sa.DateTime(), nullable=False),
            sa.Column('received_at', sa.DateTime(), nullable=False),
            sa.Column('raw_payload', sa.Text(), nullable=True),
            sa.Column('content_hash', sa.String(length=128), nullable=False),
            sa.Column('lang', sa.String(length=16), nullable=True, server_default='zh-CN'),
            sa.Column('status', sa.String(length=16), nullable=True, server_default='active'),
            sa.UniqueConstraint('source', 'external_id', name='uix_news_source_external'),
            sa.UniqueConstraint('content_hash', name='uq_news_items_content_hash'),
        )
    _ensure_index('news_items', 'ix_news_items_external_id', ['external_id'])
    _ensure_index('news_items', 'ix_news_items_published_at', ['published_at'])
    _ensure_index('news_items', 'ix_news_items_content_hash', ['content_hash'])

    if not _has_table('news_events'):
        op.create_table(
            'news_events',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('event_key', sa.String(length=128), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=True),
            sa.Column('event_type', sa.String(length=64), nullable=True, server_default='general'),
            sa.Column('importance', sa.String(length=16), nullable=True, server_default='normal'),
            sa.Column('first_seen_at', sa.DateTime(), nullable=True),
            sa.Column('last_seen_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('event_key', name='uq_news_events_event_key'),
        )
    _ensure_index('news_events', 'ix_news_events_event_key', ['event_key'], unique=True)

    if not _has_table('news_event_items'):
        op.create_table(
            'news_event_items',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('event_id', sa.Integer(), sa.ForeignKey('news_events.id'), nullable=False),
            sa.Column('news_id', sa.Integer(), sa.ForeignKey('news_items.id'), nullable=False),
            sa.Column('is_primary', sa.Boolean(), nullable=True, server_default=sa.false()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('event_id', 'news_id', name='uix_event_news'),
        )
    _ensure_index('news_event_items', 'ix_news_event_items_event_id', ['event_id'])
    _ensure_index('news_event_items', 'ix_news_event_items_news_id', ['news_id'])

    if not _has_table('news_global_analysis'):
        op.create_table(
            'news_global_analysis',
            sa.Column('news_id', sa.Integer(), sa.ForeignKey('news_items.id'), primary_key=True),
            sa.Column('sentiment', sa.String(length=16), nullable=True, server_default='neutral'),
            sa.Column('impact_level', sa.String(length=16), nullable=True, server_default='minor'),
            sa.Column('summary', sa.Text(), nullable=True),
            sa.Column('background', sa.Text(), nullable=True),
            sa.Column('confidence', sa.Float(), nullable=True, server_default='0'),
            sa.Column('model_provider', sa.String(length=64), nullable=True),
            sa.Column('model_name', sa.String(length=128), nullable=True),
            sa.Column('model_version', sa.String(length=64), nullable=True),
            sa.Column('prompt_version', sa.String(length=64), nullable=True),
            sa.Column('analysis_json', sa.Text(), nullable=True),
            sa.Column('status', sa.String(length=16), nullable=True, server_default='success'),
            sa.Column('error_code', sa.String(length=64), nullable=True),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('analyzed_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
    _ensure_index('news_global_analysis', 'ix_news_global_analysis_sentiment', ['sentiment'])
    _ensure_index('news_global_analysis', 'ix_news_global_analysis_impact_level', ['impact_level'])

    if not _has_table('entities'):
        op.create_table(
            'entities',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('entity_type', sa.String(length=32), nullable=False),
            sa.Column('entity_code', sa.String(length=64), nullable=True),
            sa.Column('entity_name', sa.String(length=255), nullable=False),
            sa.Column('aliases', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('entity_type', 'entity_code', 'entity_name', name='uix_entity_key'),
        )
    _ensure_index('entities', 'ix_entities_entity_type', ['entity_type'])
    _ensure_index('entities', 'ix_entities_entity_code', ['entity_code'])
    _ensure_index('entities', 'ix_entities_entity_name', ['entity_name'])

    if not _has_table('news_analysis_entities'):
        op.create_table(
            'news_analysis_entities',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('news_id', sa.Integer(), sa.ForeignKey('news_items.id'), nullable=False),
            sa.Column('entity_id', sa.Integer(), sa.ForeignKey('entities.id'), nullable=False),
            sa.Column('polarity', sa.String(length=16), nullable=True, server_default='neutral'),
            sa.Column('weight', sa.Float(), nullable=True, server_default='0'),
            sa.Column('evidence_text', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('news_id', 'entity_id', 'polarity', name='uix_news_entity_polarity'),
        )
    _ensure_index('news_analysis_entities', 'ix_news_analysis_entities_news_id', ['news_id'])
    _ensure_index('news_analysis_entities', 'ix_news_analysis_entities_entity_id', ['entity_id'])

    if not _has_table('user_holdings'):
        op.create_table(
            'user_holdings',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('instrument_type', sa.String(length=16), nullable=True, server_default='fund'),
            sa.Column('instrument_code', sa.String(length=32), nullable=False),
            sa.Column('instrument_name', sa.String(length=160), nullable=False),
            sa.Column('shares', sa.Float(), nullable=True, server_default='0'),
            sa.Column('cost', sa.Float(), nullable=True, server_default='0'),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('user_id', 'instrument_type', 'instrument_code', name='uix_user_holding'),
        )
    _ensure_index('user_holdings', 'ix_user_holdings_user_id', ['user_id'])

    if not _has_table('user_transactions'):
        op.create_table(
            'user_transactions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('holding_id', sa.Integer(), sa.ForeignKey('user_holdings.id'), nullable=True),
            sa.Column('trade_type', sa.String(length=16), nullable=False),
            sa.Column('trade_time', sa.DateTime(), nullable=False),
            sa.Column('shares', sa.Float(), nullable=True, server_default='0'),
            sa.Column('price', sa.Float(), nullable=True, server_default='0'),
            sa.Column('amount', sa.Float(), nullable=True, server_default='0'),
            sa.Column('fee', sa.Float(), nullable=True, server_default='0'),
            sa.Column('source', sa.String(length=64), nullable=True, server_default='manual'),
            sa.Column('note', sa.String(length=255), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    _ensure_index('user_transactions', 'ix_user_transactions_user_id', ['user_id'])
    _ensure_index('user_transactions', 'ix_user_transactions_holding_id', ['holding_id'])

    if not _has_table('market_quotes_1m'):
        op.create_table(
            'market_quotes_1m',
            sa.Column('instrument_type', sa.String(length=16), primary_key=True),
            sa.Column('instrument_code', sa.String(length=32), primary_key=True),
            sa.Column('ts_minute', sa.DateTime(), primary_key=True),
            sa.Column('price', sa.Float(), nullable=True, server_default='0'),
            sa.Column('change_pct', sa.Float(), nullable=True, server_default='0'),
            sa.Column('source', sa.String(length=64), nullable=True, server_default='eastmoney'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )

    if not _has_table('portfolio_snapshots_5m'):
        op.create_table(
            'portfolio_snapshots_5m',
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), primary_key=True),
            sa.Column('ts_5m', sa.DateTime(), primary_key=True),
            sa.Column('total_value', sa.Float(), nullable=True, server_default='0'),
            sa.Column('total_cost', sa.Float(), nullable=True, server_default='0'),
            sa.Column('today_pnl', sa.Float(), nullable=True, server_default='0'),
            sa.Column('total_pnl', sa.Float(), nullable=True, server_default='0'),
            sa.Column('risk_score', sa.Float(), nullable=True, server_default='0'),
            sa.Column('concentration', sa.Float(), nullable=True, server_default='0'),
            sa.Column('volatility', sa.Float(), nullable=True, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )

    if not _has_table('portfolio_snapshots_daily'):
        op.create_table(
            'portfolio_snapshots_daily',
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), primary_key=True),
            sa.Column('trade_date', sa.Date(), primary_key=True),
            sa.Column('total_value', sa.Float(), nullable=True, server_default='0'),
            sa.Column('total_cost', sa.Float(), nullable=True, server_default='0'),
            sa.Column('today_pnl', sa.Float(), nullable=True, server_default='0'),
            sa.Column('total_pnl', sa.Float(), nullable=True, server_default='0'),
            sa.Column('risk_score', sa.Float(), nullable=True, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )

    if not _has_table('user_news_personalized_insights'):
        op.create_table(
            'user_news_personalized_insights',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('news_id', sa.String(length=64), sa.ForeignKey('news_cache.news_id'), nullable=False),
            sa.Column('personal_summary', sa.Text(), nullable=True),
            sa.Column('risk_hint', sa.Text(), nullable=True),
            sa.Column('opportunity_hint', sa.Text(), nullable=True),
            sa.Column('action_bias', sa.String(length=16), nullable=True, server_default='hold'),
            sa.Column('confidence', sa.Float(), nullable=True, server_default='0'),
            sa.Column('model_version', sa.String(length=64), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('user_id', 'news_id', name='uix_user_news_personalized'),
        )
    _ensure_index('user_news_personalized_insights', 'ix_user_news_personalized_insights_user_id', ['user_id'])
    _ensure_index('user_news_personalized_insights', 'ix_user_news_personalized_insights_news_id', ['news_id'])

    if not _has_table('user_news_actions'):
        op.create_table(
            'user_news_actions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('news_id', sa.String(length=64), sa.ForeignKey('news_cache.news_id'), nullable=False),
            sa.Column('action', sa.String(length=32), nullable=False),
            sa.Column('action_note', sa.String(length=255), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )
    _ensure_index('user_news_actions', 'ix_user_news_actions_user_id', ['user_id'])
    _ensure_index('user_news_actions', 'ix_user_news_actions_news_id', ['news_id'])

    if not _has_table('notification_endpoints'):
        op.create_table(
            'notification_endpoints',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('channel_type', sa.String(length=32), nullable=True, server_default='webhook'),
            sa.Column('endpoint_url', sa.String(length=512), nullable=True),
            sa.Column('secret_ciphertext', sa.String(length=255), nullable=True),
            sa.Column('enabled', sa.Boolean(), nullable=True, server_default=sa.true()),
            sa.Column('cooldown_sec', sa.Integer(), nullable=True, server_default='300'),
            sa.Column('quiet_hours', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('user_id', 'channel_type', 'endpoint_url', name='uix_notification_endpoint'),
        )
    _ensure_index('notification_endpoints', 'ix_notification_endpoints_user_id', ['user_id'])

    if not _has_table('notification_rules'):
        op.create_table(
            'notification_rules',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('rule_type', sa.String(length=64), nullable=False),
            sa.Column('rule_params', sa.Text(), nullable=True),
            sa.Column('priority', sa.Integer(), nullable=True, server_default='1'),
            sa.Column('enabled', sa.Boolean(), nullable=True, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
    _ensure_index('notification_rules', 'ix_notification_rules_user_id', ['user_id'])

    if not _has_table('notification_events'):
        op.create_table(
            'notification_events',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('news_id', sa.String(length=64), sa.ForeignKey('news_cache.news_id'), nullable=False),
            sa.Column('rule_id', sa.Integer(), sa.ForeignKey('notification_rules.id'), nullable=True),
            sa.Column('severity', sa.String(length=16), nullable=True, server_default='medium'),
            sa.Column('payload', sa.Text(), nullable=True),
            sa.Column('status', sa.String(length=16), nullable=True, server_default='pending'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    _ensure_index('notification_events', 'ix_notification_events_user_id', ['user_id'])
    _ensure_index('notification_events', 'ix_notification_events_news_id', ['news_id'])
    _ensure_index('notification_events', 'ix_notification_events_rule_id', ['rule_id'])

    if not _has_table('notification_deliveries'):
        op.create_table(
            'notification_deliveries',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('event_id', sa.Integer(), sa.ForeignKey('notification_events.id'), nullable=False),
            sa.Column('endpoint_id', sa.Integer(), sa.ForeignKey('notification_endpoints.id'), nullable=False),
            sa.Column('attempt_no', sa.Integer(), nullable=True, server_default='1'),
            sa.Column('status', sa.String(length=16), nullable=True, server_default='pending'),
            sa.Column('http_status', sa.Integer(), nullable=True),
            sa.Column('response_body', sa.Text(), nullable=True),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('sent_at', sa.DateTime(), nullable=True),
            sa.Column('next_retry_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    _ensure_index('notification_deliveries', 'ix_notification_deliveries_event_id', ['event_id'])
    _ensure_index('notification_deliveries', 'ix_notification_deliveries_endpoint_id', ['endpoint_id'])

    if not _has_table('ai_provider_configs'):
        op.create_table(
            'ai_provider_configs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('provider', sa.String(length=64), nullable=False),
            sa.Column('base_url', sa.String(length=512), nullable=True),
            sa.Column('api_key_ciphertext', sa.String(length=255), nullable=True),
            sa.Column('default_models', sa.Text(), nullable=True),
            sa.Column('enabled', sa.Boolean(), nullable=True, server_default=sa.true()),
            sa.Column('updated_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('provider', name='uq_ai_provider_configs_provider'),
        )

    if not _has_table('prompt_templates'):
        op.create_table(
            'prompt_templates',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('scene', sa.String(length=64), nullable=False),
            sa.Column('version', sa.String(length=32), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('status', sa.String(length=16), nullable=True, server_default='active'),
            sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('scene', 'version', name='uix_prompt_scene_version'),
        )
    _ensure_index('prompt_templates', 'ix_prompt_templates_scene', ['scene'])

    if not _has_table('analysis_jobs'):
        op.create_table(
            'analysis_jobs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('job_type', sa.String(length=64), nullable=False),
            sa.Column('news_id', sa.String(length=64), nullable=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
            sa.Column('priority', sa.Integer(), nullable=True, server_default='5'),
            sa.Column('status', sa.String(length=16), nullable=True, server_default='pending'),
            sa.Column('scheduled_at', sa.DateTime(), nullable=True),
            sa.Column('started_at', sa.DateTime(), nullable=True),
            sa.Column('finished_at', sa.DateTime(), nullable=True),
            sa.Column('retry_count', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('payload_json', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    _ensure_index('analysis_jobs', 'ix_analysis_jobs_job_type', ['job_type'])
    _ensure_index('analysis_jobs', 'ix_analysis_jobs_news_id', ['news_id'])
    _ensure_index('analysis_jobs', 'ix_analysis_jobs_user_id', ['user_id'])
    _ensure_index('analysis_jobs', 'ix_analysis_jobs_priority', ['priority'])
    _ensure_index('analysis_jobs', 'ix_analysis_jobs_status', ['status'])
    _ensure_index('analysis_jobs', 'ix_analysis_jobs_scheduled_at', ['scheduled_at'])

    if not _has_table('analysis_job_runs'):
        op.create_table(
            'analysis_job_runs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('job_id', sa.Integer(), sa.ForeignKey('analysis_jobs.id'), nullable=False),
            sa.Column('worker_id', sa.String(length=64), nullable=True),
            sa.Column('latency_ms', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('token_in', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('token_out', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('cost_estimate', sa.Float(), nullable=True, server_default='0'),
            sa.Column('status', sa.String(length=16), nullable=True, server_default='success'),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    _ensure_index('analysis_job_runs', 'ix_analysis_job_runs_job_id', ['job_id'])

    if not _has_table('audit_logs'):
        op.create_table(
            'audit_logs',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('actor_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
            sa.Column('action', sa.String(length=64), nullable=False),
            sa.Column('resource_type', sa.String(length=64), nullable=False),
            sa.Column('resource_id', sa.String(length=128), nullable=True),
            sa.Column('before_json', sa.Text(), nullable=True),
            sa.Column('after_json', sa.Text(), nullable=True),
            sa.Column('ip', sa.String(length=64), nullable=True),
            sa.Column('ua', sa.String(length=512), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    _ensure_index('audit_logs', 'ix_audit_logs_actor_user_id', ['actor_user_id'])
    _ensure_index('audit_logs', 'ix_audit_logs_action', ['action'])

    if not _has_table('dashboard_preferences'):
        op.create_table(
            'dashboard_preferences',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('card_order', sa.Text(), nullable=True),
            sa.Column('collapsed_panels', sa.Text(), nullable=True),
            sa.Column('table_sort', sa.Text(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('user_id', name='uq_dashboard_preferences_user_id'),
        )
    _ensure_index('dashboard_preferences', 'ix_dashboard_preferences_user_id', ['user_id'], unique=True)


def downgrade() -> None:
    # Intentionally conservative: keep schema backward compatible and avoid destructive rollback on production data.
    pass
