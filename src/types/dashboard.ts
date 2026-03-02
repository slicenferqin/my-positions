export type AlertSeverity = 'low' | 'medium' | 'high'

export interface DashboardAlert {
  id: string
  type: 'drawdown' | 'concentration' | 'stale' | 'empty' | 'opportunity'
  severity: AlertSeverity
  title: string
  message: string
  fundCode?: string
}

export interface RiskScoreBreakdown {
  score: number
  level: 'low' | 'medium' | 'high'
  concentration: number
  volatility: number
  freshness: number
}

export interface DashboardMover {
  fundId?: number
  fundCode: string
  name: string
  todayProfit: number
  changePercent: number
  allocation: number
}

export interface MarketPulseItem {
  code: string
  name: string
  price: number
  changePercent: number
}

export interface DashboardOverview {
  generatedAt: number
  kpi: {
    fundCount: number
    totalCost: number
    totalValue: number
    totalProfit: number
    totalProfitPercent: number
    todayProfit: number
    todayProfitPercent: number
    alertCount: number
  }
  riskScore: RiskScoreBreakdown
  alerts: DashboardAlert[]
  topMovers: {
    gainers: DashboardMover[]
    losers: DashboardMover[]
  }
  marketPulse: MarketPulseItem[]
  staleState: {
    stale: boolean
    maxAgeSeconds: number
    latestUpdateTime: string
  }
  recommendations: string[]
}

export interface DashboardPreference {
  cardOrder: string[]
  collapsedPanels: Record<string, boolean>
  tableSort: {
    key: string
    direction: 'asc' | 'desc'
  }
}
