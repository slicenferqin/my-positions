
import { useState, useEffect } from 'react'
import type { FundWithEstimation, IntradayPoint } from '@/types'
import { parseEstimation, formatMoney, formatChangePercent, fetchFundIntraday } from '@/services'
import { TrendChart } from './TrendChart'
import './FundDetailRow.css'

interface FundDetailRowProps {
  fund: FundWithEstimation
  intradayData?: IntradayPoint[]
}

export function FundDetailRow({ fund, intradayData: propData }: FundDetailRowProps) {
  const [intradayData, setIntradayData] = useState<IntradayPoint[]>(propData || [])
  const [loading, setLoading] = useState(false)

  const parsed = fund.estimation ? parseEstimation(fund.estimation) : null

  useEffect(() => {
    if (propData && propData.length > 0) {
      setIntradayData(propData)
      return
    }

    let mounted = true
    const fetchData = async () => {
      setLoading(true)
      try {
        const data = await fetchFundIntraday(fund.code)
        if (mounted) {
          setIntradayData(data)
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    if (fund.code) {
      fetchData()
    }

    return () => {
      mounted = false
    }
  }, [fund.code, propData])

  if (!parsed) return null

  const currentValue = fund.shares * parsed.estimatedNav
  const lastValue = fund.shares * parsed.lastNav
  const profit = currentValue - fund.cost
  const profitPercent = fund.cost > 0 ? (profit / fund.cost) * 100 : 0
  const todayProfit = currentValue - lastValue
  const todayProfitPercent = lastValue > 0 ? (todayProfit / lastValue) * 100 : 0
  const avgCost = fund.shares > 0 ? fund.cost / fund.shares : 0

  return (
    <div className="fund-detail-row-content">
      <div className="detail-section trend-chart-section">
        <h5>分时走势</h5>
        <div className="chart-wrapper">
          {loading ? (
            <div className="loading-chart">加载中...</div>
          ) : (
            <TrendChart data={intradayData} height={120} />
          )}
        </div>
      </div>

      <div className="detail-section basic-info">
        <h5>基本信息</h5>
        <div className="info-grid">
          <div className="info-item">
            <span className="label">估算净值</span>
            <span className={`value ${parsed.trend}`}>
              {formatMoney(parsed.estimatedNav, 4)}
              <small>{formatChangePercent(parsed.changePercent)}</small>
            </span>
          </div>
          <div className="info-item">
            <span className="label">上期净值</span>
            <span className="value">{formatMoney(parsed.lastNav, 4)}</span>
          </div>
          <div className="info-item">
            <span className="label">净值日期</span>
            <span className="value">{parsed.navDate}</span>
          </div>
          <div className="info-item">
            <span className="label">更新时间</span>
            <span className="value">{parsed.updateTime}</span>
          </div>
        </div>
      </div>

      {fund.shares > 0 && (
        <div className="detail-section position-info">
          <h5>持仓详情</h5>
          <div className="info-grid">
            <div className="info-item">
              <span className="label">持有份额</span>
              <span className="value">{formatMoney(fund.shares, 2)}</span>
            </div>
            <div className="info-item">
              <span className="label">持仓成本</span>
              <span className="value">¥{formatMoney(fund.cost, 2)}</span>
            </div>
            <div className="info-item">
              <span className="label">单位成本</span>
              <span className="value">{formatMoney(avgCost, 4)}</span>
            </div>
            <div className="info-item">
              <span className="label">当前市值</span>
              <span className="value">¥{formatMoney(currentValue, 2)}</span>
            </div>
            <div className="info-item">
              <span className="label">持仓收益</span>
              <span className={`value ${profit >= 0 ? 'rise' : 'fall'}`}>
                {profit >= 0 ? '+' : ''}¥{formatMoney(profit, 2)}
                <small>({profitPercent >= 0 ? '+' : ''}{formatMoney(profitPercent, 2)}%)</small>
              </span>
            </div>
            <div className="info-item">
              <span className="label">今日收益</span>
              <span className={`value ${todayProfit >= 0 ? 'rise' : 'fall'}`}>
                {todayProfit >= 0 ? '+' : ''}¥{formatMoney(todayProfit, 2)}
                <small>({todayProfitPercent >= 0 ? '+' : ''}{formatMoney(todayProfitPercent, 2)}%)</small>
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="detail-section transaction-info">
        <h5>最近调仓</h5>
        {!fund.transactions || fund.transactions.length === 0 ? (
          <div className="no-data">暂无记录</div>
        ) : (
          <div className="transaction-list">
            {fund.transactions.slice(-3).reverse().map((t) => (
              <div key={t.id} className="transaction-item">
                <span className={`type ${t.type}`}>
                  {t.type === 'buy' ? '买入' : '卖出'}
                </span>
                <span className="amount">{formatMoney(t.shares, 2)}份</span>
                <span className="price">@{formatMoney(t.price, 4)}</span>
                <span className="date">{t.date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
