import type { PortfolioSummary as PortfolioSummaryType } from '@/types'
import { formatMoney } from '@/services'
import './PortfolioSummary.css'

interface PortfolioSummaryProps {
  summary: PortfolioSummaryType
}

export function PortfolioSummary({ summary }: PortfolioSummaryProps) {
  const {
    totalCost,
    totalValue,
    totalProfit,
    totalProfitPercent,
    todayProfit,
    todayProfitPercent,
    yesterdayProfit,
    yesterdayProfitPercent,
    fundCount,
  } = summary

  return (
    <div className="portfolio-summary">
      <div className="summary-item main">
        <span className="label">总市值</span>
        <span className="value">¥{formatMoney(totalValue, 2)}</span>
      </div>
      <div className="summary-item">
        <span className="label">持仓成本</span>
        <span className="value">¥{formatMoney(totalCost, 2)}</span>
      </div>
      <div className="summary-item">
        <span className="label">持仓收益</span>
        <span className={`value ${totalProfit >= 0 ? 'rise' : 'fall'}`}>
          {totalProfit >= 0 ? '+' : ''}¥{formatMoney(totalProfit, 2)}
          <small>({totalProfitPercent >= 0 ? '+' : ''}{formatMoney(totalProfitPercent, 2)}%)</small>
        </span>
      </div>
      <div className="summary-item">
        <span className="label">今日收益</span>
        <span className={`value ${todayProfit >= 0 ? 'rise' : 'fall'}`}>
          {todayProfit >= 0 ? '+' : ''}¥{formatMoney(todayProfit, 2)}
          <small>({todayProfitPercent >= 0 ? '+' : ''}{formatMoney(todayProfitPercent, 2)}%)</small>
        </span>
      </div>
      {yesterdayProfit !== null && (
        <div className="summary-item">
          <span className="label">昨日收益</span>
          <span className={`value ${yesterdayProfit >= 0 ? 'rise' : 'fall'}`}>
            {yesterdayProfit >= 0 ? '+' : ''}¥{formatMoney(yesterdayProfit, 2)}
            {yesterdayProfitPercent !== null && (
              <small>({yesterdayProfitPercent >= 0 ? '+' : ''}{formatMoney(yesterdayProfitPercent, 2)}%)</small>
            )}
          </span>
        </div>
      )}
      <div className="summary-item meta">
        <span className="fund-count">{fundCount} 只基金</span>
      </div>
    </div>
  )
}
