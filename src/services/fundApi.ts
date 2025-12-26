import type { FundEstimation, ParsedEstimation, TrendType, IntradayPoint, IntradayResponse } from '@/types'

/**
 * 获取基金实时估值
 * @param fundCode 基金代码
 * @returns 基金估值数据
 */
export async function fetchFundEstimation(fundCode: string): Promise<FundEstimation> {
  const timestamp = Date.now()
  // 通过 Vite 代理访问天天基金 API
  const url = `/api/fund/${fundCode}.js?rt=${timestamp}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`获取基金 ${fundCode} 数据失败: ${response.status}`)
  }

  const text = await response.text()
  // 解析 JSONP 格式: jsonpgz({...})
  const jsonMatch = text.match(/jsonpgz\((.*)\)/)
  if (!jsonMatch) {
    throw new Error(`基金 ${fundCode} 数据格式错误`)
  }

  try {
    const data = JSON.parse(jsonMatch[1]) as FundEstimation
    return data
  } catch {
    throw new Error(`基金 ${fundCode} JSON 解析失败`)
  }
}

/**
 * 获取基金分时走势
 * @param fundCode 基金代码
 * @returns 分时走势数据
 */
export async function fetchFundIntraday(fundCode: string): Promise<IntradayPoint[]> {
  // 直接访问东财 API (支持 CORS)
  const url = `https://fundmobapi.eastmoney.com/FundMApi/FundVarietieValuationDetail.ashx?FCODE=${fundCode}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`获取基金 ${fundCode} 分时数据失败: ${response.status}`)
    }

    const data = await response.json() as IntradayResponse
    if (data.ErrCode !== 0 || !data.Datas) {
      return []
    }

    return data.Datas.map(item => {
      // item format: "09:30,1.0000,0.00%"
      const [time, valueStr, changeStr] = item.split(',')
      return {
        time,
        value: parseFloat(valueStr),
        changePercent: parseFloat(changeStr.replace('%', ''))
      }
    })
  } catch (error) {
    console.error(`获取分时数据失败:`, error)
    return []
  }
}

/**
 * 批量获取基金估值
 * @param fundCodes 基金代码列表
 * @returns 基金估值数据映射
 */
export async function fetchMultipleFundEstimations(
  fundCodes: string[]
): Promise<Map<string, FundEstimation | Error>> {
  const results = new Map<string, FundEstimation | Error>()

  const promises = fundCodes.map(async (code) => {
    try {
      const estimation = await fetchFundEstimation(code)
      results.set(code, estimation)
    } catch (error) {
      results.set(code, error instanceof Error ? error : new Error(String(error)))
    }
  })

  await Promise.all(promises)
  return results
}

/**
 * 判断涨跌状态
 */
export function getTrendType(changePercent: number): TrendType {
  if (changePercent > 0) return 'rise'
  if (changePercent < 0) return 'fall'
  return 'flat'
}

/**
 * 解析估值数据为数值格式
 */
export function parseEstimation(estimation: FundEstimation): ParsedEstimation {
  const lastNav = parseFloat(estimation.dwjz)
  const estimatedNav = parseFloat(estimation.gsz)
  const changePercent = parseFloat(estimation.gszzl)
  const changeAmount = estimatedNav - lastNav

  return {
    code: estimation.fundcode,
    name: estimation.name,
    lastNav,
    estimatedNav,
    changePercent,
    changeAmount,
    updateTime: estimation.gztime,
    navDate: estimation.jzrq,
    trend: getTrendType(changePercent),
  }
}

/**
 * 格式化涨跌幅显示
 */
export function formatChangePercent(percent: number): string {
  const sign = percent > 0 ? '+' : ''
  return `${sign}${percent.toFixed(2)}%`
}

/**
 * 格式化金额显示
 */
export function formatMoney(amount: number, decimals = 2): string {
  return amount.toFixed(decimals)
}

/**
 * 判断当前是否为交易时间
 * 交易时间: 周一至周五 9:30-11:30, 13:00-15:00
 */
export function isTradingTime(): boolean {
  const now = new Date()
  const day = now.getDay()

  // 周末不交易
  if (day === 0 || day === 6) return false

  const hours = now.getHours()
  const minutes = now.getMinutes()
  const time = hours * 60 + minutes

  // 上午 9:30 - 11:30
  const morningStart = 9 * 60 + 30
  const morningEnd = 11 * 60 + 30
  // 下午 13:00 - 15:00
  const afternoonStart = 13 * 60
  const afternoonEnd = 15 * 60

  return (
    (time >= morningStart && time <= morningEnd) ||
    (time >= afternoonStart && time <= afternoonEnd)
  )
}

/**
 * 判断当前是否在自动刷新时间段
 * 刷新时间: 周一至周五 9:30-16:00
 */
export function isRefreshTime(): boolean {
  const now = new Date()
  const day = now.getDay()

  // 周末不刷新
  if (day === 0 || day === 6) return false

  const hours = now.getHours()
  const minutes = now.getMinutes()
  const time = hours * 60 + minutes

  // 9:30 - 16:00
  const refreshStart = 9 * 60 + 30
  const refreshEnd = 16 * 60

  return time >= refreshStart && time <= refreshEnd
}

/**
 * 市场指数数据
 */
export interface MarketIndex {
  code: string
  name: string
  price: number
  change: number
  changePercent: number
}

// 指数代码映射 (东方财富格式)
const INDEX_CODES: Record<string, { code: string; name: string }> = {
  '上证': { code: '1.000001', name: '上证指数' },
  '创业板': { code: '0.399006', name: '创业板指' },
  '科创50': { code: '1.000688', name: '科创50' },
  '沪深300': { code: '1.000300', name: '沪深300' },
}

/**
 * 获取市场指数数据
 */
export async function fetchMarketIndices(): Promise<MarketIndex[]> {
  const codes = Object.values(INDEX_CODES).map(i => i.code).join(',')
  const timestamp = Date.now()

  // 直接访问东财 API (支持 CORS)
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${codes}&fields=f2,f3,f4,f12,f14&_=${timestamp}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('获取指数数据失败')
    }

    const data = await response.json()

    if (data.data?.diff) {
      return data.data.diff.map((item: { f12: string; f14: string; f2: number; f4: number; f3: number }) => ({
        code: item.f12,
        name: item.f14,
        price: item.f2,
        change: item.f4,
        changePercent: item.f3,
      }))
    }

    return []
  } catch (error) {
    console.error('获取指数数据失败:', error)
    return []
  }
}

/**
 * 基金持仓股票信息
 */
export interface FundStock {
  code: string
  name: string
  percent: number // 持仓占比
}

/**
 * 获取基金持仓数据 (前十大重仓股)
 * 策略：每天只更新一次，优先读取本地缓存
 */
export async function fetchFundPortfolio(fundCode: string): Promise<FundStock[]> {
  const now = new Date()
  const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  const cacheKey = `PORTFOLIO_CACHE_${fundCode}`

  // 1. 尝试读取缓存
  let staleCache: FundStock[] | null = null
  try {
    const cachedData = localStorage.getItem(cacheKey)
    if (cachedData) {
      const { date, data } = JSON.parse(cachedData)
      if (date === today && Array.isArray(data) && data.length > 0) {
        console.log(`[FundApi] Using cached portfolio for ${fundCode}`)
        return data
      }
      // 保存旧缓存备用
      if (Array.isArray(data) && data.length > 0) {
        staleCache = data
      }
    }
  } catch (e) {
    console.warn('Failed to read portfolio cache', e)
  }

  // 2. 缓存无效或不存在，请求网络
  // 添加随机参数防止网络层缓存
  const t = new Date().getTime()
  // 直接访问东财 API (支持 CORS)
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${fundCode}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&_t=${t}`
  
  console.log(`[FundApi] Fetching portfolio for ${fundCode}...`)
  
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    console.log(`[FundApi] Response for ${fundCode}:`, data)

    // 处理 ETF 联接基金
    if (data.Datas.ETFCODE && data.Datas.ETFCODE.length > 0) {
      console.log(`[FundApi] Fund ${fundCode} is a Feeder/ETF-Link for ${data.Datas.ETFCODE}, fetching underlying ETF portfolio...`)
      // 递归获取，缓存逻辑会在递归调用中处理（存的是 ETF 的 key）
      // 注意：这里我们可能希望把 ETF 的数据也缓存为当前基金的数据
      const etfStocks = await fetchFundPortfolio(data.Datas.ETFCODE)
      // 将 ETF 的数据缓存为当前基金的数据，避免下次还要递归
      if (etfStocks.length > 0) {
        localStorage.setItem(cacheKey, JSON.stringify({ date: today, data: etfStocks }))
      }
      return etfStocks
    }

    if (data.ErrCode !== 0 || !data.Datas || !data.Datas.fundStocks) {
      console.warn(`[FundApi] No valid portfolio data for ${fundCode}`, data)
      return []
    }
    
    const stocks = data.Datas.fundStocks.map((item: any) => ({
      code: item.GPDM,
      name: item.GPJC,
      percent: parseFloat(item.JZBL)
    }))
    
    console.log(`[FundApi] Parsed stocks for ${fundCode}:`, stocks)
    
    // 3. 写入缓存
    if (stocks.length > 0) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ date: today, data: stocks }))
      } catch (e) {
        console.warn('Failed to save portfolio cache', e)
      }
    }

    return stocks
    
  } catch (error) {
    console.error(`[FundApi] Error fetching portfolio for ${fundCode}:`, error)
    
    // 降级策略：如果网络请求失败但有旧缓存，返回旧缓存
    if (staleCache) {
      console.warn(`[FundApi] Using stale cache for ${fundCode} due to fetch error`)
      return staleCache
    }
    
    return []
  }
}
