import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  UserFund,
  FundWithEstimation,
  FundEstimation,
  PortfolioSummary,
  Transaction,
  DailySnapshot,
  IntradayPoint,
} from '@/types'
import { storage, fetchMultipleFundEstimations, parseEstimation, isRefreshTime } from '@/services'
import {
  fetchFunds as fetchFundsRequest,
  createFundRequest,
  updateFundRequest,
  deleteFundRequest,
  createTransactionRequest,
  deleteTransactionRequest,
} from '@/services/api'

interface UseFundsReturn {
  funds: FundWithEstimation[]
  summary: PortfolioSummary
  dailySnapshots: DailySnapshot[]
  loading: boolean
  lastUpdate: Date | null
  intradayData: Map<string, IntradayPoint[]>
  refresh: () => Promise<void>
  reload: () => Promise<void>
  addFund: (fund: { code: string; name?: string; shares: number; cost: number }) => Promise<void>
  updateFund: (fundId: number, updates: Partial<Pick<UserFund, 'name' | 'shares' | 'cost'>>) => Promise<void>
  removeFund: (fundId: number) => Promise<void>
  addTransaction: (fundId: number, transaction: Omit<Transaction, 'id' | 'fundCode'>) => Promise<void>
  removeTransaction: (fundId: number, transactionId: number | string) => Promise<void>
}

function buildSummary(funds: FundWithEstimation[], estimations: Map<string, FundEstimation>): PortfolioSummary {
  const yesterdaySnapshot = storage.getYesterdaySnapshot()

  const summary = funds.reduce<PortfolioSummary>(
    (acc, fund) => {
      acc.fundCount += 1
      acc.totalCost += fund.cost
      const estimation = estimations.get(fund.code) ?? fund.estimation
      if (estimation) {
        const parsed = parseEstimation(estimation)
        let effectiveShares = fund.shares
        const todayStr = new Date().toISOString().split('T')[0]
        fund.transactions?.forEach((tx) => {
          if (tx.date === todayStr) {
            if (tx.type === 'sell') {
              effectiveShares += tx.shares
            } else if (tx.type === 'buy') {
              effectiveShares -= tx.shares
            }
          }
        })
        const currentValue = fund.shares * parsed.estimatedNav
        acc.totalValue += currentValue
        acc.totalProfit += currentValue - fund.cost
        acc.todayProfit += effectiveShares * (parsed.estimatedNav - parsed.lastNav)
      }
      return acc
    },
    {
      totalCost: 0,
      totalValue: 0,
      totalProfit: 0,
      totalProfitPercent: 0,
      todayProfit: 0,
      todayProfitPercent: 0,
      yesterdayProfit: null,
      yesterdayProfitPercent: null,
      fundCount: 0,
    }
  )

  if (summary.totalCost > 0) {
    summary.totalProfitPercent = (summary.totalProfit / summary.totalCost) * 100
  }
  if (summary.totalValue > 0) {
    const yesterdayValue = summary.totalValue - summary.todayProfit
    if (yesterdayValue > 0) {
      summary.todayProfitPercent = (summary.todayProfit / yesterdayValue) * 100
    }
  }

  if (yesterdaySnapshot) {
    summary.yesterdayProfit = yesterdaySnapshot.profit
    const dayBeforeValue = yesterdaySnapshot.totalValue - yesterdaySnapshot.profit
    if (dayBeforeValue > 0) {
      summary.yesterdayProfitPercent = (yesterdaySnapshot.profit / dayBeforeValue) * 100
    }
  }

  return summary
}

export function useFunds(token: string | null, autoRefreshInterval = 60000): UseFundsReturn {
  const [userFunds, setUserFunds] = useState<UserFund[]>([])
  const [estimations, setEstimations] = useState<Map<string, FundEstimation>>(new Map())
  const [intradayMap, setIntradayMap] = useState<Map<string, IntradayPoint[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const intervalRef = useRef<number | null>(null)

  const fetchServerFunds = useCallback(async () => {
    if (!token) {
      setUserFunds([])
      setIntradayMap(new Map())
      return
    }
    const { funds } = await fetchFundsRequest(token)
    setUserFunds(funds)
    const nextMap = new Map<string, IntradayPoint[]>()
    funds.forEach((fund) => {
      const cached = storage.getIntraday(fund.code)
      if (cached.length > 0) {
        nextMap.set(fund.code, cached)
      }
    })
    setIntradayMap(nextMap)
  }, [token])

  useEffect(() => {
    if (token) {
      fetchServerFunds().catch((error) => console.error('加载基金失败:', error))
    } else {
      setUserFunds([])
      setIntradayMap(new Map())
      setEstimations(new Map())
      setLastUpdate(null)
    }
  }, [token, fetchServerFunds])

  const refresh = useCallback(async () => {
    if (!token) return
    const codes = userFunds.map((fund) => fund.code)
    if (codes.length === 0) return
    setLoading(true)
    try {
      const results = await fetchMultipleFundEstimations(codes)
      const newEstimations = new Map<string, FundEstimation>()
      const newIntradayMap = new Map(intradayMap)
      results.forEach((value, code) => {
        if (!(value instanceof Error)) {
          newEstimations.set(code, value)
          const point: IntradayPoint = {
            time: value.gztime,
            value: parseFloat(value.gsz),
            changePercent: parseFloat(value.gszzl),
          }
          const updated = storage.saveIntraday(code, point)
          newIntradayMap.set(code, updated)
        }
      })
      setIntradayMap(newIntradayMap)
      setEstimations(newEstimations)
      setLastUpdate(new Date())

      const today = new Date().toISOString().split('T')[0]
      let todayValue = 0
      let todayProfit = 0
      let todayCost = 0
      userFunds.forEach((fund) => {
        const estimation = newEstimations.get(fund.code)
        if (estimation) {
          const parsed = parseEstimation(estimation)
          let effectiveShares = fund.shares
          fund.transactions?.forEach((tx) => {
            if (tx.date === today) {
              if (tx.type === 'sell') effectiveShares += tx.shares
              if (tx.type === 'buy') effectiveShares -= tx.shares
            }
          })
          const currentValue = fund.shares * parsed.estimatedNav
          todayValue += currentValue
          todayCost += fund.cost
          todayProfit += effectiveShares * (parsed.estimatedNav - parsed.lastNav)
        }
      })
      if (todayValue > 0) {
        storage.saveDailySnapshot({ date: today, totalValue: todayValue, totalCost: todayCost, profit: todayProfit })
      }
    } catch (error) {
      console.error('刷新估值失败:', error)
    } finally {
      setLoading(false)
    }
  }, [token, userFunds, intradayMap])

  useEffect(() => {
    if (autoRefreshInterval > 0 && userFunds.length > 0) {
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
  }, [autoRefreshInterval, userFunds.length, refresh])

  const addFund = useCallback(
    async (payload: { code: string; name?: string; shares: number; cost: number }) => {
      if (!token) throw new Error('请先登录')
      const { fund } = await createFundRequest(token, payload)
      let nextFund = fund
      if (!payload.name?.trim()) {
        const estimationMap = await fetchMultipleFundEstimations([payload.code])
        const estimation = estimationMap.get(payload.code)
        if (estimation && !(estimation instanceof Error) && estimation.name && fund.id) {
          const updated = await updateFundRequest(token, fund.id, { name: estimation.name })
          nextFund = updated.fund
          setEstimations((prev) => new Map(prev).set(payload.code, estimation))
        }
      }
      setUserFunds((prev) => [...prev, nextFund])
    },
    [token]
  )

  const updateFund = useCallback(
    async (fundId: number, updates: Partial<Pick<UserFund, 'name' | 'shares' | 'cost'>>) => {
      if (!token) throw new Error('请先登录')
      const { fund } = await updateFundRequest(token, fundId, updates)
      setUserFunds((prev) => prev.map((item) => (item.id === fund.id ? fund : item)))
    },
    [token]
  )

  const removeFund = useCallback(
    async (fundId: number) => {
      if (!token) throw new Error('请先登录')
      await deleteFundRequest(token, fundId)
      setUserFunds((prev) => prev.filter((fund) => fund.id !== fundId))
    },
    [token]
  )

  const addTransaction = useCallback(
    async (fundId: number, transaction: Omit<Transaction, 'id' | 'fundCode'>) => {
      if (!token) throw new Error('请先登录')
      const { fund } = await createTransactionRequest(token, fundId, transaction)
      setUserFunds((prev) => prev.map((item) => (item.id === fund.id ? fund : item)))
    },
    [token]
  )

  const removeTransaction = useCallback(
    async (fundId: number, transactionId: number | string) => {
      if (!token) throw new Error('请先登录')
      const { fund } = await deleteTransactionRequest(token, fundId, transactionId)
      setUserFunds((prev) => prev.map((item) => (item.id === fund.id ? fund : item)))
    },
    [token]
  )

  const reload = useCallback(async () => {
    if (!token) {
      setUserFunds([])
      return
    }
    await fetchServerFunds()
  }, [token, fetchServerFunds])

  const fundsWithState: FundWithEstimation[] = [...userFunds]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((fund) => ({
      ...fund,
      estimation: estimations.get(fund.code) || null,
      loading: loading,
      error: null,
    }))

  const summary = buildSummary(fundsWithState, estimations)
  const dailySnapshots = storage.getDailySnapshots()

  return {
    funds: fundsWithState,
    summary,
    dailySnapshots,
    loading,
    lastUpdate,
    intradayData: intradayMap,
    refresh,
    reload,
    addFund,
    updateFund,
    removeFund,
    addTransaction,
    removeTransaction,
  }
}
