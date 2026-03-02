import type { PortfolioSummary } from '@/types'
import type { DashboardOverview } from '@/types/dashboard'
import { formatMoney } from '@/services'
import './HomeDashboard.css'

interface PortfolioKpiBarProps {
  summary: PortfolioSummary
  overview: DashboardOverview | null
  lastUpdate: Date | null
}

const RISK_LABEL_MAP = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
} as const

export function PortfolioKpiBar({ summary, overview, lastUpdate }: PortfolioKpiBarProps) {
  const kpi = overview?.kpi
  const totalValue = kpi?.totalValue ?? summary.totalValue
  const todayProfit = kpi?.todayProfit ?? summary.todayProfit
  const todayProfitPercent = kpi?.todayProfitPercent ?? summary.todayProfitPercent
  const totalProfit = kpi?.totalProfit ?? summary.totalProfit
  const totalProfitPercent = kpi?.totalProfitPercent ?? summary.totalProfitPercent
  const alertCount = kpi?.alertCount ?? 0
  const risk = overview?.riskScore

  const updateText = lastUpdate
    ? `更新于 ${lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '等待首轮刷新'

  return (
    <section className="kpi-grid">
      <div className="kpi-card">
        <div className="kpi-label">总资产</div>
        <div className="kpi-value currency">¥{formatMoney(totalValue, 2)}</div>
        <div className="kpi-meta">
          <span>{kpi?.fundCount ?? summary.fundCount} 只持仓</span>
          <span>{updateText}</span>
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-label">今日盈亏</div>
        <div className={`kpi-value ${todayProfit >= 0 ? 'rise' : 'fall'}`}>
          {todayProfit >= 0 ? '+' : ''}¥{formatMoney(todayProfit, 2)}
        </div>
        <div className="kpi-meta">
          <span>{todayProfitPercent >= 0 ? '+' : ''}{formatMoney(todayProfitPercent, 2)}%</span>
          <span>{todayProfit >= 0 ? '盘中偏强' : '盘中承压'}</span>
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-label">累计盈亏</div>
        <div className={`kpi-value ${totalProfit >= 0 ? 'rise' : 'fall'}`}>
          {totalProfit >= 0 ? '+' : ''}¥{formatMoney(totalProfit, 2)}
        </div>
        <div className="kpi-meta">
          <span>{totalProfitPercent >= 0 ? '+' : ''}{formatMoney(totalProfitPercent, 2)}%</span>
          <span>对比持仓成本</span>
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-label">风险状态</div>
        <div className={`kpi-risk-badge ${risk?.level || 'low'}`}>
          <span>{RISK_LABEL_MAP[risk?.level || 'low']}</span>
          <span>{Math.round(risk?.score ?? 0)}</span>
        </div>
        <div className="kpi-meta">
          <span>异常 {alertCount} 条</span>
          <span>浓度 {Math.round(risk?.concentration ?? 0)}</span>
        </div>
      </div>
    </section>
  )
}
