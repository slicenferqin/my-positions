/**
 * 天天基金API返回的实时估值数据
 */
export interface FundEstimation {
  fundcode: string
  name: string
  jzrq: string
  dwjz: string
  gsz: string
  gszzl: string
  gztime: string
}

/**
 * 调仓记录类型
 */
export type TransactionType = 'buy' | 'sell'

/**
 * 调仓记录
 */
export interface Transaction {
  id: string
  fundCode: string
  type: TransactionType
  shares: number
  price: number
  amount: number
  date: string
  note?: string
}

/**
 * 用户持仓的基金信息
 */
export interface UserFund {
  code: string
  name: string
  shares: number
  cost: number
  addedAt: number
  sortOrder: number
  /** 调仓记录 */
  transactions?: Transaction[]
}

/**
 * 基金完整信息（用户持仓 + 实时估值）
 */
export interface FundWithEstimation extends UserFund {
  estimation: FundEstimation | null
  loading: boolean
  error: string | null
}

/**
 * 基金涨跌状态
 */
export type TrendType = 'rise' | 'fall' | 'flat'

/**
 * 解析后的估值数据
 */
export interface ParsedEstimation {
  code: string
  name: string
  lastNav: number
  estimatedNav: number
  changePercent: number
  changeAmount: number
  updateTime: string
  navDate: string
  trend: TrendType
}

/**
 * 分时走势数据点
 */
export interface IntradayPoint {
  time: string
  value: number
  changePercent: number
}

/**
 * 分时走势响应
 */
export interface IntradayResponse {
  ErrCode: number
  ErrMsg: string | null
  Datas: string[] // "09:30,1.234,0.12%"
  Expansion: any
}

/**
 * 持仓汇总信息
 */
export interface PortfolioSummary {
  totalCost: number
  totalValue: number
  totalProfit: number
  totalProfitPercent: number
  todayProfit: number
  todayProfitPercent: number
  yesterdayProfit: number | null
  yesterdayProfitPercent: number | null
  fundCount: number
}
