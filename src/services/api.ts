import type { Transaction, UserFund, WebhookConfig } from '@/types'
import type { AuthUser } from '@/types/auth'

const API_BASE = '/api'

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

export function createFundRequest(token: string, payload: { code: string; name?: string; shares: number; cost: number }) {
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
