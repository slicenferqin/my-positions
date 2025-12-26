import { useState, useEffect, useCallback, useRef } from 'react'
import type { UserFund, FundWithEstimation, FundEstimation, PortfolioSummary, Transaction, DailySnapshot, IntradayPoint } from '@/types'
import { storage, fetchMultipleFundEstimations, parseEstimation, isRefreshTime } from '@/services'

interface UseFundsReturn {
  funds: FundWithEstimation[]
  summary: PortfolioSummary
  dailySnapshots: DailySnapshot[]
  loading: boolean
  lastUpdate: Date | null
  intradayData: Map<string, IntradayPoint[]>
  refresh: () => Promise<void>
  reload: () => void
  addFund: (fund: Omit<UserFund, 'addedAt' | 'sortOrder' | 'transactions'>) => Promise<void>
  updateFund: (code: string, updates: Partial<Omit<UserFund, 'code' | 'addedAt'>>) => void
  removeFund: (code: string) => void
  addTransaction: (code: string, transaction: Omit<Transaction, 'id' | 'fundCode'>) => void
  removeTransaction: (code: string, transactionId: string) => void
}

export function useFunds(autoRefreshInterval = 60000): UseFundsReturn {
  const [userFunds, setUserFunds] = useState<UserFund[]>(() => storage.getFunds())
  const [estimations, setEstimations] = useState<Map<string, FundEstimation>>(new Map())
  const [intradayMap, setIntradayMap] = useState<Map<string, IntradayPoint[]>>(() => {
    const map = new Map<string, IntradayPoint[]>()
    storage.getFunds().forEach(fund => {
      const points = storage.getIntraday(fund.code)
      if (points.length > 0) {
        map.set(fund.code, points)
      }
    })
    return map
  })
  const [loadingCodes, setLoadingCodes] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)

  const intervalRef = useRef<number | null>(null)

  const funds: FundWithEstimation[] = userFunds
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((fund) => ({
      ...fund,
      estimation: estimations.get(fund.code) || null,
      loading: loadingCodes.has(fund.code),
      error: errors.get(fund.code) || null,
    }))

  // 获取昨日快照
  const yesterdaySnapshot = storage.getYesterdaySnapshot()

  const summary: PortfolioSummary = funds.reduce(
    (acc, fund) => {
      acc.fundCount++
      acc.totalCost += fund.cost

      if (fund.estimation) {
        const parsed = parseEstimation(fund.estimation)
        
        // 计算今日有效份额（处理今日交易的情况）
        let effectiveShares = fund.shares
        const todayStr = new Date().toISOString().split('T')[0]
        
        if (fund.transactions) {
          fund.transactions.forEach(tx => {
            if (tx.date === todayStr) {
              if (tx.type === 'sell') {
                // 如果是今日卖出，这部分份额在今日仍产生收益，需加回
                effectiveShares += tx.shares
              } else if (tx.type === 'buy') {
                // 如果是今日买入，这部分份额在今日不产生收益，需减去
                effectiveShares -= tx.shares
              }
            }
          })
        }

        const currentValue = fund.shares * parsed.estimatedNav
        // 今日收益使用有效份额计算
        const profitShares = effectiveShares
        
        acc.totalValue += currentValue
        acc.totalProfit += currentValue - fund.cost
        // 今日收益 = 有效份额 * (当前估值 - 昨日净值)
        acc.todayProfit += profitShares * (parsed.estimatedNav - parsed.lastNav)
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
      yesterdayProfit: null as number | null,
      yesterdayProfitPercent: null as number | null,
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

  // 计算昨日收益
  if (yesterdaySnapshot) {
    summary.yesterdayProfit = yesterdaySnapshot.profit
    // 计算昨日收益率：昨日收益 / 前天市值
    const dayBeforeValue = yesterdaySnapshot.totalValue - yesterdaySnapshot.profit
    if (dayBeforeValue > 0) {
      summary.yesterdayProfitPercent = (yesterdaySnapshot.profit / dayBeforeValue) * 100
    }
  }

  const refresh = useCallback(async () => {
    const codes = userFunds.map((f) => f.code)
    if (codes.length === 0) return

    setLoading(true)
    setLoadingCodes(new Set(codes))

    try {
      const results = await fetchMultipleFundEstimations(codes)
      const newEstimations = new Map<string, FundEstimation>()
      const newErrors = new Map<string, string>()
      
      // Update intraday data
      const newIntradayMap = new Map(intradayMap)

      results.forEach((result, code) => {
        if (result instanceof Error) {
          newErrors.set(code, result.message)
        } else {
          newEstimations.set(code, result)
          
          // Save intraday data
          const point: IntradayPoint = {
            time: result.gztime,
            value: parseFloat(result.gsz),
            changePercent: parseFloat(result.gszzl)
          }
          const updatedPoints = storage.saveIntraday(code, point)
          newIntradayMap.set(code, updatedPoints)
        }
      })
      
      setIntradayMap(newIntradayMap)
      setEstimations(newEstimations)
      setErrors(newErrors)
      setLastUpdate(new Date())

      // 保存当日快照（用于计算昨日收益）
      const today = new Date().toISOString().split('T')[0]
      let todayValue = 0
      let todayTotalCost = 0
      let todayProfit = 0

      userFunds.forEach((fund) => {
        const estimation = newEstimations.get(fund.code)
        if (estimation && !(estimation instanceof Error)) {
          const parsed = parseEstimation(estimation)
          
          // 计算今日有效份额（处理今日交易的情况）
          let effectiveShares = fund.shares
          if (fund.transactions) {
            fund.transactions.forEach(tx => {
              if (tx.date === today) {
                if (tx.type === 'sell') {
                  effectiveShares += tx.shares
                } else if (tx.type === 'buy') {
                  effectiveShares -= tx.shares
                }
              }
            })
          }

          const currentValue = fund.shares * parsed.estimatedNav
          todayValue += currentValue
          todayTotalCost += fund.cost
          // 今日收益 = 有效份额 * (当前估值 - 昨日净值)
          todayProfit += effectiveShares * (parsed.estimatedNav - parsed.lastNav)
        }
      })

      if (todayValue > 0) {
        storage.saveDailySnapshot({
          date: today,
          totalValue: todayValue,
          totalCost: todayTotalCost,
          profit: todayProfit,
        })
      }
    } catch (error) {
      console.error('刷新估值失败:', error)
    } finally {
      setLoading(false)
      setLoadingCodes(new Set())
    }
  }, [userFunds])

  // 重新从存储加载数据
  const reload = useCallback(() => {
    setUserFunds(storage.getFunds())
  }, [])

  const addFund = useCallback(
    async (fund: Omit<UserFund, 'addedAt' | 'sortOrder' | 'transactions'>) => {
      try {
        const newFund = storage.addFund(fund)
        setUserFunds((prev) => [...prev, newFund])

        setLoadingCodes((prev) => new Set(prev).add(fund.code))
        const results = await fetchMultipleFundEstimations([fund.code])
        const result = results.get(fund.code)

        if (result && !(result instanceof Error)) {
          setEstimations((prev) => new Map(prev).set(fund.code, result))
          if (!fund.name && result.name) {
            storage.updateFund(fund.code, { name: result.name })
            setUserFunds((prev) =>
              prev.map((f) => (f.code === fund.code ? { ...f, name: result.name } : f))
            )
          }
        } else if (result instanceof Error) {
          setErrors((prev) => new Map(prev).set(fund.code, result.message))
        }
      } finally {
        setLoadingCodes((prev) => {
          const next = new Set(prev)
          next.delete(fund.code)
          return next
        })
      }
    },
    []
  )

  const updateFund = useCallback(
    (code: string, updates: Partial<Omit<UserFund, 'code' | 'addedAt'>>) => {
      const updated = storage.updateFund(code, updates)
      if (updated) {
        setUserFunds((prev) => prev.map((f) => (f.code === code ? updated : f)))
      }
    },
    []
  )

  const removeFund = useCallback((code: string) => {
    if (storage.removeFund(code)) {
      setUserFunds((prev) => prev.filter((f) => f.code !== code))
      setEstimations((prev) => {
        const next = new Map(prev)
        next.delete(code)
        return next
      })
      setErrors((prev) => {
        const next = new Map(prev)
        next.delete(code)
        return next
      })
    }
  }, [])

  const addTransaction = useCallback(
    (code: string, transaction: Omit<Transaction, 'id' | 'fundCode'>) => {
      const result = storage.addTransaction(code, transaction)
      if (result) {
        // 重新加载数据以获取更新后的份额和成本
        setUserFunds(storage.getFunds())
      }
    },
    []
  )

  const removeTransaction = useCallback((code: string, transactionId: string) => {
    const result = storage.removeTransaction(code, transactionId)
    if (result) {
      setUserFunds(storage.getFunds())
    } else {
      console.error('Failed to remove transaction', { code, transactionId })
    }
  }, [])

  useEffect(() => {
    if (userFunds.length > 0) {
      refresh()
    }
  }, [])

  useEffect(() => {
    if (autoRefreshInterval > 0 && userFunds.length > 0) {
      intervalRef.current = window.setInterval(() => {
        // 只在刷新时间段内自动刷新 (9:30-16:00)
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
  }, [autoRefreshInterval, refresh, userFunds.length])

  // 获取历史快照数据
  const dailySnapshots = storage.getDailySnapshots()

  return {
    funds,
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
