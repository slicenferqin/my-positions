# AI 智能情报分析系统 + UI/UX 重构 — 实施方案

## Context

当前 myPositions 是一个基金持仓追踪工具，已有多用户认证、实时估值、新闻推送等功能。目标是将其升级为成熟产品，包含两大升级：

1. **AI 驱动的情报分析系统**：每条新闻自动分析，判断涉及板块/个股、情绪、影响程度，并与用户持仓关联
2. **UI/UX 全面重构**：从赛博朋克暗色风格转向现代浅色金融风格，引入 Semi Design 组件库，优化信息架构

用户决策：
- AI 走 OpenAI 协议（自定义端点+Key）
- 保持 SQLite
- Phase 2 优先（AI 分析系统）
- 视觉风格：现代浅色金融风（类似雪球/蚂蚁财富）
- UI 框架：Semi Design
- 导航结构：双 Tab（持仓概览 | 智能情报）

## 核心架构：两层分析

```
新闻入库 → Layer1 全局AI分析(1次/条) → Layer2 用户关联匹配(纯代码) → 前端展示
```

- Layer1 成本与用户数无关，结果所有用户共享
- Layer2 是纯代码匹配，零 AI 开销

---

## 实施步骤

### Step 1: 新增数据模型 (server/app.py)

在现有 `SentNews` 模型之后添加 4 个新模型：

1. **NewsCache** — 新闻缓存（后端持久化新闻，不再依赖前端直接调财联社）
   - `news_id` (String, unique, indexed), `title`, `content`, `brief`, `ctime` (Integer, indexed), `raw_json` (Text)

2. **NewsAnalysis** — Layer1 全局分析结果
   - `news_id` (FK→news_cache), `sectors` (JSON数组), `stocks` (JSON数组，含name+code), `sentiment` (bullish/bearish/neutral), `impact_level` (major/moderate/minor), `summary`, `background`, `tags` (JSON), `model_used`, `token_count`, `analyzed_at`, `error`

3. **UserNewsRelevance** — Layer2 用户关联
   - `user_id` (FK→users), `news_id` (FK→news_cache), `relevance_score` (Float 0-1), `matched_stocks` (JSON), `matched_sectors` (JSON), `personalized_comment` (可选)
   - Unique(user_id, news_id)

4. **AIConfig** — AI 配置（key-value 存储）
   - `key` (String, unique), `value` (Text)
   - 支持的 key: `ai_base_url`, `ai_api_key`, `ai_model_fast`, `ai_model_deep`, `ai_enabled`, `ai_batch_size`

### Step 2: AI 服务层 (server/app.py)

替换现有 Claude CLI 子进程调用，改用 `openai` Python SDK：

- `get_ai_client()` — 从 AIConfig 表或环境变量读取 base_url + api_key，创建 OpenAI 客户端
- `_get_ai_config(key, default)` / `_set_ai_config(key, value)` — 配置读写
- `is_ai_enabled()` — 主开关
- `analyze_news_layer1(news_items: list)` — 批量 Layer1 分析，返回结构化 JSON
- `compute_user_relevance(analysis, user_id)` — Layer2 纯代码匹配，无 AI 调用

Layer1 Prompt 设计要点：
- System prompt 定义为"中国A股金融分析师"
- 要求返回 JSON 数组，每条包含 sectors/stocks/sentiment/impact_level/summary/background/tags
- temperature=0.3，要求结构化输出
- 批量处理（默认5条一组）

Layer2 匹配逻辑：
- 将 AI 提取的 stocks/sectors 与用户持仓 keywords 做交集
- 个股直接匹配 +0.3 分，板块匹配 +0.15 分，文本关键词匹配 +0.05 分
- impact_level=major 时分数 ×1.5
- score > 0 才存入 UserNewsRelevance

### Step 3: Worker 改造 (server/app.py)

**修改 `news_worker`**（现有函数，~line 402）：
- 新增：获取新闻后，upsert 到 NewsCache 表
- 新增：未分析的新闻 ID 放入 `analysis_queue`（queue.Queue）
- 保持：现有 webhook 推送逻辑不变

**新增 `analysis_worker`**：
- 从 analysis_queue 取新闻 ID（批量，等待+非阻塞填充）
- 检查 AI 是否启用
- 调用 `analyze_news_layer1()` 做 Layer1 分析
- 存储 NewsAnalysis 结果
- 遍历所有用户，调用 `compute_user_relevance()` 做 Layer2 匹配
- 存储 UserNewsRelevance 结果
- 作为 daemon thread 启动

### Step 4: 新增 API 端点 (server/app.py)

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/news/analyzed` | GET | 是 | 分页获取新闻+分析结果+用户关联度，支持 sentiment/impact 筛选 |
| `/api/news/<` | GET | 是 | 单条新闻完整分析 |
| `/api/news/relevant` | GET | 是 | 仅返回与当前用户持仓相关的新闻，按时间倒序 |
| `/api/ai/config` | GET | 是 | 获取 AI 配置（key 脱敏）+ 统计数据 |
| `/api/ai/config` | PUT | 是 | 更新 AI 配置 |

替换现有 `/api/ai/analyze`：从 Claude CLI 子进程改为 OpenAI SDK 调用。

### Step 5: 前端类型定义 (src/types/news.ts)

新增类型：
- `NewsAnalysisResult` — 分析结果（sectors, stocks, sentiment, impactLevel, summary, background, tags）
- `UserRelevance` — 用户关联（relevanceScore, matchedStocks, matchedSectors）
- `AnalyzedNewsItem` — 合并新闻+分析+关联的完整对象
- `AIConfigResponse` — AI 配置响应

### Step 6: 前端 API 服务 (src/services/api.ts)

新增函数：
- `fetchAnalyzedNews(token, params)` — 获取分析后的新闻列表
- `fetchRelevantNews(token, params)` — 获取与我相关的新闻
- `fetchNewsAnalysis(token, newsId)` — 获取单条分析详情
- `fetchAIConfig(token)` / `updateAIConfig(token, data)` — AI 配置管理

### Step 7: 前端 NewsFeed 组件改造 (src/components/NewsFeed.tsx)

核心改动：
1. **数据源切换**调财联社 API 改为调后端 `/api/news/analyzed`
2. **分析卡片**：每条新闻下方显示 AI 分析摘要（情绪标签、涉及板块、一句话总结）
3. **展开详情**：点击展开完整分析（背景信息、涉及个股、影响评估）
4. **关联标记**：与用户持仓相关的新闻高亮显示，标注命中的持仓
5. **筛选增强**：新增按情绪（利好/利空）、影响程度（重大/一般）、板块筛选
6. **"与我相关"模式**：切换到 `/api/news/relevant` 数据源，只看关联新闻

### Step 8: AI 配置面板 (新组件或集成到 NewsFeed)

- 配置 AI 端点 URL、API Key、模型选择
- 显示分析统计（今日已分析、队列待处理）
- AI 开关（启用/禁用）
- 集成到现有 webhook 配置面板旁边

### Step 9: 配置与部署更新

- `server/requirements.txt`：添加 `openai>=1.0.0`
- `docker-compose.yml`：添加环境变量 `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL_FAST`, `AI_MODEL_DEEP`, `AI_ENABLED`
- `server/Dockerfile`：移除 Node.js 和 Claude CLI 安装（不再需要）
- `nginx.conf`：添加 `/api/news` 代理规则
- `vite.config.ts`：添加 `/api/news` 开发代理

---

## UI/UX 重构方案

### 设计系统

**配色方案（现代浅色金融风）：**
- 背景色：`#ffffff` (纯白)
- 次级背景：`#f5f7fa` (浅灰)
- 主色调：`#1677ff` (蓝色，Semi Design 默认)
- 成功/上涨：`#f5222d` (红色，中国市场习惯)
- 失败/下跌：`#52c41a` (绿色)
- 警告：`#faad14` (橙色)
- 文字主色：`#1f2329` (深灰)
- 文字次要：`#646a73` (中灰)
- 边框：`#e5e6eb` (浅灰)

**字体系统：**
- 主字体：`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
- 数字字体：`'SF Mono', 'Roboto Mono', Consolas, monospace` (保持等宽)
- 基础字号：14px
- 标题字号：16px (h3), 18px (h2), 2**间距系统（8px 基准）：**
- xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px

**圆角系统：**
- 小圆角：4px (按钮、输入框)
- 中圆角：8px (卡片)
- 大圆角：12px (大卡片、模态框)

**阴影系统：**
- 卡片：`0 1px 2px rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px rgba(0, 0, 0, 0.02)`
- 悬浮：`0 4px 12px rgba(0, 0, 0, 0.08)`
- 模态框：`0 6px 16px rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)`

### 新导航结构

```
┌─────────────────────────────────────────────────────────┐
│  Header (固定顶部)                                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Logo  [持仓概览]情报]    市场脉搏  用户头像 │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  Tab Content (根据选中 Tab 切换)                         │
│                                                         │
│  Tab 1: 持仓概览                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 资产概览卡片 (总资产、今日收益、总收益)           │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 持仓列表 (Table 组件，支持基金+股票)              │   │
│  │ - 可展开查看详情                                  │   │
│  │ - 可排序                                          │   │
│  │ - 操作按钮（买入、卖出、删除）                     │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌──────────────────┐ ┌──────────────────┐            │
│  │ 收益日历热力图    │ │ 持仓分析 X-Ray   │            │
│  └──────────────────┘ └──────────────────┘            │
│                                                         │
│  Tab 2: 智能情报                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 筛选栏 (与我相关/全部, 情绪, 板块, 影响程度)      │   │
│ ───────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 新闻列表 (List 组件)                              │   │
│  │ ┌─────────────────────────────────────────────┐ │   │
│  │ │ 🔴 利好 | 央行降准 0.5 个百分点               │ │   │
│  │ │ AI: 利好银行、地产板块，与您持仓的XX基金高度  │ │   │
│  │ │     相关 (关联度 85%)                         │ │   │
│  │ │ [展开详情] [收藏] [忽略]                      │ │   │
│  │ └─────────────────────────────────────────────┘ │   │
│  │ ┌─────────────────────────────────────────────┐ │   │
│  │ │ ⚪ 中性 | 某公司发布 Q3          │ │   │
│  │ │ AI: 营收符合预期，影响较小                    │ │   │
│  │ └─────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 配置面板 (Collapse 组件)                          │   │
│  │ - AI 配置 (端点、Key、模型)                       │   │
│  │ - Webhook 配置                                    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 组件改造清单

| 原组件 | 改造方案 | Semi Design 组件 |
|--------|---------|-----------------|
| `App.tsx` | 重构为 Tabs 布局，移除 cyberpunk 元素 | `Tabs`, `Layout` |
| `AuthScreen.tsx` | 简化为 Card + Form，移除渐变背景 | `Card`, `Form`, `Input`, `Button` |
| `FundTable.tsx` | 改用 Semi Table，保留展开行功能 | `Table`, `Button`, `Popconfirm` |
| `PortfolioSummary.tsx` | 改为 Card 布局，数字更突出 | `Card`, `Statistic` |
| `MarketIndices.tsx` | 改为横向滚动卡片，简化样式 | `Card`, `Space` |
| `NewsFeed.tsx` | 重构为 List + Filter，集成 AI 分析展示 | `List`, `Tag`, `Collapse`, `Badge` |
| `PortfolioAnalysis.tsx` | 保持功能，简化样式 | `Card`, `Progress` |
| `ProfitChart.tsx` | 保持热力图，调整配色 | 自定义 SVG + `Tooltip` |
| `Toolbar.tsx` | 改为 Space + Button 组合 | `Space`, `Button`, `DropdowdFundForm.tsx` | 改用 Semi Modal + Form | `Modal`, `Form`, `Input`, `Select` |
| `EditFundForm.tsx` | 同上 | `Modal`, `Form` |
| `TransactionForm.tsx` | 同上 | `Modal`, `Form`, `Tabs` |

### 新增组件

1. **AIConfigPanel.tsx** — AI 配置面板
   - 使用 `Form` + `Input` + `Switch`
   - 显示统计数据（今日已分析、队列待处理）
   - 测试连接按钮

2. **NewsAnalysisCard.tsx** — 新闻 AI 分析卡片
   - 显示情绪标签、涉及板块、一句话总结
   - 可展开查看完整分析（背景信息、涉及个股）
   - 关联度指示器（与用户持仓的匹配程度）

3. **RelevanceIndicator.tsx** — 关联度指示器
   - 进度条 + 百分比
   - 显示命中的持仓名称

### CSS 迁移策略

1. **移除文件**：
   - 所有 cyberpunk 相关样式（aurora, grid-overlay, glassmorphism）
   - 自定义按钮、输入框样式（改用 Semi Design）

2. **保留文件**：
   - `ProfitChart.css` — 热力图样式（调整配色）
   - `Tret.css` — 走势图样式（调整配色）
   - 部分自定义动画（如 flash 效果）

3. **新增文件**：
   - `theme.css` — 全局主题变量和覆盖 Semi Design 默认样式
   - `layout.css` — 布局相关样式

### Semi Design 配置

**安装依赖：**
```bash
npm install @douyinfe/semi-ui @douyinfe/semi-icons
```

**主题定制（src/theme.css）：**
```css
:root {
  --semi-color-primary: #1677ff;
  --semi-color-success: #f5222d;  /* 红涨 */
  --semi-color-danger: #52c41a;   /* 绿跌 */
  --semi-color-warning: #faad14;
  --semi-border-radius-small: 4px;
  --semi-border-radius-medium: 8px;
  --semi-border-radius-large: 12px;
}
```

---
## 实施步骤（更新）

### Phase 1: 依赖和配置

1. 安装 Semi Design：`npm install @douyinfe/semi-ui @douyinfe/semi-icons`
2. 安装 OpenAI SDK：`pip install openai>=1.0.0`
3. 创建 `src/theme.css` 并在 `main.tsx` 中引入
4. 更新 `vite.config.ts` 支持 Semi Design 按需加载

### Phase 2: 后端 AI 分析系统（同原方案 Step 1-4）

（保持不变，见上文）

### Phase 3: 前端 UI 框架迁移

1. **App.tsx 重构**：
   - 引入 `Tabs`, `Layout` 组件
   - 创建两个 Tab：持仓概览、智能情报
   - 移除 cyberpunk 样式

2. **AuthScreen.tsx 简化**：
   - 使用 `Card` + `Form` 替换自定义样式
   - 移除渐变背景和 glassmorphism

3. **FundTable.tsx 迁移**：
   - 改用 `<Table>` 组件
   - 配置 columns 和 expandedRowRender
   - 保留排序、展开功能

4. **PortfolioSummarx 改造**：
   - 使用 `Card` + `Statistic` 展示资产概览
   - 更清晰的数字层级

5. **MarketIndices.tsx 简化**：
   - 使用 `Space` + `Card` 横向布局
   - 移除复杂动画

### Phase 4: 智能情报 Tab 开发

1. **NewsFeed.tsx 重构**：
   - 顶部筛选栏：`Radio.Group`（与我相关/全部）+ `Select`（情绪、板块、影响程度）
   - 新闻列表：`List` 组件
   - 每条新闻集成 `NewsAnalysisCard`
   - 底部配置面板：`Collapse` 包裹 AI 配置和 Webhook 配置

2. **NewsAnalysisCard.tsx 新建**：
   - 显示 AI 分析摘要（情绪 Tag + 一句话总结）
   - 展开按钮查看完整分析
   - 关联度指示器（如果与用户持仓相关）

3. **AIConfigPanel.tsx 新建**：
   - `Form` 表单配置 AI 端点、Key、模型
   - 显示统计数据（`Statistic` 组件）
   - 测试连接按钮

### Phase 5: 样式清理和优化

1. 删除所有 cyberpunk 相关 CSS
2. 调整 `ProfitChart.css` 和 `TrendChart.css` 配色
3. 创建 `layout.css` 统一布局样式
4. 响应式适配（移动端优化）

---

## 关键文件清单（更新）

| 文件 | 操作 |
|------|------|
| **后端** | |
| `server/app.py` | 重点修改：新模型、AI服务、新Worker、新API |
| `server/requirements.txt` | 添加 openai 依赖 |
| `server/Dockerfile` | 精简（移除 Node.js） |
| **前端 - 类型** | |
| `src/types/news.ts` | 新增分析相关类型 |
| **前端 - 服务** | |
| `src/services/api.ts` | 新增 API 调用函数 |
| **前端 - 组件（重构）** | |
| `src/App.tsx` | 重构为 Tabs 布局 |
| `src/components/AuthScreen.tsx` | 简化为 Semi Card + Form |
| `src/components/FundTable.tsx` | 改用 Semi Table |
| `src/components/PortfolioSummary.tsx` | 改用 Semi Card + Statistic |
| `src/components/MarketIndices.tsx` | 简化样式 |
| `src/components/NewsFeed.tsx` | 重构：接入分析数据、新UI |
| `src/components/Toolbar.tsx` | 改用 Semi Space + Button |
| `src/components/AddFundForm.tsx` | 改用 Semi Modal + Form |
| `src/components/EditFundForm.tsx` | 同上 |
| `src/components/TransactionForm.tsx` | 同上 |
| **前端 - 组件（新增）** | |
| `src/components/NewsAnalysisCard.tsx` | 新建：AI 分析卡片 |
| `src/components/AIConfigPanel.tsx` | 新建：AI 配置面板 |
| `src/components/RelevanceIndicator.tsx` | 新建：关联度指示器 |
| **前端 - 样式** | |
| `src/theme.css` | 新建：Semi Design 主题定制 |
| `src/layout.css` | 新建：布局样式 |
| `src/App.css` | 大幅简化，移除 cyberpunk 样式 |
| `src/components/*.css` | 大部分删除或简化 |
| **配置** | |
| `package.json` | 添加 Semi Design 依赖 |
| `vite.config.ts` | 新增 /api/news 代理 |
| `docker-compose.yml` | 新增 AI 环境变量 |
| `nginx.conf` | 新增 /api/news 代理 |

---

## 验证方案

**后端验证：**
1. 启动后端，配置 AI 端点和 Key
2. 等待 news_worker 拉取新闻并入库
3. 确认 analysis_worker 自动分析新闻（查看日志）
4. 调用 `GET /api/news/analyzed` 验证分析结果
5. 添加基金持仓，调用 `GET /api/news/relevant` 验证关联匹配

**前端验证：**
1. 验证 Tabs 切换正常（持仓概览 ↔ 智能情报）
2. 验证持仓列表使用 Semi Table 展示，可排序、可展开
3. 验证智能情报 Tab 显示 AI 分析后的新闻
4. 验证新闻卡片展示情绪标关联度
5. 验证筛选功能（与我相关、按情绪、按板块）
6. 验证 AI 配置面板的读写功能
7. 验证移动端响应式布局

**视觉验证：**
1. 确认整体为浅色主题，白色背景
2. 确认主色调为蓝色 (#1677ff)
3. 确认红涨绿跌配色正确
4. 确认所有组件使用 Semi Design 风格
5. 确认无 cyberpunk 元素残留

---

## 成本估算

假设用 OpenAI 协议兼容的 API：

| 场景 | 频率 | 单次成本估算 | 日成本 |
|------|------|-------------|--------|
| Layer1 全局分析 | ~300条/天 | ~$0.003 (快速模型) | ~$0.9 |
| Layer1 深度分析 | ~50条重要新闻 | ~$0.015 (深度模型) | ~$0.75 |
| 个性化点评 | ~20条/用户/天 | ~$0.003 (快速模型) | ~$0.06/用户 |
| 每日简报 | 1次/用户/天 | ~$0.015 (深度模型) | ~$0.015/用户 |

**10个用户日成本约 $2.4，100个用户约 $9。完全可控。**

---

## 技术栈总结

**后端：**
- Python 3.11 + Flask 3.0
- SQLite (SQLAlchemy ORM)
- OpenAI SDK (兼容协议)
- 多线程 Worker (news_worker, portfolio_worker, analysis_worker)

**前端：**
- React 18 + TypeScript
- Vite 6.0
- Semi Design UI 组件库
- React Markdown (AI 分析展示)

**部署：**
- Docker + Docker Compose
- Nginx 反向代理
- 数据持久化 (SQLite volume)

**数据源：**
- 基金数据：天天基金 API
- 市场指数：东方财富 API
- 新闻源：财联社 API
- AI 分析：OpenAI 协议兼容端点

---

## 项目里程碑

- [ ] Phase 1: 依赖和配置 (0.5天)
- [ ] Phase 2: 后端 AI 分析系统 (1.5天)
- [ ] Phase 3: 前端 UI 框架迁移 (1天)
- [ ] Phase 4: 智能情报 Tab 开发 (1天)
- [ ] Phase 5: 样式清理和优化 (0.5天)
- [ ] 集成测试和 Bug 修复 (0.5天)

**预计总工期：5天**
