import type { UserFund, AppSettings, Transaction, DailySnapshot } from '@/types'
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '@/types'

interface IntradayStorage {
  date: string
  points: IntradayPoint[]
}

/**
 * 生成唯一ID
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/**
 * 本地存储服务
 */
export const storage = {
  getFunds(): UserFund[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER_FUNDS)
      if (!data) return []
      return JSON.parse(data) as UserFund[]
    } catch {
      console.error('读取基金列表失败')
      return []
    }
  },

  saveFunds(funds: UserFund[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.USER_FUNDS, JSON.stringify(funds))
    } catch (error) {
      console.error('保存基金列表失败:', error)
    }
  },

  addFund(fund: Omit<UserFund, 'addedAt' | 'sortOrder' | 'transactions'>): UserFund {
    const funds = this.getFunds()
    const existingFund = funds.find((f) => f.code === fund.code)
    if (existingFund) {
      throw new Error(`基金 ${fund.code} 已存在`)
    }

    const newFund: UserFund = {
      ...fund,
      addedAt: Date.now(),
      sortOrder: funds.length,
      transactions: [],
    }

    funds.push(newFund)
    this.saveFunds(funds)
    return newFund
  },

  updateFund(code: string, updates: Partial<Omit<UserFund, 'code' | 'addedAt'>>): UserFund | null {
    const funds = this.getFunds()
    const index = funds.findIndex((f) => f.code === code)
    if (index === -1) return null

    funds[index] = { ...funds[index], ...updates }
    this.saveFunds(funds)
    return funds[index]
  },

  removeFund(code: string): boolean {
    const funds = this.getFunds()
    const index = funds.findIndex((f) => f.code === code)
    if (index === -1) return false

    funds.splice(index, 1)
    funds.forEach((f, i) => (f.sortOrder = i))
    this.saveFunds(funds)
    return true
  },

  /**
   * 添加调仓记录
   */
  addTransaction(
    fundCode: string,
    transaction: Omit<Transaction, 'id' | 'fundCode'>
  ): Transaction | null {
    const funds = this.getFunds()
    const fund = funds.find((f) => f.code === fundCode)
    if (!fund) return null

    const newTransaction: Transaction = {
      ...transaction,
      id: generateId(),
      fundCode,
    }

    if (!fund.transactions) {
      fund.transactions = []
    }
    fund.transactions.push(newTransaction)

    // 更新份额和成本
    if (transaction.type === 'buy') {
      fund.shares += transaction.shares
      fund.cost += transaction.amount
    } else {
      fund.shares -= transaction.shares
      // 按比例减少成本
      const costPerShare = fund.cost / (fund.shares + transaction.shares)
      fund.cost -= costPerShare * transaction.shares
    }

    // 确保不会出现负数
    fund.shares = Math.max(0, fund.shares)
    fund.cost = Math.max(0, fund.cost)

    this.saveFunds(funds)
    return newTransaction
  },

  /**
   * 删除调仓记录
   */
  removeTransaction(fundCode: string, transactionId: string): boolean {
    console.log('Attempting to remove transaction:', { fundCode, transactionId })
    const funds = this.getFunds()
    const fund = funds.find((f) => f.code === fundCode)
    if (!fund || !fund.transactions) {
      console.error('Fund not found or no transactions:', fundCode)
      return false
    }

    const index = fund.transactions.findIndex((t) => t.id === transactionId)
    if (index === -1) {
      console.error('Transaction not found:', transactionId)
      return false
    }

    const transaction = fund.transactions[index]
    console.log('Found transaction to remove:', transaction)

    // 恢复份额和成本
    if (transaction.type === 'buy') {
      fund.shares -= transaction.shares
      fund.cost -= transaction.amount
    } else {
      fund.shares += transaction.shares
      // 卖出时减少了成本：fund.cost -= (fund.cost / (fund.shares + transaction.shares)) * transaction.shares
      // 也就是 cost = oldCost * (1 - soldShares / oldShares) = oldCost * (remainingShares / oldShares)
      // 现在要恢复: oldCost = cost / (remainingShares / oldShares) = cost * oldShares / remainingShares
      // remainingShares = fund.shares - transaction.shares (before this block, but we just added shares back)
      // So now fund.shares is oldShares.
      // And prevCost = fund.cost (before restoration).
      // The logic below is simpler:
      // CostPerShare (post-sell) should equal CostPerShare (pre-sell)
      // So restoredCost = (fund.cost / (fund.shares - transaction.shares)) * fund.shares
      
      const sharesBeforeRestoration = fund.shares - transaction.shares
      if (sharesBeforeRestoration > 0) {
        const costPerShare = fund.cost / sharesBeforeRestoration
        fund.cost = costPerShare * fund.shares
      } else {
        // 如果之前持有0份，无法推算之前的单位成本
        // 只能回退 transaction.amount (虽然不准确，但没有更好办法，除非记录了卖出时的成本)
        // 或者假设单位成本为0? 不，这会导致成本变成0。
        // 这是一个极端情况。暂且用 transaction.amount 兜底，或者是 0
        fund.cost += transaction.amount 
      }
    }

    fund.transactions.splice(index, 1)
    console.log('Saving updated funds:', funds)
    this.saveFunds(funds)
    return true
  },

  getSettings(): AppSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS)
      if (!data) return DEFAULT_SETTINGS
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
    } catch {
      return DEFAULT_SETTINGS
    }
  },

  saveSettings(settings: Partial<AppSettings>): AppSettings {
    const current = this.getSettings()
    const updated = { ...current, ...settings }
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated))
    return updated
  },

  /**
   * 保存分时数据
   */
  saveIntraday(fundCode: string, point: IntradayPoint): IntradayPoint[] {
    const key = `intraday_${fundCode}`
    const today = new Date().toISOString().split('T')[0]
    let data: IntradayStorage = { date: today, points: [] }

    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored) as IntradayStorage
        if (parsed.date === today) {
          data = parsed
        }
      }
    } catch (e) {
      console.error('读取分时数据失败:', e)
    }

    // 检查是否已存在该时间点的数据
    const exists = data.points.some(p => p.time === point.time)
    if (!exists) {
      data.points.push(point)
      // 按时间排序
      data.points.sort((a, b) => a.time.localeCompare(b.time))
      
      try {
        localStorage.setItem(key, JSON.stringify(data))
      } catch (e) {
        console.error('保存分时数据失败:', e)
      }
    }
    
    return data.points
  },

  /**
   * 获取分时数据
   */
  getIntraday(fundCode: string): IntradayPoint[] {
    const key = `intraday_${fundCode}`
    const today = new Date().toISOString().split('T')[0]
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored) as IntradayStorage
        if (parsed.date === today) {
          return parsed.points
        }
      }
    } catch (e) {
      console.error('读取分时数据失败:', e)
    }
    return []
  },

  /**
   * 导出数据
   */
  exportData(): string {
    return JSON.stringify(
      {
        funds: this.getFunds(),
        settings: this.getSettings(),
        exportedAt: new Date().toISOString(),
        version: '1.0',
      },
      null,
      2
    )
  },

  /**
   * 导入数据
   */
  importData(jsonString: string): { success: boolean; message: string; count?: number } {
    try {
      const data = JSON.parse(jsonString)

      if (!data.funds || !Array.isArray(data.funds)) {
        return { success: false, message: '无效的数据格式：缺少 funds 数组' }
      }

      // 验证每个基金数据
      for (const fund of data.funds) {
        if (!fund.code || typeof fund.code !== 'string') {
          return { success: false, message: '无效的基金数据：缺少基金代码' }
        }
      }

      this.saveFunds(data.funds)

      if (data.settings) {
        this.saveSettings(data.settings)
      }

      return {
        success: true,
        message: `成功导入 ${data.funds.length} 只基金`,
        count: data.funds.length,
      }
    } catch (error) {
      return {
        success: false,
        message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }
    }
  },

  clearAll(): void {
    localStorage.removeItem(STORAGE_KEYS.USER_FUNDS)
    localStorage.removeItem(STORAGE_KEYS.SETTINGS)
    localStorage.removeItem(STORAGE_KEYS.DAILY_SNAPSHOTS)
  },

  /**
   * 获取每日快照列表
   */
  getDailySnapshots(): DailySnapshot[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DAILY_SNAPSHOTS)
      if (!data) return []
      return JSON.parse(data) as DailySnapshot[]
    } catch {
      return []
    }
  },

  /**
   * 保存每日快照（自动去重，只保留最近30天）
   */
  saveDailySnapshot(snapshot: DailySnapshot): void {
    const snapshots = this.getDailySnapshots()
    const existingIndex = snapshots.findIndex((s) => s.date === snapshot.date)

    if (existingIndex >= 0) {
      snapshots[existingIndex] = snapshot
    } else {
      snapshots.push(snapshot)
    }

    // 按日期排序，只保留最近30天
    snapshots.sort((a, b) => b.date.localeCompare(a.date))
    const trimmed = snapshots.slice(0, 30)

    localStorage.setItem(STORAGE_KEYS.DAILY_SNAPSHOTS, JSON.stringify(trimmed))
  },

  /**
   * 获取指定日期的快照
   */
  getSnapshotByDate(date: string): DailySnapshot | null {
    const snapshots = this.getDailySnapshots()
    return snapshots.find((s) => s.date === date) || null
  },

  /**
   * 获取昨日快照
   */
  getYesterdaySnapshot(): DailySnapshot | null {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().split('T')[0]
    return this.getSnapshotByDate(dateStr)
  },
}
