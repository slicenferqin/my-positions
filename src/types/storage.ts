import type { UserFund } from './fund'

/**
 * LocalStorage 存储键名
 */
export const STORAGE_KEYS = {
  /** 用户持仓基金列表 */
  USER_FUNDS: 'myPositions_funds',
  /** 应用设置 */
  SETTINGS: 'myPositions_settings',
  /** 每日收益快照 */
  DAILY_SNAPSHOTS: 'myPositions_dailySnapshots',
} as const

/**
 * 每日收益快照
 */
export interface DailySnapshot {
  /** 日期 YYYY-MM-DD */
  date: string
  /** 当日总市值 */
  totalValue: number
  /** 当日总成本 */
  totalCost: number
  /** 当日收益（相对前一天） */
  profit: number
}

/**
 * 应用设置
 */
export interface AppSettings {
  /** 自动刷新间隔（毫秒），0 表示不自动刷新 */
  refreshInterval: number
  /** 是否显示持仓成本和收益 */
  showCostAndProfit: boolean
  /** 主题模式 */
  theme: 'light' | 'dark' | 'system'
}

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: AppSettings = {
  refreshInterval: 30000, // 30秒
  showCostAndProfit: true,
  theme: 'light',
}

/**
 * 存储数据结构
 */
export interface StorageData {
  /** 用户持仓基金列表 */
  funds: UserFund[]
  /** 应用设置 */
  settings: AppSettings
}
