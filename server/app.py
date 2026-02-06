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


load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///mypositions.db')
JWT_SECRET = os.getenv('JWT_SECRET', 'replace-this-secret')
JWT_EXPIRES_DAYS = int(os.getenv('JWT_EXPIRES_DAYS', '15'))
NEWS_POLL_SECONDS = int(os.getenv('NEWS_POLL_SECONDS', '60'))


app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(180), unique=True, nullable=False)
    name = db.Column(db.String(80), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    funds = db.relationship('FundHolding', backref='user', cascade='all, delete-orphan')
    webhook = db.relationship('WebhookConfig', backref='user', uselist=False, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'createdAt': int(self.created_at.timestamp() * 1000) if self.created_at else None,
        }


class FundHolding(db.Model):
    __tablename__ = 'fund_holdings'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
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
            result.add(self.code.lower())
        if self.keywords:
            try:
                for item in json.loads(self.keywords):
                    if isinstance(item, str) and item.strip():
                        result.add(item.lower())
            except json.JSONDecodeError:
                pass
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


def create_token(user: User):
    payload = {
        'sub': user.id,
        'email': user.email,
        'name': user.name,
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


def fund_to_dict(fund: FundHolding):
    return {
        'id': fund.id,
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


def analyze_sentiment(content: str):
    if any(word in content for word in ['利好', '上涨', '突破', '大增', '创新高']):
        return 'bullish'
    if any(word in content for word in ['利空', '下跌', '跌破', '大减', '创新低']):
        return 'bearish'
    return None


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


def build_webhook_payload(news_item: dict, is_highlighted: bool, sentiment: str | None, config: WebhookConfig):
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
    sentiment_text = '📈 利好' if sentiment == 'bullish' else '📉 利空' if sentiment == 'bearish' else ''

    if config.url and 'oapi.dingtalk.com' in config.url:
        markdown_text = f"## {highlight_text}{title}\n\n**时间：** {time_str}\n\n**来源：** 财联社\n\n"
        if sentiment_text:
            markdown_text += f"**情绪：** {sentiment_text}\n\n"
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
        },
    }


def send_webhook_message(news_item: dict, config: WebhookConfig, is_highlighted: bool, sentiment: str | None):
    if not config.enabled or not config.url:
        return False

    payload = build_webhook_payload(news_item, is_highlighted, sentiment, config)
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
        if data.get('Datas', {}).get('ETFCODE'):
            return fetch_fund_portfolio_codes(data['Datas']['ETFCODE'])
        if data.get('ErrCode') == 0 and data.get('Datas', {}).get('fundStocks'):
            return [item.get('GPJC') for item in data['Datas']['fundStocks'] if item.get('GPJC')]
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
                configs = WebhookConfig.query.filter_by(enabled=True).all()
                for config in configs:
                    keywords = get_user_keywords(config.user_id)
                    cooldown = config.interval_minutes * 60 if config.interval_minutes else 0
                    for news in reversed(news_items):
                        news_id = str(news.get('id', news.get('ctime')))
                        exists = SentNews.query.filter_by(user_id=config.user_id, news_id=news_id).first()
                        if exists:
                            continue
                        highlight = is_relevant(news, keywords)
                        if config.holdings_only and not highlight:
                            continue
                        if cooldown and config.last_sent_time:
                            elapsed = (datetime.utcnow() - config.last_sent_time).total_seconds()
                            if elapsed < cooldown:
                                continue

                        sentiment = analyze_sentiment(news.get('content', ''))
                        success = send_webhook_message(news, config, highlight, sentiment)
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

    user = User(email=email, name=name, password_hash=generate_password_hash(password))
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
    code = (data.get('code') or '').strip()
    name = (data.get('name') or '').strip() or code
    shares = float(data.get('shares') or 0)
    cost = float(data.get('cost') or 0)

    if not code:
        return jsonify({'error': '基金代码不能为空'}), 400

    existing = FundHolding.query.filter_by(user_id=g.current_user.id, code=code).first()
    if existing:
        return jsonify({'error': '该基金已存在'}), 409

    count = FundHolding.query.filter_by(user_id=g.current_user.id).count()
    fund = FundHolding(
        user_id=g.current_user.id,
        code=code,
        name=name,
        shares=shares,
        cost=cost,
        sort_order=count,
    )
    db.session.add(fund)
    db.session.commit()
    enqueue_portfolio_refresh(g.current_user.id, code)
    return jsonify({'fund': fund_to_dict(fund)})


@app.put('/api/funds/<int:fund_id>')
@auth_required
def update_fund(fund_id):
    fund = FundHolding.query.filter_by(id=fund_id, user_id=g.current_user.id).first()
    if not fund:
        return jsonify({'error': '基金不存在'}), 404
    data = request.get_json() or {}
    if 'name' in data:
        fund.name = data['name'] or fund.name
    if 'shares' in data:
        fund.shares = max(0, float(data['shares']))
    if 'cost' in data:
        fund.cost = max(0, float(data['cost']))
    if 'sortOrder' in data:
        fund.sort_order = int(data['sortOrder'])
    if 'code' in data and data['code'] and data['code'] != fund.code:
        fund.code = data['code']
        enqueue_portfolio_refresh(g.current_user.id, fund.code)
    db.session.commit()
    return jsonify({'fund': fund_to_dict(fund)})


@app.delete('/api/funds/<int:fund_id>')
@auth_required
def delete_fund(fund_id):
    fund = FundHolding.query.filter_by(id=fund_id, user_id=g.current_user.id).first()
    if not fund:
        return jsonify({'error': '基金不存在'}), 404
    db.session.delete(fund)
    db.session.commit()
    return jsonify({'success': True})


@app.post('/api/funds/<int:fund_id>/transactions')
@auth_required
def create_transaction(fund_id):
    fund = FundHolding.query.filter_by(id=fund_id, user_id=g.current_user.id).first()
    if not fund:
        return jsonify({'error': '基金不存在'}), 404

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
        return jsonify({'error': '基金不存在'}), 404
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
        code = payload.get('code')
        name = payload.get('name') or code
        if not code:
            continue
        fund = FundHolding(
            user_id=g.current_user.id,
            code=code,
            name=name,
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


@app.get('/api/webhook')
@auth_required
def get_webhook():
    config = WebhookConfig.query.filter_by(user_id=g.current_user.id).first()
    if not config:
        config = WebhookConfig(user_id=g.current_user.id)
        db.session.add(config)
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
            return jsonify({'error': '基金不存在'}), 404
        enqueue_portfolio_refresh(g.current_user.id, fund_code)
    else:
        funds = FundHolding.query.filter_by(user_id=g.current_user.id).all()
        for fund in funds:
            enqueue_portfolio_refresh(g.current_user.id, fund.code)
    return jsonify({'success': True})


@app.post('/api/ai/analyze')
def analyze():
    try:
        data = request.get_json() or {}
        if 'prompt' not in data:
            return jsonify({'error': 'Missing prompt'}), 400
        process = subprocess.Popen(
            ['claude'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=True,
        )
        stdout, stderr = process.communicate(input=data['prompt'])
        if process.returncode != 0:
            return jsonify({'error': f'Claude CLI failed: {stderr}'}), 500
        return jsonify({'result': stdout})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


def bootstrap():
    with app.app_context():
        db.create_all()
        funds = FundHolding.query.all()
        for fund in funds:
            if not fund.keywords:
                enqueue_portfolio_refresh(fund.user_id, fund.code)


bootstrap()

portfolio_thread = threading.Thread(target=portfolio_worker, daemon=True)
portfolio_thread.start()

news_thread = threading.Thread(target=news_worker, daemon=True)
news_thread.start()


if __name__ == '__main__':
    print('Starting API server on port 5001...')
    app.run(host='0.0.0.0', port=5001, debug=True)
