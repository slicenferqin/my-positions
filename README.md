# My Positions 📈

[English](#english) | [中文](#chinese)

A sophisticated personal fund tracking and analysis dashboard that combines real-time valuation with AI-powered market intelligence.

一款结合实时估值与 AI 市场情报的智能基金持仓追踪与分析看板。

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

#### 🤖 AI-Powered Intelligence
*   **Smart News Feed**: Aggregates 24/7 financial news from Cailian Press (财联社).
*   **Portfolio Relevance**: Automatically identifies news affecting your specific holdings (penetrating to stock level).
*   **AI Analysis**:
    *   **Impact Assessment**: Classifies news as Bullish (利好), Bearish (利空), or Neutral.
    *   **Reasoning**: Provides concise, logic-based explanations for the assessment.
    *   **Holdings Linkage**: Explicitly points out which of your funds/stocks are affected.

### 🛠 Tech Stack

*   **Frontend**: React 18, TypeScript, Vite, CSS Modules
*   **Backend / AI Proxy**: Python, Flask
*   **AI Engine**: Local Claude CLI (Anthropic)
*   **Data Sources**: EastMoney (Fund/Stock data), Cailian Press (News)

### 🚀 Getting Started

#### Prerequisites

*   Node.js (v16+)
*   Python (v3.8+)
*   [Claude CLI](https://github.com/anthropics/claude-code) (installed and authenticated)

#### 1. Start the AI Proxy Server

The Python backend acts as a bridge between the frontend and your local Claude CLI for secure, unlimited analysis.

```bash
cd server

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

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

1.  **Add Funds**: Go to the "Positions" tab, click "Add Fund", and enter the fund code (e.g., `000001`), shares held, and cost.
2.  **Monitor**: Watch real-time valuations change during trading hours.
3.  **News & AI**: Switch to the "News" tab. The system will automatically highlight news related to your holdings and generate AI analysis cards for significant events.

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

#### 🤖 AI 智能情报
*   **智能资讯流**: 聚合财联社 24/7 财经电报。
*   **持仓关联**: 自动识别影响您特定持仓的新闻（穿透至股票级别）。
*   **AI 深度解读**:
    *   **影响评估**: 自动判断新闻性质为 利好、利空 或 中性。
    *   **逻辑推理**: 提供简明扼要的逻辑分析。
    *   **持仓联动**: 明确指出您的哪些基金/股票受到了影响。

### 🛠 技术栈

*   **前端**: React 18, TypeScript, Vite, CSS Modules
*   **后端 / AI 代理**: Python, Flask
*   **AI 引擎**: 本地 Claude CLI (Anthropic)
*   **数据源**: 天天基金/东方财富 (行情数据), 财联社 (资讯)

### 🚀 快速开始

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

访问 `http://localhost:3000` 进入控制台。

### 📖 使用指南

1.  **添加基金**: 进入“持仓”标签页，点击“添加基金”，输入基金代码（如 `000001`）、持有份额和成本。
2.  **实时监控**: 在交易时段观看估值实时跳动。
3.  **资讯与 AI**: 切换到“资讯”标签页。系统会自动高亮与您持仓相关的新闻，并对重要事件生成 AI 解读卡片。

### ⚠️ 免责声明

*   **投资风险**: 所有数据和 AI 分析仅供参考。行情数据可能存在延迟。本工具不构成任何投资建议。
*   **数据准确性**: 基金估值基于公开的季度持仓估算，可能因基金经理调仓而与实际净值存在偏差。

---

## 📄 License

This project is licensed under the MIT License.
