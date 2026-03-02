import type { Transaction, UserFund, WebhookConfig } from '@/types'
import type { AuthUser } from '@/types/auth'
import type { DashboardOverview, DashboardPreference } from '@/types/dashboard'
import type {
  AIConfigResponse,
  AdminAIConfig,
  AnalysisJobRecord,
  AnalyzedNewsResponse,
  AuditLogEntry,
  NewsDetailResponseV2,
  NewsFeedResponseV2,
  NotificationEndpointItem,
  NotificationRuleItem,
  PromptTemplateRecord,
} from '@/types/news'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const API_BASE = `${APP_BASE}/api`

interface RequestOptions {
  method?: string
  token?: string | null
  body?: unknown
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`
  }

  let body: BodyInit | undefined
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const response = await fetch(path, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers,
    body,
  })

  if (!response.ok) {
    let message = `请求失败 (${response.status})`
    try {
      const data = await response.json()
      message = data.error || message
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

// Auth
interface AuthPayload {
  email: string
  password: string
  name?: string
}

interface AuthResponse {
  token: string
  user: AuthUser
}

export function registerUser(payload: AuthPayload): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(`${API_BASE}/auth/register`, { method: 'POST', body: payload })
}

export function loginUser(payload: AuthPayload): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(`${API_BASE}/auth/login`, { method: 'POST', body: payload })
}

export function fetchProfile(token: string): Promise<{ user: AuthUser }> {
  return apiRequest<{ user: AuthUser }>(`${API_BASE}/auth/me`, { token })
}

// Funds
export function fetchFunds(token: string): Promise<{ funds: UserFund[] }> {
  return apiRequest<{ funds: UserFund[] }>(`${API_BASE}/funds`, { token })
}

export function createFundRequest(
  token: string,
  payload: {
    code: string
    name?: string
    shares: number
    cost: number
    instrumentType?: 'fund' | 'stock'
    market?: string
  }
) {
  return apiRequest<{ fund: UserFund }>(`${API_BASE}/funds`, { method: 'POST', token, body: payload })
}

export function updateFundRequest(token: string, fundId: number, payload: Partial<UserFund>) {
  return apiRequest<{ fund: UserFund }>(`${API_BASE}/funds/${fundId}`, { method: 'PUT', token, body: payload })
}

export function deleteFundRequest(token: string, fundId: number) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/funds/${fundId}`, { method: 'DELETE', token })
}

export function createTransactionRequest(
  token: string,
  fundId: number,
  payload: Omit<Transaction, 'id' | 'fundCode' | 'amount'> & { amount?: number }
) {
  return apiRequest<{ fund: UserFund }>(`${API_BASE}/funds/${fundId}/transactions`, {
    method: 'POST',
    token,
    body: payload,
  })
}

export function deleteTransactionRequest(token: string, fundId: number, transactionId: number | string) {
  return apiRequest<{ fund: UserFund }>(`${API_BASE}/funds/${fundId}/transactions/${transactionId}`, {
    method: 'DELETE',
    token,
  })
}

export function exportFundsRequest(token: string) {
  return apiRequest(`${API_BASE}/funds/export`, { token })
}

export function importFundsRequest(token: string, payload: unknown) {
  return apiRequest<{ count: number }>(`${API_BASE}/funds/import`, { method: 'POST', token, body: payload })
}

export function refreshPortfolioRequest(token: string, code?: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/portfolio/refresh`, {
    method: 'POST',
    token,
    body: code ? { code } : {},
  })
}

// Webhook
export function fetchWebhookConfig(token: string) {
  return apiRequest<{ config: WebhookConfig }>(`${API_BASE}/webhook`, { token })
}

export function updateWebhookConfig(token: string, payload: Partial<WebhookConfig>) {
  return apiRequest<{ config: WebhookConfig }>(`${API_BASE}/webhook`, { method: 'PUT', token, body: payload })
}

export function testWebhook(token: string) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/webhook/test`, { method: 'POST', token })
}

// News Intelligence v2
export function fetchNewsFeed(
  token: string,
  params?: {
    mode?: 'all' | 'relevant'
    page?: number
    perPage?: number
    sentiment?: string
    impact?: string
    entity?: string
  }
) {
  const query = new URLSearchParams()
  if (params?.mode) query.set('mode', params.mode)
  if (params?.page) query.set('page', String(params.page))
  if (params?.perPage) query.set('per_page', String(params.perPage))
  if (params?.sentiment) query.set('sentiment', params.sentiment)
  if (params?.impact) query.set('impact', params.impact)
  if (params?.entity) query.set('entity', params.entity)

  return apiRequest<NewsFeedResponseV2>(`${API_BASE}/news/feed?${query.toString()}`, { token })
}

export function fetchNewsDetail(token: string, newsId: string) {
  return apiRequest<NewsDetailResponseV2>(`${API_BASE}/news/${newsId}`, { token })
}

export function submitNewsFeedback(
  token: string,
  newsId: string,
  payload: { action: 'useful' | 'not_useful' | 'already_acted'; note?: string }
) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/news/${newsId}/feedback`, {
    method: 'POST',
    token,
    body: payload,
  })
}

export function fetchNotificationEndpoints(token: string) {
  return apiRequest<{ endpoints: NotificationEndpointItem[] }>(`${API_BASE}/notification/endpoints`, { token })
}

export function updateNotificationEndpoints(token: string, endpoints: Array<Partial<NotificationEndpointItem> & { secret?: string }>) {
  return apiRequest<{ endpoints: NotificationEndpointItem[] }>(`${API_BASE}/notification/endpoints`, {
    method: 'PUT',
    token,
    body: { endpoints },
  })
}

export function fetchNotificationRules(token: string) {
  return apiRequest<{ rules: NotificationRuleItem[] }>(`${API_BASE}/notification/rules`, { token })
}

export function updateNotificationRules(token: string, rules: Array<Partial<NotificationRuleItem>>) {
  return apiRequest<{ rules: NotificationRuleItem[] }>(`${API_BASE}/notification/rules`, {
    method: 'PUT',
    token,
    body: { rules },
  })
}

// Legacy wrappers (compatibility)
export async function fetchAnalyzedNews(
  token: string,
  params?: {
    page?: number
    perPage?: number
    sentiment?: string
    impact?: string
  }
) {
  const response = await fetchNewsFeed(token, {
    mode: 'all',
    page: params?.page,
    perPage: params?.perPage,
    sentiment: params?.sentiment,
    impact: params?.impact,
  })
  return {
    items: response.items.map((item) => ({
      id: item.news.id,
      title: item.news.title,
      content: item.news.content,
      ctime: item.news.ctime,
      brief: item.news.brief,
      raw: item.news.raw,
      analysis: item.globalAnalysis,
      relevance: item.relevance,
    })),
    total: response.total,
    page: response.page,
    perPage: response.perPage,
  } as AnalyzedNewsResponse
}

export async function fetchRelevantNews(
  token: string,
  params?: {
    page?: number
    perPage?: number
    minScore?: number
  }
) {
  const response = await fetchNewsFeed(token, {
    mode: 'relevant',
    page: params?.page,
    perPage: params?.perPage,
  })
  const minScore = params?.minScore ?? 0
  const items = response.items
    .filter((item) => (item.relevance?.relevanceScore || 0) >= minScore)
    .map((item) => ({
      id: item.news.id,
      title: item.news.title,
      content: item.news.content,
      ctime: item.news.ctime,
      brief: item.news.brief,
      raw: item.news.raw,
      analysis: item.globalAnalysis,
      relevance: item.relevance,
    }))

  return {
    items,
    total: items.length,
    page: response.page,
    perPage: response.perPage,
  } as AnalyzedNewsResponse
}

export function fetchNewsAnalysis(token: string, newsId: string) {
  return apiRequest(`${API_BASE}/news/${newsId}/analysis`, { token })
}

// Admin APIs
export function fetchAdminAIConfig(token: string) {
  return apiRequest<{ config: AdminAIConfig }>(`${API_BASE}/admin/ai/config`, { token })
}

export function updateAdminAIConfig(
  token: string,
  payload: {
    baseUrl?: string
    apiKey?: string
    enabled?: boolean
    defaultModels?: Record<string, string>
  }
) {
  return apiRequest<{ config: AdminAIConfig }>(`${API_BASE}/admin/ai/config`, {
    method: 'PUT',
    token,
    body: payload,
  })
}

export function fetchAdminPrompt(token: string, scene: string) {
  return apiRequest<{ scene: string; active: PromptTemplateRecord | null; items: PromptTemplateRecord[] }>(
    `${API_BASE}/admin/prompts/${scene}`,
    { token }
  )
}

export function updateAdminPrompt(
  token: string,
  scene: string,
  payload: { content: string; version?: string; status?: 'active' | 'inactive' | 'archived' }
) {
  return apiRequest<{ scene: string; active: PromptTemplateRecord | null; items: PromptTemplateRecord[] }>(
    `${API_BASE}/admin/prompts/${scene}`,
    {
      method: 'PUT',
      token,
      body: payload,
    }
  )
}

export function fetchAdminAnalysisJobs(
  token: string,
  params?: { page?: number; perPage?: number; status?: string; jobType?: string }
) {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.perPage) query.set('per_page', String(params.perPage))
  if (params?.status) query.set('status', params.status)
  if (params?.jobType) query.set('jobType', params.jobType)
  return apiRequest<{ items: AnalysisJobRecord[]; total: number; page: number; perPage: number }>(
    `${API_BASE}/admin/analysis/jobs?${query.toString()}`,
    { token }
  )
}

export function retryAdminAnalysisJob(token: string, jobId: number) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/admin/analysis/jobs/${jobId}/retry`, {
    method: 'POST',
    token,
  })
}

export function fetchAdminAnalysisMetrics(token: string) {
  return apiRequest<{
    window: { from: number; to: number }
    queue: { pending: number; running: number; failed: number }
    throughput: { jobs24h: number; runs24h: number; successRuns24h: number; failedRuns24h: number; successRate24h: number }
    latency: { p50: number; p95: number; max: number }
    tokens: { input: number; output: number; costEstimate: number }
    byJobType: Record<string, { total: number; success: number; failed: number }>
  }>(`${API_BASE}/admin/metrics/analysis`, { token })
}

export function fetchAdminPipelineHealth(token: string) {
  return apiRequest<{
    status: 'healthy' | 'degraded' | 'critical'
    source: { newsPollSeconds: number; latestNewsAt: number | null; ageSeconds: number | null }
    workers: { analysisQueueMemory: number; portfolioQueueMemory: number; pendingGlobalJobs: number; pendingUserJobs: number; failedJobsLastHour: number }
    ai: { enabled: boolean; provider: string }
  }>(`${API_BASE}/admin/news/pipeline/health`, { token })
}

export function fetchAdminAuditLogs(token: string, params?: { page?: number; perPage?: number; action?: string }) {
  const query = new URLSearchParams()
  if (params?.page) query.set('page', String(params.page))
  if (params?.perPage) query.set('per_page', String(params.perPage))
  if (params?.action) query.set('action', params.action)

  return apiRequest<{ items: AuditLogEntry[]; total: number; page: number; perPage: number }>(
    `${API_BASE}/admin/audit/logs?${query.toString()}`,
    { token }
  )
}

// Legacy admin wrappers (for old panel)
export function fetchAIConfig(token: string) {
  return apiRequest<AIConfigResponse>(`${API_BASE}/ai/config`, { token })
}

export function updateAIConfig(token: string, data: Record<string, string>) {
  return apiRequest<{ success: boolean }>(`${API_BASE}/ai/config`, {
    method: 'PUT',
    token,
    body: data,
  })
}

// Dashboard
export function fetchDashboardOverview(token: string) {
  return apiRequest<{ overview: DashboardOverview }>(`${API_BASE}/dashboard/overview`, { token })
}

export function fetchDashboardPreferences(token: string) {
  return apiRequest<{ preferences: DashboardPreference }>(`${API_BASE}/dashboard/preferences`, { token })
}

export function updateDashboardPreferences(token: string, payload: Partial<DashboardPreference>) {
  return apiRequest<{ preferences: DashboardPreference }>(`${API_BASE}/dashboard/preferences`, {
    method: 'PUT',
    token,
    body: payload,
  })
}
