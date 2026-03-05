export interface NewsItem {
  id: string
  title: string
  content: string
  ctime: number
  brief: string
  reading_num?: number
  shareurl?: string
  img?: string
  subjects?: Array<{
    subject_name: string
    subject_id: string
  }>
  comment_num?: number
  share_num?: number
}

export interface NewsResponse {
  code: number
  msg: string
  data: {
    roll_data: NewsItem[]
    next_max_time: number
  }
}

export interface GlobalNewsAnalysis {
  newsId: string
  sectors: string[]
  sectorImpacts: Array<{ sector: string; polarity: 'bullish' | 'bearish' | 'neutral' }>
  stocks: Array<{ name: string; code: string }>
  sentiment: 'bullish' | 'bearish' | 'neutral'
  impactLevel: 'major' | 'moderate' | 'minor'
  summary: string
  background: string
  backgroundSources?: string[]
  impactAnalysis?: string
  watchPoints?: string[]
  tags: string[]
  modelUsed: string
  analyzedAt: number | null
  confidence?: number
  status?: string
  promptVersion?: string
}

export interface UserNewsRelevanceV2 {
  newsId: string
  relevanceScore: number
  relevanceLevel: 'critical' | 'high' | 'medium' | 'low' | 'none'
  matchedStocks: string[]
  matchedSectors: string[]
  matchedEntities: Array<{
    type: string
    name: string
    code?: string
    weight?: number
    scope?: 'holding' | 'watchlist' | string
  }>
  matchScope?: 'holding' | 'watchlist' | 'mixed' | 'none' | string
  matchedWatchlist?: string[]
  reasonCodes: string[]
  personalizedComment?: string | null
  computedAt?: number | null
}

export interface UserNewsPersonalizedInsight {
  newsId: string
  personalSummary: string
  riskHint: string
  opportunityHint: string
  actionBias: 'watch' | 'reduce' | 'hold' | string
  confidence: number
  modelVersion: string
  createdAt?: number | null
}

export interface NewsFeedItemV2 {
  news: {
    id: string
    title: string
    content: string
    brief: string
    ctime: number
    raw: NewsItem
  }
  globalAnalysis: GlobalNewsAnalysis | null
  relevance: UserNewsRelevanceV2 | null
  personalizedInsight: UserNewsPersonalizedInsight | null
  whyRelevant: {
    matchedEntities: UserNewsRelevanceV2['matchedEntities']
    matchedWatchlist?: string[]
    reasonCodes: string[]
  }
}

export interface NewsFeedResponseV2 {
  items: NewsFeedItemV2[]
  total: number
  page: number
  perPage: number
  mode: 'all' | 'relevant' | string
}

export interface NewsDetailResponseV2 {
  item: NewsFeedItemV2
  event: {
    id: number
    eventKey: string
    title: string
    eventType: string
    importance: string
    firstSeenAt?: number | null
    lastSeenAt?: number | null
    relatedNews: Array<{
      newsId: string
      title: string
      brief: string
      publishedAt?: number | null
      isPrimary: boolean
    }>
  } | null
  userAction: {
    action: 'watched' | 'ignored' | 'acted' | string
    actionNote?: string
    createdAt?: number | null
  } | null
}

export interface NotificationEndpointItem {
  id: number
  userId: number
  channelType: string
  endpointUrl: string
  enabled: boolean
  cooldownSec: number
  quietHours: Record<string, unknown>
  hasSecret?: boolean
  secretMasked?: string
  createdAt?: number | null
  updatedAt?: number | null
}

export interface NotificationRuleItem {
  id: number
  userId: number
  ruleType: string
  ruleParams: Record<string, unknown>
  priority: number
  enabled: boolean
  createdAt?: number | null
  updatedAt?: number | null
}

export interface AdminAIConfig {
  provider: string
  baseUrl: string
  defaultModels: {
    ai_model_fast?: string
    ai_model_deep?: string
    [key: string]: string | undefined
  }
  enabled: boolean
  apiKeyMasked?: string
  updatedBy?: number
  updatedAt?: number | null
  stats?: {
    pendingJobs: number
    runningJobs: number
    todayAnalyzed: number
  }
}

export interface PromptTemplateRecord {
  id: number
  scene: string
  version: string
  content: string
  status: 'active' | 'inactive' | 'archived' | string
  createdBy?: number
  createdAt?: number | null
}

export interface AnalysisJobRecord {
  id: number
  jobType: string
  newsId?: string
  userId?: number
  priority: number
  status: string
  scheduledAt?: number | null
  startedAt?: number | null
  finishedAt?: number | null
  retryCount: number
  errorMessage?: string | null
  payload?: Record<string, unknown>
  createdAt?: number | null
  latestRun?: {
    id: number
    latencyMs: number
    tokenIn: number
    tokenOut: number
    costEstimate: number
    status: string
    errorMessage?: string | null
    createdAt?: number | null
  } | null
}

export interface AuditLogEntry {
  id: number
  actorUserId?: number | null
  action: string
  resourceType: string
  resourceId?: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  ip?: string
  ua?: string
  createdAt?: number | null
}

// Legacy aliases (for existing components before complete migration)
export type NewsAnalysisResult = GlobalNewsAnalysis
export type UserRelevance = UserNewsRelevanceV2

export interface AnalyzedNewsItem {
  id: string
  title: string
  content: string
  ctime: number
  brief?: string
  raw: NewsItem
  analysis: GlobalNewsAnalysis | null
  relevance: UserNewsRelevanceV2 | null
}

export interface AnalyzedNewsResponse {
  items: AnalyzedNewsItem[]
  total: number
  page: number
  perPage: number
}

export interface AIConfigResponse {
  config: {
    ai_base_url: string
    ai_api_key: string
    ai_model_fast: string
    ai_model_deep: string
    ai_enabled: string
    ai_batch_size: string
    stats: {
      todayAnalyzed: number
      totalAnalyzed: number
      pendingQueue: number
    }
  }
}
