# My Positions 📈

A sophisticated personal fund tracking and analysis dashboard that combines real-time valuation with AI-powered market intelligence.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/react-18.x-61DAFB.svg?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6.svg?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/python-3.8+-3776AB.svg?logo=python&logoColor=white)

## Overview

**My Positions** is designed for investors who want more than just static net value updates. It provides real-time intraday valuation estimates for mutual funds based on their underlying stock holdings and utilizes local AI (Claude) to analyze how breaking news impacts your specific portfolio.

## ✨ Key Features

### 📊 Real-time Portfolio Tracking
*   **Intraday Valuation**: Estimates fund net value in real-time during trading hours based on stock holdings.
*   **Performance Metrics**: Track daily gains, total return, and holding yields at a glance.
*   **Visual Analytics**: Interactive charts for daily profit trends and asset distribution.
*   **Market Pulse**: Real-time monitoring of major indices (Shanghai Composite, ChiNext, etc.).

### 🤖 AI-Powered Intelligence
*   **Smart News Feed**: Aggregates 24/7 financial news from Cailian Press (财联社).
*   **Portfolio Relevance**: Automatically identifies news affecting your specific holdings (penetrating to stock level).
*   **AI Analysis**:
    *   **Impact Assessment**: Classifies news as Bullish (利好), Bearish (利空), or Neutral.
    *   **Reasoning**: Provides concise, logic-based explanations for the assessment.
    *   **Holdings Linkage**: Explicitly points out which of your funds/stocks are affected.

## 🛠 Tech Stack

*   **Frontend**: React 18, TypeScript, Vite, CSS Modules
*   **Backend / AI Proxy**: Python, Flask
*   **AI Engine**: Local Claude CLI (Anthropic)
*   **Data Sources**: EastMoney (Fund/Stock data), Cailian Press (News)

## 🚀 Getting Started

### Prerequisites

*   Node.js (v16+)
*   Python (v3.8+)
*   [Claude CLI](https://github.com/anthropics/claude-code) (installed and authenticated)

### 1. Start the AI Proxy Server

The Python backend acts as a bridge between the frontend and your local Claude CLI for secure, unlimited analysis.

```bash
cd server

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server (default port: 5000)
python app.py
```

### 2. Start the Frontend Application

```bash
# In the project root
npm install

# Start development server
npm run dev
```

Visit `http://localhost:3000` to access the dashboard.

## 📖 Usage Guide

1.  **Add Funds**: Go to the "Positions" tab, click "Add Fund", and enter the fund code (e.g., `000001`), shares held, and cost.
2.  **Monitor**: Watch real-time valuations change during trading hours.
3.  **News & AI**: Switch to the "News" tab. The system will automatically highlight news related to your holdings and generate AI analysis cards for significant events.

## ⚠️ Disclaimer

*   **Investment Risk**: All data and AI analyses are for reference only. Market data may have delays. This tool does not constitute investment advice.
*   **Data Accuracy**: Fund valuations are estimates based on disclosed quarterly holdings and may differ from actual net values due to position adjustments by fund managers.

## 📄 License

This project is licensed under the MIT License.
