import os
import json
import time
import queue
import threading
import subprocess
import requests
import hmac
import hashlib
import base64
import urllib.parse
import re
from datetime import datetime, timedelta
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, request, jsonify, g
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
from sqlalchemy import inspect, text, and_, or_
from sqlalchemy.exc import IntegrityError

try:
    from duckduckgo_search import DDGS
except ImportError:
    DDGS = None

try:
    import trafilatura
except ImportError:
    trafilatura = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None


load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///mypositions.db')
JWT_SECRET = os.getenv('JWT_SECRET', 'replace-this-secret')
JWT_EXPIRES_DAYS = int(os.getenv('JWT_EXPIRES_DAYS', '15'))
NEWS_POLL_SECONDS = int(os.getenv('NEWS_POLL_SECONDS', '20'))
NEWS_MIN_COOLDOWN_SECONDS = int(os.getenv('NEWS_MIN_COOLDOWN_SECONDS', '15'))
NEWS_PUSH_MAX_AGE_SECONDS = int(os.getenv('NEWS_PUSH_MAX_AGE_SECONDS', '900'))
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.getenv('ADMIN_EMAILS', '').split(',')
    if email.strip()
}
DEFAULT_TIMEZONE = os.getenv('APP_TIMEZONE', 'Asia/Shanghai')
DISABLE_BOOTSTRAP = os.getenv('DISABLE_BOOTSTRAP', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
DISABLE_BACKGROUND_WORKERS = os.getenv('DISABLE_BACKGROUND_WORKERS', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
METASO_SEARCH_URL = os.getenv('METASO_SEARCH_URL', 'https://metaso.cn/api/v1/search')
METASO_READER_URL = os.getenv('METASO_READER_URL', 'https://metaso.cn/api/v1/reader')
METASO_DAILY_BUDGET_DEFAULT = int(os.getenv('METASO_DAILY_BUDGET', '500'))
METASO_QUOTA_COOLDOWN_SECONDS = int(os.getenv('METASO_QUOTA_COOLDOWN_SECONDS', '1800'))
METASO_READER_MIN_SNIPPET = int(os.getenv('METASO_READER_MIN_SNIPPET', '80'))
METASO_CONTEXT_CACHE_TTL_SECONDS = int(os.getenv('METASO_CONTEXT_CACHE_TTL_SECONDS', '43200'))
METASO_EMPTY_CONTEXT_TTL_SECONDS = int(os.getenv('METASO_EMPTY_CONTEXT_TTL_SECONDS', '1800'))
LOCAL_FALLBACK_DAILY_BUDGET_DEFAULT = int(os.getenv('LOCAL_FALLBACK_DAILY_BUDGET', '2000'))
LOCAL_READER_DAILY_BUDGET_DEFAULT = int(os.getenv('LOCAL_READER_DAILY_BUDGET', '1200'))
LOCAL_FETCH_USER_AGENT = os.getenv(
    'LOCAL_FETCH_USER_AGENT',
    'Mozilla/5.0 (compatible; myPositionsBot/1.0; +https://example.com/bot)',
)
LOCAL_FETCH_TIMEOUT_SECONDS = int(os.getenv('LOCAL_FETCH_TIMEOUT_SECONDS', '15'))


app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Global queues for workers
portfolio_queue: 'queue.Queue[tuple[int, str]]' = queue.Queue()
portfolio_pending: set[str] = set()
analysis_queue: 'queue.Queue[str]' = queue.Queue()  # news_id strings
metaso_quota_lock = threading.Lock()
metaso_quota_state = {
    'date': '',
    'count': 0,
    'disabled_until': 0.0,
    'last_log': '',
}
metaso_context_lock = threading.Lock()
metaso_context_cache = {}
local_fallback_quota_lock = threading.Lock()
local_fallback_quota_state = {
    'date': '',
    'search_count': 0,
    'reader_count': 0,
    'last_log': '',
}


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(180), unique=True, nullable=False)
    name = db.Column(db.String(80), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(16), default='user', nullable=False, index=True)
    status = db.Column(db.String(16), default='active', nullable=False)
    last_login_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    funds = db.relationship('FundHolding', backref='user', cascade='all, delete-orphan')
    watchlist_items = db.relationship('WatchlistItem', backref='user', cascade='all, delete-orphan')
    webhook = db.relationship('WebhookConfig', backref='user', uselist=False, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'role': self.role or 'user',
            'status': self.status or 'active',
            'lastLoginAt': int(self.last_login_at.timestamp() * 1000) if self.last_login_at else None,
            'createdAt': int(self.created_at.timestamp() * 1000) if self.created_at else None,
        }


class FundHolding(db.Model):
    __tablename__ = 'fund_holdings'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    instrument_type = db.Column(db.String(16), default='fund', nullable=False)
    market = db.Column(db.String(8))
    code = db.Column(db.String(20), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    shares = db.Column(db.Float, default=0)
    cost = db.Column(db.Float, default=0)
    sort_order = db.Column(db.Integer, default=0)
    added_at = db.Column(db.DateTime, default=datetime.utcnow)
    keywords = db.Column(db.Text)  # JSON array of strings
    last_keywords_at = db.Column(db.DateTime)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'code', name='uix_user_fund_code'),
    )

    transactions = db.relationship('Transaction', backref='fund', cascade='all, delete-orphan', order_by='Transaction.date.desc()')

    def keyword_set(self):
        result = set()
        if self.name:
            result.add(self.name.lower())
        if self.code:
            code = self.code.lower()
            result.add(code)
            compact = re.sub(r'[^a-z0-9]', '', code)
            if compact:
                result.add(compact)
            suffix_match = re.search(r'(\d{6})$', code)
            if suffix_match:
                result.add(suffix_match.group(1))
        if self.keywords:
            try:
                for item in json.loads(self.keywords):
                    if isinstance(item, str) and item.strip():
                        result.add(item.lower())
            except json.JSONDecodeError:
                pass
        return result


class WatchlistItem(db.Model):
    __tablename__ = 'watchlist_items'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    instrument_type = db.Column(db.String(16), default='fund', nullable=False)
    market = db.Column(db.String(8))
    code = db.Column(db.String(20), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    sort_order = db.Column(db.Integer, default=0)
    added_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'instrument_type', 'code', name='uix_user_watchlist_code'),
        db.Index('idx_watchlist_user_sort', 'user_id', 'sort_order'),
        db.Index('idx_watchlist_user_asset', 'user_id', 'instrument_type', 'code'),
    )

    def keyword_set(self):
        result = set()
        if self.name:
            result.add(self.name.lower())
        if self.code:
            code = self.code.lower()
            result.add(code)
            compact = re.sub(r'[^a-z0-9]', '', code)
            if compact:
                result.add(compact)
            suffix_match = re.search(r'(\d{6})$', code)
            if suffix_match:
                result.add(suffix_match.group(1))
        return result


class Transaction(db.Model):
    __tablename__ = 'transactions'

    id = db.Column(db.Integer, primary_key=True)
    fund_id = db.Column(db.Integer, db.ForeignKey('fund_holdings.id'), nullable=False)
    type = db.Column(db.String(10), nullable=False)
    shares = db.Column(db.Float, nullable=False)
    price = db.Column(db.Float, nullable=False)
    amount = db.Column(db.Float, nullable=False)
    date = db.Column(db.String(16), nullable=False)
    note = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class WebhookConfig(db.Model):
    __tablename__ = 'webhook_configs'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, unique=True)
    url = db.Column(db.String(512))
    secret = db.Column(db.String(255))
    enabled = db.Column(db.Boolean, default=False)
    holdings_only = db.Column(db.Boolean, default=True)
    interval_minutes = db.Column(db.Integer, default=5)
    last_sent_time = db.Column(db.DateTime)
    sent_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'url': self.url or '',
            'secret': self.secret or '',
            'enabled': bool(self.enabled),
            'holdingsOnly': bool(self.holdings_only),
            'interval': self.interval_minutes,
            'lastSentTime': int(self.last_sent_time.timestamp() * 1000) if self.last_sent_time else None,
            'sentCount': self.sent_count,
        }


class SentNews(db.Model):
    __tablename__ = 'sent_news'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    news_id = db.Column(db.String(64), nullable=False)
    sent_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'news_id', name='uix_sent_news_user'),
    )


class NewsCache(db.Model):
    __tablename__ = 'news_cache'

    id = db.Column(db.Integer, primary_key=True)
    news_id = db.Column(db.String(64), unique=True, nullable=False, index=True)
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    brief = db.Column(db.Text)
    ctime = db.Column(db.Integer, nullable=False, index=True)
    raw_json = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    analysis = db.relationship('NewsAnalysis', backref='news', uselist=False, cascade='all, delete-orphan')


class NewsAnalysis(db.Model):
    __tablename__ = 'news_analysis'

    id = db.Column(db.Integer, primary_key=True)
    news_id = db.Column(db.String(64), db.ForeignKey('news_cache.news_id'), unique=True, nullable=False, index=True)

    sectors = db.Column(db.Text)
    stocks = db.Column(db.Text)
    sentiment = db.Column(db.String(16))
    impact_level = db.Column(db.String(16))
    summary = db.Column(db.Text)
    background = db.Column(db.Text)
    tags = db.Column(db.Text)

    model_used = db.Column(db.String(64))
    token_count = db.Column(db.Integer)
    analyzed_at = db.Column(db.DateTime, default=datetime.utcnow)
    error = db.Column(db.Text)

    def to_dict(self):
        return {
            'newsId': self.news_id,
            'sectors': json.loads(self.sectors) if self.sectors else [],
            'stocks': json.loads(self.stocks) if self.stocks else [],
            'sentiment': self.sentiment,
            'impactLevel': self.impact_level,
            'summary': self.summary,
            'background': self.background,
            'tags': json.loads(self.tags) if self.tags else [],
            'modelUsed': self.model_used,
            'analyzedAt': int(self.analyzed_at.timestamp() * 1000) if self.analyzed_at else None,
        }


class UserNewsRelevance(db.Model):
    __tablename__ = 'user_news_relevance'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    news_id = db.Column(db.String(64), db.ForeignKey('news_cache.news_id'), nullable=False, index=True)

    relevance_score = db.Column(db.Float, default=0)
    relevance_level = db.Column(db.String(16), default='low')
    matched_stocks = db.Column(db.Text)
    matched_sectors = db.Column(db.Text)
    matched_entities = db.Column(db.Text)
    reason_codes = db.Column(db.Text)
    personalized_comment = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    computed_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'news_id', name='uix_user_news_relevance'),
    )

    def to_dict(self):
        matched_entities = []
        reason_codes = []
        matched_sectors = []
        try:
            matched_entities = json.loads(self.matched_entities) if self.matched_entities else []
        except json.JSONDecodeError:
            matched_entities = []
        try:
            matched_sectors = json.loads(self.matched_sectors) if self.matched_sectors else []
        except json.JSONDecodeError:
            matched_sectors = []
        try:
            reason_codes = json.loads(self.reason_codes) if self.reason_codes else []
        except json.JSONDecodeError:
            reason_codes = []
        filtered_entities = [item for item in matched_entities if isinstance(item, dict) and item.get('type') != 'stock']
        holding_hit = any((item.get('scope') == 'holding') for item in matched_entities if isinstance(item, dict))
        watchlist_hit = any((item.get('scope') == 'watchlist') for item in matched_entities if isinstance(item, dict))
        for reason in reason_codes:
            if not isinstance(reason, str):
                continue
            if reason.startswith('WATCHLIST_'):
                watchlist_hit = True
            elif reason.startswith('HOLDING_') or reason in {'STOCK_MATCH', 'SECTOR_MATCH', 'TEXT_MATCH'}:
                holding_hit = True

        match_scope = 'none'
        if holding_hit and watchlist_hit:
            match_scope = 'mixed'
        elif holding_hit:
            match_scope = 'holding'
        elif watchlist_hit:
            match_scope = 'watchlist'

        normalized_sectors = []
        seen = set()
        for name in matched_sectors:
            sector_name = (name or '').strip()
            if sector_name and sector_name not in seen:
                seen.add(sector_name)
                normalized_sectors.append(sector_name)
        for item in filtered_entities:
            sector_name = (item.get('name') or '').strip()
            if item.get('type') == 'sector' and sector_name and sector_name not in seen:
                seen.add(sector_name)
                normalized_sectors.append(sector_name)
        matched_watchlist = []
        watchlist_seen = set()
        for item in matched_entities:
            if not isinstance(item, dict) or item.get('scope') != 'watchlist':
                continue
            label = (item.get('name') or '').strip()
            if not label or label in watchlist_seen:
                continue
            watchlist_seen.add(label)
            matched_watchlist.append(label)

        return {
            'newsId': self.news_id,
            'relevanceScore': self.relevance_score,
            'relevanceLevel': self.relevance_level or 'low',
            'matchedStocks': [],
            'matchedSectors': normalized_sectors,
            'matchedEntities': filtered_entities,
            'matchScope': match_scope,
            'matchedWatchlist': matched_watchlist,
            'reasonCodes': reason_codes,
            'personalizedComment': self.personalized_comment,
            'computedAt': int(self.computed_at.timestamp() * 1000) if self.computed_at else None,
        }


class AIConfig(db.Model):
    __tablename__ = 'ai_config'

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(64), unique=True, nullable=False)
    value = db.Column(db.Text)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DashboardPreference(db.Model):
    __tablename__ = 'dashboard_preferences'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, unique=True, index=True)
    card_order = db.Column(db.Text)
    collapsed_panels = db.Column(db.Text)
    table_sort = db.Column(db.Text)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        default = default_dashboard_preferences()
        card_order = default['cardOrder']
        collapsed_panels = default['collapsedPanels']
        table_sort = default['tableSort']

        try:
            if self.card_order:
                parsed = json.loads(self.card_order)
                if isinstance(parsed, list):
                    card_order = parsed
        except json.JSONDecodeError:
            pass

        try:
            if self.collapsed_panels:
                parsed = json.loads(self.collapsed_panels)
                if isinstance(parsed, dict):
                    collapsed_panels = parsed
        except json.JSONDecodeError:
            pass

        try:
            if self.table_sort:
                parsed = json.loads(self.table_sort)
                if isinstance(parsed, dict):
                    table_sort = parsed
        except json.JSONDecodeError:
            pass

        return {
            'cardOrder': card_order,
            'collapsedPanels': collapsed_panels,
            'tableSort': table_sort,
        }


class NewsItem(db.Model):
    __tablename__ = 'news_items'

    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(64), nullable=False, default='cls')
    external_id = db.Column(db.String(128), nullable=False, index=True)
    title = db.Column(db.Text)
    content = db.Column(db.Text)
    brief = db.Column(db.Text)
    published_at = db.Column(db.DateTime, nullable=False, index=True)
    received_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    raw_payload = db.Column(db.Text)
    content_hash = db.Column(db.String(128), nullable=False, unique=True, index=True)
    lang = db.Column(db.String(16), default='zh-CN')
    status = db.Column(db.String(16), default='active')

    __table_args__ = (
        db.UniqueConstraint('source', 'external_id', name='uix_news_source_external'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'source': self.source,
            'externalId': self.external_id,
            'title': self.title,
            'content': self.content,
            'brief': self.brief,
            'publishedAt': int(self.published_at.timestamp() * 1000) if self.published_at else None,
            'receivedAt': int(self.received_at.timestamp() * 1000) if self.received_at else None,
            'contentHash': self.content_hash,
            'lang': self.lang,
            'status': self.status,
        }


class NewsEvent(db.Model):
    __tablename__ = 'news_events'

    id = db.Column(db.Integer, primary_key=True)
    event_key = db.Column(db.String(128), unique=True, nullable=False, index=True)
    title = db.Column(db.String(255))
    event_type = db.Column(db.String(64), default='general')
    importance = db.Column(db.String(16), default='normal')
    first_seen_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen_at = db.Column(db.DateTime, default=datetime.utcnow)


class NewsEventItem(db.Model):
    __tablename__ = 'news_event_items'

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey('news_events.id'), nullable=False, index=True)
    news_id = db.Column(db.Integer, db.ForeignKey('news_items.id'), nullable=False, index=True)
    is_primary = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('event_id', 'news_id', name='uix_event_news'),
    )


class NewsGlobalAnalysis(db.Model):
    __tablename__ = 'news_global_analysis'

    news_id = db.Column(db.Integer, db.ForeignKey('news_items.id'), primary_key=True)
    sentiment = db.Column(db.String(16), default='neutral')
    impact_level = db.Column(db.String(16), default='minor')
    summary = db.Column(db.Text)
    background = db.Column(db.Text)
    confidence = db.Column(db.Float, default=0.0)
    model_provider = db.Column(db.String(64), default='openai-compatible')
    model_name = db.Column(db.String(128), default='')
    model_version = db.Column(db.String(64), default='v1')
    prompt_version = db.Column(db.String(64), default='news_global.v1')
    analysis_json = db.Column(db.Text)
    status = db.Column(db.String(16), default='success')
    error_code = db.Column(db.String(64))
    error_message = db.Column(db.Text)
    analyzed_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        payload = {}
        try:
            payload = json.loads(self.analysis_json) if self.analysis_json else {}
        except json.JSONDecodeError:
            payload = {}
        return {
            'sentiment': self.sentiment,
            'impactLevel': self.impact_level,
            'summary': self.summary,
            'background': self.background,
            'confidence': self.confidence,
            'modelProvider': self.model_provider,
            'modelName': self.model_name,
            'modelVersion': self.model_version,
            'promptVersion': self.prompt_version,
            'analysisJson': payload,
            'status': self.status,
            'errorCode': self.error_code,
            'errorMessage': self.error_message,
            'analyzedAt': int(self.analyzed_at.timestamp() * 1000) if self.analyzed_at else None,
        }


class Entity(db.Model):
    __tablename__ = 'entities'

    id = db.Column(db.Integer, primary_key=True)
    entity_type = db.Column(db.String(32), nullable=False, index=True)
    entity_code = db.Column(db.String(64), index=True)
    entity_name = db.Column(db.String(255), nullable=False, index=True)
    aliases = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('entity_type', 'entity_code', 'entity_name', name='uix_entity_key'),
    )


class NewsAnalysisEntity(db.Model):
    __tablename__ = 'news_analysis_entities'

    id = db.Column(db.Integer, primary_key=True)
    news_id = db.Column(db.Integer, db.ForeignKey('news_items.id'), nullable=False, index=True)
    entity_id = db.Column(db.Integer, db.ForeignKey('entities.id'), nullable=False, index=True)
    polarity = db.Column(db.String(16), default='neutral')
    weight = db.Column(db.Float, default=0.0)
    evidence_text = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('news_id', 'entity_id', 'polarity', name='uix_news_entity_polarity'),
    )


class UserHolding(db.Model):
    __tablename__ = 'user_holdings'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    instrument_type = db.Column(db.String(16), default='fund')
    instrument_code = db.Column(db.String(32), nullable=False)
    instrument_name = db.Column(db.String(160), nullable=False)
    shares = db.Column(db.Float, default=0)
    cost = db.Column(db.Float, default=0)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'instrument_type', 'instrument_code', name='uix_user_holding'),
    )


class UserTransaction(db.Model):
    __tablename__ = 'user_transactions'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    holding_id = db.Column(db.Integer, db.ForeignKey('user_holdings.id'), index=True)
    trade_type = db.Column(db.String(16), nullable=False)
    trade_time = db.Column(db.DateTime, nullable=False)
    shares = db.Column(db.Float, default=0)
    price = db.Column(db.Float, default=0)
    amount = db.Column(db.Float, default=0)
    fee = db.Column(db.Float, default=0)
    source = db.Column(db.String(64), default='manual')
    note = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class MarketQuote1m(db.Model):
    __tablename__ = 'market_quotes_1m'

    instrument_type = db.Column(db.String(16), primary_key=True)
    instrument_code = db.Column(db.String(32), primary_key=True)
    ts_minute = db.Column(db.DateTime, primary_key=True)
    price = db.Column(db.Float, default=0)
    change_pct = db.Column(db.Float, default=0)
    source = db.Column(db.String(64), default='eastmoney')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class PortfolioSnapshot5m(db.Model):
    __tablename__ = 'portfolio_snapshots_5m'

    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    ts_5m = db.Column(db.DateTime, primary_key=True)
    total_value = db.Column(db.Float, default=0)
    total_cost = db.Column(db.Float, default=0)
    today_pnl = db.Column(db.Float, default=0)
    total_pnl = db.Column(db.Float, default=0)
    risk_score = db.Column(db.Float, default=0)
    concentration = db.Column(db.Float, default=0)
    volatility = db.Column(db.Float, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class PortfolioSnapshotDaily(db.Model):
    __tablename__ = 'portfolio_snapshots_daily'

    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    trade_date = db.Column(db.Date, primary_key=True)
    total_value = db.Column(db.Float, default=0)
    total_cost = db.Column(db.Float, default=0)
    today_pnl = db.Column(db.Float, default=0)
    total_pnl = db.Column(db.Float, default=0)
    risk_score = db.Column(db.Float, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class UserNewsPersonalizedInsight(db.Model):
    __tablename__ = 'user_news_personalized_insights'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    news_id = db.Column(db.String(64), db.ForeignKey('news_cache.news_id'), nullable=False, index=True)
    personal_summary = db.Column(db.Text)
    risk_hint = db.Column(db.Text)
    opportunity_hint = db.Column(db.Text)
    action_bias = db.Column(db.String(16), default='hold')
    confidence = db.Column(db.Float, default=0.0)
    model_version = db.Column(db.String(64), default='news_user.v1')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'news_id', name='uix_user_news_personalized'),
    )

    def to_dict(self):
        return {
            'newsId': self.news_id,
            'personalSummary': self.personal_summary,
            'riskHint': self.risk_hint,
            'opportunityHint': self.opportunity_hint,
            'actionBias': self.action_bias,
            'confidence': self.confidence,
            'modelVersion': self.model_version,
            'createdAt': int(self.created_at.timestamp() * 1000) if self.created_at else None,
        }


class UserNewsAction(db.Model):
    __tablename__ = 'user_news_actions'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    news_id = db.Column(db.String(64), db.ForeignKey('news_cache.news_id'), nullable=False, index=True)
    action = db.Column(db.String(32), nullable=False)
    action_note = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class NotificationEndpoint(db.Model):
    __tablename__ = 'notification_endpoints'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    channel_type = db.Column(db.String(32), default='webhook')
    endpoint_url = db.Column(db.String(512))
    secret_ciphertext = db.Column(db.String(255))
    enabled = db.Column(db.Boolean, default=True)
    cooldown_sec = db.Column(db.Integer, default=300)
    quiet_hours = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'channel_type', 'endpoint_url', name='uix_notification_endpoint'),
    )

    def to_dict(self):
        quiet_hours = {}
        try:
            quiet_hours = json.loads(self.quiet_hours) if self.quiet_hours else {}
        except json.JSONDecodeError:
            quiet_hours = {}
        return {
            'id': self.id,
            'userId': self.user_id,
            'channelType': self.channel_type,
            'endpointUrl': self.endpoint_url or '',
            'enabled': bool(self.enabled),
            'cooldownSec': self.cooldown_sec or 300,
            'quietHours': quiet_hours,
            'createdAt': int(self.created_at.timestamp() * 1000) if self.created_at else None,
            'updatedAt': int(self.updated_at.timestamp() * 1000) if self.updated_at else None,
        }


class NotificationRule(db.Model):
    __tablename__ = 'notification_rules'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    rule_type = db.Column(db.String(64), nullable=False)
    rule_params = db.Column(db.Text)
    priority = db.Column(db.Integer, default=1)
    enabled = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        params = {}
        try:
            params = json.loads(self.rule_params) if self.rule_params else {}
        except json.JSONDecodeError:
            params = {}
        return {
            'id': self.id,
            'userId': self.user_id,
            'ruleType': self.rule_type,
            'ruleParams': params,
            'priority': self.priority,
            'enabled': bool(self.enabled),
            'createdAt': int(self.created_at.timestamp() * 1000) if self.created_at else None,
            'updatedAt': int(self.updated_at.timestamp() * 1000) if self.updated_at else None,
        }


class NotificationEvent(db.Model):
    __tablename__ = 'notification_events'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    news_id = db.Column(db.String(64), db.ForeignKey('news_cache.news_id'), nullable=False, index=True)
    rule_id = db.Column(db.Integer, db.ForeignKey('notification_rules.id'), index=True)
    severity = db.Column(db.String(16), default='medium')
    payload = db.Column(db.Text)
    status = db.Column(db.String(16), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class NotificationDelivery(db.Model):
    __tablename__ = 'notification_deliveries'

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey('notification_events.id'), nullable=False, index=True)
    endpoint_id = db.Column(db.Integer, db.ForeignKey('notification_endpoints.id'), nullable=False, index=True)
    attempt_no = db.Column(db.Integer, default=1)
    status = db.Column(db.String(16), default='pending')
    http_status = db.Column(db.Integer)
    response_body = db.Column(db.Text)
    error_message = db.Column(db.Text)
    sent_at = db.Column(db.DateTime)
    next_retry_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class AIProviderConfig(db.Model):
    __tablename__ = 'ai_provider_configs'

    id = db.Column(db.Integer, primary_key=True)
    provider = db.Column(db.String(64), unique=True, nullable=False)
    base_url = db.Column(db.String(512))
    api_key_ciphertext = db.Column(db.String(255))
    default_models = db.Column(db.Text)
    enabled = db.Column(db.Boolean, default=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        models = {}
        try:
            models = json.loads(self.default_models) if self.default_models else {}
        except json.JSONDecodeError:
            models = {}
        return {
            'provider': self.provider,
            'baseUrl': self.base_url,
            'defaultModels': models,
            'enabled': bool(self.enabled),
            'updatedBy': self.updated_by,
            'updatedAt': int(self.updated_at.timestamp() * 1000) if self.updated_at else None,
        }


class PromptTemplate(db.Model):
    __tablename__ = 'prompt_templates'

    id = db.Column(db.Integer, primary_key=True)
    scene = db.Column(db.String(64), nullable=False, index=True)
    version = db.Column(db.String(32), nullable=False)
    content = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(16), default='active')
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('scene', 'version', name='uix_prompt_scene_version'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'scene': self.scene,
            'version': self.version,
            'content': self.content,
            'status': self.status,
            'createdBy': self.created_by,
            'createdAt': int(self.created_at.timestamp() * 1000) if self.created_at else None,
        }


class AnalysisJob(db.Model):
    __tablename__ = 'analysis_jobs'

    id = db.Column(db.Integer, primary_key=True)
    job_type = db.Column(db.String(64), nullable=False, index=True)
    news_id = db.Column(db.String(64), index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), index=True)
    priority = db.Column(db.Integer, default=5, index=True)
    status = db.Column(db.String(16), default='pending', index=True)
    scheduled_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    started_at = db.Column(db.DateTime)
    finished_at = db.Column(db.DateTime)
    retry_count = db.Column(db.Integer, default=0)
    error_message = db.Column(db.Text)
    payload_json = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        payload = {}
        try:
            payload = json.loads(self.payload_json) if self.payload_json else {}
        except json.JSONDecodeError:
            payload = {}
        return {
            'id': self.id,
            'jobType': self.job_type,
            'newsId': self.news_id,
            'userId': self.user_id,
            'priority': self.priority,
            'status': self.status,
            'scheduledAt': int(self.scheduled_at.timestamp() * 1000) if self.scheduled_at else None,
            'startedAt': int(self.started_at.timestamp() * 1000) if self.started_at else None,
            'finishedAt': int(self.finished_at.timestamp() * 1000) if self.finished_at else None,
            'retryCount': self.retry_count,
            'errorMessage': self.error_message,
            'payload': payload,
            'createdAt': int(self.created_at.timestamp() * 1000) if self.created_at else None,
        }


class AnalysisJobRun(db.Model):
    __tablename__ = 'analysis_job_runs'

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('analysis_jobs.id'), nullable=False, index=True)
    worker_id = db.Column(db.String(64))
    latency_ms = db.Column(db.Integer, default=0)
    token_in = db.Column(db.Integer, default=0)
    token_out = db.Column(db.Integer, default=0)
    cost_estimate = db.Column(db.Float, default=0)
    status = db.Column(db.String(16), default='success')
    error_message = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class AuditLog(db.Model):
    __tablename__ = 'audit_logs'

    id = db.Column(db.Integer, primary_key=True)
    actor_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), index=True)
    action = db.Column(db.String(64), nullable=False, index=True)
    resource_type = db.Column(db.String(64), nullable=False)
    resource_id = db.Column(db.String(128))
    before_json = db.Column(db.Text)
    after_json = db.Column(db.Text)
    ip = db.Column(db.String(64))
    ua = db.Column(db.String(512))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


def create_token(user: User):
    payload = {
        'sub': user.id,
        'email': user.email,
        'name': user.name,
        'role': user.role or 'user',
        'iat': int(time.time()),
        'exp': datetime.utcnow() + timedelta(days=JWT_EXPIRES_DAYS),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm='HS256')
    return token


def decode_token(token: str):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except jwt.PyJWTError:
        return None


def auth_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing token'}), 401
        token = auth_header.split(' ', 1)[1]
        payload = decode_token(token)
        if not payload:
            return jsonify({'error': 'Invalid token'}), 401
        user = User.query.get(payload['sub'])
        if not user:
            return jsonify({'error': 'User not found'}), 401
        g.current_user = user
        g.auth_token = token
        return func(*args, **kwargs)

    return wrapper


def admin_required(func):
    @wraps(func)
    @auth_required
    def wrapper(*args, **kwargs):
        if (g.current_user.role or 'user') != 'admin':
            return jsonify({'error': 'Admin only'}), 403
        return func(*args, **kwargs)

    return wrapper


def mask_secret(value: str | None):
    if not value:
        return ''
    if len(value) <= 10:
        return '*' * len(value)
    return f'{value[:4]}***{value[-3:]}'


def save_audit_log(action: str, resource_type: str, resource_id: str | None, before: dict | None, after: dict | None):
    actor_id = g.current_user.id if hasattr(g, 'current_user') and g.current_user else None
    entry = AuditLog(
        actor_user_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id or '',
        before_json=json.dumps(before or {}, ensure_ascii=False),
        after_json=json.dumps(after or {}, ensure_ascii=False),
        ip=request.remote_addr or '',
        ua=request.headers.get('User-Agent', '')[:512],
    )
    db.session.add(entry)


def fund_to_dict(fund: FundHolding):
    return {
        'id': fund.id,
        'instrumentType': (fund.instrument_type or 'fund'),
        'market': (fund.market or ''),
        'code': fund.code,
        'name': fund.name,
        'shares': fund.shares,
        'cost': fund.cost,
        'sortOrder': fund.sort_order,
        'addedAt': int(fund.added_at.timestamp() * 1000) if fund.added_at else None,
        'transactions': [
            {
                'id': tx.id,
                'fundCode': fund.code,
                'type': tx.type,
                'shares': tx.shares,
                'price': tx.price,
                'amount': tx.amount,
                'date': tx.date,
                'note': tx.note or '',
            }
            for tx in sorted(fund.transactions, key=lambda t: (t.date, t.id), reverse=True)
        ],
    }


def watchlist_to_dict(item: WatchlistItem):
    return {
        'id': item.id,
        'instrumentType': normalize_instrument_type(item.instrument_type),
        'market': item.market or '',
        'code': item.code,
        'name': item.name,
        'sortOrder': item.sort_order or 0,
        'addedAt': int(item.added_at.timestamp() * 1000) if item.added_at else None,
        'updatedAt': int(item.updated_at.timestamp() * 1000) if item.updated_at else None,
    }


def find_holding_conflict(
    user_id: int,
    instrument_type: str,
    code: str,
    exclude_fund_id: int | None = None,
):
    normalized_code = (code or '').strip().upper()
    query = FundHolding.query.filter_by(user_id=user_id)
    if exclude_fund_id is not None:
        query = query.filter(FundHolding.id != exclude_fund_id)
    candidates = query.all()
    for candidate in candidates:
        candidate_code = (candidate.code or '').strip().upper()
        if candidate_code != normalized_code:
            continue
        if normalize_instrument_type(candidate.instrument_type) == instrument_type:
            return candidate
    return None


def find_watchlist_conflict(
    user_id: int,
    instrument_type: str,
    code: str,
    exclude_item_id: int | None = None,
):
    normalized_code = (code or '').strip().upper()
    query = WatchlistItem.query.filter_by(user_id=user_id)
    if exclude_item_id is not None:
        query = query.filter(WatchlistItem.id != exclude_item_id)
    candidates = query.all()
    for candidate in candidates:
        candidate_code = (candidate.code or '').strip().upper()
        if candidate_code != normalized_code:
            continue
        if normalize_instrument_type(candidate.instrument_type) == instrument_type:
            return candidate
    return None


def remove_watchlist_conflict(user_id: int, instrument_type: str, code: str):
    removed = 0
    normalized_code = (code or '').strip().upper()
    conflicts = WatchlistItem.query.filter_by(user_id=user_id).all()
    for item in conflicts:
        item_code = (item.code or '').strip().upper()
        if item_code != normalized_code:
            continue
        if normalize_instrument_type(item.instrument_type) != instrument_type:
            continue
        db.session.delete(item)
        removed += 1
    return removed


def parse_holding_payload(data: dict, default_instrument_type: str | None = None):
    instrument_type = normalize_instrument_type(
        data.get('instrumentType') or data.get('instrument_type') or default_instrument_type or 'fund'
    )
    raw_code = (data.get('code') or '').strip()
    if not raw_code:
        label = '股票' if instrument_type == 'stock' else '基金'
        raise ValueError(f'{label}代码不能为空')

    market = ''
    if instrument_type == 'stock':
        parsed = parse_stock_code_info(raw_code)
        if not parsed:
            raise ValueError('股票代码格式错误，示例: 600519 / SH600519 / SZ000001')
        code = parsed['normalized_code']
        market = parsed['market']
    else:
        if not re.fullmatch(r'\d{6}', raw_code):
            raise ValueError('基金代码格式错误，应为6位数字')
        code = raw_code

    name = (data.get('name') or '').strip() or code
    return {
        'instrument_type': instrument_type,
        'market': market,
        'code': code,
        'name': name,
    }


def analyze_sentiment(content: str):
    if any(word in content for word in ['利好', '上涨', '突破', '大增', '创新高']):
        return 'bullish'
    if any(word in content for word in ['利空', '下跌', '跌破', '大减', '创新低']):
        return 'bearish'
    return None


def build_content_hash(title: str, content: str):
    payload = f'{(title or "").strip()}|{(content or "").strip()}'
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def relevance_level_from_score(score: float):
    if score >= 0.75:
        return 'critical'
    if score >= 0.55:
        return 'high'
    if score >= 0.35:
        return 'medium'
    if score > 0:
        return 'low'
    return 'none'


def sentiment_label(sentiment: str | None):
    normalized = (sentiment or '').strip().lower()
    if normalized == 'bullish':
        return '偏利好'
    if normalized == 'bearish':
        return '偏利空'
    return '中性'


def trading_now_flag():
    return is_trading_time_now()


def current_prompt(scene: str, fallback: str):
    row = (
        PromptTemplate.query
        .filter_by(scene=scene, status='active')
        .order_by(PromptTemplate.created_at.desc())
        .first()
    )
    if row:
        return row.content, row.version
    return fallback, 'builtin.v1'


def parse_json_text(payload: str | None, fallback):
    if not payload:
        return fallback
    try:
        parsed = json.loads(payload)
        return parsed if parsed is not None else fallback
    except json.JSONDecodeError:
        return fallback


def get_news_item_by_legacy_id(news_id: str):
    return NewsItem.query.filter_by(source='cls', external_id=news_id).first()


def get_global_analysis_payload(news_id: str, legacy_analysis: NewsAnalysis | None):
    sectors = parse_json_text(legacy_analysis.sectors, []) if legacy_analysis else []
    tags = parse_json_text(legacy_analysis.tags, []) if legacy_analysis else []
    sentiment = legacy_analysis.sentiment if legacy_analysis else 'neutral'
    impact_level = legacy_analysis.impact_level if legacy_analysis else 'minor'
    summary = legacy_analysis.summary if legacy_analysis else ''
    background = legacy_analysis.background if legacy_analysis else ''
    model_used = legacy_analysis.model_used if legacy_analysis else ''
    analyzed_at = int(legacy_analysis.analyzed_at.timestamp() * 1000) if legacy_analysis and legacy_analysis.analyzed_at else None
    confidence = 0.55 if legacy_analysis else 0
    status = 'success' if legacy_analysis else 'pending'
    prompt_version = 'legacy.v1'
    background_sources = []
    impact_analysis = ''
    watch_points = []
    sector_impacts = _normalize_sector_impacts([], sectors, sentiment)

    news_item = get_news_item_by_legacy_id(news_id)
    if news_item:
        modern = NewsGlobalAnalysis.query.filter_by(news_id=news_item.id).first()
        if modern:
            analysis_payload = parse_json_text(modern.analysis_json, {})
            sectors = analysis_payload.get('sectors') if isinstance(analysis_payload.get('sectors'), list) else sectors
            raw_sector_impacts = (
                analysis_payload.get('sectorImpacts')
                if isinstance(analysis_payload.get('sectorImpacts'), list)
                else analysis_payload.get('sector_impacts')
            )
            tags = analysis_payload.get('tags') if isinstance(analysis_payload.get('tags'), list) else tags
            background_sources = (
                analysis_payload.get('backgroundSources')
                if isinstance(analysis_payload.get('backgroundSources'), list)
                else background_sources
            )
            if not background_sources and isinstance(analysis_payload.get('background_sources'), list):
                background_sources = analysis_payload.get('background_sources')
            impact_analysis = (
                analysis_payload.get('impactAnalysis')
                if isinstance(analysis_payload.get('impactAnalysis'), str)
                else impact_analysis
            )
            if not impact_analysis and isinstance(analysis_payload.get('impact_analysis'), str):
                impact_analysis = analysis_payload.get('impact_analysis')
            watch_points = (
                analysis_payload.get('watchPoints')
                if isinstance(analysis_payload.get('watchPoints'), list)
                else watch_points
            )
            if not watch_points and isinstance(analysis_payload.get('watch_points'), list):
                watch_points = analysis_payload.get('watch_points')
            sentiment = modern.sentiment or sentiment
            impact_level = modern.impact_level or impact_level
            summary = modern.summary or summary
            background = modern.background or background
            model_used = modern.model_name or model_used
            analyzed_at = int(modern.analyzed_at.timestamp() * 1000) if modern.analyzed_at else analyzed_at
            confidence = modern.confidence if modern.confidence is not None else confidence
            status = modern.status or status
            prompt_version = modern.prompt_version or prompt_version
            sector_impacts = _normalize_sector_impacts(raw_sector_impacts, sectors, sentiment)
        else:
            sector_impacts = _normalize_sector_impacts([], sectors, sentiment)
    else:
        sector_impacts = _normalize_sector_impacts([], sectors, sentiment)

    sector_labels = [item['sector'] for item in sector_impacts if isinstance(item, dict) and item.get('sector')]
    sector_text = '、'.join(sector_labels[:3]) or '相关板块'

    if not isinstance(background, str):
        background = ''
    background = background.strip()
    if not background:
        background = (
            f"该事件主要影响{sector_text}，当前信息仍以快讯为主，"
            "后续需结合官方公告、行业数据与成交结构确认影响持续性。"
        )
    elif len(background) < 120:
        background = (
            f"{background} 从传导路径看，市场通常先交易预期，再验证基本面，"
            f"需结合{sector_text}近期资金流向、政策/供需变化与盘面成交确认影响强弱。"
            "若后续缺乏增量信息，相关板块弹性可能回落。"
        )[:280]

    if not isinstance(impact_analysis, str):
        impact_analysis = ''
    impact_analysis = impact_analysis.strip()
    if not impact_analysis:
        impact_analysis = (
            f"短线看，消息对{sector_text}情绪影响{sentiment_label(sentiment)}，"
            "可能引发板块内部分化；中线需跟踪事件落地节奏、盈利传导和估值匹配度，"
            "若兑现不及预期，存在情绪回撤风险。"
        )
    elif len(impact_analysis) < 120:
        impact_analysis = (
            f"{impact_analysis}\n\n"
            f"产业链与中期变量方面，需继续验证{sector_text}的供需与盈利传导是否兑现，"
            "并关注政策、资金与估值是否形成同向共振，防范预期过度交易后的回撤。"
        )[:320]

    if not isinstance(watch_points, list):
        watch_points = []
    watch_points = [str(item)[:60] for item in watch_points if isinstance(item, str) and item.strip()][:4]
    if not watch_points:
        watch_points = [
            '观察板块成交额与主线持续性',
            '跟踪后续公告与数据兑现进度',
            '警惕预期过高后的回撤波动',
        ]

    if not isinstance(background_sources, list):
        background_sources = []
    background_sources = [
        str(url).strip()
        for url in background_sources
        if isinstance(url, str) and str(url).strip().startswith(('http://', 'https://'))
    ][:2]

    return {
        'newsId': news_id,
        'sectors': [item['sector'] for item in sector_impacts],
        'sectorImpacts': sector_impacts,
        'stocks': [],
        'sentiment': sentiment or 'neutral',
        'impactLevel': impact_level or 'minor',
        'summary': summary or '',
        'background': background or '',
        'backgroundSources': background_sources,
        'impactAnalysis': (impact_analysis or '')[:320],
        'watchPoints': [str(item)[:60] for item in watch_points if isinstance(item, str) and item.strip()][:4],
        'tags': tags,
        'modelUsed': model_used or '',
        'analyzedAt': analyzed_at,
        'confidence': confidence,
        'status': status,
        'promptVersion': prompt_version,
    }


def build_event_context(news_id: str):
    news_item = get_news_item_by_legacy_id(news_id)
    if not news_item:
        return None

    relation = (
        NewsEventItem.query
        .filter_by(news_id=news_item.id)
        .order_by(NewsEventItem.is_primary.desc(), NewsEventItem.created_at.asc())
        .first()
    )
    if not relation:
        return None

    event = NewsEvent.query.get(relation.event_id)
    if not event:
        return None

    mapped = (
        db.session.query(NewsEventItem, NewsItem)
        .join(NewsItem, NewsEventItem.news_id == NewsItem.id)
        .filter(NewsEventItem.event_id == event.id)
        .order_by(NewsItem.published_at.desc())
        .limit(8)
        .all()
    )
    related_items = []
    for rel, item in mapped:
        related_items.append({
            'newsId': item.external_id,
            'title': item.title,
            'brief': item.brief,
            'publishedAt': int(item.published_at.timestamp() * 1000) if item.published_at else None,
            'isPrimary': bool(rel.is_primary),
        })

    return {
        'id': event.id,
        'eventKey': event.event_key,
        'title': event.title,
        'eventType': event.event_type,
        'importance': event.importance,
        'firstSeenAt': int(event.first_seen_at.timestamp() * 1000) if event.first_seen_at else None,
        'lastSeenAt': int(event.last_seen_at.timestamp() * 1000) if event.last_seen_at else None,
        'relatedNews': related_items,
    }


def to_news_feed_item(news: NewsCache, analysis: NewsAnalysis | None, relevance: UserNewsRelevance | None, insight: UserNewsPersonalizedInsight | None):
    relevance_payload = relevance.to_dict() if relevance else None
    why_relevant = {
        'matchedEntities': relevance_payload.get('matchedEntities', []) if relevance_payload else [],
        'reasonCodes': relevance_payload.get('reasonCodes', []) if relevance_payload else [],
        'matchedWatchlist': relevance_payload.get('matchedWatchlist', []) if relevance_payload else [],
    }
    return {
        'news': {
            'id': news.news_id,
            'title': news.title,
            'content': news.content,
            'brief': news.brief,
            'ctime': news.ctime,
            'raw': json.loads(news.raw_json) if news.raw_json else {},
        },
        'globalAnalysis': get_global_analysis_payload(news.news_id, analysis) if analysis else None,
        'relevance': relevance_payload,
        'personalizedInsight': insight.to_dict() if insight else None,
        'whyRelevant': why_relevant,
    }


def default_dashboard_preferences():
    return {
        'cardOrder': ['kpi', 'actions', 'market', 'alerts', 'insight'],
        'collapsedPanels': {
            'profitChart': True,
            'portfolioAnalysis': True,
        },
        'tableSort': {
            'key': 'today',
            'direction': 'desc',
        },
    }


def is_trading_time_now():
    now = datetime.now()
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return (570 <= minutes <= 690) or (780 <= minutes <= 900)


def parse_estimation_time(value: str):
    if not value:
        return None
    for fmt in ('%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def normalize_instrument_type(value: str | None):
    normalized = (value or 'fund').strip().lower()
    return 'stock' if normalized == 'stock' else 'fund'


def parse_stock_code_info(raw_code: str | None):
    if not raw_code:
        return None
    cleaned = re.sub(r'[^A-Za-z0-9.]', '', str(raw_code)).upper()
    if not cleaned:
        return None

    prefix = ''
    digits = ''

    direct = re.fullmatch(r'(SH|SZ|BJ)(\d{6})', cleaned)
    if direct:
        prefix = direct.group(1)
        digits = direct.group(2)
    else:
        with_dot = re.fullmatch(r'(SH|SZ|BJ)\.?(\d{6})', cleaned)
        if with_dot:
            prefix = with_dot.group(1)
            digits = with_dot.group(2)
        else:
            reverse = re.fullmatch(r'(\d{6})\.(SH|SZ|BJ)', cleaned)
            if reverse:
                digits = reverse.group(1)
                prefix = reverse.group(2)
            elif re.fullmatch(r'\d{6}', cleaned):
                digits = cleaned
                if digits[0] in {'5', '6', '9'}:
                    prefix = 'SH'
                elif digits[0] in {'0', '1', '2', '3'}:
                    prefix = 'SZ'
                elif digits[0] in {'4', '8'}:
                    prefix = 'BJ'
                else:
                    return None
            else:
                return None

    market_id = 1 if prefix == 'SH' else 0
    return {
        'market': prefix,
        'market_id': market_id,
        'digits': digits,
        'secid': f'{market_id}.{digits}',
        'normalized_code': f'{prefix}{digits}',
    }


def build_stock_estimation_from_quote(stock_code: str, quote: dict):
    price = safe_float(quote.get('price'))
    change_percent = safe_float(quote.get('changePercent'))
    if price <= 0:
        return None
    if abs(100 + change_percent) < 1e-6:
        prev_close = price
    else:
        prev_close = price / (1 + change_percent / 100.0)
    if prev_close <= 0:
        prev_close = price

    now = datetime.now()
    return {
        'fundcode': stock_code,
        'name': quote.get('name') or stock_code,
        'jzrq': now.strftime('%Y-%m-%d'),
        'dwjz': f'{prev_close:.4f}',
        'gsz': f'{price:.4f}',
        'gszzl': f'{change_percent:.2f}',
        'gztime': now.strftime('%Y-%m-%d %H:%M:%S'),
    }


def fetch_stock_quotes_batch(stock_codes: list[str]):
    unique_codes = []
    seen = set()
    for code in stock_codes:
        normalized = (code or '').strip().upper()
        if normalized and normalized not in seen:
            seen.add(normalized)
            unique_codes.append(normalized)
    if not unique_codes:
        return {}

    secid_to_code = {}
    secids = []
    for code in unique_codes:
        parsed = parse_stock_code_info(code)
        if not parsed:
            continue
        secid = parsed['secid']
        secids.append(secid)
        secid_to_code[secid] = parsed['normalized_code']
        if code != parsed['normalized_code']:
            secid_to_code.setdefault(f'{parsed["market_id"]}.{code[-6:]}', parsed['normalized_code'])
    if not secids:
        return {}

    url = (
        'https://push2.eastmoney.com/api/qt/ulist.np/get'
        f'?fltt=2&secids={",".join(secids)}&fields=f2,f3,f12,f13,f14&_={int(time.time() * 1000)}'
    )

    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        print(f'[Backend] fetch stock quote failed: {exc}')
        return {}

    quotes = {}
    for item in payload.get('data', {}).get('diff', []):
        if not isinstance(item, dict):
            continue
        digits = str(item.get('f12') or '').strip()
        market_id = int(item.get('f13') or 0)
        secid = f'{market_id}.{digits}'
        code = secid_to_code.get(secid)
        if not code and digits:
            fallback_market = 'SH' if market_id == 1 else 'SZ'
            code = f'{fallback_market}{digits}'
        if not code:
            continue
        quotes[code] = {
            'name': str(item.get('f14') or '').strip() or code,
            'price': safe_float(item.get('f2')),
            'changePercent': safe_float(item.get('f3')),
        }
    return quotes


def fetch_fund_estimation_data(fund_code: str):
    url = f'https://fundgz.1234567.com.cn/js/{fund_code}.js?rt={int(time.time() * 1000)}'
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        match = re.search(r'jsonpgz\((.*)\)', response.text)
        if not match:
            return None
        data = json.loads(match.group(1))
        if not isinstance(data, dict) or not data.get('gsz'):
            return None
        return data
    except Exception as exc:
        print(f'[Backend] fetch estimation failed for {fund_code}: {exc}')
        return None


def fetch_market_pulse():
    index_map = [
        ('1.000001', '上证指数'),
        ('0.399006', '创业板指'),
        ('1.000688', '科创50'),
        ('1.000300', '沪深300'),
    ]
    secids = ','.join(item[0] for item in index_map)
    url = (
        'https://push2.eastmoney.com/api/qt/ulist.np/get'
        f'?fltt=2&secids={secids}&fields=f2,f3,f4,f12,f14&_={int(time.time() * 1000)}'
    )
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        payload = response.json()
        result = []
        for item in payload.get('data', {}).get('diff', []):
            result.append({
                'code': item.get('f12', ''),
                'name': item.get('f14', ''),
                'price': float(item.get('f2', 0) or 0),
                'changePercent': float(item.get('f3', 0) or 0),
            })
        return result[:4]
    except Exception as exc:
        print(f'[Backend] fetch market pulse failed: {exc}')
        return []


def clamp(value, lower=0.0, upper=100.0):
    return max(lower, min(upper, value))


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def compute_dashboard_overview(user_id: int):
    funds = FundHolding.query.filter_by(user_id=user_id).all()
    now = datetime.now()
    stock_codes = [fund.code for fund in funds if normalize_instrument_type(fund.instrument_type) == 'stock']
    stock_quotes = fetch_stock_quotes_batch(stock_codes) if stock_codes else {}

    entries = []
    total_cost = 0.0
    total_value = 0.0
    today_profit = 0.0
    max_change_abs = 0.0
    latest_update = None

    for fund in funds:
        instrument_type = normalize_instrument_type(fund.instrument_type)
        if instrument_type == 'stock':
            quote = stock_quotes.get((fund.code or '').strip().upper())
            estimation = build_stock_estimation_from_quote(fund.code, quote) if quote else None
        else:
            estimation = fetch_fund_estimation_data(fund.code)
        current_nav = safe_float(estimation.get('gsz')) if estimation else 0.0
        last_nav = safe_float(estimation.get('dwjz')) if estimation else 0.0
        change_percent = safe_float(estimation.get('gszzl')) if estimation else 0.0
        update_time = parse_estimation_time(estimation.get('gztime', '')) if estimation else None

        value = fund.shares * current_nav if current_nav > 0 else fund.cost
        fund_today_profit = fund.shares * (current_nav - last_nav) if current_nav > 0 and last_nav > 0 else 0.0
        total_cost += fund.cost
        total_value += value
        today_profit += fund_today_profit
        max_change_abs = max(max_change_abs, abs(change_percent))

        if update_time and (latest_update is None or update_time > latest_update):
            latest_update = update_time

        entries.append({
            'fundId': fund.id,
            'fundCode': fund.code,
            'name': fund.name,
            'instrumentType': instrument_type,
            'value': value,
            'cost': fund.cost,
            'todayProfit': fund_today_profit,
            'changePercent': change_percent,
        })

    total_profit = total_value - total_cost
    total_profit_percent = (total_profit / total_cost * 100) if total_cost > 0 else 0.0
    yesterday_value = total_value - today_profit
    today_profit_percent = (today_profit / yesterday_value * 100) if yesterday_value > 0 else 0.0

    for entry in entries:
        entry['allocation'] = (entry['value'] / total_value * 100) if total_value > 0 else 0.0

    max_allocation = max([entry['allocation'] for entry in entries], default=0.0)

    concentration_risk = clamp((max_allocation - 20) * 4.0)
    volatility_risk = clamp(max_change_abs * 30.0)

    stale = False
    max_age_seconds = 0
    if latest_update:
        max_age_seconds = int((now - latest_update).total_seconds())
        stale = is_trading_time_now() and max_age_seconds > 180
    freshness_risk = 100.0 if stale else 10.0

    risk_score = round(clamp(concentration_risk * 0.45 + volatility_risk * 0.35 + freshness_risk * 0.20), 1)
    if risk_score <= 33:
        risk_level = 'low'
    elif risk_score <= 66:
        risk_level = 'medium'
    else:
        risk_level = 'high'

    top_gainer = sorted([entry for entry in entries if entry['todayProfit'] > 0], key=lambda item: item['todayProfit'], reverse=True)
    top_loser = sorted([entry for entry in entries if entry['todayProfit'] < 0], key=lambda item: item['todayProfit'])

    alerts = []
    if not entries:
        alerts.append({
            'id': 'empty-portfolio',
            'type': 'empty',
            'severity': 'low',
            'title': '当前无持仓',
            'message': '建议先添加 1-2 只核心仓位，开始跟踪盘中收益。',
        })
    else:
        if top_loser:
            loser = top_loser[0]
            alerts.append({
                'id': f'loser-{loser["fundCode"]}',
                'type': 'drawdown',
                'severity': 'high' if loser['todayProfit'] < -100 else 'medium',
                'title': f'{loser["name"]} 今日拖累最大',
                'message': f'今日贡献 {loser["todayProfit"]:.2f} 元，建议检查仓位或波动原因。',
                'fundCode': loser['fundCode'],
            })

        heavy = [entry for entry in entries if entry['allocation'] >= 35]
        if heavy:
            target = sorted(heavy, key=lambda item: item['allocation'], reverse=True)[0]
            alerts.append({
                'id': f'concentration-{target["fundCode"]}',
                'type': 'concentration',
                'severity': 'medium',
                'title': f'{target["name"]} 仓位过高',
                'message': f'当前占比 {target["allocation"]:.1f}%，建议关注分散风险。',
                'fundCode': target['fundCode'],
            })

        if stale:
            alerts.append({
                'id': 'stale-data',
                'type': 'stale',
                'severity': 'high',
                'title': '估值数据可能过期',
                'message': f'最近更新时间距今 {max_age_seconds // 60} 分钟，建议立即刷新。',
            })

    alerts = alerts[:3]
    recommendations = [alert['message'] for alert in alerts[:2]]

    return {
        'generatedAt': int(now.timestamp() * 1000),
        'kpi': {
            'fundCount': len(entries),
            'totalCost': round(total_cost, 2),
            'totalValue': round(total_value, 2),
            'totalProfit': round(total_profit, 2),
            'totalProfitPercent': round(total_profit_percent, 2),
            'todayProfit': round(today_profit, 2),
            'todayProfitPercent': round(today_profit_percent, 2),
            'alertCount': len(alerts),
        },
        'riskScore': {
            'score': risk_score,
            'level': risk_level,
            'concentration': round(concentration_risk, 1),
            'volatility': round(volatility_risk, 1),
            'freshness': round(freshness_risk, 1),
        },
        'alerts': alerts,
        'topMovers': {
            'gainers': top_gainer[:3],
            'losers': top_loser[:3],
        },
        'marketPulse': fetch_market_pulse(),
        'staleState': {
            'stale': stale,
            'maxAgeSeconds': max_age_seconds,
            'latestUpdateTime': latest_update.strftime('%Y-%m-%d %H:%M:%S') if latest_update else '',
        },
        'recommendations': recommendations,
    }


# ============ AI Service Layer ============

def get_ai_runtime_config():
    with app.app_context():
        base_url = (_get_ai_config('ai_base_url', os.getenv('AI_BASE_URL', '')) or '').strip()
        api_key = (_get_ai_config('ai_api_key', os.getenv('AI_API_KEY', '')) or '').strip()
    if not base_url or not api_key:
        return None
    return {
        'base_url': base_url.rstrip('/'),
        'api_key': api_key,
    }


def _extract_ai_text(payload):
    if not isinstance(payload, dict):
        return ''

    output_text = payload.get('output_text')
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    choices = payload.get('choices')
    if isinstance(choices, list) and choices:
        choice = choices[0] if isinstance(choices[0], dict) else {}
        message = choice.get('message') if isinstance(choice, dict) else {}
        content = message.get('content') if isinstance(message, dict) else ''
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            fragments = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                text = block.get('text') or block.get('value') or ''
                if isinstance(text, str) and text.strip():
                    fragments.append(text.strip())
            if fragments:
                return '\n'.join(fragments)

    output = payload.get('output')
    if isinstance(output, list):
        fragments = []
        for item in output:
            if not isinstance(item, dict):
                continue
            for block in item.get('content', []) if isinstance(item.get('content'), list) else []:
                if not isinstance(block, dict):
                    continue
                text = block.get('text') or block.get('output_text') or ''
                if isinstance(text, str) and text.strip():
                    fragments.append(text.strip())
        if fragments:
            return '\n'.join(fragments)

    content = payload.get('content')
    if isinstance(content, list):
        fragments = []
        for block in content:
            if not isinstance(block, dict):
                continue
            text = block.get('text') or ''
            if isinstance(text, str) and text.strip():
                fragments.append(text.strip())
        if fragments:
            return '\n'.join(fragments)

    if isinstance(content, str) and content.strip():
        return content.strip()
    return ''


def _extract_ai_tokens(payload):
    if not isinstance(payload, dict):
        return 0
    usage = payload.get('usage')
    if isinstance(usage, dict):
        total = usage.get('total_tokens')
        if isinstance(total, int):
            return total
        input_tokens = usage.get('input_tokens')
        output_tokens = usage.get('output_tokens')
        if isinstance(input_tokens, int) and isinstance(output_tokens, int):
            return input_tokens + output_tokens
    return 0


def _build_ai_endpoints(base_url: str, preferred_wire_api: str = 'responses'):
    normalized = base_url.rstrip('/')
    if normalized.endswith('/v1'):
        root_url = normalized[:-3]
        v1_url = normalized
    else:
        root_url = normalized
        v1_url = f'{normalized}/v1'

    candidates_by_api = {
        'responses': [
            ('responses', f'{root_url}/responses'),
            ('responses', f'{v1_url}/responses'),
        ],
        'chat': [
            ('chat', f'{root_url}/chat/completions'),
            ('chat', f'{v1_url}/chat/completions'),
        ],
        'messages': [
            ('messages', f'{root_url}/messages'),
            ('messages', f'{v1_url}/messages'),
        ],
    }

    order = ['responses', 'chat', 'messages']
    if preferred_wire_api in order:
        order = [preferred_wire_api] + [item for item in order if item != preferred_wire_api]

    flattened = []
    seen = set()
    for api in order:
        for endpoint_name, endpoint_url in candidates_by_api[api]:
            if endpoint_url in seen:
                continue
            seen.add(endpoint_url)
            flattened.append((endpoint_name, endpoint_url))
    return flattened


def call_ai_text(system_prompt: str, user_prompt: str, model: str, temperature: float = 0.3):
    config = get_ai_runtime_config()
    if not config:
        return None

    headers_common = {
        'Authorization': f'Bearer {config["api_key"]}',
        'Content-Type': 'application/json',
    }
    wire_api = (_get_ai_config('ai_wire_api', os.getenv('AI_WIRE_API', 'responses')) or 'responses').strip().lower()

    for endpoint_name, endpoint_url in _build_ai_endpoints(config['base_url'], wire_api):
        try:
            headers = dict(headers_common)
            if endpoint_name == 'responses':
                payload = {
                    'model': model,
                    'input': [
                        {
                            'role': 'system',
                            'content': [{'type': 'input_text', 'text': system_prompt}],
                        },
                        {
                            'role': 'user',
                            'content': [{'type': 'input_text', 'text': user_prompt}],
                        },
                    ],
                    'max_output_tokens': 4096,
                    'temperature': temperature,
                }
            elif endpoint_name == 'chat':
                payload = {
                    'model': model,
                    'messages': [
                        {'role': 'system', 'content': system_prompt},
                        {'role': 'user', 'content': user_prompt},
                    ],
                    'temperature': temperature,
                }
            else:
                headers['x-api-key'] = config['api_key']
                headers['anthropic-version'] = '2023-06-01'
                payload = {
                    'model': model,
                    'system': system_prompt,
                    'max_tokens': 4096,
                    'messages': [
                        {
                            'role': 'user',
                            'content': [{'type': 'text', 'text': user_prompt}],
                        }
                    ],
                }

            response = requests.post(endpoint_url, headers=headers, json=payload, timeout=45)
            if response.status_code >= 400:
                body = (response.text or '')[:200].replace('\n', ' ')
                print(f'[AI] endpoint {endpoint_name} status={response.status_code} body={body}')
                continue

            payload_json = response.json()
            text = _extract_ai_text(payload_json)
            if not text:
                print(f'[AI] endpoint {endpoint_name} returned empty text payload')
                continue

            return {
                'text': text,
                'tokens': _extract_ai_tokens(payload_json),
                'endpoint': endpoint_name,
            }
        except Exception as exc:
            print(f'[AI] endpoint {endpoint_name} failed: {exc}')
            continue

    return None


def _get_ai_config(key: str, default: str = '') -> str:
    """Read a config value from AIConfig table, falling back to default."""
    provider = AIProviderConfig.query.filter_by(provider='default').first()
    if provider:
        models = {}
        try:
            models = json.loads(provider.default_models) if provider.default_models else {}
        except json.JSONDecodeError:
            models = {}
        if key == 'ai_base_url' and provider.base_url:
            return provider.base_url
        if key == 'ai_api_key' and provider.api_key_ciphertext:
            return provider.api_key_ciphertext
        if key in ('ai_model_fast', 'ai_model_deep') and models.get(key):
            return str(models.get(key))
        if key == 'ai_enabled':
            return 'true' if provider.enabled else 'false'

    row = AIConfig.query.filter_by(key=key).first()
    return row.value if row and row.value else default


def _set_ai_config(key: str, value: str):
    """Write a config value to AIConfig table."""
    row = AIConfig.query.filter_by(key=key).first()
    if row:
        row.value = value
        row.updated_at = datetime.utcnow()
    else:
        row = AIConfig(key=key, value=value)
        db.session.add(row)

    provider = AIProviderConfig.query.filter_by(provider='default').first()
    if not provider:
        provider = AIProviderConfig(provider='default')
        db.session.add(provider)

    models = {}
    try:
        models = json.loads(provider.default_models) if provider.default_models else {}
    except json.JSONDecodeError:
        models = {}

    if key == 'ai_base_url':
        provider.base_url = value
    elif key == 'ai_api_key':
        provider.api_key_ciphertext = value
    elif key in ('ai_model_fast', 'ai_model_deep'):
        models[key] = value
        provider.default_models = json.dumps(models, ensure_ascii=False)
    elif key == 'ai_enabled':
        provider.enabled = str(value).lower() == 'true'

    db.session.commit()


def is_ai_enabled() -> bool:
    """Check if AI analysis is enabled."""
    return _get_ai_config('ai_enabled', os.getenv('AI_ENABLED', 'false')).lower() == 'true'


def get_metaso_api_key():
    return (_get_ai_config('metaso_api_key', os.getenv('METASO_API_KEY', '')) or '').strip()


def metaso_enabled():
    return bool(get_metaso_api_key())


def get_metaso_daily_budget():
    raw = _get_ai_config('metaso_daily_budget', os.getenv('METASO_DAILY_BUDGET', str(METASO_DAILY_BUDGET_DEFAULT)))
    try:
        budget = int(str(raw).strip())
    except (TypeError, ValueError):
        budget = METASO_DAILY_BUDGET_DEFAULT
    return max(0, budget)


def metaso_high_impact_only():
    raw = _get_ai_config('metaso_high_impact_only', os.getenv('METASO_HIGH_IMPACT_ONLY', 'true'))
    return str(raw).strip().lower() not in {'0', 'false', 'no', 'off'}


def _parse_bool_value(raw, default: bool = False) -> bool:
    if raw is None:
        return default
    return str(raw).strip().lower() not in {'0', 'false', 'no', 'off', ''}


def local_fallback_enabled() -> bool:
    raw = _get_ai_config('fallback_enabled', os.getenv('LOCAL_FALLBACK_ENABLED', 'true'))
    return _parse_bool_value(raw, True)


def get_local_fallback_daily_budget() -> int:
    raw = _get_ai_config(
        'fallback_daily_budget',
        os.getenv('LOCAL_FALLBACK_DAILY_BUDGET', str(LOCAL_FALLBACK_DAILY_BUDGET_DEFAULT)),
    )
    try:
        budget = int(str(raw).strip())
    except (TypeError, ValueError):
        budget = LOCAL_FALLBACK_DAILY_BUDGET_DEFAULT
    return max(0, budget)


def get_local_reader_daily_budget() -> int:
    raw = _get_ai_config(
        'fallback_reader_daily_budget',
        os.getenv('LOCAL_READER_DAILY_BUDGET', str(LOCAL_READER_DAILY_BUDGET_DEFAULT)),
    )
    try:
        budget = int(str(raw).strip())
    except (TypeError, ValueError):
        budget = LOCAL_READER_DAILY_BUDGET_DEFAULT
    return max(0, budget)


def background_enrichment_enabled() -> bool:
    return metaso_enabled() or local_fallback_enabled()


def _metaso_acquire_call_slot(units: int = 1, with_reason: bool = False):
    if units <= 0:
        if with_reason:
            return True, ''
        return True

    now_ts = time.time()
    today = datetime.now().strftime('%Y-%m-%d')
    with metaso_quota_lock:
        if metaso_quota_state['date'] != today:
            metaso_quota_state['date'] = today
            metaso_quota_state['count'] = 0
            metaso_quota_state['disabled_until'] = 0.0
            metaso_quota_state['last_log'] = ''

        if metaso_quota_state['disabled_until'] > now_ts:
            if with_reason:
                return False, 'quota'
            return False

        budget = get_metaso_daily_budget()
        if budget <= 0:
            if metaso_quota_state['last_log'] != 'budget_zero':
                print('[Metaso] disabled: metaso_daily_budget <= 0')
                metaso_quota_state['last_log'] = 'budget_zero'
            if with_reason:
                return False, 'budget_zero'
            return False

        if metaso_quota_state['count'] + units > budget:
            if metaso_quota_state['last_log'] != 'budget_reached':
                print(f'[Metaso] daily budget reached count={metaso_quota_state["count"]} budget={budget}')
                metaso_quota_state['last_log'] = 'budget_reached'
            if with_reason:
                return False, 'quota'
            return False

        metaso_quota_state['count'] += units
        if with_reason:
            return True, ''
        return True


def _metaso_mark_quota_exhausted(reason: str = ''):
    with metaso_quota_lock:
        metaso_quota_state['disabled_until'] = max(
            metaso_quota_state['disabled_until'],
            time.time() + METASO_QUOTA_COOLDOWN_SECONDS,
        )
        if metaso_quota_state['last_log'] != 'quota_exhausted':
            suffix = f' reason={reason}' if reason else ''
            print(f'[Metaso] quota exhausted; cooling down {METASO_QUOTA_COOLDOWN_SECONDS}s{suffix}')
            metaso_quota_state['last_log'] = 'quota_exhausted'


def _local_fallback_acquire_slot(slot: str, units: int = 1) -> bool:
    if units <= 0:
        return True
    if slot not in {'search', 'reader'}:
        return False

    today = datetime.now().strftime('%Y-%m-%d')
    count_key = f'{slot}_count'
    budget = get_local_fallback_daily_budget() if slot == 'search' else get_local_reader_daily_budget()

    with local_fallback_quota_lock:
        if local_fallback_quota_state['date'] != today:
            local_fallback_quota_state['date'] = today
            local_fallback_quota_state['search_count'] = 0
            local_fallback_quota_state['reader_count'] = 0
            local_fallback_quota_state['last_log'] = ''

        if budget <= 0:
            log_key = f'{slot}_budget_zero'
            if local_fallback_quota_state['last_log'] != log_key:
                print(f'[LocalFallback] {slot} disabled: budget <= 0')
                local_fallback_quota_state['last_log'] = log_key
            return False

        current = local_fallback_quota_state[count_key]
        if current + units > budget:
            log_key = f'{slot}_budget_reached'
            if local_fallback_quota_state['last_log'] != log_key:
                print(f'[LocalFallback] {slot} daily budget reached count={current} budget={budget}')
                local_fallback_quota_state['last_log'] = log_key
            return False

        local_fallback_quota_state[count_key] = current + units
        return True


def _metaso_cached_context_get(cache_key: str):
    now_ts = time.time()
    with metaso_context_lock:
        cached = metaso_context_cache.get(cache_key)
        if not cached:
            return None
        if cached.get('expires_at', 0) <= now_ts:
            metaso_context_cache.pop(cache_key, None)
            return None
        return cached.get('payload')


def _metaso_cached_context_set(cache_key: str, payload: dict, ttl_seconds: int):
    ttl = max(60, int(ttl_seconds or 0))
    with metaso_context_lock:
        metaso_context_cache[cache_key] = {
            'payload': payload,
            'expires_at': time.time() + ttl,
        }


def extract_metaso_items(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []

    for key in ('items', 'results', 'list', 'webpages', 'pages'):
        if isinstance(payload.get(key), list):
            return payload.get(key)

    for key in ('data', 'result', 'payload'):
        nested = payload.get(key)
        if isinstance(nested, list):
            return nested
        if isinstance(nested, dict):
            nested_items = extract_metaso_items(nested)
            if nested_items:
                return nested_items

    return []


def metaso_search(query: str, size: int = 4, with_reason: bool = False):
    reason = ''
    key = get_metaso_api_key()
    if not key:
        reason = 'metaso_disabled'
        return ([], reason) if with_reason else []
    if not query:
        reason = 'empty_query'
        return ([], reason) if with_reason else []
    acquired, acquire_reason = _metaso_acquire_call_slot(1, with_reason=True)
    if not acquired:
        reason = acquire_reason or 'quota'
        return ([], reason) if with_reason else []

    headers = {
        'Authorization': f'Bearer {key}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
    payload = {
        'q': query[:120],
        'scope': 'webpage',
        'includeSummary': False,
        'size': str(max(1, min(size, 10))),
        'includeRawContent': False,
        'conciseSnippet': False,
    }

    try:
        resp = requests.post(METASO_SEARCH_URL, headers=headers, json=payload, timeout=20)
        resp.raise_for_status()
    except Exception as exc:
        print(f'[Metaso] search failed: {exc}')
        reason = 'http_error'
        return ([], reason) if with_reason else []

    try:
        parsed = resp.json()
    except ValueError as exc:
        print(f'[Metaso] search parse failed: {exc}')
        reason = 'parse_error'
        return ([], reason) if with_reason else []

    if isinstance(parsed, dict):
        err_code = parsed.get('errCode', parsed.get('code'))
        if err_code not in (None, 0, '0'):
            err_msg = parsed.get('errMsg') or parsed.get('message') or ''
            print(f'[Metaso] search api error code={err_code} msg={err_msg}')
            if str(err_code) == '3000':
                _metaso_mark_quota_exhausted(err_msg)
                reason = 'quota'
            else:
                reason = 'api_error'
            return ([], reason) if with_reason else []

    items = extract_metaso_items(parsed)

    normalized = []
    seen_urls = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        url = (item.get('url') or item.get('link') or item.get('href') or '').strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        normalized.append({
            'title': (item.get('title') or item.get('name') or '').strip(),
            'url': url,
            'snippet': (item.get('snippet') or item.get('summary') or item.get('description') or '').strip(),
        })

    if not normalized:
        reason = 'empty_result'
    return (normalized, reason) if with_reason else normalized


def metaso_read_url(url: str, max_chars: int = 1200, with_reason: bool = False):
    reason = ''
    key = get_metaso_api_key()
    if not key:
        reason = 'metaso_disabled'
        return ('', reason) if with_reason else ''
    if not url:
        reason = 'empty_url'
        return ('', reason) if with_reason else ''
    acquired, acquire_reason = _metaso_acquire_call_slot(1, with_reason=True)
    if not acquired:
        reason = acquire_reason or 'quota'
        return ('', reason) if with_reason else ''

    headers = {
        'Authorization': f'Bearer {key}',
        'Accept': 'text/plain',
        'Content-Type': 'application/json',
    }
    try:
        resp = requests.post(METASO_READER_URL, headers=headers, json={'url': url}, timeout=25)
        resp.raise_for_status()
        text_content = (resp.text or '').strip()
        if max_chars > 0 and len(text_content) > max_chars:
            text_content = text_content[:max_chars]
        if not text_content:
            reason = 'empty_result'
        return (text_content, reason) if with_reason else text_content
    except Exception as exc:
        print(f'[Metaso] reader failed for {url}: {exc}')
        reason = 'http_error'
        return ('', reason) if with_reason else ''


def local_search_duckduckgo(query: str, size: int = 1, with_reason: bool = False):
    reason = ''
    if not local_fallback_enabled():
        reason = 'disabled'
        return ([], reason) if with_reason else []
    if not query:
        reason = 'empty_query'
        return ([], reason) if with_reason else []
    if DDGS is None:
        reason = 'provider_unavailable'
        print('[LocalFallback] duckduckgo-search is not installed')
        return ([], reason) if with_reason else []
    if not _local_fallback_acquire_slot('search', 1):
        reason = 'quota'
        return ([], reason) if with_reason else []

    normalized = []
    seen_urls = set()
    query_text = query[:120]
    max_results = max(1, min(size, 3))
    try:
        with DDGS() as ddgs:
            items = list(ddgs.text(query_text, max_results=max_results))
    except Exception as exc:
        print(f'[LocalFallback] DDG search failed: {exc}')
        reason = 'http_error'
        return ([], reason) if with_reason else []

    for item in items:
        if not isinstance(item, dict):
            continue
        url = (item.get('href') or item.get('url') or item.get('link') or '').strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        normalized.append({
            'title': (item.get('title') or '').strip(),
            'url': url,
            'snippet': (item.get('body') or item.get('snippet') or '').strip(),
        })

    if not normalized:
        reason = 'empty_result'
    return (normalized, reason) if with_reason else normalized


def local_read_url(url: str, max_chars: int = 900, with_reason: bool = False):
    reason = ''
    if not local_fallback_enabled():
        reason = 'disabled'
        return ('', reason) if with_reason else ''
    if not url:
        reason = 'empty_url'
        return ('', reason) if with_reason else ''
    if not _local_fallback_acquire_slot('reader', 1):
        reason = 'quota'
        return ('', reason) if with_reason else ''

    headers = {
        'User-Agent': LOCAL_FETCH_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
    try:
        resp = requests.get(url, headers=headers, timeout=LOCAL_FETCH_TIMEOUT_SECONDS)
        resp.raise_for_status()
        html_text = resp.text or ''

        text_content = ''
        if trafilatura is not None:
            try:
                extracted = trafilatura.extract(
                    html_text,
                    url=url,
                    include_comments=False,
                    include_tables=False,
                    favor_precision=True,
                )
                text_content = (extracted or '').strip()
            except Exception as exc:
                print(f'[LocalFallback] trafilatura failed for {url}: {exc}')

        if not text_content:
            if BeautifulSoup is not None:
                soup = BeautifulSoup(html_text, 'html.parser')
                for tag in soup(['script', 'style', 'noscript']):
                    tag.decompose()
                text_content = soup.get_text('\n')
            else:
                text_content = re.sub(r'<[^>]+>', ' ', html_text)

        text_content = re.sub(r'\s+', ' ', (text_content or '')).strip()
        if max_chars > 0 and len(text_content) > max_chars:
            text_content = text_content[:max_chars]
        if not text_content:
            reason = 'empty_result'
        return (text_content, reason) if with_reason else text_content
    except Exception as exc:
        print(f'[LocalFallback] reader failed for {url}: {exc}')
        reason = 'http_error'
        return ('', reason) if with_reason else ''


def _build_background_payload_from_search_results(search_results: list[dict], read_url_fn):
    sources = []
    evidence = []
    for entry in search_results[:1]:
        url = entry.get('url') or ''
        snippet = (entry.get('snippet') or '').strip()
        title_text = (entry.get('title') or '').strip()
        evidence_text = snippet
        if len((evidence_text or '').strip()) < METASO_READER_MIN_SNIPPET:
            evidence_text = (read_url_fn(url, max_chars=900) or snippet).strip()
        if evidence_text:
            evidence.append({
                'title': title_text,
                'url': url,
                'text': evidence_text[:900],
            })
        if url:
            sources.append({
                'title': title_text,
                'url': url,
                'snippet': snippet[:280],
            })
    return {
        'sources': sources[:2],
        'evidence': evidence[:2],
    }


def build_local_background_context(news_item: dict, with_reason: bool = False):
    title = (news_item.get('title') or '').strip()
    content = (news_item.get('content') or '').strip()
    query = title[:120] if title else content[:120]
    if not query:
        payload = {'sources': [], 'evidence': []}
        return (payload, 'empty_query') if with_reason else payload

    search_results, search_reason = local_search_duckduckgo(query, size=1, with_reason=True)
    if not search_results:
        payload = {'sources': [], 'evidence': []}
        return (payload, search_reason or 'empty_result') if with_reason else payload

    payload = _build_background_payload_from_search_results(search_results, local_read_url)
    reason = ''
    if not payload.get('sources') and not payload.get('evidence'):
        reason = 'empty_result'
    return (payload, reason) if with_reason else payload


def _should_trigger_local_fallback(metaso_reason: str) -> bool:
    if not local_fallback_enabled():
        return False
    return metaso_reason in {'metaso_disabled', 'quota', 'budget_zero', 'http_error', 'parse_error', 'api_error'}


def build_news_background_context(news_item: dict):
    title = (news_item.get('title') or '').strip()
    content = (news_item.get('content') or '').strip()
    query = title[:120] if title else content[:120]
    if not query:
        return {'sources': [], 'evidence': []}
    cache_key = build_content_hash(title, content)
    cached_payload = _metaso_cached_context_get(cache_key)
    if isinstance(cached_payload, dict):
        return cached_payload

    payload = {'sources': [], 'evidence': []}
    provider = 'none'
    fail_reason = ''

    metaso_results, metaso_reason = metaso_search(query, size=1, with_reason=True)
    if metaso_results:
        payload = _build_background_payload_from_search_results(metaso_results, metaso_read_url)
        if payload.get('sources') or payload.get('evidence'):
            provider = 'metaso'
        else:
            fail_reason = 'empty_result'
    else:
        fail_reason = metaso_reason or 'empty_result'

    if provider != 'metaso' and _should_trigger_local_fallback(fail_reason):
        local_payload, local_reason = build_local_background_context(news_item, with_reason=True)
        if local_payload.get('sources') or local_payload.get('evidence'):
            payload = local_payload
            provider = 'local-ddg'
            fail_reason = ''
        else:
            payload = local_payload
            if local_reason:
                fail_reason = f'{fail_reason}|local_{local_reason}' if fail_reason else f'local_{local_reason}'

    if provider == 'none' and not fail_reason:
        fail_reason = 'empty_result'

    ttl = (
        METASO_CONTEXT_CACHE_TTL_SECONDS
        if payload.get('sources') or payload.get('evidence')
        else METASO_EMPTY_CONTEXT_TTL_SECONDS
    )
    print(
        f'[BackgroundContext] provider={provider} fail_reason={(fail_reason or "none")} '
        f'news_id={news_item.get("news_id", "")}'
    )
    _metaso_cached_context_set(cache_key, payload, ttl)
    return payload


SECTOR_KEYWORDS = [
    ('半导体', ['半导体', '芯片', '晶圆', '封测', '存储']),
    ('人工智能', ['人工智能', 'ai', '大模型', '算力', '服务器']),
    ('新能源', ['新能源', '光伏', '风电', '储能', '锂电']),
    ('汽车', ['汽车', '整车', '智能驾驶', '车企', '电动车']),
    ('医药', ['医药', '创新药', '医疗器械', '药企', '生物']),
    ('消费', ['白酒', '食品饮料', '消费', '零售', '家电']),
    ('金融', ['银行', '券商', '保险', '金融']),
    ('地产', ['地产', '房地产', '楼市']),
    ('军工', ['军工', '国防', '航天', '船舶']),
    ('有色', ['有色', '铜', '铝', '黄金', '稀土']),
    ('煤炭', ['煤炭', '焦煤', '焦炭']),
    ('石油化工', ['石油', '天然气', '化工']),
]

MAJOR_IMPACT_KEYWORDS = [
    '国常会', '国务院', '证监会', '央行', '降准', '降息', '重大', '突发',
    '地缘', '战争', '制裁', '停牌', '复牌', '并购', '重组'
]

MODERATE_IMPACT_KEYWORDS = [
    '业绩', '财报', '订单', '销量', '数据', '景气', '产能', '招标',
    '调研', '会议', '发布会', '产业链', '行业'
]

TAG_KEYWORDS = {
    '政策': ['政策', '监管', '国务院', '证监会', '央行', '发改委'],
    '财报': ['财报', '业绩', '净利润', '营收', '预告'],
    '数据': ['cpi', 'ppi', 'pmi', '社融', '非农', '数据'],
    '行业': ['行业', '景气', '供需', '产能', '库存'],
    '国际': ['美国', '欧洲', '海外', '美联储', '地缘', '制裁'],
}


def _infer_sectors(text: str) -> list[str]:
    lowered = (text or '').lower()
    matched = []
    for sector, keywords in SECTOR_KEYWORDS:
        if any(keyword.lower() in lowered for keyword in keywords):
            matched.append(sector)
    return matched[:4]


def _infer_tags(text: str) -> list[str]:
    lowered = (text or '').lower()
    tags = [tag for tag, keywords in TAG_KEYWORDS.items() if any(keyword.lower() in lowered for keyword in keywords)]
    if not tags:
        tags = ['其他']
    return tags[:3]


def _infer_impact_level(text: str) -> str:
    lowered = (text or '').lower()
    if any(keyword.lower() in lowered for keyword in MAJOR_IMPACT_KEYWORDS):
        return 'major'
    if any(keyword.lower() in lowered for keyword in MODERATE_IMPACT_KEYWORDS):
        return 'moderate'
    return 'minor'


def _normalize_sector_impacts(raw_impacts, sectors: list[str], default_polarity: str):
    valid_polarity = {'bullish', 'bearish', 'neutral'}
    polarity = default_polarity if default_polarity in valid_polarity else 'neutral'
    normalized = []
    seen = set()

    if isinstance(raw_impacts, list):
        for item in raw_impacts:
            if not isinstance(item, dict):
                continue
            sector = (item.get('sector') or item.get('name') or '').strip()
            if not sector or sector in seen:
                continue
            sector_polarity = (item.get('polarity') or '').strip().lower()
            if sector_polarity not in valid_polarity:
                sector_polarity = polarity
            seen.add(sector)
            normalized.append({
                'sector': sector,
                'polarity': sector_polarity,
            })

    for sector in sectors:
        sector_name = (sector or '').strip()
        if not sector_name or sector_name in seen:
            continue
        seen.add(sector_name)
        normalized.append({
            'sector': sector_name,
            'polarity': polarity,
        })

    return normalized[:6]


def _extract_stock_candidates(text: str) -> list[dict]:
    result = []
    seen = set()
    pattern = re.compile(r'([\u4e00-\u9fa5A-Za-z]{2,12})\s*[\(（]\s*(\d{6})\s*[\)）]')
    for name, code in pattern.findall(text or ''):
        key = (name, code)
        if key in seen:
            continue
        seen.add(key)
        result.append({'name': name, 'code': code})
        if len(result) >= 5:
            break
    return result


def _build_rule_based_layer1_results(news_items: list[dict], background_context_by_news_id: dict, reason: str):
    results = []
    for item in news_items:
        news_id = str(item.get('news_id', ''))
        title = (item.get('title') or '').strip()
        content = (item.get('content') or '').strip()
        merged_text = f'{title} {content}'.strip()
        context_payload = background_context_by_news_id.get(news_id, {'sources': [], 'evidence': []})
        evidence = context_payload.get('evidence', [])
        background_text = ''
        if evidence:
            background_text = (evidence[0].get('text') or '').replace('\n', ' ').strip()[:220]
        if not background_text:
            background_text = (content[:180] if content else '') or '暂无补充背景。'
        summary = title[:40] if title else (content[:40] if content else '暂无摘要')
        sentiment = analyze_sentiment(merged_text) or 'neutral'
        impact_level = _infer_impact_level(merged_text)
        sectors = _infer_sectors(merged_text)
        sector_impacts = _normalize_sector_impacts([], sectors, sentiment)
        background_sources = [entry.get('url', '') for entry in context_payload.get('sources', []) if entry.get('url')]
        sector_text = '、'.join([item['sector'] for item in sector_impacts][:3]) or '相关板块'
        impact_analysis = (
            f"短期情绪：该消息对{sector_text}的市场预期影响{sentiment_label(sentiment)}，"
            "盘中通常先反映在成交与板块联动强度上，若缺乏后续增量信息，情绪驱动可能衰减。\n\n"
            f"产业链与中期：需跟踪事件在{sector_text}的传导路径，包括供需、政策与盈利兑现节奏；"
            "若兑现不及预期，存在估值回撤与交易拥挤反身性风险。"
        )
        watch_points = [
            '观察盘中成交额与板块联动强度',
            '关注后续公告或数据兑现情况',
            '警惕预期过高后的回撤风险',
        ]

        results.append({
            'news_id': news_id,
            'sectors': [item['sector'] for item in sector_impacts],
            'sector_impacts': sector_impacts,
            'stocks': [],
            'sentiment': sentiment,
            'impact_level': impact_level,
            'summary': summary,
            'background': background_text,
            'background_sources': background_sources[:2],
            'impact_analysis': impact_analysis[:300],
            'watch_points': watch_points[:3],
            'tags': _infer_tags(merged_text),
            '_model': 'rules-fallback',
            '_tokens': 0,
            '_prompt_version': f'rules-fallback:{reason}',
            '_background_context': context_payload,
            '_background_sources': background_sources[:2],
        })
    return results


def news_global_prompt_v3() -> tuple[str, str]:
    prompt = """你是一位专业的中国A股市场金融分析师。请分析以下财经新闻，对每条新闻提取结构化信息。

对每条新闻，请返回以下JSON格式：
{
  "news_id": "原始ID",
  "sector_impacts": [{"sector": "受影响板块", "polarity": "bullish|bearish|neutral"}],
  "sectors": ["受影响板块（可选，若给出需与sector_impacts一致）"],
  "sentiment": "bullish|bearish|neutral",
  "impact_level": "major|moderate|minor",
  "summary": "一句话摘要（20~40字）",
  "background": "背景补充（120~220字，包含历史背景/关键数据/上下文）",
  "impact_analysis": "两段分析文本：第一段写短期情绪与盘面反馈，第二段写产业链传导、竞争格局与中长期变量（总长140~280字）",
  "watch_points": ["观察要点1", "观察要点2", "观察要点3"],
  "background_sources": ["用于背景补充的URL，可为空数组"],
  "tags": ["政策|财报|数据|行业|国际|其他"]
}

硬性规则：
- 只输出板块，不输出具体个股代码、个股推荐、目标价或买卖指令。
- impact_analysis 必须是“两个自然段”，段间用换行分隔：
  - 第一段聚焦：短期情绪、资金偏好、盘面弹性。
  - 第二段聚焦：产业链传导、竞争格局变化、兑现节奏与主要风险变量。
- 若新闻信息量不足，需明确“不确定性”和“待验证变量”，不能写成确定性结论。
- watch_points 最多3条，每条不超过24字，强调后续可观测变量。
- background_sources 仅返回确实使用过的URL，最多2条。
- 如果新闻与A股无关，sentiment=neutral，impact_level=minor。

请以JSON数组格式返回所有分析结果，不要包含其他文字。"""
    return prompt, 'builtin.news_global.v3'


def analyze_news_layer1(news_items: list[dict]) -> list[dict]:
    """
    Run Layer 1 global analysis on a batch of news items.
    Returns list of analysis result dicts.
    """
    model = _get_ai_config('ai_model_fast', os.getenv('AI_MODEL_FAST', 'gpt-4o-mini'))

    # Build batch prompt (with optional background context: metaso -> local fallback)
    news_text = ""
    background_context_by_news_id = {}
    for i, item in enumerate(news_items):
        title = (item.get('title') or '')[:180]
        content = (item.get('content') or '')[:800]
        news_id = item.get('news_id')
        should_enrich_background = False
        if background_enrichment_enabled():
            estimated_impact = _infer_impact_level(f'{title} {content}'.strip())
            should_enrich_background = (not metaso_high_impact_only()) or estimated_impact == 'major'
        context_payload = build_news_background_context(item) if should_enrich_background else {'sources': [], 'evidence': []}
        if news_id:
            background_context_by_news_id[str(news_id)] = context_payload

        evidence_lines = []
        for index, evidence in enumerate(context_payload.get('evidence', []), start=1):
            evidence_lines.append(
                f"[ref{index}] 标题: {evidence.get('title', '')}\n"
                f"URL: {evidence.get('url', '')}\n"
                f"内容摘录: {(evidence.get('text', '') or '')[:420]}"
            )
        evidence_block = "\n\n".join(evidence_lines) if evidence_lines else "无可用联网背景。"

        news_text += (
            f"\n---NEWS_{i+1}---\n"
            f"ID: {news_id}\n"
            f"标题: {title}\n"
            f"内容: {content}\n"
            f"联网背景候选:\n{evidence_block}\n"
        )

    if not get_ai_runtime_config():
        return _build_rule_based_layer1_results(news_items, background_context_by_news_id, 'missing_client')

    system_prompt, prompt_version = news_global_prompt_v3()

    try:
        ai_output = call_ai_text(
            system_prompt=system_prompt,
            user_prompt=f"请分析以下{len(news_items)}条新闻：\n{news_text}",
            model=model,
            temperature=0.3,
        )
        if not ai_output:
            raise RuntimeError('all ai endpoints failed')

        result_text = ai_output['text']
        token_count = ai_output['tokens']

        # Parse JSON response
        raw_text = (result_text or '').strip()
        if raw_text.startswith('```'):
            raw_text = raw_text.strip('`')
            if raw_text.startswith('json'):
                raw_text = raw_text[4:].strip()
        parsed = json.loads(raw_text)
        results = parsed if isinstance(parsed, list) else parsed.get('results', parsed.get('analyses', [parsed]))

        # Attach metadata
        for r in results:
            news_id = str(r.get('news_id')) if r.get('news_id') is not None else ''
            background_context = background_context_by_news_id.get(news_id, {'sources': [], 'evidence': []})
            model_sources = r.get('background_sources')
            if not isinstance(model_sources, list):
                model_sources = []
            if not model_sources:
                model_sources = [entry.get('url', '') for entry in background_context.get('sources', []) if entry.get('url')]

            background_text = (r.get('background') or '').strip()
            if background_text:
                r['background'] = background_text[:320]

            impact_analysis = r.get('impact_analysis')
            if not isinstance(impact_analysis, str) or not impact_analysis.strip():
                impact_analysis = (
                    f"短期情绪：该消息对相关板块情绪影响{sentiment_label(r.get('sentiment'))}，"
                    "需结合量能、盘口强弱与资金偏好确认持续性。\n\n"
                    "中期传导：重点跟踪政策/供需/盈利兑现链条，若后续数据与预期背离，"
                    "可能触发估值回撤与交易拥挤风险释放。"
                )
            r['impact_analysis'] = impact_analysis.strip()[:320]

            watch_points = r.get('watch_points')
            if not isinstance(watch_points, list):
                watch_points = []
            cleaned_watch_points = [
                str(item).strip()[:60]
                for item in watch_points
                if isinstance(item, str) and item.strip()
            ][:4]
            if not cleaned_watch_points:
                cleaned_watch_points = [
                    '观察成交与板块联动是否持续',
                    '关注后续公告或数据兑现',
                    '警惕情绪回落导致波动放大',
                ]
            r['watch_points'] = cleaned_watch_points

            r['_model'] = f'{model}@{ai_output["endpoint"]}'
            r['_tokens'] = token_count // len(news_items) if news_items else 0
            r['_prompt_version'] = prompt_version
            r['_background_context'] = background_context
            r['_background_sources'] = model_sources[:2]

        return results
    except Exception as exc:
        print(f"[AI] Layer 1 analysis error: {exc}")
        return _build_rule_based_layer1_results(news_items, background_context_by_news_id, 'ai_error')


def _extract_stock_match_keys(stock: dict):
    keys = set()
    if not isinstance(stock, dict):
        return keys
    stock_name = (stock.get('name') or '').strip().lower()
    stock_code = (stock.get('code') or '').strip()

    if stock_name:
        keys.add(stock_name)

    if stock_code:
        parsed = parse_stock_code_info(stock_code)
        normalized = parsed['normalized_code'] if parsed else stock_code.strip().upper()
        normalized_lower = normalized.lower()
        keys.add(normalized_lower)
        compact = re.sub(r'[^a-z0-9]', '', normalized_lower)
        if compact:
            keys.add(compact)
        suffix_match = re.search(r'(\d{6})$', normalized_lower)
        if suffix_match:
            keys.add(suffix_match.group(1))

    return keys


def _safe_parse_array(value):
    try:
        parsed = json.loads(value) if value else []
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def compute_user_relevance(news_analysis, user_id: int):
    """
    Match a news analysis against a user's holdings/watchlist.
    Returns a UserNewsRelevance object or None if no relevance.
    """
    holdings = FundHolding.query.filter_by(user_id=user_id).all()
    watchlist = WatchlistItem.query.filter_by(user_id=user_id).all()

    holding_keywords = set()
    watchlist_keywords = set()
    for fund in holdings:
        holding_keywords.update(fund.keyword_set())
    for item in watchlist:
        watchlist_keywords.update(item.keyword_set())

    if not holding_keywords and not watchlist_keywords:
        return None

    analysis_stocks = _safe_parse_array(news_analysis.stocks)
    analysis_sectors = _safe_parse_array(news_analysis.sectors)

    news = NewsCache.query.filter_by(news_id=news_analysis.news_id).first()
    news_text = ''
    if news:
        news_text = ((news.title or '') + (news.content or '') + (news.brief or '')).lower()

    matched_stocks = []
    matched_sectors = []
    matched_entities = []
    reason_codes = []
    score = 0.0

    holding_hit = False
    watchlist_hit = False
    holding_text_score = 0.0
    watchlist_text_score = 0.0

    matched_stock_keys = set()
    matched_sector_keys = set()
    entity_keys = set()

    def append_entity(entity: dict):
        key = (
            entity.get('scope'),
            entity.get('type'),
            (entity.get('name') or '').strip(),
            (entity.get('code') or '').strip(),
        )
        if key in entity_keys:
            return
        entity_keys.add(key)
        matched_entities.append(entity)

    for stock in analysis_stocks:
        if not isinstance(stock, dict):
            continue
        match_keys = _extract_stock_match_keys(stock)
        if not match_keys:
            continue

        stock_name = (stock.get('name') or stock.get('code') or '').strip()
        stock_code = (stock.get('code') or '').strip().upper()
        dedupe_key = stock_code or stock_name.lower()
        if not dedupe_key:
            continue

        if match_keys & holding_keywords and ('holding', dedupe_key) not in matched_stock_keys:
            matched_stock_keys.add(('holding', dedupe_key))
            holding_hit = True
            score += 0.30
            reason_codes.append('HOLDING_STOCK_MATCH')
            if stock_name:
                matched_stocks.append(stock_name)
            append_entity({
                'type': 'stock',
                'name': stock_name,
                'code': stock_code,
                'weight': 0.30,
                'scope': 'holding',
            })

        if match_keys & watchlist_keywords and ('watchlist', dedupe_key) not in matched_stock_keys:
            matched_stock_keys.add(('watchlist', dedupe_key))
            watchlist_hit = True
            score += 0.18
            reason_codes.append('WATCHLIST_STOCK_MATCH')
            if stock_name:
                matched_stocks.append(stock_name)
            append_entity({
                'type': 'stock',
                'name': stock_name,
                'code': stock_code,
                'weight': 0.18,
                'scope': 'watchlist',
            })

    for sector in analysis_sectors:
        if not isinstance(sector, str):
            continue
        sector_name = sector.strip()
        if not sector_name:
            continue
        sector_key = sector_name.lower()
        if sector_key in holding_keywords and ('holding', sector_key) not in matched_sector_keys:
            matched_sector_keys.add(('holding', sector_key))
            holding_hit = True
            score += 0.15
            reason_codes.append('HOLDING_SECTOR_MATCH')
            matched_sectors.append(sector_name)
            append_entity({
                'type': 'sector',
                'name': sector_name,
                'weight': 0.15,
                'scope': 'holding',
            })

        if sector_key in watchlist_keywords and ('watchlist', sector_key) not in matched_sector_keys:
            matched_sector_keys.add(('watchlist', sector_key))
            watchlist_hit = True
            score += 0.08
            reason_codes.append('WATCHLIST_SECTOR_MATCH')
            matched_sectors.append(sector_name)
            append_entity({
                'type': 'sector',
                'name': sector_name,
                'weight': 0.08,
                'scope': 'watchlist',
            })

    for keyword in sorted(holding_keywords):
        if not keyword or keyword not in news_text:
            continue
        if keyword in {item.lower() for item in matched_stocks if isinstance(item, str)}:
            continue
        if keyword in {item.lower() for item in matched_sectors if isinstance(item, str)}:
            continue
        delta = min(0.05, 0.20 - holding_text_score)
        if delta <= 0:
            break
        holding_text_score += delta
        holding_hit = True
        score += delta
        reason_codes.append('HOLDING_TEXT_MATCH')
        append_entity({
            'type': 'text',
            'name': keyword,
            'weight': round(delta, 3),
            'scope': 'holding',
        })

    for keyword in sorted(watchlist_keywords):
        if not keyword or keyword not in news_text:
            continue
        if keyword in {item.lower() for item in matched_stocks if isinstance(item, str)}:
            continue
        if keyword in {item.lower() for item in matched_sectors if isinstance(item, str)}:
            continue
        delta = min(0.03, 0.12 - watchlist_text_score)
        if delta <= 0:
            break
        watchlist_text_score += delta
        watchlist_hit = True
        score += delta
        reason_codes.append('WATCHLIST_TEXT_MATCH')
        append_entity({
            'type': 'text',
            'name': keyword,
            'weight': round(delta, 3),
            'scope': 'watchlist',
        })

    score = min(score, 1.0)
    if score <= 0:
        return None

    match_scope = 'none'
    if holding_hit and watchlist_hit:
        match_scope = 'mixed'
    elif holding_hit:
        match_scope = 'holding'
    elif watchlist_hit:
        match_scope = 'watchlist'

    if news_analysis.impact_level == 'major':
        if match_scope in {'holding', 'mixed'}:
            score = min(score * 1.5, 1.0)
            reason_codes.append('MAJOR_IMPACT_HOLDING_BONUS')
        elif match_scope == 'watchlist':
            score = min(score * 1.2, 1.0)
            reason_codes.append('MAJOR_IMPACT_WATCHLIST_BONUS')

    score = round(score, 3)
    level = relevance_level_from_score(score)

    return UserNewsRelevance(
        user_id=user_id,
        news_id=news_analysis.news_id,
        relevance_score=score,
        relevance_level=level,
        matched_stocks=json.dumps(sorted(set(matched_stocks)), ensure_ascii=False),
        matched_sectors=json.dumps(sorted(set(matched_sectors)), ensure_ascii=False),
        matched_entities=json.dumps(matched_entities, ensure_ascii=False),
        reason_codes=json.dumps(sorted(set(reason_codes)), ensure_ascii=False),
        computed_at=datetime.utcnow(),
    )


def should_trigger_personalized_insight(relevance: UserNewsRelevance | None, news_analysis: NewsAnalysis | None):
    if not relevance or not news_analysis:
        return False
    if relevance.relevance_score >= 0.55:
        return True
    if news_analysis.impact_level == 'major' and relevance.relevance_score >= 0.35:
        return True
    return False


def build_personalized_insight(news: NewsCache, analysis: NewsAnalysis, relevance: UserNewsRelevance):
    action_bias = 'hold'
    if analysis.sentiment == 'bullish' and relevance.relevance_score >= 0.55:
        action_bias = 'watch'
    elif analysis.sentiment == 'bearish' and relevance.relevance_score >= 0.55:
        action_bias = 'reduce'

    default_summary = f'{analysis.summary or "该新闻"}与您的关注资产存在相关性，建议结合盘中波动与仓位权重进一步判断。'
    default_risk = '若市场情绪快速反转，请优先控制仓位集中风险。'
    default_opportunity = '可将该新闻加入观察列表，结合后续公告与资金面信号再决策。'
    model_version = 'rules.v1'

    if get_ai_runtime_config() and is_ai_enabled():
        model = _get_ai_config('ai_model_fast', os.getenv('AI_MODEL_FAST', 'gpt-4o-mini'))
        prompt = (
            "你是一位基金组合顾问。请基于新闻全局分析结果和用户相关度，"
            "给出简短个性化解读，返回JSON对象，字段: personalSummary, riskHint, opportunityHint, actionBias, confidence。"
        )
        user_payload = {
            'newsTitle': news.title,
            'newsContent': (news.content or '')[:800],
            'globalAnalysis': analysis.to_dict(),
            'relevance': relevance.to_dict(),
        }
        try:
            ai_output = call_ai_text(
                system_prompt=prompt,
                user_prompt=json.dumps(user_payload, ensure_ascii=False),
                model=model,
                temperature=0.2,
            )
            if not ai_output:
                raise RuntimeError('all ai endpoints failed')
            content = ai_output['text'] or '{}'
            parsed = json.loads(content)
            default_summary = parsed.get('personalSummary') or default_summary
            default_risk = parsed.get('riskHint') or default_risk
            default_opportunity = parsed.get('opportunityHint') or default_opportunity
            action_bias = parsed.get('actionBias') or action_bias
            confidence = float(parsed.get('confidence', relevance.relevance_score))
            model_version = f'{model}@{ai_output["endpoint"]}'
            return {
                'personalSummary': default_summary,
                'riskHint': default_risk,
                'opportunityHint': default_opportunity,
                'actionBias': action_bias,
                'confidence': max(0.0, min(confidence, 1.0)),
                'modelVersion': model_version,
            }
        except Exception as exc:
            print(f'[AI] Personalized insight fallback: {exc}')

    return {
        'personalSummary': default_summary,
        'riskHint': default_risk,
        'opportunityHint': default_opportunity,
        'actionBias': action_bias,
        'confidence': relevance.relevance_score,
        'modelVersion': model_version,
    }


def get_user_keywords(user_id: int):
    funds = FundHolding.query.filter_by(user_id=user_id).all()
    keywords = set()
    for fund in funds:
        keywords.update(fund.keyword_set())
    return keywords


def is_relevant(news_item: dict, keywords: set[str]):
    if not keywords:
        return False
    content = (news_item.get('title', '') + news_item.get('content', '') + news_item.get('brief', '')).lower()
    for keyword in keywords:
        if keyword and keyword in content:
            return True
    return False


def generate_dingtalk_sign(secret: str):
    timestamp = str(round(time.time() * 1000))
    string_to_sign = f'{timestamp}\n{secret}'
    h = hmac.new(secret.encode('utf-8'), string_to_sign.encode('utf-8'), digestmod=hashlib.sha256).digest()
    sign = base64.b64encode(h).decode('utf-8')
    return timestamp, sign


def _sentiment_label(sentiment: str | None):
    if sentiment == 'bullish':
        return '利好'
    if sentiment == 'bearish':
        return '利空'
    return '中性'


def _impact_label(impact_level: str | None):
    if impact_level == 'major':
        return '重大'
    if impact_level == 'moderate':
        return '一般'
    return '轻微'


def _normalize_webhook_sector_impacts(sector_impacts):
    if not isinstance(sector_impacts, list):
        return []
    normalized = []
    seen = set()
    for item in sector_impacts:
        if not isinstance(item, dict):
            continue
        sector = (item.get('sector') or '').strip()
        if not sector or sector in seen:
            continue
        seen.add(sector)
        polarity = (item.get('polarity') or '').strip().lower()
        if polarity not in {'bullish', 'bearish', 'neutral'}:
            polarity = 'neutral'
        normalized.append({
            'sector': sector,
            'polarity': polarity,
        })
    return normalized[:6]


def build_webhook_payload(
    news_item: dict,
    is_highlighted: bool,
    sentiment: str | None,
    config: WebhookConfig,
    sector_impacts=None,
    impact_level: str | None = None,
    summary: str | None = None,
):
    title = news_item.get('title') or ''
    content = news_item.get('content') or news_item.get('brief', '') or ''

    match = re.match(r'^【(.*?)】', content)
    if match:
        content = content[match.end():].lstrip('，。！？：:, .\n')
        if not title:
            title = match.group(1)

    if not title:
        title = content[:20] + '...' if len(content) > 20 else content or '财联社快讯'

    date = datetime.fromtimestamp(news_item.get('ctime', time.time()))
    time_str = date.strftime('%H:%M:%S')

    highlight_text = '🔴 【持仓相关】' if is_highlighted else ''
    sentiment_label = _sentiment_label(sentiment)
    impact_label = _impact_label(impact_level)
    sector_items = _normalize_webhook_sector_impacts(sector_impacts)
    sector_text = '、'.join(f'{item["sector"]}({_sentiment_label(item["polarity"])})' for item in sector_items[:4])

    if config.url and 'oapi.dingtalk.com' in config.url:
        markdown_text = f"## {highlight_text}{title}\n\n**时间：** {time_str}\n\n**来源：** 财联社\n\n"
        markdown_text += f"**情绪：** {sentiment_label}\n\n"
        markdown_text += f"**影响级别：** {impact_label}\n\n"
        if sector_text:
            markdown_text += f"**板块影响：** {sector_text}\n\n"
        if summary:
            markdown_text += f"**解读摘要：** {summary[:120]}\n\n"
        markdown_text += f"---\n\n{content[:400]}"
        return {
            'msgtype': 'markdown',
            'markdown': {
                'title': title,
                'text': markdown_text,
            },
        }

    return {
        'type': 'news',
        'timestamp': int(time.time()),
        'data': {
            'id': str(news_item.get('id', news_item.get('ctime'))),
            'title': title,
            'content': content,
            'time': time_str,
            'source': '财联社',
            'isHighlighted': is_highlighted,
            'sentiment': sentiment,
            'sentimentLabel': sentiment_label,
            'impactLevel': impact_level or 'minor',
            'impactLabel': impact_label,
            'sectorImpacts': sector_items,
            'summary': (summary or '')[:200],
        },
    }


def send_webhook_message(
    news_item: dict,
    config: WebhookConfig,
    is_highlighted: bool,
    sentiment: str | None,
    sector_impacts=None,
    impact_level: str | None = None,
    summary: str | None = None,
):
    if not config.enabled or not config.url:
        return False

    payload = build_webhook_payload(
        news_item,
        is_highlighted,
        sentiment,
        config,
        sector_impacts=sector_impacts,
        impact_level=impact_level,
        summary=summary,
    )
    target_url = config.url
    headers = {'Content-Type': 'application/json'}

    if 'oapi.dingtalk.com' in target_url and config.secret:
        timestamp, sign = generate_dingtalk_sign(config.secret)
        parsed = urllib.parse.urlparse(target_url)
        query = urllib.parse.parse_qs(parsed.query)
        query['timestamp'] = [timestamp]
        query['sign'] = [sign]
        new_query = urllib.parse.urlencode(query, doseq=True)
        target_url = urllib.parse.urlunparse(parsed._replace(query=new_query))

    try:
        response = requests.post(target_url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json() if 'application/json' in response.headers.get('Content-Type', '') else None
        if data and data.get('errcode') not in (0, None):
            print(f"[Backend] DingTalk error: {data}")
            return False
        return True
    except Exception as exc:
        print(f"[Backend] Webhook send error: {exc}")
        return False


def get_user_webhook_cooldown_seconds(user_id: int, fallback_minutes: int | None):
    endpoint = (
        NotificationEndpoint.query
        .filter_by(user_id=user_id, channel_type='webhook', enabled=True)
        .order_by(NotificationEndpoint.updated_at.desc())
        .first()
    )
    if endpoint and endpoint.cooldown_sec:
        return max(NEWS_MIN_COOLDOWN_SECONDS, int(endpoint.cooldown_sec))
    fallback_seconds = int((fallback_minutes or 5) * 60)
    return max(NEWS_MIN_COOLDOWN_SECONDS, fallback_seconds)


portfolio_queue: 'queue.Queue[tuple[int, str]]' = queue.Queue()
portfolio_pending: set[str] = set()


def enqueue_portfolio_refresh(user_id: int, fund_code: str):
    key = f"{user_id}:{fund_code}"
    if key in portfolio_pending:
        return
    portfolio_queue.put((user_id, fund_code))
    portfolio_pending.add(key)


def fetch_fund_portfolio_codes(fund_code: str):
    url = f'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE={fund_code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0'
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            return []
        datas = data.get('Datas') if isinstance(data.get('Datas'), dict) else {}
        if datas.get('ETFCODE'):
            return fetch_fund_portfolio_codes(data['Datas']['ETFCODE'])
        if data.get('ErrCode') == 0 and datas.get('fundStocks'):
            return [item.get('GPJC') for item in datas['fundStocks'] if isinstance(item, dict) and item.get('GPJC')]
    except Exception as exc:
        print(f"[Backend] Portfolio fetch error for {fund_code}: {exc}")
    return []


def portfolio_worker():
    print('[Backend] Portfolio worker started')
    while True:
        key = None
        try:
            user_id, fund_code = portfolio_queue.get()
            key = f"{user_id}:{fund_code}"
            with app.app_context():
                fund = FundHolding.query.filter_by(user_id=user_id, code=fund_code).first()
                if not fund:
                    continue
                if normalize_instrument_type(fund.instrument_type) != 'fund':
                    continue
                keywords = fetch_fund_portfolio_codes(fund_code)
                if keywords:
                    fund.keywords = json.dumps(sorted(set(keywords)))
                    fund.last_keywords_at = datetime.utcnow()
                    db.session.commit()
                    print(f"[Backend] Updated keywords for {fund_code} ({len(keywords)})")
        except Exception as exc:
            print('[Backend] Portfolio worker error:', exc)
        finally:
            if key:
                portfolio_pending.discard(key)
            time.sleep(2)


def fetch_news():
    url = 'https://www.cls.cn/nodeapi/telegraphList'
    params = {
        'app': 'CailianpressWeb',
        'os': 'web',
        'refresh_type': '1',
        'order': '1',
        'rn': '50',
        'sv': '8.4.6',
    }
    headers = {
        'Referer': 'https://www.cls.cn/telegraph',
        'User-Agent': 'Mozilla/5.0',
    }
    try:
        response = requests.get(url, params=params, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
        if data.get('error') == 0 and data.get('data', {}).get('roll_data'):
            return data['data']['roll_data']
    except Exception as exc:
        print('[Backend] Fetch news error:', exc)
    return []


def news_worker():
    print('[Backend] News worker started')
    while True:
        try:
            news_items = fetch_news()
            if not news_items:
                time.sleep(NEWS_POLL_SECONDS)
                continue

            with app.app_context():
                # Step 1: Cache news items and queue for analysis
                for news in news_items:
                    news_id = str(news.get('id', news.get('ctime')))
                    title = news.get('title', '') or ''
                    content = news.get('content', '') or ''
                    brief = news.get('brief', '') or ''
                    ctime = int(news.get('ctime', int(time.time())))
                    published_at = datetime.fromtimestamp(ctime)
                    raw_json = json.dumps(news, ensure_ascii=False)
                    content_hash = build_content_hash(title, content)

                    try:
                        with db.session.begin_nested():
                            cached = NewsCache.query.filter_by(news_id=news_id).first()
                            if not cached:
                                cached = NewsCache(
                                    news_id=news_id,
                                    title=title,
                                    content=content,
                                    brief=brief,
                                    ctime=ctime,
                                    raw_json=raw_json,
                                )
                                db.session.add(cached)

                            news_item = NewsItem.query.filter_by(source='cls', external_id=news_id).first()
                            if not news_item:
                                news_item = NewsItem.query.filter_by(content_hash=content_hash).first()
                            if not news_item:
                                news_item = NewsItem(
                                    source='cls',
                                    external_id=news_id,
                                    title=title,
                                    content=content,
                                    brief=brief,
                                    published_at=published_at,
                                    raw_payload=raw_json,
                                    content_hash=content_hash,
                                    lang='zh-CN',
                                    status='active',
                                )
                                db.session.add(news_item)
                                db.session.flush()

                            event = NewsEvent.query.filter_by(event_key=content_hash).first()
                            if not event:
                                event = NewsEvent(
                                    event_key=content_hash,
                                    title=title[:255],
                                    event_type='telegraph',
                                    importance='normal',
                                    first_seen_at=published_at,
                                    last_seen_at=published_at,
                                )
                                db.session.add(event)
                                db.session.flush()
                            else:
                                event.last_seen_at = max(event.last_seen_at or published_at, published_at)

                            relation = NewsEventItem.query.filter_by(event_id=event.id, news_id=news_item.id).first()
                            if not relation:
                                relation = NewsEventItem(
                                    event_id=event.id,
                                    news_id=news_item.id,
                                    is_primary=True,
                                )
                                db.session.add(relation)

                            has_job = AnalysisJob.query.filter_by(job_type='global_news', news_id=news_id).filter(
                                AnalysisJob.status.in_(['pending', 'running', 'success'])
                            ).first()
                            if not has_job:
                                db.session.add(AnalysisJob(
                                    job_type='global_news',
                                    news_id=news_id,
                                    priority=5,
                                    status='pending',
                                    scheduled_at=datetime.utcnow(),
                                    payload_json=json.dumps({'source': 'cls'}, ensure_ascii=False),
                                ))

                        # Keep in-memory queue as low-latency fallback
                        if not NewsAnalysis.query.filter_by(news_id=news_id).first():
                            analysis_queue.put(news_id)
                    except IntegrityError as exc:
                        print(
                            f"[Backend] News worker skip duplicate news_id={news_id} "
                            f"content_hash={content_hash} error={exc.__class__.__name__}"
                        )
                        continue
                    except Exception as item_exc:
                        print(f"[Backend] News worker skip invalid item news_id={news_id}: {item_exc}")
                        continue

                db.session.commit()

                # Step 2: proactive webhook push based on analyzed results
                configs = WebhookConfig.query.filter_by(enabled=True).all()
                for config in configs:
                    cooldown = get_user_webhook_cooldown_seconds(config.user_id, config.interval_minutes)
                    for news in reversed(news_items):
                        news_id = str(news.get('id', news.get('ctime')))
                        news_ctime = int(news.get('ctime', 0) or 0)
                        if news_ctime > 0:
                            news_age_seconds = int(time.time()) - news_ctime
                            if news_age_seconds > NEWS_PUSH_MAX_AGE_SECONDS:
                                continue
                        if config.last_sent_time and news_ctime > 0:
                            if news_ctime <= int(config.last_sent_time.timestamp()):
                                continue
                        exists = SentNews.query.filter_by(user_id=config.user_id, news_id=news_id).first()
                        if exists:
                            continue
                        analysis = NewsAnalysis.query.filter_by(news_id=news_id).first()
                        if not analysis:
                            continue

                        relevance = UserNewsRelevance.query.filter_by(user_id=config.user_id, news_id=news_id).first()
                        relevance_score = relevance.relevance_score if relevance else 0.0
                        relevance_payload = relevance.to_dict() if relevance else {}
                        match_scope = relevance_payload.get('matchScope', 'none')
                        highlight = relevance_score > 0 and match_scope != 'none'

                        should_notify = False
                        if config.holdings_only:
                            should_notify = should_trigger_personalized_insight(relevance, analysis)
                            if not should_notify and not relevance:
                                # 兜底：当相关度尚未产出或基金关键词冷启动失败时，
                                # 仍允许中高影响新闻进入推送，避免“已启用但长期无消息”。
                                should_notify = analysis.impact_level in {'major', 'moderate'}
                        else:
                            should_notify = analysis.impact_level in {'major', 'moderate'}
                        if not should_notify:
                            continue

                        if cooldown and config.last_sent_time:
                            elapsed = (datetime.utcnow() - config.last_sent_time).total_seconds()
                            if elapsed < cooldown:
                                continue

                        global_payload = get_global_analysis_payload(news_id, analysis)
                        success = send_webhook_message(
                            news,
                            config,
                            highlight,
                            analysis.sentiment,
                            sector_impacts=global_payload.get('sectorImpacts', []),
                            impact_level=analysis.impact_level,
                            summary=analysis.summary,
                        )
                        if success:
                            sent = SentNews(user_id=config.user_id, news_id=news_id)
                            db.session.add(sent)
                            config.last_sent_time = datetime.utcnow()
                            config.sent_count = (config.sent_count or 0) + 1
                            db.session.commit()
                            print(f"[Backend] Sent news {news_id} to user {config.user_id}")

        except Exception as exc:
            print('[Backend] News worker error:', exc)
        finally:
            time.sleep(NEWS_POLL_SECONDS)


def analysis_worker():
    """Background worker that processes news through AI analysis pipeline."""
    print('[Backend] Analysis worker started')

    while True:
        try:
            with app.app_context():
                batch_size = int(_get_ai_config('ai_batch_size', '5') or '5')
                ai_enabled = is_ai_enabled()
                # Claim DB jobs first
                pending_jobs = (
                    AnalysisJob.query
                    .filter(AnalysisJob.status == 'pending')
                    .order_by(AnalysisJob.priority.asc(), AnalysisJob.scheduled_at.asc())
                    .limit(batch_size)
                    .all()
                )
                for job in pending_jobs:
                    job.status = 'running'
                    job.started_at = datetime.utcnow()
                db.session.commit()

                global_jobs = [job for job in pending_jobs if job.job_type == 'global_news']
                user_jobs = [job for job in pending_jobs if job.job_type == 'user_news_insight']
                if global_jobs:
                    deduped = {}
                    duplicates = []
                    for job in global_jobs:
                        dedupe_key = job.news_id or f'__global_job_{job.id}'
                        if dedupe_key in deduped:
                            duplicates.append(job)
                        else:
                            deduped[dedupe_key] = job
                    if duplicates:
                        now = datetime.utcnow()
                        for dup in duplicates:
                            dup.status = 'success'
                            dup.finished_at = now
                            dup.error_message = 'deduplicated-running-batch'
                        db.session.commit()
                    global_jobs = list(deduped.values())

                if user_jobs:
                    deduped = {}
                    duplicates = []
                    for job in user_jobs:
                        dedupe_key = (job.user_id, job.news_id)
                        if dedupe_key in deduped:
                            duplicates.append(job)
                        else:
                            deduped[dedupe_key] = job
                    if duplicates:
                        now = datetime.utcnow()
                        for dup in duplicates:
                            dup.status = 'success'
                            dup.finished_at = now
                            dup.error_message = 'deduplicated-running-batch'
                        db.session.commit()
                    user_jobs = list(deduped.values())

                # Fallback in-memory queue: convert to DB jobs
                if not pending_jobs:
                    fallback_ids = []
                    try:
                        first_id = analysis_queue.get(timeout=1)
                        fallback_ids.append(first_id)
                    except queue.Empty:
                        fallback_ids = []
                    while len(fallback_ids) < batch_size:
                        try:
                            fallback_ids.append(analysis_queue.get_nowait())
                        except queue.Empty:
                            break
                    for nid in fallback_ids:
                        existing = AnalysisJob.query.filter_by(job_type='global_news', news_id=nid).filter(
                            AnalysisJob.status.in_(['pending', 'running'])
                        ).first()
                        if existing:
                            continue
                        db.session.add(AnalysisJob(
                            job_type='global_news',
                            news_id=nid,
                            status='pending',
                            priority=5,
                            scheduled_at=datetime.utcnow(),
                            payload_json=json.dumps({'source': 'memory_queue'}, ensure_ascii=False),
                        ))
                    if fallback_ids:
                        db.session.commit()
                    time.sleep(1)
                    continue

                if global_jobs and not ai_enabled:
                    for job in global_jobs:
                        job.status = 'failed'
                        job.error_message = 'AI disabled'
                        job.finished_at = datetime.utcnow()
                    db.session.commit()
                    print('[AI] AI is disabled, global news jobs marked as failed')

                if global_jobs and ai_enabled:
                    news_batch = []
                    for job in global_jobs:
                        payload = parse_json_text(job.payload_json, {})
                        force_reanalyze = False
                        if isinstance(payload, dict):
                            force_reanalyze = (
                                payload.get('force_reanalyze') in (True, 'true', '1', 1)
                                or payload.get('forceReanalyze') in (True, 'true', '1', 1)
                                or payload.get('trigger') in {'manual_rerun_rich_background', 'manual_targeted_rerun'}
                            )
                        cached = NewsCache.query.filter_by(news_id=job.news_id).first()
                        if not cached:
                            job.status = 'failed'
                            job.error_message = 'news not found'
                            job.finished_at = datetime.utcnow()
                            continue
                        if NewsAnalysis.query.filter_by(news_id=job.news_id).first() and not force_reanalyze:
                            job.status = 'success'
                            job.finished_at = datetime.utcnow()
                            continue
                        news_batch.append({
                            'job': job,
                            'news': cached,
                            'payload': {
                                'news_id': cached.news_id,
                                'title': cached.title,
                                'content': cached.content,
                            },
                        })

                    if news_batch:
                        start_at = time.time()
                        results = analyze_news_layer1([item['payload'] for item in news_batch])
                        result_map = {item.get('news_id'): item for item in results if item.get('news_id')}

                        for item in news_batch:
                            job = item['job']
                            cached = item['news']
                            result = result_map.get(cached.news_id)
                            if not result:
                                job.status = 'failed'
                                job.error_message = 'analysis result missing'
                                job.retry_count = (job.retry_count or 0) + 1
                                job.finished_at = datetime.utcnow()
                                db.session.add(AnalysisJobRun(
                                    job_id=job.id,
                                    worker_id='analysis_worker',
                                    latency_ms=0,
                                    token_in=0,
                                    token_out=0,
                                    cost_estimate=0,
                                    status='failed',
                                    error_message='analysis result missing',
                                ))
                                continue

                            sectors = result.get('sectors', [])
                            sentiment = result.get('sentiment', 'neutral')
                            raw_sector_impacts = result.get('sector_impacts')
                            if not isinstance(raw_sector_impacts, list):
                                raw_sector_impacts = result.get('sectorImpacts')
                            sector_impacts = _normalize_sector_impacts(raw_sector_impacts, sectors, sentiment)
                            sectors = [item['sector'] for item in sector_impacts]
                            stocks = []
                            tags = result.get('tags', [])
                            summary = result.get('summary', '')
                            background = result.get('background', '')
                            impact_analysis = (result.get('impact_analysis') or '').strip()[:320]
                            watch_points = result.get('watch_points')
                            if not isinstance(watch_points, list):
                                watch_points = []
                            watch_points = [str(item)[:60] for item in watch_points if isinstance(item, str) and item.strip()][:4]
                            background_sources = result.get('background_sources')
                            if not isinstance(background_sources, list):
                                background_sources = result.get('_background_sources', [])
                            if not isinstance(background_sources, list):
                                background_sources = []
                            impact_level = result.get('impact_level', 'minor')
                            model_name = result.get('_model', '')
                            token_count = result.get('_tokens', 0)
                            prompt_version = result.get('_prompt_version', 'news_global.v1')

                            legacy_analysis = NewsAnalysis(
                                news_id=cached.news_id,
                                sectors=json.dumps(sectors, ensure_ascii=False),
                                stocks=json.dumps(stocks, ensure_ascii=False),
                                sentiment=sentiment,
                                impact_level=impact_level,
                                summary=summary,
                                background=background,
                                tags=json.dumps(tags, ensure_ascii=False),
                                model_used=model_name,
                                token_count=token_count,
                            )
                            db.session.merge(legacy_analysis)

                            news_item = NewsItem.query.filter_by(source='cls', external_id=cached.news_id).first()
                            if news_item:
                                global_analysis = NewsGlobalAnalysis(
                                    news_id=news_item.id,
                                    sentiment=sentiment,
                                    impact_level=impact_level,
                                    summary=summary,
                                    background=background,
                                    confidence=0.7 if impact_level == 'major' else 0.55,
                                    model_provider='openai-compatible',
                                    model_name=model_name,
                                    model_version='v1',
                                    prompt_version=prompt_version,
                                    analysis_json=json.dumps({
                                        'sectors': sectors,
                                        'stocks': [],
                                        'sectorImpacts': sector_impacts,
                                        'tags': tags,
                                        'backgroundSources': background_sources[:2],
                                        'impactAnalysis': impact_analysis,
                                        'watchPoints': watch_points,
                                    }, ensure_ascii=False),
                                    status='success',
                                    analyzed_at=datetime.utcnow(),
                                )
                                db.session.merge(global_analysis)

                                NewsAnalysisEntity.query.filter_by(news_id=news_item.id).delete()
                                entity_candidates = []
                                for sector in sectors:
                                    if not sector:
                                        continue
                                    entity = Entity.query.filter_by(entity_type='sector', entity_name=sector).first()
                                    if not entity:
                                        entity = Entity(entity_type='sector', entity_name=sector, aliases='[]')
                                        db.session.add(entity)
                                        db.session.flush()
                                    entity_candidates.append((entity.id, 'sector', sector))
                                for stock in stocks:
                                    name = stock.get('name', '')
                                    code = stock.get('code', '')
                                    if not name:
                                        continue
                                    entity = Entity.query.filter_by(entity_type='stock', entity_code=code, entity_name=name).first()
                                    if not entity:
                                        entity = Entity(entity_type='stock', entity_code=code, entity_name=name, aliases='[]')
                                        db.session.add(entity)
                                        db.session.flush()
                                    entity_candidates.append((entity.id, 'stock', name))

                                for entity_id, entity_type, evidence_name in entity_candidates:
                                    db.session.add(NewsAnalysisEntity(
                                        news_id=news_item.id,
                                        entity_id=entity_id,
                                        polarity=sentiment,
                                        weight=0.3 if entity_type == 'stock' else 0.15,
                                        evidence_text=f'{entity_type}:{evidence_name}',
                                    ))

                            users = User.query.filter_by(status='active').all()
                            generated_at = datetime.utcnow()
                            created_insight_jobs = 0
                            for user in users:
                                relevance = UserNewsRelevance.query.filter_by(user_id=user.id, news_id=cached.news_id).first()
                                if not relevance:
                                    relevance = compute_user_relevance(legacy_analysis, user.id)
                                    if relevance:
                                        db.session.add(relevance)

                                if relevance and should_trigger_personalized_insight(relevance, legacy_analysis):
                                    existing_insight_job = AnalysisJob.query.filter_by(
                                        job_type='user_news_insight',
                                        news_id=cached.news_id,
                                        user_id=user.id
                                    ).filter(AnalysisJob.status.in_(['pending', 'running', 'success'])).first()
                                    if not existing_insight_job:
                                        db.session.add(AnalysisJob(
                                            job_type='user_news_insight',
                                            news_id=cached.news_id,
                                            user_id=user.id,
                                            status='pending',
                                            priority=7,
                                            scheduled_at=generated_at,
                                            payload_json=json.dumps({'trigger': 'relevance_threshold'}, ensure_ascii=False),
                                        ))
                                        created_insight_jobs += 1

                            latency_ms = int((time.time() - start_at) * 1000)
                            db.session.add(AnalysisJobRun(
                                job_id=job.id,
                                worker_id='analysis_worker',
                                latency_ms=latency_ms,
                                token_in=0,
                                token_out=token_count,
                                cost_estimate=0,
                                status='success',
                                error_message=f'created_insight_jobs={created_insight_jobs}',
                            ))
                            job.status = 'success'
                            job.finished_at = datetime.utcnow()
                            job.error_message = None

                    db.session.commit()

                if user_jobs:
                    for job in user_jobs:
                        start_at = time.time()
                        cached = NewsCache.query.filter_by(news_id=job.news_id).first()
                        analysis = NewsAnalysis.query.filter_by(news_id=job.news_id).first()
                        relevance = UserNewsRelevance.query.filter_by(user_id=job.user_id, news_id=job.news_id).first()
                        if not cached or not analysis or not relevance:
                            job.status = 'failed'
                            job.error_message = 'missing dependency'
                            job.retry_count = (job.retry_count or 0) + 1
                            job.finished_at = datetime.utcnow()
                            db.session.add(AnalysisJobRun(
                                job_id=job.id,
                                worker_id='analysis_worker',
                                latency_ms=0,
                                status='failed',
                                error_message='missing dependency',
                            ))
                            continue

                        insight_payload = build_personalized_insight(cached, analysis, relevance)
                        insight = UserNewsPersonalizedInsight.query.filter_by(user_id=job.user_id, news_id=job.news_id).first()
                        if not insight:
                            insight = UserNewsPersonalizedInsight(user_id=job.user_id, news_id=job.news_id)
                            db.session.add(insight)
                        insight.personal_summary = insight_payload['personalSummary']
                        insight.risk_hint = insight_payload['riskHint']
                        insight.opportunity_hint = insight_payload['opportunityHint']
                        insight.action_bias = insight_payload['actionBias']
                        insight.confidence = insight_payload['confidence']
                        insight.model_version = insight_payload['modelVersion']

                        job.status = 'success'
                        job.finished_at = datetime.utcnow()
                        job.error_message = None
                        db.session.add(AnalysisJobRun(
                            job_id=job.id,
                            worker_id='analysis_worker',
                            latency_ms=int((time.time() - start_at) * 1000),
                            status='success',
                        ))

                    db.session.commit()

        except Exception as exc:
            print(f'[AI] Analysis worker error: {exc}')
            time.sleep(5)


def apply_transaction(fund: FundHolding, tx: Transaction, reverse: bool = False):
    multiplier = -1 if reverse else 1
    if tx.type == 'buy':
        fund.shares += multiplier * tx.shares
        fund.cost += multiplier * tx.amount
    else:
        if reverse:
            # revert sell
            fund.shares += tx.shares
            shares_before = fund.shares - tx.shares
            if shares_before > 0:
                cost_per_share = fund.cost / shares_before if shares_before else 0
                fund.cost = cost_per_share * fund.shares
            else:
                fund.cost += tx.amount
        else:
            fund.shares -= tx.shares
            shares_before = fund.shares + tx.shares
            if shares_before > 0:
                cost_per_share = fund.cost / shares_before
                fund.cost -= cost_per_share * tx.shares
    fund.shares = max(fund.shares, 0)
    fund.cost = max(fund.cost, 0)


def ensure_notification_endpoint_from_legacy(user_id: int):
    endpoint = (
        NotificationEndpoint.query
        .filter_by(user_id=user_id, channel_type='webhook')
        .order_by(NotificationEndpoint.updated_at.desc())
        .first()
    )
    if endpoint:
        return endpoint

    legacy = WebhookConfig.query.filter_by(user_id=user_id).first()
    if not legacy or not legacy.url:
        return None

    endpoint = NotificationEndpoint(
        user_id=user_id,
        channel_type='webhook',
        endpoint_url=legacy.url,
        secret_ciphertext=legacy.secret,
        enabled=bool(legacy.enabled),
        cooldown_sec=max(NEWS_MIN_COOLDOWN_SECONDS, int((legacy.interval_minutes or 5) * 60)),
        quiet_hours=json.dumps({}, ensure_ascii=False),
    )
    db.session.add(endpoint)
    db.session.commit()
    return endpoint


def sync_legacy_webhook_from_endpoint(user_id: int, endpoint: NotificationEndpoint | None):
    legacy = WebhookConfig.query.filter_by(user_id=user_id).first()
    if not legacy:
        legacy = WebhookConfig(user_id=user_id)
        db.session.add(legacy)

    if endpoint:
        was_enabled = bool(legacy.enabled)
        previous_url = legacy.url or ''
        legacy.url = endpoint.endpoint_url
        legacy.secret = endpoint.secret_ciphertext
        legacy.enabled = bool(endpoint.enabled)
        legacy.holdings_only = True
        legacy.interval_minutes = max(1, int((endpoint.cooldown_sec or 300) / 60))
        if legacy.enabled and (not was_enabled or previous_url != (endpoint.endpoint_url or '') or not legacy.last_sent_time):
            legacy.last_sent_time = datetime.utcnow()
    else:
        legacy.enabled = False


def default_notification_rules(user_id: int):
    return [
        NotificationRule(
            user_id=user_id,
            rule_type='high_relevance',
            rule_params=json.dumps({'minRelevance': 0.55, 'impactLevel': 'major'}, ensure_ascii=False),
            priority=1,
            enabled=True,
        ),
        NotificationRule(
            user_id=user_id,
            rule_type='major_impact',
            rule_params=json.dumps({'impactLevel': 'major', 'minRelevance': 0.35}, ensure_ascii=False),
            priority=2,
            enabled=True,
        ),
    ]


@app.post('/api/auth/register')
def register():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    name = (data.get('name') or '投资者').strip() or '投资者'

    if not email or not password:
        return jsonify({'error': '邮箱和密码不能为空'}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': '邮箱已注册'}), 409

    role = 'admin' if email in ADMIN_EMAILS else 'user'
    user = User(email=email, name=name, password_hash=generate_password_hash(password), role=role, status='active')
    user.last_login_at = datetime.utcnow()
    db.session.add(user)
    db.session.commit()
    token = create_token(user)
    return jsonify({'token': token, 'user': user.to_dict()})


@app.post('/api/auth/login')
def login():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': '账号或密码错误'}), 401

    if email in ADMIN_EMAILS and (user.role or 'user') != 'admin':
        user.role = 'admin'
    user.last_login_at = datetime.utcnow()
    db.session.commit()

    token = create_token(user)
    return jsonify({'token': token, 'user': user.to_dict()})


@app.get('/api/auth/me')
@auth_required
def me():
    return jsonify({'user': g.current_user.to_dict()})


@app.get('/api/funds')
@auth_required
def list_funds():
    funds = FundHolding.query.filter_by(user_id=g.current_user.id).order_by(FundHolding.sort_order).all()
    return jsonify({'funds': [fund_to_dict(f) for f in funds]})


@app.post('/api/funds')
@auth_required
def create_fund():
    data = request.get_json() or {}
    try:
        holding = parse_holding_payload(data)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    shares = max(0, float(data.get('shares') or 0))
    cost = max(0, float(data.get('cost') or 0))

    existing = find_holding_conflict(
        user_id=g.current_user.id,
        instrument_type=holding['instrument_type'],
        code=holding['code'],
    )
    if existing:
        return jsonify({'error': '该持仓代码已存在'}), 409

    watch_conflict = find_watchlist_conflict(
        user_id=g.current_user.id,
        instrument_type=holding['instrument_type'],
        code=holding['code'],
    )
    if watch_conflict:
        return jsonify({'error': '该标的已在自选中，请先转持仓或删除自选'}), 409

    count = FundHolding.query.filter_by(user_id=g.current_user.id).count()
    fund = FundHolding(
        user_id=g.current_user.id,
        instrument_type=holding['instrument_type'],
        market=holding['market'],
        code=holding['code'],
        name=holding['name'],
        shares=shares,
        cost=cost,
        sort_order=count,
    )
    db.session.add(fund)
    db.session.commit()
    if fund.instrument_type == 'fund':
        enqueue_portfolio_refresh(g.current_user.id, fund.code)
    return jsonify({'fund': fund_to_dict(fund)})


@app.put('/api/funds/<int:fund_id>')
@auth_required
def update_fund(fund_id):
    fund = FundHolding.query.filter_by(id=fund_id, user_id=g.current_user.id).first()
    if not fund:
        return jsonify({'error': '持仓不存在'}), 404
    data = request.get_json() or {}
    if 'name' in data:
        fund.name = data['name'] or fund.name
    if 'shares' in data:
        fund.shares = max(0, float(data['shares']))
    if 'cost' in data:
        fund.cost = max(0, float(data['cost']))
    if 'sortOrder' in data:
        fund.sort_order = int(data['sortOrder'])
    should_parse_asset = (
        ('code' in data and data.get('code'))
        or ('instrumentType' in data)
        or ('instrument_type' in data)
    )
    if should_parse_asset:
        payload = dict(data)
        if not payload.get('code'):
            payload['code'] = fund.code
        if not payload.get('name'):
            payload['name'] = fund.name
        try:
            holding = parse_holding_payload(payload, default_instrument_type=fund.instrument_type)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        if holding['code'] != fund.code or holding['instrument_type'] != normalize_instrument_type(fund.instrument_type):
            duplicate = find_holding_conflict(
                user_id=g.current_user.id,
                instrument_type=holding['instrument_type'],
                code=holding['code'],
                exclude_fund_id=fund.id,
            )
            if duplicate:
                return jsonify({'error': '该持仓代码已存在'}), 409
            watch_conflict = find_watchlist_conflict(
                user_id=g.current_user.id,
                instrument_type=holding['instrument_type'],
                code=holding['code'],
            )
            if watch_conflict:
                return jsonify({'error': '该标的已在自选中，请先转持仓或删除自选'}), 409
        fund.code = holding['code']
        fund.instrument_type = holding['instrument_type']
        fund.market = holding['market']
        if fund.instrument_type == 'fund':
            enqueue_portfolio_refresh(g.current_user.id, fund.code)
    db.session.commit()
    return jsonify({'fund': fund_to_dict(fund)})


@app.delete('/api/funds/<int:fund_id>')
@auth_required
def delete_fund(fund_id):
    fund = FundHolding.query.filter_by(id=fund_id, user_id=g.current_user.id).first()
    if not fund:
        return jsonify({'error': '持仓不存在'}), 404
    db.session.delete(fund)
    db.session.commit()
    return jsonify({'success': True})


@app.post('/api/funds/<int:fund_id>/transactions')
@auth_required
def create_transaction(fund_id):
    fund = FundHolding.query.filter_by(id=fund_id, user_id=g.current_user.id).first()
    if not fund:
        return jsonify({'error': '持仓不存在'}), 404

    data = request.get_json() or {}
    tx_type = data.get('type')
    shares = float(data.get('shares') or 0)
    price = float(data.get('price') or 0)
    date = data.get('date') or datetime.utcnow().strftime('%Y-%m-%d')
    note = data.get('note')

    if tx_type not in {'buy', 'sell'}:
        return jsonify({'error': '无效的交易类型'}), 400
    if shares <= 0:
        return jsonify({'error': '份额必须大于0'}), 400

    amount = shares * price
    tx = Transaction(fund_id=fund.id, type=tx_type, shares=shares, price=price, amount=amount, date=date, note=note)
    apply_transaction(fund, tx)
    db.session.add(tx)
    db.session.commit()
    return jsonify({'fund': fund_to_dict(fund)})


@app.delete('/api/funds/<int:fund_id>/transactions/<int:tx_id>')
@auth_required
def delete_transaction(fund_id, tx_id):
    fund = FundHolding.query.filter_by(id=fund_id, user_id=g.current_user.id).first()
    if not fund:
        return jsonify({'error': '持仓不存在'}), 404
    tx = Transaction.query.filter_by(id=tx_id, fund_id=fund.id).first()
    if not tx:
        return jsonify({'error': '交易不存在'}), 404
    apply_transaction(fund, tx, reverse=True)
    db.session.delete(tx)
    db.session.commit()
    return jsonify({'fund': fund_to_dict(fund)})


@app.post('/api/funds/import')
@auth_required
def import_funds():
    data = request.get_json() or {}
    funds_data = data.get('funds')
    if not isinstance(funds_data, list):
        return jsonify({'error': '数据格式错误'}), 400

    FundHolding.query.filter_by(user_id=g.current_user.id).delete()
    db.session.commit()

    created = []
    for idx, payload in enumerate(funds_data):
        try:
            holding = parse_holding_payload(payload)
        except ValueError:
            continue
        remove_watchlist_conflict(g.current_user.id, holding['instrument_type'], holding['code'])
        fund = FundHolding(
            user_id=g.current_user.id,
            instrument_type=holding['instrument_type'],
            market=holding['market'],
            code=holding['code'],
            name=holding['name'],
            shares=float(payload.get('shares') or 0),
            cost=float(payload.get('cost') or 0),
            sort_order=idx,
            added_at=datetime.utcnow(),
        )
        db.session.add(fund)
        db.session.flush()

        for tx_data in payload.get('transactions', []):
            tx = Transaction(
                fund_id=fund.id,
                type=tx_data.get('type', 'buy'),
                shares=float(tx_data.get('shares') or 0),
                price=float(tx_data.get('price') or 0),
                amount=float(tx_data.get('amount') or 0),
                date=tx_data.get('date') or datetime.utcnow().strftime('%Y-%m-%d'),
                note=tx_data.get('note'),
            )
            db.session.add(tx)

        created.append(fund)

    db.session.commit()
    for fund in created:
        if normalize_instrument_type(fund.instrument_type) == 'fund':
            enqueue_portfolio_refresh(g.current_user.id, fund.code)
    return jsonify({'count': len(created)})


@app.get('/api/funds/export')
@auth_required
def export_funds():
    funds = FundHolding.query.filter_by(user_id=g.current_user.id).order_by(FundHolding.sort_order).all()
    payload = {
        'funds': [fund_to_dict(f) for f in funds],
        'exportedAt': datetime.utcnow().isoformat(),
        'version': '2.0',
    }
    return jsonify(payload)


@app.get('/api/watchlist')
@auth_required
def list_watchlist():
    items = (
        WatchlistItem.query
        .filter_by(user_id=g.current_user.id)
        .order_by(WatchlistItem.sort_order.asc(), WatchlistItem.added_at.asc())
        .all()
    )
    return jsonify({'items': [watchlist_to_dict(item) for item in items]})


@app.post('/api/watchlist')
@auth_required
def create_watchlist_item():
    data = request.get_json() or {}
    try:
        holding = parse_holding_payload(data)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    holding_conflict = find_holding_conflict(
        user_id=g.current_user.id,
        instrument_type=holding['instrument_type'],
        code=holding['code'],
    )
    if holding_conflict:
        return jsonify({'error': '该标的已在持仓中'}), 409

    watchlist_conflict = find_watchlist_conflict(
        user_id=g.current_user.id,
        instrument_type=holding['instrument_type'],
        code=holding['code'],
    )
    if watchlist_conflict:
        return jsonify({'error': '该标的已在自选中'}), 409

    sort_order = WatchlistItem.query.filter_by(user_id=g.current_user.id).count()
    item = WatchlistItem(
        user_id=g.current_user.id,
        instrument_type=holding['instrument_type'],
        market=holding['market'],
        code=holding['code'],
        name=holding['name'],
        sort_order=sort_order,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({'item': watchlist_to_dict(item)})


@app.put('/api/watchlist/<int:item_id>')
@auth_required
def update_watchlist_item(item_id):
    item = WatchlistItem.query.filter_by(id=item_id, user_id=g.current_user.id).first()
    if not item:
        return jsonify({'error': '自选不存在'}), 404

    data = request.get_json() or {}

    should_parse_asset = (
        ('code' in data and data.get('code'))
        or ('instrumentType' in data)
        or ('instrument_type' in data)
    )
    if should_parse_asset:
        payload = dict(data)
        if not payload.get('code'):
            payload['code'] = item.code
        if not payload.get('name'):
            payload['name'] = item.name
        try:
            parsed = parse_holding_payload(payload, default_instrument_type=item.instrument_type)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        changed = (
            parsed['code'] != item.code
            or parsed['instrument_type'] != normalize_instrument_type(item.instrument_type)
        )
        if changed:
            holding_conflict = find_holding_conflict(
                user_id=g.current_user.id,
                instrument_type=parsed['instrument_type'],
                code=parsed['code'],
            )
            if holding_conflict:
                return jsonify({'error': '该标的已在持仓中'}), 409
            watchlist_conflict = find_watchlist_conflict(
                user_id=g.current_user.id,
                instrument_type=parsed['instrument_type'],
                code=parsed['code'],
                exclude_item_id=item.id,
            )
            if watchlist_conflict:
                return jsonify({'error': '该标的已在自选中'}), 409

        item.instrument_type = parsed['instrument_type']
        item.market = parsed['market']
        item.code = parsed['code']

    if 'name' in data:
        item.name = (data.get('name') or '').strip() or item.code
    if 'sortOrder' in data:
        try:
            item.sort_order = int(data.get('sortOrder') or 0)
        except (TypeError, ValueError):
            return jsonify({'error': 'sortOrder 格式错误'}), 400

    item.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'item': watchlist_to_dict(item)})


@app.delete('/api/watchlist/<int:item_id>')
@auth_required
def delete_watchlist_item(item_id):
    item = WatchlistItem.query.filter_by(id=item_id, user_id=g.current_user.id).first()
    if not item:
        return jsonify({'error': '自选不存在'}), 404
    db.session.delete(item)
    db.session.commit()
    return jsonify({'success': True})


@app.post('/api/watchlist/<int:item_id>/convert')
@auth_required
def convert_watchlist_item(item_id):
    item = WatchlistItem.query.filter_by(id=item_id, user_id=g.current_user.id).first()
    if not item:
        return jsonify({'error': '自选不存在'}), 404

    data = request.get_json() or {}
    shares = safe_float(data.get('shares'), -1)
    cost = safe_float(data.get('cost'), -1)
    if shares <= 0:
        return jsonify({'error': '持有份额必须大于0'}), 400
    if cost < 0:
        return jsonify({'error': '持仓成本不能为负数'}), 400

    instrument_type = normalize_instrument_type(item.instrument_type)
    duplicate = find_holding_conflict(
        user_id=g.current_user.id,
        instrument_type=instrument_type,
        code=item.code,
    )
    if duplicate:
        return jsonify({'error': '该标的已在持仓中'}), 409

    sort_order = FundHolding.query.filter_by(user_id=g.current_user.id).count()
    fund = FundHolding(
        user_id=g.current_user.id,
        instrument_type=instrument_type,
        market=item.market,
        code=item.code,
        name=item.name or item.code,
        shares=shares,
        cost=cost,
        sort_order=sort_order,
        added_at=datetime.utcnow(),
    )
    db.session.add(fund)
    db.session.delete(item)
    db.session.commit()

    if instrument_type == 'fund':
        enqueue_portfolio_refresh(g.current_user.id, fund.code)
    return jsonify({'fund': fund_to_dict(fund)})


@app.get('/api/webhook')
@auth_required
def get_webhook():
    config = WebhookConfig.query.filter_by(user_id=g.current_user.id).first()
    if not config:
        config = WebhookConfig(user_id=g.current_user.id)
        db.session.add(config)
        db.session.commit()

    endpoint = (
        NotificationEndpoint.query
        .filter_by(user_id=g.current_user.id, channel_type='webhook')
        .order_by(NotificationEndpoint.updated_at.desc())
        .first()
    )
    if endpoint:
        config.url = endpoint.endpoint_url or config.url
        config.secret = endpoint.secret_ciphertext or config.secret
        config.enabled = bool(endpoint.enabled)
        config.interval_minutes = max(1, int((endpoint.cooldown_sec or 300) / 60))
        db.session.commit()

    data = config.to_dict()
    data['keywordsTracked'] = len(get_user_keywords(g.current_user.id))
    return jsonify({'config': data})


@app.put('/api/webhook')
@auth_required
def update_webhook():
    config = WebhookConfig.query.filter_by(user_id=g.current_user.id).first()
    if not config:
        config = WebhookConfig(user_id=g.current_user.id)
        db.session.add(config)
    data = request.get_json() or {}
    if 'url' in data:
        config.url = data['url']
    if 'secret' in data:
        config.secret = data['secret']
    if 'enabled' in data:
        config.enabled = bool(data['enabled'])
    if 'holdingsOnly' in data:
        config.holdings_only = bool(data['holdingsOnly'])
    if 'interval' in data:
        config.interval_minutes = max(1, int(data['interval']))

    endpoint = (
        NotificationEndpoint.query
        .filter_by(user_id=g.current_user.id, channel_type='webhook')
        .order_by(NotificationEndpoint.updated_at.desc())
        .first()
    )
    if not endpoint:
        endpoint = NotificationEndpoint(user_id=g.current_user.id, channel_type='webhook')
        db.session.add(endpoint)
    endpoint.endpoint_url = config.url
    endpoint.secret_ciphertext = config.secret
    endpoint.enabled = bool(config.enabled)
    endpoint.cooldown_sec = max(NEWS_MIN_COOLDOWN_SECONDS, int((config.interval_minutes or 5) * 60))
    endpoint.updated_at = datetime.utcnow()

    db.session.commit()
    return jsonify({'config': config.to_dict()})


@app.post('/api/webhook/test')
@auth_required
def test_webhook():
    config = WebhookConfig.query.filter_by(user_id=g.current_user.id).first()
    if not config or not config.url:
        return jsonify({'error': '请先配置 Webhook URL'}), 400
    test_news = {
        'id': f'test_{int(time.time())}',
        'ctime': time.time(),
        'title': '测试消息',
        'content': '这是一条测试消息，用于验证 webhook 配置是否生效。',
        'brief': '这是一条测试消息',
    }
    keywords = get_user_keywords(g.current_user.id)
    success = send_webhook_message(test_news, config, False, None)
    if success:
        config.last_sent_time = datetime.utcnow()
        config.sent_count = (config.sent_count or 0) + 1
        db.session.commit()
    return jsonify({'success': success})


@app.post('/api/portfolio/refresh')
@auth_required
def refresh_portfolio_keywords():
    payload = request.get_json() or {}
    fund_code = payload.get('code')
    if fund_code:
        fund = FundHolding.query.filter_by(user_id=g.current_user.id, code=fund_code).first()
        if not fund:
            return jsonify({'error': '持仓不存在'}), 404
        if normalize_instrument_type(fund.instrument_type) != 'fund':
            return jsonify({'error': '仅支持基金持仓刷新穿透关键词'}), 400
        enqueue_portfolio_refresh(g.current_user.id, fund_code)
    else:
        funds = FundHolding.query.filter_by(user_id=g.current_user.id).all()
        for fund in funds:
            if normalize_instrument_type(fund.instrument_type) == 'fund':
                enqueue_portfolio_refresh(g.current_user.id, fund.code)
    return jsonify({'success': True})


@app.post('/api/ai/analyze')
@auth_required
def analyze():
    """Generic AI analysis endpoint (replaced Claude CLI with OpenAI SDK)."""
    data = request.get_json() or {}
    prompt = data.get('prompt')
    if not prompt:
        return jsonify({'error': 'Missing prompt'}), 400

    if not get_ai_runtime_config():
        return jsonify({'error': 'AI service not configured'}), 503

    model = _get_ai_config('ai_model_deep', os.getenv('AI_MODEL_DEEP', 'gpt-4o'))

    try:
        ai_output = call_ai_text(
            system_prompt="你是一位专业的中国A股市场金融分析师。",
            user_prompt=prompt,
            model=model,
            temperature=0.5,
        )
        if not ai_output:
            return jsonify({'error': 'all ai endpoints failed'}), 502
        return jsonify({'result': ai_output['text']})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.get('/api/news/feed')
@auth_required
def get_news_feed():
    page = max(1, request.args.get('page', 1, type=int))
    per_page = request.args.get('per_page', 30, type=int)
    per_page = min(max(1, per_page), 100)

    mode = (request.args.get('mode') or 'all').strip().lower()
    sentiment = (request.args.get('sentiment') or '').strip().lower()
    impact = (request.args.get('impact') or '').strip().lower()
    entity = (request.args.get('entity') or '').strip().lower()

    query = NewsCache.query

    needs_analysis_join = bool(sentiment or impact or entity)
    if needs_analysis_join:
        query = query.outerjoin(NewsAnalysis, NewsCache.news_id == NewsAnalysis.news_id)
    if mode == 'relevant':
        query = query.join(
            UserNewsRelevance,
            and_(
                NewsCache.news_id == UserNewsRelevance.news_id,
                UserNewsRelevance.user_id == g.current_user.id,
            )
        ).filter(UserNewsRelevance.relevance_score > 0)
    if sentiment:
        query = query.filter(NewsAnalysis.sentiment == sentiment)
    if impact:
        query = query.filter(NewsAnalysis.impact_level == impact)
    if entity:
        pattern = f'%{entity}%'
        query = query.filter(or_(
            NewsCache.title.ilike(pattern),
            NewsCache.content.ilike(pattern),
            NewsCache.brief.ilike(pattern),
            NewsAnalysis.sectors.ilike(pattern),
            NewsAnalysis.stocks.ilike(pattern),
        ))

    query = query.order_by(NewsCache.ctime.desc())
    total = query.count()
    items = query.offset((page - 1) * per_page).limit(per_page).all()

    feed_items = []
    for item in items:
        analysis = NewsAnalysis.query.filter_by(news_id=item.news_id).first()
        relevance = UserNewsRelevance.query.filter_by(user_id=g.current_user.id, news_id=item.news_id).first()
        insight = UserNewsPersonalizedInsight.query.filter_by(user_id=g.current_user.id, news_id=item.news_id).first()
        entry = to_news_feed_item(item, analysis, relevance, insight)
        if not entry.get('globalAnalysis'):
            entry['globalAnalysis'] = get_global_analysis_payload(item.news_id, analysis)
        feed_items.append(entry)

    return jsonify({
        'items': feed_items,
        'total': total,
        'page': page,
        'perPage': per_page,
        'mode': mode,
    })


@app.get('/api/news/<news_id>')
@auth_required
def get_news_detail(news_id):
    news = NewsCache.query.filter_by(news_id=news_id).first()
    if not news:
        return jsonify({'error': '新闻不存在'}), 404

    analysis = NewsAnalysis.query.filter_by(news_id=news_id).first()
    relevance = UserNewsRelevance.query.filter_by(user_id=g.current_user.id, news_id=news_id).first()
    insight = UserNewsPersonalizedInsight.query.filter_by(user_id=g.current_user.id, news_id=news_id).first()
    action = (
        UserNewsAction.query
        .filter_by(user_id=g.current_user.id, news_id=news_id)
        .order_by(UserNewsAction.created_at.desc())
        .first()
    )

    payload = to_news_feed_item(news, analysis, relevance, insight)
    if not payload.get('globalAnalysis'):
        payload['globalAnalysis'] = get_global_analysis_payload(news_id, analysis)

    return jsonify({
        'item': payload,
        'event': build_event_context(news_id),
        'userAction': {
            'action': action.action,
            'actionNote': action.action_note,
            'createdAt': int(action.created_at.timestamp() * 1000) if action and action.created_at else None,
        } if action else None,
    })


@app.post('/api/news/<news_id>/feedback')
@auth_required
def post_news_feedback(news_id):
    news = NewsCache.query.filter_by(news_id=news_id).first()
    if not news:
        return jsonify({'error': '新闻不存在'}), 404

    payload = request.get_json() or {}
    action = (payload.get('action') or '').strip()
    note = (payload.get('note') or '').strip()
    mapping = {
        'useful': 'watched',
        'not_useful': 'ignored',
        'already_acted': 'acted',
        'watched': 'watched',
        'ignored': 'ignored',
        'acted': 'acted',
    }
    normalized = mapping.get(action)
    if not normalized:
        return jsonify({'error': '无效的反馈动作'}), 400

    row = UserNewsAction(
        user_id=g.current_user.id,
        news_id=news_id,
        action=normalized,
        action_note=note[:255] if note else None,
        created_at=datetime.utcnow(),
    )
    db.session.add(row)
    db.session.commit()

    return jsonify({
        'success': True,
        'feedback': {
            'newsId': news_id,
            'action': normalized,
            'actionNote': row.action_note,
            'createdAt': int(row.created_at.timestamp() * 1000),
        },
    })


@app.get('/api/notification/endpoints')
@auth_required
def get_notification_endpoints():
    ensure_notification_endpoint_from_legacy(g.current_user.id)
    rows = (
        NotificationEndpoint.query
        .filter_by(user_id=g.current_user.id)
        .order_by(NotificationEndpoint.updated_at.desc(), NotificationEndpoint.id.desc())
        .all()
    )

    items = []
    for row in rows:
        item = row.to_dict()
        item['hasSecret'] = bool(row.secret_ciphertext)
        item['secretMasked'] = mask_secret(row.secret_ciphertext)
        items.append(item)

    return jsonify({'endpoints': items})


@app.put('/api/notification/endpoints')
@auth_required
def put_notification_endpoints():
    payload = request.get_json() or {}
    endpoints = payload.get('endpoints')
    if not isinstance(endpoints, list):
        return jsonify({'error': 'endpoints 必须是数组'}), 400

    existing = {row.id: row for row in NotificationEndpoint.query.filter_by(user_id=g.current_user.id).all()}
    touched_ids = set()
    latest_webhook: NotificationEndpoint | None = None

    for item in endpoints:
        if not isinstance(item, dict):
            continue
        endpoint_id = item.get('id')
        row = existing.get(endpoint_id) if endpoint_id else None
        if not row:
            row = NotificationEndpoint(user_id=g.current_user.id)
            db.session.add(row)
            db.session.flush()
            existing[row.id] = row

        row.channel_type = (item.get('channelType') or row.channel_type or 'webhook').strip()
        row.endpoint_url = (item.get('endpointUrl') or '').strip()
        row.enabled = bool(item.get('enabled', row.enabled))
        row.cooldown_sec = max(NEWS_MIN_COOLDOWN_SECONDS, int(item.get('cooldownSec') or row.cooldown_sec or 300))
        quiet_hours = item.get('quietHours', {})
        if isinstance(quiet_hours, dict):
            row.quiet_hours = json.dumps(quiet_hours, ensure_ascii=False)
        secret = item.get('secret')
        if isinstance(secret, str) and secret.strip():
            row.secret_ciphertext = secret.strip()
        row.updated_at = datetime.utcnow()
        touched_ids.add(row.id)
        if row.channel_type == 'webhook':
            latest_webhook = row

    for row_id, row in existing.items():
        if row_id not in touched_ids:
            db.session.delete(row)

    sync_legacy_webhook_from_endpoint(g.current_user.id, latest_webhook)
    db.session.commit()
    return get_notification_endpoints()


@app.get('/api/notification/rules')
@auth_required
def get_notification_rules():
    rows = NotificationRule.query.filter_by(user_id=g.current_user.id).order_by(NotificationRule.priority.asc()).all()
    if not rows:
        seeded = default_notification_rules(g.current_user.id)
        for row in seeded:
            db.session.add(row)
        db.session.commit()
        rows = NotificationRule.query.filter_by(user_id=g.current_user.id).order_by(NotificationRule.priority.asc()).all()

    return jsonify({'rules': [row.to_dict() for row in rows]})


@app.put('/api/notification/rules')
@auth_required
def put_notification_rules():
    payload = request.get_json() or {}
    rules = payload.get('rules')
    if not isinstance(rules, list):
        return jsonify({'error': 'rules 必须是数组'}), 400

    existing = {row.id: row for row in NotificationRule.query.filter_by(user_id=g.current_user.id).all()}
    touched = set()
    for item in rules:
        if not isinstance(item, dict):
            continue
        rule_id = item.get('id')
        row = existing.get(rule_id) if rule_id else None
        if not row:
            row = NotificationRule(
                user_id=g.current_user.id,
                rule_type='high_relevance',
                rule_params=json.dumps({}, ensure_ascii=False),
                priority=1,
                enabled=True,
            )
            db.session.add(row)
        row.rule_type = (item.get('ruleType') or row.rule_type or 'high_relevance').strip()
        params = item.get('ruleParams', {})
        if isinstance(params, dict):
            row.rule_params = json.dumps(params, ensure_ascii=False)
        row.priority = int(item.get('priority') or row.priority or 1)
        row.enabled = bool(item.get('enabled', row.enabled))
        row.updated_at = datetime.utcnow()
        db.session.flush()
        existing[row.id] = row
        touched.add(row.id)

    for rid, row in existing.items():
        if rid not in touched:
            db.session.delete(row)

    db.session.commit()
    return get_notification_rules()


@app.get('/api/news/analyzed')
@auth_required
def get_analyzed_news():
    """Get paginated news with analysis results and user relevance."""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 30, type=int)
    sentiment = request.args.get('sentiment')
    impact = request.args.get('impact')

    query = NewsCache.query.order_by(NewsCache.ctime.desc())

    # Apply filters via join
    if sentiment or impact:
        query = query.join(NewsAnalysis, NewsCache.news_id == NewsAnalysis.news_id)
        if sentiment:
            query = query.filter(NewsAnalysis.sentiment == sentiment)
        if impact:
            query = query.filter(NewsAnalysis.impact_level == impact)

    total = query.count()
    items = query.offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for item in items:
        analysis = NewsAnalysis.query.filter_by(news_id=item.news_id).first()
        relevance = UserNewsRelevance.query.filter_by(
            user_id=g.current_user.id, news_id=item.news_id
        ).first()

        entry = {
            'id': item.news_id,
            'title': item.title,
            'content': item.content,
            'brief': item.brief,
            'ctime': item.ctime,
            'raw': json.loads(item.raw_json) if item.raw_json else {},
            'analysis': analysis.to_dict() if analysis else None,
            'relevance': relevance.to_dict() if relevance else None,
        }
        result.append(entry)

    return jsonify({
        'items': result,
        'total': total,
        'page': page,
        'perPage': per_page,
    })


@app.get('/api/news/<news_id>/analysis')
@auth_required
def get_news_analysis(news_id):
    """Get full analysis for a specific news item."""
    analysis = NewsAnalysis.query.filter_by(news_id=news_id).first()
    relevance = UserNewsRelevance.query.filter_by(
        user_id=g.current_user.id, news_id=news_id
    ).first()

    if not analysis:
        return jsonify({'error': '该新闻尚未分析'}), 404

    return jsonify({
        'analysis': analysis.to_dict(),
        'relevance': relevance.to_dict() if relevance else None,
    })


@app.get('/api/news/relevant')
@auth_required
def get_relevant_news():
    """Get news relevant to current user's holdings."""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    min_score = request.args.get('min_score', 0.1, type=float)

    query = (
        db.session.query(NewsCache, NewsAnalysis, UserNewsRelevance)
        .join(UserNewsRelevance, NewsCache.news_id == UserNewsRelevance.news_id)
        .join(NewsAnalysis, NewsCache.news_id == NewsAnalysis.news_id)
        .filter(UserNewsRelevance.user_id == g.current_user.id)
        .filter(UserNewsRelevance.relevance_score >= min_score)
        .order_by(NewsCache.ctime.desc())
    )

    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for news, analysis, relevance in rows:
        result.append({
            'id': news.news_id,
            'title': news.title,
            'content': news.content,
            'ctime': news.ctime,
            'raw': json.loads(news.raw_json) if news.raw_json else {},
            'analysis': analysis.to_dict(),
            'relevance': relevance.to_dict(),
        })

    return jsonify({
        'items': result,
        'total': total,
        'page': page,
        'perPage': per_page,
    })


@app.get('/api/admin/users')
@admin_required
def get_admin_users():
    users = User.query.order_by(User.created_at.desc()).limit(200).all()
    return jsonify({
        'items': [
            {
                'id': user.id,
                'email': user.email,
                'name': user.name,
                'role': user.role,
                'status': user.status,
                'lastLoginAt': int(user.last_login_at.timestamp() * 1000) if user.last_login_at else None,
                'createdAt': int(user.created_at.timestamp() * 1000) if user.created_at else None,
            }
            for user in users
        ]
    })


@app.put('/api/admin/users/<int:user_id>/role')
@admin_required
def put_admin_user_role(user_id):
    if user_id == g.current_user.id:
        return jsonify({'error': '不能修改自己的角色'}), 400

    payload = request.get_json() or {}
    role = (payload.get('role') or '').strip()
    if role not in {'user', 'admin'}:
        return jsonify({'error': 'role 非法'}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    before = {'role': user.role, 'status': user.status}
    user.role = role
    user.updated_at = datetime.utcnow()
    save_audit_log('admin.user.role.update', 'user', str(user.id), before, {'role': user.role, 'status': user.status})
    db.session.commit()
    return jsonify({'success': True, 'user': user.to_dict()})


def admin_ai_config_payload():
    provider = AIProviderConfig.query.filter_by(provider='default').first()
    if not provider:
        provider = AIProviderConfig(
            provider='default',
            base_url=_get_ai_config('ai_base_url', ''),
            api_key_ciphertext=_get_ai_config('ai_api_key', ''),
            default_models=json.dumps({
                'ai_model_fast': _get_ai_config('ai_model_fast', os.getenv('AI_MODEL_FAST', 'gpt-4o-mini')),
                'ai_model_deep': _get_ai_config('ai_model_deep', os.getenv('AI_MODEL_DEEP', 'gpt-4o')),
            }, ensure_ascii=False),
            enabled=is_ai_enabled(),
        )
        db.session.add(provider)
        db.session.commit()

    payload = provider.to_dict()
    payload['apiKeyMasked'] = mask_secret(provider.api_key_ciphertext)
    payload['metaso'] = {
        'enabled': metaso_enabled(),
        'apiKeyMasked': mask_secret(get_metaso_api_key()),
        'searchUrl': METASO_SEARCH_URL,
        'readerUrl': METASO_READER_URL,
        'dailyBudget': get_metaso_daily_budget(),
        'highImpactOnly': metaso_high_impact_only(),
        'quotaCooldownSeconds': METASO_QUOTA_COOLDOWN_SECONDS,
    }
    payload['fallback'] = {
        'enabled': local_fallback_enabled(),
        'provider': 'duckduckgo',
        'dailyBudget': get_local_fallback_daily_budget(),
        'readerDailyBudget': get_local_reader_daily_budget(),
    }
    payload['stats'] = {
        'pendingJobs': AnalysisJob.query.filter(AnalysisJob.status == 'pending').count(),
        'runningJobs': AnalysisJob.query.filter(AnalysisJob.status == 'running').count(),
        'todayAnalyzed': AnalysisJobRun.query.filter(
            AnalysisJobRun.status == 'success',
            AnalysisJobRun.created_at >= datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0),
        ).count(),
    }
    return payload


@app.get('/api/admin/ai/config')
@admin_required
def get_admin_ai_config():
    return jsonify({'config': admin_ai_config_payload()})


@app.put('/api/admin/ai/config')
@admin_required
def put_admin_ai_config():
    data = request.get_json() or {}
    provider = AIProviderConfig.query.filter_by(provider='default').first()
    if not provider:
        provider = AIProviderConfig(provider='default')
        db.session.add(provider)
        db.session.flush()

    before = {
        'baseUrl': provider.base_url,
        'apiKeyMasked': mask_secret(provider.api_key_ciphertext),
        'defaultModels': parse_json_text(provider.default_models, {}),
        'enabled': bool(provider.enabled),
        'metasoApiKeyMasked': mask_secret(get_metaso_api_key()),
        'fallback': {
            'enabled': local_fallback_enabled(),
            'dailyBudget': get_local_fallback_daily_budget(),
            'readerDailyBudget': get_local_reader_daily_budget(),
        },
    }

    if 'baseUrl' in data:
        provider.base_url = (data.get('baseUrl') or '').strip()
        _set_ai_config('ai_base_url', provider.base_url)
    if isinstance(data.get('apiKey'), str) and data.get('apiKey').strip():
        provider.api_key_ciphertext = data.get('apiKey').strip()
        _set_ai_config('ai_api_key', provider.api_key_ciphertext)
    if 'enabled' in data:
        provider.enabled = bool(data.get('enabled'))
        _set_ai_config('ai_enabled', 'true' if provider.enabled else 'false')
    if isinstance(data.get('metasoApiKey'), str) and data.get('metasoApiKey').strip():
        _set_ai_config('metaso_api_key', data.get('metasoApiKey').strip())
    if data.get('metasoDailyBudget') is not None:
        try:
            budget = max(0, int(data.get('metasoDailyBudget')))
            _set_ai_config('metaso_daily_budget', str(budget))
        except (TypeError, ValueError):
            return jsonify({'error': 'metasoDailyBudget 非法'}), 400
    if data.get('metasoHighImpactOnly') is not None:
        _set_ai_config('metaso_high_impact_only', 'true' if bool(data.get('metasoHighImpactOnly')) else 'false')

    fallback_data = data.get('fallback') if isinstance(data.get('fallback'), dict) else {}
    fallback_enabled_value = data.get('fallbackEnabled')
    if fallback_enabled_value is None and 'enabled' in fallback_data:
        fallback_enabled_value = fallback_data.get('enabled')
    fallback_daily_budget_value = data.get('fallbackDailyBudget')
    if fallback_daily_budget_value is None and 'dailyBudget' in fallback_data:
        fallback_daily_budget_value = fallback_data.get('dailyBudget')
    fallback_reader_daily_budget_value = data.get('fallbackReaderDailyBudget')
    if fallback_reader_daily_budget_value is None and 'readerDailyBudget' in fallback_data:
        fallback_reader_daily_budget_value = fallback_data.get('readerDailyBudget')

    if fallback_enabled_value is not None:
        _set_ai_config('fallback_enabled', 'true' if _parse_bool_value(fallback_enabled_value, True) else 'false')
    if fallback_daily_budget_value is not None:
        try:
            budget = max(0, int(fallback_daily_budget_value))
            _set_ai_config('fallback_daily_budget', str(budget))
        except (TypeError, ValueError):
            return jsonify({'error': 'fallbackDailyBudget 非法'}), 400
    if fallback_reader_daily_budget_value is not None:
        try:
            budget = max(0, int(fallback_reader_daily_budget_value))
            _set_ai_config('fallback_reader_daily_budget', str(budget))
        except (TypeError, ValueError):
            return jsonify({'error': 'fallbackReaderDailyBudget 非法'}), 400

    models = parse_json_text(provider.default_models, {})
    if isinstance(data.get('defaultModels'), dict):
        models.update(data.get('defaultModels'))
    provider.default_models = json.dumps(models, ensure_ascii=False)
    provider.updated_by = g.current_user.id
    provider.updated_at = datetime.utcnow()

    if models.get('ai_model_fast'):
        _set_ai_config('ai_model_fast', str(models.get('ai_model_fast')))
    if models.get('ai_model_deep'):
        _set_ai_config('ai_model_deep', str(models.get('ai_model_deep')))

    after = {
        'baseUrl': provider.base_url,
        'apiKeyMasked': mask_secret(provider.api_key_ciphertext),
        'defaultModels': models,
        'enabled': bool(provider.enabled),
        'metasoApiKeyMasked': mask_secret(get_metaso_api_key()),
        'fallback': {
            'enabled': local_fallback_enabled(),
            'dailyBudget': get_local_fallback_daily_budget(),
            'readerDailyBudget': get_local_reader_daily_budget(),
        },
    }
    save_audit_log('admin.ai_config.update', 'ai_provider_config', provider.provider, before, after)
    db.session.commit()
    return jsonify({'config': admin_ai_config_payload()})


@app.get('/api/admin/prompts/<scene>')
@admin_required
def get_admin_prompt(scene):
    rows = (
        PromptTemplate.query
        .filter_by(scene=scene)
        .order_by(PromptTemplate.created_at.desc())
        .all()
    )
    active = next((row for row in rows if row.status == 'active'), None)
    return jsonify({
        'scene': scene,
        'active': active.to_dict() if active else None,
        'items': [row.to_dict() for row in rows[:30]],
    })


@app.put('/api/admin/prompts/<scene>')
@admin_required
def put_admin_prompt(scene):
    payload = request.get_json() or {}
    content = (payload.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'content 不能为空'}), 400

    status = (payload.get('status') or 'active').strip()
    if status not in {'active', 'inactive', 'archived'}:
        return jsonify({'error': 'status 非法'}), 400

    version = (payload.get('version') or '').strip()
    if not version:
        version = datetime.utcnow().strftime('%Y%m%d%H%M%S')

    existing = PromptTemplate.query.filter_by(scene=scene, version=version).first()
    before = existing.to_dict() if existing else None
    if not existing:
        existing = PromptTemplate(scene=scene, version=version)
        db.session.add(existing)

    existing.content = content
    existing.status = status
    existing.created_by = g.current_user.id
    if not existing.created_at:
        existing.created_at = datetime.utcnow()

    if status == 'active':
        PromptTemplate.query.filter(
            PromptTemplate.scene == scene,
            PromptTemplate.id != existing.id,
            PromptTemplate.status == 'active',
        ).update({'status': 'inactive'})

    db.session.flush()
    after = existing.to_dict()
    save_audit_log('admin.prompt.upsert', 'prompt_template', f'{scene}:{version}', before, after)
    db.session.commit()
    return get_admin_prompt(scene)


@app.get('/api/admin/analysis/jobs')
@admin_required
def get_admin_analysis_jobs():
    page = max(1, request.args.get('page', 1, type=int))
    per_page = min(100, max(1, request.args.get('per_page', 30, type=int)))
    status = (request.args.get('status') or '').strip()
    job_type = (request.args.get('jobType') or '').strip()

    query = AnalysisJob.query
    if status:
        query = query.filter(AnalysisJob.status == status)
    if job_type:
        query = query.filter(AnalysisJob.job_type == job_type)

    total = query.count()
    rows = (
        query.order_by(AnalysisJob.scheduled_at.desc(), AnalysisJob.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    job_ids = [row.id for row in rows]
    run_map = {}
    if job_ids:
        runs = (
            AnalysisJobRun.query
            .filter(AnalysisJobRun.job_id.in_(job_ids))
            .order_by(AnalysisJobRun.created_at.desc())
            .all()
        )
        for run in runs:
            if run.job_id not in run_map:
                run_map[run.job_id] = run

    return jsonify({
        'items': [
            {
                **row.to_dict(),
                'latestRun': {
                    'id': run_map[row.id].id,
                    'latencyMs': run_map[row.id].latency_ms,
                    'tokenIn': run_map[row.id].token_in,
                    'tokenOut': run_map[row.id].token_out,
                    'costEstimate': run_map[row.id].cost_estimate,
                    'status': run_map[row.id].status,
                    'errorMessage': run_map[row.id].error_message,
                    'createdAt': int(run_map[row.id].created_at.timestamp() * 1000) if run_map[row.id].created_at else None,
                } if row.id in run_map else None,
            }
            for row in rows
        ],
        'total': total,
        'page': page,
        'perPage': per_page,
    })


@app.post('/api/admin/analysis/jobs/<int:job_id>/retry')
@admin_required
def post_admin_retry_job(job_id):
    job = AnalysisJob.query.get(job_id)
    if not job:
        return jsonify({'error': '任务不存在'}), 404

    before = job.to_dict()
    job.status = 'pending'
    job.scheduled_at = datetime.utcnow()
    job.started_at = None
    job.finished_at = None
    job.error_message = None
    job.retry_count = (job.retry_count or 0) + 1
    job.payload_json = job.payload_json or json.dumps({'manualRetry': True}, ensure_ascii=False)
    save_audit_log('admin.analysis.retry', 'analysis_job', str(job.id), before, job.to_dict())
    db.session.commit()
    return jsonify({'success': True, 'job': job.to_dict()})


def percentile(values: list[int], p: float):
    if not values:
        return 0
    values = sorted(values)
    index = min(len(values) - 1, int(len(values) * p))
    return values[index]


@app.get('/api/admin/metrics/analysis')
@admin_required
def get_admin_analysis_metrics():
    now = datetime.utcnow()
    since_24h = now - timedelta(hours=24)
    jobs_24h = AnalysisJob.query.filter(AnalysisJob.created_at >= since_24h).all()
    runs_24h = AnalysisJobRun.query.filter(AnalysisJobRun.created_at >= since_24h).all()

    success_runs = [run for run in runs_24h if run.status == 'success']
    failed_runs = [run for run in runs_24h if run.status != 'success']
    latency_values = [int(run.latency_ms or 0) for run in success_runs]
    token_in = sum(int(run.token_in or 0) for run in runs_24h)
    token_out = sum(int(run.token_out or 0) for run in runs_24h)
    total_cost = round(sum(float(run.cost_estimate or 0) for run in runs_24h), 4)

    grouped = {}
    for job in jobs_24h:
        grouped.setdefault(job.job_type, {'total': 0, 'success': 0, 'failed': 0})
        grouped[job.job_type]['total'] += 1
        if job.status == 'success':
            grouped[job.job_type]['success'] += 1
        elif job.status == 'failed':
            grouped[job.job_type]['failed'] += 1

    return jsonify({
        'window': {
            'from': int(since_24h.timestamp() * 1000),
            'to': int(now.timestamp() * 1000),
        },
        'queue': {
            'pending': AnalysisJob.query.filter(AnalysisJob.status == 'pending').count(),
            'running': AnalysisJob.query.filter(AnalysisJob.status == 'running').count(),
            'failed': AnalysisJob.query.filter(AnalysisJob.status == 'failed').count(),
        },
        'throughput': {
            'jobs24h': len(jobs_24h),
            'runs24h': len(runs_24h),
            'successRuns24h': len(success_runs),
            'failedRuns24h': len(failed_runs),
            'successRate24h': round((len(success_runs) / len(runs_24h) * 100), 2) if runs_24h else 0,
        },
        'latency': {
            'p50': percentile(latency_values, 0.5),
            'p95': percentile(latency_values, 0.95),
            'max': max(latency_values) if latency_values else 0,
        },
        'tokens': {
            'input': token_in,
            'output': token_out,
            'costEstimate': total_cost,
        },
        'byJobType': grouped,
    })


@app.get('/api/admin/news/pipeline/health')
@admin_required
def get_admin_pipeline_health():
    latest_news = NewsCache.query.order_by(NewsCache.ctime.desc()).first()
    latest_news_at = datetime.fromtimestamp(latest_news.ctime) if latest_news else None
    age_seconds = int((datetime.utcnow() - latest_news_at).total_seconds()) if latest_news_at else None

    failed_recent = AnalysisJob.query.filter(
        AnalysisJob.status == 'failed',
        AnalysisJob.finished_at >= datetime.utcnow() - timedelta(hours=1)
    ).count()

    pending_global = AnalysisJob.query.filter(
        AnalysisJob.job_type == 'global_news',
        AnalysisJob.status == 'pending'
    ).count()
    pending_user = AnalysisJob.query.filter(
        AnalysisJob.job_type == 'user_news_insight',
        AnalysisJob.status == 'pending'
    ).count()

    status = 'healthy'
    if age_seconds is None or age_seconds > NEWS_POLL_SECONDS * 5:
        status = 'degraded'
    if failed_recent >= 10:
        status = 'critical'

    return jsonify({
        'status': status,
        'source': {
            'newsPollSeconds': NEWS_POLL_SECONDS,
            'latestNewsAt': int(latest_news_at.timestamp() * 1000) if latest_news_at else None,
            'ageSeconds': age_seconds,
        },
        'workers': {
            'analysisQueueMemory': analysis_queue.qsize(),
            'portfolioQueueMemory': portfolio_queue.qsize(),
            'pendingGlobalJobs': pending_global,
            'pendingUserJobs': pending_user,
            'failedJobsLastHour': failed_recent,
        },
        'ai': {
            'enabled': is_ai_enabled(),
            'provider': _get_ai_config('ai_base_url', ''),
        },
    })


@app.get('/api/admin/audit/logs')
@admin_required
def get_admin_audit_logs():
    page = max(1, request.args.get('page', 1, type=int))
    per_page = min(100, max(1, request.args.get('per_page', 30, type=int)))
    action = (request.args.get('action') or '').strip()

    query = AuditLog.query
    if action:
        query = query.filter(AuditLog.action == action)

    total = query.count()
    rows = (
        query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return jsonify({
        'items': [
            {
                'id': row.id,
                'actorUserId': row.actor_user_id,
                'action': row.action,
                'resourceType': row.resource_type,
                'resourceId': row.resource_id,
                'before': parse_json_text(row.before_json, {}),
                'after': parse_json_text(row.after_json, {}),
                'ip': row.ip,
                'ua': row.ua,
                'createdAt': int(row.created_at.timestamp() * 1000) if row.created_at else None,
            }
            for row in rows
        ],
        'total': total,
        'page': page,
        'perPage': per_page,
    })


@app.get('/api/ai/config')
@admin_required
def get_ai_config():
    return get_admin_ai_config()


@app.put('/api/ai/config')
@admin_required
def update_ai_config():
    payload = request.get_json() or {}
    provider = AIProviderConfig.query.filter_by(provider='default').first()
    if not provider:
        provider = AIProviderConfig(provider='default')
        db.session.add(provider)
        db.session.flush()

    before = {
        'baseUrl': provider.base_url,
        'apiKeyMasked': mask_secret(provider.api_key_ciphertext),
        'defaultModels': parse_json_text(provider.default_models, {}),
        'enabled': bool(provider.enabled),
        'metasoApiKeyMasked': mask_secret(get_metaso_api_key()),
        'fallback': {
            'enabled': local_fallback_enabled(),
            'dailyBudget': get_local_fallback_daily_budget(),
            'readerDailyBudget': get_local_reader_daily_budget(),
        },
    }

    base_url = payload.get('ai_base_url') or payload.get('baseUrl')
    api_key = payload.get('ai_api_key') or payload.get('apiKey')
    ai_enabled = payload.get('ai_enabled')
    if ai_enabled is None:
        ai_enabled = payload.get('enabled')
    model_fast = payload.get('ai_model_fast')
    model_deep = payload.get('ai_model_deep')
    metaso_api_key = payload.get('metaso_api_key') or payload.get('metasoApiKey')
    metaso_daily_budget = payload.get('metaso_daily_budget')
    if metaso_daily_budget is None:
        metaso_daily_budget = payload.get('metasoDailyBudget')
    metaso_high_impact_only_value = payload.get('metaso_high_impact_only')
    if metaso_high_impact_only_value is None:
        metaso_high_impact_only_value = payload.get('metasoHighImpactOnly')
    fallback_enabled_value = payload.get('fallback_enabled')
    if fallback_enabled_value is None:
        fallback_enabled_value = payload.get('fallbackEnabled')
    fallback_daily_budget = payload.get('fallback_daily_budget')
    if fallback_daily_budget is None:
        fallback_daily_budget = payload.get('fallbackDailyBudget')
    fallback_reader_daily_budget = payload.get('fallback_reader_daily_budget')
    if fallback_reader_daily_budget is None:
        fallback_reader_daily_budget = payload.get('fallbackReaderDailyBudget')
    fallback_payload = payload.get('fallback') if isinstance(payload.get('fallback'), dict) else {}
    if fallback_enabled_value is None and 'enabled' in fallback_payload:
        fallback_enabled_value = fallback_payload.get('enabled')
    if fallback_daily_budget is None and 'dailyBudget' in fallback_payload:
        fallback_daily_budget = fallback_payload.get('dailyBudget')
    if fallback_reader_daily_budget is None and 'readerDailyBudget' in fallback_payload:
        fallback_reader_daily_budget = fallback_payload.get('readerDailyBudget')

    if isinstance(base_url, str):
        provider.base_url = base_url.strip()
        _set_ai_config('ai_base_url', provider.base_url)
    if isinstance(api_key, str) and api_key.strip():
        provider.api_key_ciphertext = api_key.strip()
        _set_ai_config('ai_api_key', provider.api_key_ciphertext)
    if ai_enabled is not None:
        enabled = ai_enabled in ('true', True, '1', 1)
        provider.enabled = enabled
        _set_ai_config('ai_enabled', 'true' if enabled else 'false')
    if isinstance(metaso_api_key, str) and metaso_api_key.strip():
        _set_ai_config('metaso_api_key', metaso_api_key.strip())
    if metaso_daily_budget is not None:
        try:
            budget = max(0, int(metaso_daily_budget))
            _set_ai_config('metaso_daily_budget', str(budget))
        except (TypeError, ValueError):
            return jsonify({'error': 'metaso_daily_budget 非法'}), 400
    if metaso_high_impact_only_value is not None:
        enabled = metaso_high_impact_only_value in ('true', True, '1', 1)
        _set_ai_config('metaso_high_impact_only', 'true' if enabled else 'false')
    if fallback_enabled_value is not None:
        _set_ai_config('fallback_enabled', 'true' if _parse_bool_value(fallback_enabled_value, True) else 'false')
    if fallback_daily_budget is not None:
        try:
            budget = max(0, int(fallback_daily_budget))
            _set_ai_config('fallback_daily_budget', str(budget))
        except (TypeError, ValueError):
            return jsonify({'error': 'fallback_daily_budget 非法'}), 400
    if fallback_reader_daily_budget is not None:
        try:
            budget = max(0, int(fallback_reader_daily_budget))
            _set_ai_config('fallback_reader_daily_budget', str(budget))
        except (TypeError, ValueError):
            return jsonify({'error': 'fallback_reader_daily_budget 非法'}), 400

    models = parse_json_text(provider.default_models, {})
    if model_fast:
        models['ai_model_fast'] = str(model_fast)
        _set_ai_config('ai_model_fast', str(model_fast))
    if model_deep:
        models['ai_model_deep'] = str(model_deep)
        _set_ai_config('ai_model_deep', str(model_deep))
    provider.default_models = json.dumps(models, ensure_ascii=False)

    if payload.get('ai_batch_size') is not None:
        _set_ai_config('ai_batch_size', str(payload.get('ai_batch_size')))

    provider.updated_by = g.current_user.id
    provider.updated_at = datetime.utcnow()
    save_audit_log(
        'admin.ai_config.compat_update',
        'ai_provider_config',
        provider.provider,
        before,
        {
            'baseUrl': provider.base_url,
            'apiKeyMasked': mask_secret(provider.api_key_ciphertext),
            'defaultModels': models,
            'enabled': bool(provider.enabled),
            'metasoApiKeyMasked': mask_secret(get_metaso_api_key()),
            'fallback': {
                'enabled': local_fallback_enabled(),
                'dailyBudget': get_local_fallback_daily_budget(),
                'readerDailyBudget': get_local_reader_daily_budget(),
            },
        },
    )
    db.session.commit()
    return jsonify({'config': admin_ai_config_payload(), 'success': True})


@app.get('/api/dashboard/overview')
@auth_required
def get_dashboard_overview():
    overview = compute_dashboard_overview(g.current_user.id)
    return jsonify({'overview': overview})


@app.get('/api/dashboard/preferences')
@auth_required
def get_dashboard_preferences():
    row = DashboardPreference.query.filter_by(user_id=g.current_user.id).first()
    if not row:
        return jsonify({'preferences': default_dashboard_preferences()})
    return jsonify({'preferences': row.to_dict()})


@app.put('/api/dashboard/preferences')
@auth_required
def put_dashboard_preferences():
    payload = request.get_json() or {}
    row = DashboardPreference.query.filter_by(user_id=g.current_user.id).first()
    if not row:
        row = DashboardPreference(user_id=g.current_user.id)
        db.session.add(row)

    defaults = default_dashboard_preferences()

    card_order = payload.get('cardOrder')
    if isinstance(card_order, list):
        row.card_order = json.dumps(card_order, ensure_ascii=False)
    elif not row.card_order:
        row.card_order = json.dumps(defaults['cardOrder'], ensure_ascii=False)

    collapsed_panels = payload.get('collapsedPanels')
    if isinstance(collapsed_panels, dict):
        row.collapsed_panels = json.dumps(collapsed_panels, ensure_ascii=False)
    elif not row.collapsed_panels:
        row.collapsed_panels = json.dumps(defaults['collapsedPanels'], ensure_ascii=False)

    table_sort = payload.get('tableSort')
    if isinstance(table_sort, dict):
        normalized = {
            'key': table_sort.get('key', defaults['tableSort']['key']),
            'direction': table_sort.get('direction', defaults['tableSort']['direction']),
        }
        if normalized['direction'] not in ('asc', 'desc'):
            normalized['direction'] = defaults['tableSort']['direction']
        row.table_sort = json.dumps(normalized, ensure_ascii=False)
    elif not row.table_sort:
        row.table_sort = json.dumps(defaults['tableSort'], ensure_ascii=False)

    row.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'preferences': row.to_dict()})


def bootstrap():
    with app.app_context():
        db.create_all()
        patch_legacy_schema()
        funds = FundHolding.query.all()
        for fund in funds:
            if normalize_instrument_type(fund.instrument_type) == 'fund' and not fund.keywords:
                enqueue_portfolio_refresh(fund.user_id, fund.code)


def patch_legacy_schema():
    if not app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite'):
        return

    inspector = inspect(db.engine)
    table_columns = {}
    for table_name in inspector.get_table_names():
        table_columns[table_name] = {col['name'] for col in inspector.get_columns(table_name)}

    alter_statements = []
    users_columns = table_columns.get('users', set())
    if 'role' not in users_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN role VARCHAR(16) DEFAULT 'user'")
    if 'status' not in users_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN status VARCHAR(16) DEFAULT 'active'")
    if 'last_login_at' not in users_columns:
        alter_statements.append("ALTER TABLE users ADD COLUMN last_login_at DATETIME")

    relevance_columns = table_columns.get('user_news_relevance', set())
    if 'relevance_level' not in relevance_columns:
        alter_statements.append("ALTER TABLE user_news_relevance ADD COLUMN relevance_level VARCHAR(16) DEFAULT 'low'")
    if 'matched_entities' not in relevance_columns:
        alter_statements.append("ALTER TABLE user_news_relevance ADD COLUMN matched_entities TEXT")
    if 'reason_codes' not in relevance_columns:
        alter_statements.append("ALTER TABLE user_news_relevance ADD COLUMN reason_codes TEXT")
    if 'computed_at' not in relevance_columns:
        alter_statements.append("ALTER TABLE user_news_relevance ADD COLUMN computed_at DATETIME")

    funds_columns = table_columns.get('fund_holdings', set())
    if 'instrument_type' not in funds_columns:
        alter_statements.append("ALTER TABLE fund_holdings ADD COLUMN instrument_type VARCHAR(16) DEFAULT 'fund'")
    if 'market' not in funds_columns:
        alter_statements.append("ALTER TABLE fund_holdings ADD COLUMN market VARCHAR(8)")
    if 'updated_at' not in funds_columns:
        alter_statements.append("ALTER TABLE fund_holdings ADD COLUMN updated_at DATETIME")

    if not alter_statements:
        return

    with db.engine.begin() as conn:
        for statement in alter_statements:
            conn.execute(text(statement))
        conn.execute(text("UPDATE fund_holdings SET instrument_type='fund' WHERE instrument_type IS NULL OR instrument_type=''"))


if not DISABLE_BOOTSTRAP:
    bootstrap()

if not DISABLE_BOOTSTRAP and not DISABLE_BACKGROUND_WORKERS:
    portfolio_thread = threading.Thread(target=portfolio_worker, daemon=True)
    portfolio_thread.start()

    news_thread = threading.Thread(target=news_worker, daemon=True)
    news_thread.start()

    analysis_thread = threading.Thread(target=analysis_worker, daemon=True)
    analysis_thread.start()


if __name__ == '__main__':
    print('Starting API server on port 5001...')
    app.run(host='0.0.0.0', port=5001, debug=True)
