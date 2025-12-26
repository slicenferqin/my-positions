# 财经资讯功能设计方案

## 1. 概述
在现有"我的持仓"基础上，增加"财经资讯"（电报）功能，接入财联社（Cailianshe）24小时电报数据。用户可以通过顶部标签页在"持仓"和"资讯"之间切换。

## 2. 界面布局设计

### 2.1 顶部导航
- **位置**：`App-header` 区域。
- **样式**：采用分段控制器（Segmented Control）或标签页（Tabs）样式。
- **选项**：
  - `我的持仓` (默认选中)
  - `7x24快讯`

### 2.2 资讯列表页 (NewsFeed)
- **布局**：垂直时间轴或卡片列表。
- **卡片内容**：
  - **时间**：显示 `HH:mm` (如 14:30)。
  - **标题/摘要**：加粗显示核心内容。
  - **正文**：显示详细资讯内容，支持展开/收起（如果内容过长）。
  - **标签**：如有重要标签（如"利好"、"利空" - 需根据内容分析或接口数据），可高亮显示。
- **交互**：
  - 下拉刷新 / 点击刷新按钮。
  - 自动刷新（可选，如每60秒）。

### 2.3 响应式适配
- **桌面端**：资讯列表宽度限制在 `800px` 以内，居中显示，避免阅读视线过长。
- **移动端**：占满屏幕宽度，左右留白 `12px`。

## 3. 技术实现方案

### 3.1 数据来源
- **源站**：财联社 (www.cls.cn)
- **接口地址**：`https://www.cls.cn/nodeapi/telegraphList`
- **请求参数**：
  ```json
  {
    "app": "CailianpressWeb",
    "os": "web",
    "refresh_type": "1",
    "order": "1",
    "rn": "20", // 每页数量
    "sv": "8.4.6"
  }
  ```
- **跨域处理**：在 Vite 开发服务器中配置代理转发。

### 3.2 代理配置 (vite.config.ts)
需新增 `/api/cls` 代理规则：
```typescript
'/api/cls': {
  target: 'https://www.cls.cn',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/cls/, ''),
  headers: {
    'Referer': 'https://www.cls.cn/telegraph',
    'User-Agent': 'Mozilla/5.0 ...'
  }
}
```

### 3.3 数据结构 (Types)
```typescript
export interface NewsItem {
  id: string;      // 对应接口中的 id 或 unique key
  title: string;   // 标题
  content: string; // 正文内容
  ctime: number;   // 发布时间戳 (秒)
  brief?: string;  // 摘要
}
```

### 3.4 组件拆分
1. **`NewsTab`**: 容器组件，负责获取数据、处理刷新逻辑。
2. **`NewsCard`**: 展示单条资讯，处理样式渲染。
3. **`App`**: 增加 `activeTab` 状态 (`'positions' | 'news'`)。

## 4. 后续扩展
- **关键词高亮**：对"涨停"、"利好"等词汇进行红色高亮。
- **相关基金关联**：如果资讯提及某板块（如"半导体"），且用户持有相关基金，可显示关联提示（需后端NLP支持，暂不实现）。

## 5. 开发计划
1.  **配置代理**：修改 `vite.config.ts`。
2.  **API封装**：在 `services/api.ts` 中添加 `fetchNews`。
3.  **UI实现**：
    - 修改 `App.tsx` 增加 Tab 切换。
    - 创建 `components/NewsFeed.tsx` 和 `components/NewsFeed.css`。
4.  **联调测试**：验证数据加载和跨域问题。
