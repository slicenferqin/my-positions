import type { DailySnapshot, IntradayPoint } from '@/types'
import { STORAGE_KEYS } from '@/types'

interface IntradayStorage {
  date: string
  points: IntradayPoint[]
}

let scopeKey = 'default'

function scopedKey(key: string) {
  return `${scopeKey}_${key}`
}

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

export const storage = {
  setScope(userId?: string | number | null) {
    scopeKey = userId ? `user_${userId}` : 'default'
  },

  saveIntraday(code: string, point: IntradayPoint): IntradayPoint[] {
    if (typeof window === 'undefined') return []
    const key = scopedKey(`intraday_${code}`)
    const today = getToday()
    let data: IntradayStorage = { date: today, points: [] }

    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored) as IntradayStorage
        if (parsed.date === today) {
          data = parsed
        }
      }
    } catch (error) {
      console.warn('读取分时数据失败:', error)
    }

    if (!data.points.some((p) => p.time === point.time)) {
      data.points.push(point)
      data.points.sort((a, b) => a.time.localeCompare(b.time))
      try {
        localStorage.setItem(key, JSON.stringify(data))
      } catch (error) {
        console.warn('保存分时数据失败:', error)
      }
    }

    return data.points
  },

  getIntraday(code: string): IntradayPoint[] {
    if (typeof window === 'undefined') return []
    const key = scopedKey(`intraday_${code}`)
    const today = getToday()
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored) as IntradayStorage
        if (parsed.date === today) {
          return parsed.points
        }
      }
    } catch (error) {
      console.warn('读取分时数据失败:', error)
    }
    return []
  },

  saveDailySnapshot(snapshot: DailySnapshot) {
    if (typeof window === 'undefined') return
    const key = scopedKey(STORAGE_KEYS.DAILY_SNAPSHOTS)
    const snapshots = this.getDailySnapshots()
    const existingIndex = snapshots.findIndex((s) => s.date === snapshot.date)
    if (existingIndex >= 0) {
      snapshots[existingIndex] = snapshot
    } else {
      snapshots.push(snapshot)
    }
    snapshots.sort((a, b) => b.date.localeCompare(a.date))
    const trimmed = snapshots.slice(0, 30)
    localStorage.setItem(key, JSON.stringify(trimmed))
  },

  getDailySnapshots(): DailySnapshot[] {
    if (typeof window === 'undefined') return []
    const key = scopedKey(STORAGE_KEYS.DAILY_SNAPSHOTS)
    try {
      const stored = localStorage.getItem(key)
      if (!stored) return []
      return JSON.parse(stored) as DailySnapshot[]
    } catch (error) {
      console.warn('读取收益快照失败:', error)
      return []
    }
  },

  getYesterdaySnapshot(): DailySnapshot | null {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const date = yesterday.toISOString().split('T')[0]
    return this.getDailySnapshots().find((s) => s.date === date) || null
  },

  clearCaches() {
    if (typeof window === 'undefined') return
    // 清空当前作用域下的所有缓存
    const prefix = `${scopeKey}_`
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key)
      }
    })
  },
}
