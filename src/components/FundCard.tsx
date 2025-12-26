import type { FundWithEstimation } from '@/types'
import { parseEstimation, formatChangePercent, formatMoney } from '@/services'
import './FundCard.css'

interface FundCardProps {
  fund: FundWithEstimation
  showCostAndProfit?: boolean
  onRemove?: (code: string) => void
}

export function FundCard({ fund, showCostAndProfit = true, onRemove }: FundCardProps) {
  const parsed = fund.estimation ? parseEstimation(fund.estimation) : null

  // 计算持仓收益
  const currentValue = parsed ? fund.shares * parsed.estimatedNav : 0
  const lastValue = parsed ? fund.shares * parsed.lastNav : 0
  const profit = currentValue - fund.cost
  const profitPercent = fund.cost > 0 ? (profit / fund.cost) * 100 : 0
  const todayProfit = currentValue - lastValue
  const todayProfitPercent = lastValue > 0 ? (todayProfit / lastValue) * 100 : 0

  return (
    <div className={`fund-card ${fund.loading ? 'loading' : ''}`}>
      <div className="fund-header">
        <div className="fund-info">
          <span className="fund-name">{fund.name || fund.code}</span>
          <span className="fund-code">{fund.code}</span>
        </div>
        {onRemove && (
          <button
            className="remove-btn"
            onClick={() => onRemove(fund.code)}
            title="删除基金"
          >
            ×
          </button>
        )}
      </div>

      {fund.error ? (
        <div className="fund-error">{fund.error}</div>
      ) : parsed ? (
        <>
          <div className="fund-estimation">
            <div className="estimation-value">
              <span className="label">估算净值</span>
              <span className={`value ${parsed.trend}`}>
                {formatMoney(parsed.estimatedNav, 4)}
              </span>
            </div>
            <div className="estimation-change">
              <span className={`change-percent ${parsed.trend}`}>
                {formatChangePercent(parsed.changePercent)}
              </span>
            </div>
          </div>

          <div className="fund-nav">
            <span className="label">上期净值</span>
            <span className="value">{formatMoney(parsed.lastNav, 4)}</span>
            <span className="nav-date">{parsed.navDate}</span>
          </div>

          {showCostAndProfit && fund.shares > 0 && (
            <div className="fund-position">
              <div className="position-row">
                <span className="label">持有份额</span>
                <span className="value">{formatMoney(fund.shares, 2)}</span>
              </div>
              <div className="position-row">
                <span className="label">当前市值</span>
                <span className="value">¥{formatMoney(currentValue, 2)}</span>
              </div>
              <div className="position-row">
                <span className="label">持仓成本</span>
                <span className="value">¥{formatMoney(fund.cost, 2)}</span>
              </div>
              <div className="position-row">
                <span className="label">持仓收益</span>
                <span className={`value ${profit >= 0 ? 'rise' : 'fall'}`}>
                  {profit >= 0 ? '+' : ''}¥{formatMoney(profit, 2)}
                  <small>({profitPercent >= 0 ? '+' : ''}{formatMoney(profitPercent, 2)}%)</small>
                </span>
              </div>
              <div className="position-row">
                <span className="label">今日收益</span>
                <span className={`value ${todayProfit >= 0 ? 'rise' : 'fall'}`}>
                  {todayProfit >= 0 ? '+' : ''}¥{formatMoney(todayProfit, 2)}
                  <small>({todayProfitPercent >= 0 ? '+' : ''}{formatMoney(todayProfitPercent, 2)}%)</small>
                </span>
              </div>
            </div>
          )}

          <div className="fund-update-time">
            估值时间: {parsed.updateTime}
          </div>
        </>
      ) : (
        <div className="fund-loading">加载中...</div>
      )}
    </div>
  )
}
