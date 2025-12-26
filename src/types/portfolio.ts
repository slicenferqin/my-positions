export interface Stock {
  code: string
  name: string
  ratio: number // 持仓占比 %
  percent?: number // 占总资产占比 (calculated)
}

export interface FundDetails {
  code: string
  name: string
  sectors: string[]
  topStocks: Stock[]
}

export interface AttributionItem {
  name: string
  code?: string
  amount: number
  returnRate?: number
  percent?: number
}

export interface PortfolioAnalysis {
  keywords: Set<string>
  topStocks: Set<string>
  sectors: Set<string>
  summary: string
  sectorAllocation: { name: string; value: number; percent: number }[]
  stockExposure: { code: string; name: string; value: number; percent: number }[]
  totalAssets: number
  dailyAttribution: {
    topGainers: AttributionItem[]
    topLosers: AttributionItem[]
    sectorContribution: AttributionItem[]
    totalDailyProfit: number
  }
}
