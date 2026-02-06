/**
 * LocalStorage 键名
 */
export const STORAGE_KEYS = {
  DAILY_SNAPSHOTS: 'myPositions_dailySnapshots',
} as const

/**
 * 每日收益快照
 */
export interface DailySnapshot {
  date: string
  totalValue: number
  totalCost: number
  profit: number
}

/**
 * Webhook 配置（与后端保持一致）
 */
export interface WebhookConfig {
  enabled: boolean
  url: string
  secret?: string
  holdingsOnly: boolean
  interval: number
  lastSentTime?: number | null
  sentCount?: number
  keywordsTracked?: number
}

export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: false,
  url: '',
  secret: '',
  holdingsOnly: true,
  interval: 5,
  lastSentTime: null,
  sentCount: 0,
  keywordsTracked: 0,
}
