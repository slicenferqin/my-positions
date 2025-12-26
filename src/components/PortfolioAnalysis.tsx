import React, { useMemo, useState, useEffect, useRef } from 'react'
import { analyzePortfolio, fetchFundPortfolio } from '@/services'
import type { FundWithEstimation, Stock } from '@/types'
import './PortfolioAnalysis.css'

interface Props {
  funds: FundWithEstimation[]
}

export function PortfolioAnalysis({ funds }: Props) {
  const [realHoldings, setRealHoldings] = useState<Record<string, Stock[]>>({})
  const loadedCodesRef = useRef(new Set<string>())

  // 获取真实持仓数据
  useEffect(() => {
    const loadHoldings = async () => {
      const codesToFetch = funds
        .map(f => f.code)
        .filter(code => !loadedCodesRef.current.has(code))

      if (codesToFetch.length === 0) return

      // 标记为已处理
      codesToFetch.forEach(c => loadedCodesRef.current.add(c))

      const newHoldings: Record<string, Stock[]> = {}
      await Promise.all(codesToFetch.map(async (code) => {
        try {
          const stocks = await fetchFundPortfolio(code)
          if (stocks && stocks.length > 0) {
            newHoldings[code] = stocks.map(s => ({
              name: s.name,
              code: s.code,
              ratio: s.percent
            }))
          }
        } catch (e) {
          console.error(`Load portfolio failed for ${code}`, e)
        }
      }))

      if (Object.keys(newHoldings).length > 0) {
        setRealHoldings(prev => ({ ...prev, ...newHoldings }))
      }
    }

    if (funds.length > 0) {
      loadHoldings()
    }
  }, [funds.map(f => f.code).join(',')])

  const analysis = useMemo(() => analyzePortfolio(funds, realHoldings), [funds, realHoldings])
  const { sectorAllocation, stockExposure, totalAssets, summary, dailyAttribution } = analysis

  if (funds.length === 0 || totalAssets === 0) {
    return (
      <div className="portfolio-analysis-card empty">
        <div className="analysis-icon">📊</div>
        <div className="analysis-empty-text">添加基金后查看持仓透视</div>
      </div>
    )
  }
  
  // Format money helper
  const fmtMoney = (val: number) => {
    return (val >= 0 ? '+' : '') + val.toFixed(2)
  }

  return (
    <div className="portfolio-analysis-card">
      <div className="analysis-header">
        <div className="header-title-row">
          <h3>持仓深度透视</h3>
          <span className="badge-xray">X-RAY</span>
        </div>
        <p className="analysis-summary">{summary}</p>
      </div>

      {/* 今日异动归因 */}
      <div className="analysis-section">
        <h4 className="section-title">
          <span>今日异动归因</span>
          <span className="section-subtitle">盈亏来源分析</span>
        </h4>
        
        <div className="attribution-grid">
          {/* Top Gainers */}
          {dailyAttribution.topGainers.length > 0 && (
            <div className="attribution-col">
              <div className="sub-title rise">
                <span>🔥 领涨贡献</span>
              </div>
              <div className="attribution-list">
                {dailyAttribution.topGainers.map(item => (
                  <div key={item.code} className="attribution-item">
                    <div className="attr-name">{item.name}</div>
                    <div className="attr-values">
                      <span className="attr-amount rise">{fmtMoney(item.amount)}</span>
                      <span className="attr-rate rise">+{item.returnRate?.toFixed(2)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Top Losers */}
          {dailyAttribution.topLosers.length > 0 && (
            <div className="attribution-col">
              <div className="sub-title fall">
                <span>❄️ 领跌拖累</span>
              </div>
              <div className="attribution-list">
                {dailyAttribution.topLosers.map(item => (
                  <div key={item.code} className="attribution-item">
                    <div className="attr-name">{item.name}</div>
                    <div className="attr-values">
                      <span className="attr-amount fall">{fmtMoney(item.amount)}</span>
                      <span className="attr-rate fall">{item.returnRate?.toFixed(2)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Sector Contribution */}
          <div className="attribution-col full-width">
             <div className="sub-title">
                <span>板块贡献分布</span>
             </div>
             <div className="sector-attribution-chart">
               {dailyAttribution.sectorContribution.map(item => (
                 <div key={item.name} className="sector-attr-row">
                   <span className="sec-name">{item.name}</span>
                   <div className="sec-bar-container">
                     <div 
                       className={`sec-bar ${item.amount >= 0 ? 'rise-bg' : 'fall-bg'}`}
                       style={{ 
                         width: `${Math.min(Math.abs(item.amount) / (Math.abs(dailyAttribution.totalDailyProfit) || 1) * 100 * 2, 100)}%`,
                         marginLeft: item.amount >= 0 ? '50%' : 'auto',
                         marginRight: item.amount < 0 ? '50%' : 'auto',
                         transformOrigin: item.amount >= 0 ? 'left' : 'right'
                       }}
                     ></div>
                   </div>
                   <span className={`sec-val ${item.amount >= 0 ? 'rise' : 'fall'}`}>
                     {fmtMoney(item.amount)}
                   </span>
                 </div>
               ))}
             </div>
          </div>
        </div>
      </div>

      {/* 行业分布 */}
      <div className="analysis-section">
        <h4 className="section-title">
          <span>行业分布</span>
          <span className="section-subtitle">Top 5</span>
        </h4>
        <div className="sector-chart">
          {sectorAllocation.slice(0, 5).map((sector, index) => (
            <div key={sector.name} className="chart-row">
              <div className="row-label">{sector.name}</div>
              <div className="row-bar-container">
                <div 
                  className="row-bar" 
                  style={{ width: `${Math.min(sector.percent * 1.5, 100)}%`, animationDelay: `${index * 0.1}s` }}
                ></div>
              </div>
              <div className="row-value">{sector.percent.toFixed(1)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* 穿透重仓股 */}
      <div className="analysis-section">
        <h4 className="section-title">
          <span>穿透重仓股</span>
          <span className="section-subtitle">隐形持仓暴露</span>
        </h4>
        <div className="stock-list">
          {stockExposure.slice(0, 8).map((stock, index) => (
            <div key={stock.name} className="stock-item">
              <div className="stock-info">
                <span className="stock-name">{stock.name}</span>
                <span className="stock-code">{stock.code}</span>
              </div>
              <div className="stock-bar-bg">
                <div 
                  className="stock-bar-fill"
                  style={{ width: `${Math.min(stock.percent * 2, 100)}%` }} 
                ></div>
              </div>
              <div className="stock-percent">{stock.percent.toFixed(1)}%</div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="analysis-footer">
        数据来源：天天基金 | 基于最新季报重仓股估算
      </div>
    </div>
  )
}
