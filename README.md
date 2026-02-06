# My Positions 📈 · 自部署基金战情舱

[English](#english) | [中文](#chinese)

**Keep real-time CN fund valuations, webhook alerts, and AI analysis online no matter what happens to domestic apps.**

近期国内不少基金 App 因政策暂停“实时估值”展示。My Positions 通过完全自托管的 React + Flask + Claude CLI 堆栈，直接拉取公开行情/资讯接口，让研究者与投资团队继续掌握第一手估值与情报。

### 为什么现在要自托管？

1. **随时上线**：实时估值、交易流水、情报推送全部由自己服务器输出，不受第三方客户端下架影响。
2. **后台自动推送**：Webhook worker 常驻拉取财联社电报，自动过滤持仓相关并推送至钉钉/任意 Endpoint。
3. **开箱即用**：Docker Compose + SQLite，部署/迁移只需一条命令；支持多账号、JWT 认证、持仓导入导出。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/react-18.x-61DAFB.svg?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6.svg?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/python-3.8+-3776AB.svg?logo=python&logoColor=white)

---

<a name="english"></a>
## 🇬🇧 English

### Overview

**My Positions** is designed for investors who want more than just static net value updates. It provides real-time intraday valuation estimates for mutual funds based on their underlying stock holdings and utilizes local AI (Claude) to analyze how breaking news impacts your specific portfolio.

### ✨ Key Features

#### 📊 Real-time Portfolio Tracking
*   **Intraday Valuation**: Estimates fund net value in real-time during trading hours based on stock holdings.
*   **Performance Metrics**: Track daily gains, total return, and holding yields at a glance.
*   **Visual Analytics**: Interactive charts for daily profit trends and asset distribution.
*   **Market Pulse**: Real-time monitoring of major indices (Shanghai Composite, ChiNext, etc.).

#### 👤 Account & Persistence
*   **User Registration/Login**: Secure account system with JWT authentication.
*   **Cloud Portfolio Storage**: Funds and transactions are persisted in backend SQLite database.
*   **Multi-user Isolation**: Each user has independent funds, webhook settings, and push history.

#### 🤖 AI-Powered Intelligence
*   **Smart News Feed**: Aggregates 24/7 financial news from Cailian Press (财联社).
*   **Portfolio Relevance**: Automatically identifies news affecting your specific holdings (penetrating to stock level).
*   **AI Analysis**:
    *   **Impact Assessment**: Classifies news as Bullish (利好), Bearish (利空), or Neutral.
    *   **Reasoning**: Provides concise, logic-based explanations for the assessment.
    *   **Holdings Linkage**: Explicitly points out which of your funds/stocks are affected.

#### 🔔 Webhook Daemon Push
*   **Server-side Worker**: Backend continuously pulls latest telegraph news every minute.
*   **No Open Page Needed**: Push runs in backend daemon after configuration.
*   **Custom Webhook**: Supports DingTalk and generic webhook endpoints.

### 🛠 Tech Stack

*   **Frontend**: React 18, TypeScript, Vite, CSS Modules
*   **Backend / API / Worker**: Python, Flask, Flask-SQLAlchemy, SQLite, JWT
*   **AI Engine**: Local Claude CLI (Anthropic)
*   **Data Sources**: EastMoney (Fund/Stock data), Cailian Press (News)

### 🚀 Getting Started

#### Method 1: Docker (Recommended)

Requires [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/).

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/slicenferqin/my-positions.git
    cd my-positions
    ```

2.  **Configure environment variables**:
    ```bash
    cp .env.example .env  # if you create one yourself, at least set JWT_SECRET
    ```
    Minimal required variables:
    *   `JWT_SECRET`: a strong random secret
    *   Optional: `JWT_EXPIRES_DAYS`, `NEWS_POLL_SECONDS`

3.  **Authenticate Claude CLI**:
    Ensure you have authenticated with Claude CLI on your host machine. Docker will use your local credentials via volume mounting.
    *   Default paths mounted: `~/.anthropic` and `~/.config/claude-code`
    *   If your credentials are elsewhere, update `docker-compose.yml`.

4.  **Start Services**:
    ```bash
    docker-compose up -d
    ```
    Access the application at `http://localhost:3001`.

#### Method 2: Manual Setup

#### Prerequisites

*   Node.js (v16+)
*   Python (v3.8+)
*   [Claude CLI](https://github.com/anthropics/claude-code) (installed and authenticated)

#### 1. Start the AI Proxy Server

The Python backend now provides authentication, portfolio persistence, webhook daemon push, and AI proxy.

```bash
cd server

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure env (required)
export JWT_SECRET='change-this-to-a-strong-secret'

# Run the server (default port: 5001)
python app.py
```

#### 2. Start the Frontend Application

```bash
# In the project root
npm install

# Start development server
npm run dev
```

Visit `http://localhost:3000` to access the dashboard.

### 📖 Usage Guide

1.  **Create Account**: Register or login first.
2.  **Add Funds**: Go to the "Positions" tab, click "Add Fund", and enter code/shares/cost.
3.  **Configure Webhook**: In "News" tab, open webhook panel and save your endpoint.
4.  **Daemon Push**: Keep backend running; webhook push continues even if browser page is closed.

### ⚠️ Disclaimer

*   **Investment Risk**: All data and AI analyses are for reference only. Market data may have delays. This tool does not constitute investment advice.
*   **Data Accuracy**: Fund valuations are estimates based on disclosed quarterly holdings and may differ from actual net values due to position adjustments by fund managers.

---

<a name="chinese"></a>
## 🇨🇳 中文

### 概览

**My Positions** 专为不满足于静态净值更新的投资者设计。它基于底层持仓股票提供基金的实时盘中估值，并利用本地 AI (Claude) 分析突发新闻对您特定持仓的影响。

### ✨ 核心功能

#### 📊 实时持仓追踪
*   **盘中估值**: 在交易时段内，基于持仓股票实时估算基金净值。
*   **收益指标**: 一目了然地追踪当日收益、累计收益和持有收益率。
*   **可视化分析**: 提供日收益趋势和资产分布的交互式图表。
*   **市场脉搏**: 实时监控主要指数（上证指数、创业板指等）。

#### 👤 账号与数据持久化
*   **用户注册/登录**: 基于 JWT 的认证体系。
*   **持仓云端保存**: 基金和交易记录持久化到后端 SQLite 数据库。
*   **多用户隔离**: 每个用户独立管理持仓、Webhook 配置与推送记录。

#### 🤖 AI 智能情报
*   **智能资讯流**: 聚合财联社 24/7 财经电报。
*   **持仓关联**: 自动识别影响您特定持仓的新闻（穿透至股票级别）。
*   **AI 深度解读**:
    *   **影响评估**: 自动判断新闻性质为 利好、利空 或 中性。
    *   **逻辑推理**: 提供简明扼要的逻辑分析。
    *   **持仓联动**: 明确指出您的哪些基金/股票受到了影响。

#### 🔔 Webhook 后台推送
*   **后端常驻 Worker**: 默认每 60 秒拉取最新快讯。
*   **无需打开页面**: 配置后由后端持续推送。
*   **自定义 Webhook**: 支持钉钉机器人与通用 webhook。

### 🛠 技术栈

*   **前端**: React 18, TypeScript, Vite, CSS Modules
*   **后端 / API / Worker**: Python, Flask, Flask-SQLAlchemy, SQLite, JWT
*   **AI 引擎**: 本地 Claude CLI (Anthropic)
*   **数据源**: 天天基金/东方财富 (行情数据), 财联社 (资讯)

### 🚀 快速开始

#### 方式一：Docker 一键部署（推荐）

1. 克隆项目并进入目录。
2. 配置环境变量（至少设置 `JWT_SECRET`，可选 `JWT_EXPIRES_DAYS`、`NEWS_POLL_SECONDS`）。
3. 确保本机 Claude CLI 已登录（将通过挂载目录复用凭据）。
4. 启动：
   ```bash
   docker-compose up -d
   ```
5. 打开 `http://localhost:3000`。

#### 前置要求

*   Node.js (v16+)
*   Python (v3.8+)
*   [Claude CLI](https://github.com/anthropics/claude-code) (已安装并完成认证)

#### 1. 启动 AI 代理服务

Python 后端作为前端与本地 Claude CLI 之间的桥梁，实现安全、无限制的分析调用。

```bash
cd server

# 创建并激活虚拟环境
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 设置环境变量（必须）
export JWT_SECRET='请改成高强度随机字符串'

# 运行服务器 (默认端口: 5001)
python app.py
```

#### 2. 启动前端应用

```bash
# 在项目根目录下
npm install

# 启动开发服务器
npm run dev
```

访问 `http://localhost:3001` 进入控制台。

### 📖 使用指南

1.  **注册/登录**: 首次使用先创建账号。
2.  **添加基金**: 在“我的持仓”中录入基金与份额成本。
3.  **配置 Webhook**: 在“7x24快讯”中填写并保存 webhook。
4.  **后台自动推送**: 保持后端运行即可，不需要打开前端页面。

### ⚠️ 免责声明

*   **投资风险**: 所有数据和 AI 分析仅供参考。行情数据可能存在延迟。本工具不构成任何投资建议。
*   **数据准确性**: 基金估值基于公开的季度持仓估算，可能因基金经理调仓而与实际净值存在偏差。

---

## 📄 License

This project is licensed under the MIT License.
