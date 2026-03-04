import { useState, useEffect, useCallback, useRef } from 'react'
import type { FundEstimation, UserFund, WatchlistItem, WatchlistWithEstimation } from '@/types'
import { fetchMultipleFundEstimations, fetchMultipleStockEstimations, isRefreshTime } from '@/services'
import {
  convertWatchlistToFund,
  createWatchlistItem,
  deleteWatchlistItem,
  fetchWatchlist as fetchWatchlistRequest,
  updateWatchlistItem as updateWatchlistItemRequest,
} from '@/services/api'

interface UseWatchlistReturn {
  items: WatchlistWithEstimation[]
  loading: boolean
  lastUpdate: Date | null
  refresh: () => Promise<void>
  reload: () => Promise<void>
  addItem: (payload: { instrumentType?: 'fund' | 'stock'; code: string; name?: string }) => Promise<void>
  updateItem: (itemId: number, payload: Partial<Pick<WatchlistItem, 'name' | 'sortOrder'>>) => Promise<void>
  removeItem: (itemId: number) => Promise<void>
  convertToHolding: (itemId: number, payload: { shares: number; cost: number }) => Promise<UserFund>
}

function normalizeInstrumentType(value: string | undefined): 'fund' | 'stock' {
  return value === 'stock' ? 'stock' : 'fund'
}

function watchlistStorageKey(item: Pick<WatchlistItem, 'code' | 'instrumentType'>): string {
  return `${normalizeInstrumentType(item.instrumentType)}:${(item.code || '').toUpperCase()}`
}

export function useWatchlist(token: string | null, autoRefreshInterval = 60000): UseWatchlistReturn {
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([])
  const [estimations, setEstimations] = useState<Map<string, FundEstimation>>(new Map())
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const intervalRef = useRef<number | null>(null)

  const fetchServerWatchlist = useCallback(async () => {
    if (!token) {
      setWatchlistItems([])
      setEstimations(new Map())
      return
    }
    const { items } = await fetchWatchlistRequest(token)
    setWatchlistItems(items)
    setEstimations((prev) => {
      const next = new Map<string, FundEstimation>()
      items.forEach((item) => {
        const key = watchlistStorageKey(item)
        const cached = prev.get(key)
        if (cached) {
          next.set(key, cached)
        }
      })
      return next
    })
  }, [token])

  useEffect(() => {
    if (token) {
      fetchServerWatchlist().catch((error) => console.error('加载自选失败:', error))
    } else {
      setWatchlistItems([])
      setEstimations(new Map())
      setLastUpdate(null)
    }
  }, [token, fetchServerWatchlist])

  const refresh = useCallback(async () => {
    if (!token || watchlistItems.length === 0) return
    const fundCodes = watchlistItems
      .filter((item) => normalizeInstrumentType(item.instrumentType) === 'fund')
      .map((item) => item.code)
    const stockCodes = watchlistItems
      .filter((item) => normalizeInstrumentType(item.instrumentType) === 'stock')
      .map((item) => item.code)
    if (fundCodes.length === 0 && stockCodes.length === 0) return

    setLoading(true)
    try {
      const [fundResults, stockResults] = await Promise.all([
        fundCodes.length > 0 ? fetchMultipleFundEstimations(fundCodes) : Promise.resolve(new Map<string, FundEstimation | Error>()),
        stockCodes.length > 0 ? fetchMultipleStockEstimations(stockCodes) : Promise.resolve(new Map<string, FundEstimation | Error>()),
      ])

      const resultMap = new Map<string, FundEstimation | Error>()
      fundResults.forEach((value, code) => resultMap.set(code, value))
      stockResults.forEach((value, code) => resultMap.set(code.toUpperCase(), value))

      const next = new Map<string, FundEstimation>()
      watchlistItems.forEach((item) => {
        const key = watchlistStorageKey(item)
        const lookupKey = normalizeInstrumentType(item.instrumentType) === 'stock'
          ? item.code.toUpperCase()
          : item.code
        const value = resultMap.get(lookupKey)
        if (!value || value instanceof Error) {
          return
        }
        next.set(key, value)
      })

      setEstimations(next)
      setLastUpdate(new Date())
    } finally {
      setLoading(false)
    }
  }, [token, watchlistItems])

  useEffect(() => {
    if (autoRefreshInterval > 0 && watchlistItems.length > 0) {
      intervalRef.current = window.setInterval(() => {
        if (isRefreshTime()) {
          refresh()
        }
      }, autoRefreshInterval)
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [autoRefreshInterval, watchlistItems.length, refresh])

  const addItem = useCallback(
    async (payload: { instrumentType?: 'fund' | 'stock'; code: string; name?: string }) => {
      if (!token) throw new Error('请先登录')
      const instrumentType = normalizeInstrumentType(payload.instrumentType)
      const { item } = await createWatchlistItem(token, {
        ...payload,
        instrumentType,
      })
      let nextItem = item

      if (!payload.name?.trim()) {
        const estimationsMap = instrumentType === 'stock'
          ? await fetchMultipleStockEstimations([item.code])
          : await fetchMultipleFundEstimations([item.code])
        const estimation = estimationsMap.get(instrumentType === 'stock' ? item.code.toUpperCase() : item.code)
        if (estimation && !(estimation instanceof Error) && estimation.name && estimation.name !== item.name) {
          const updated = await updateWatchlistItemRequest(token, item.id, { name: estimation.name })
          nextItem = updated.item
        }
      }

      setWatchlistItems((prev) => [...prev, nextItem])
    },
    [token]
  )

  const updateItem = useCallback(
    async (itemId: number, payload: Partial<Pick<WatchlistItem, 'name' | 'sortOrder'>>) => {
      if (!token) throw new Error('请先登录')
      const { item } = await updateWatchlistItemRequest(token, itemId, payload)
      setWatchlistItems((prev) => prev.map((entry) => (entry.id === item.id ? item : entry)))
    },
    [token]
  )

  const removeItem = useCallback(
    async (itemId: number) => {
      if (!token) throw new Error('请先登录')
      await deleteWatchlistItem(token, itemId)
      setWatchlistItems((prev) => prev.filter((entry) => entry.id !== itemId))
    },
    [token]
  )

  const convertToHolding = useCallback(
    async (itemId: number, payload: { shares: number; cost: number }) => {
      if (!token) throw new Error('请先登录')
      const { fund } = await convertWatchlistToFund(token, itemId, payload)
      setWatchlistItems((prev) => prev.filter((entry) => entry.id !== itemId))
      return fund
    },
    [token]
  )

  const reload = useCallback(async () => {
    if (!token) {
      setWatchlistItems([])
      setEstimations(new Map())
      return
    }
    await fetchServerWatchlist()
  }, [token, fetchServerWatchlist])

  const watchlistWithState: WatchlistWithEstimation[] = [...watchlistItems]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((item) => ({
      ...item,
      estimation: estimations.get(watchlistStorageKey(item)) || null,
      loading,
      error: null,
    }))

  return {
    items: watchlistWithState,
    loading,
    lastUpdate,
    refresh,
    reload,
    addItem,
    updateItem,
    removeItem,
    convertToHolding,
  }
}
