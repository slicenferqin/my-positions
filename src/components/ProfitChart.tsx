import { useMemo, useState } from 'react'
import type { DailySnapshot } from '@/types'
import { formatMoney } from '@/services'
import './ProfitChart.css'

interface ProfitChartProps {
  snapshots: DailySnapshot[]
  days?: number // 这里的 days 实际上我们改用 weeks 逻辑，或者保留 days 用来计算范围
}

export function ProfitChart({ snapshots }: ProfitChartProps) {
  const [hoveredData, setHoveredData] = useState<{ date: string; profit: number } | null>(null)

  // 配置: 显示过去多少周的数据
  const WEEKS_TO_SHOW = 52

  // 1. 处理数据映射 date -> profit
  const profitMap = useMemo(() => {
    const map = new Map<string, number>()
    snapshots.forEach(s => {
      map.set(s.date, s.profit)
    })
    return map
  }, [snapshots])

  // 2. 生成日历网格数据
  const calendarData = useMemo(() => {
    const today = new Date()
    // 找到最近的一个周六作为结束点 (让当前周完整显示或截止到今天)
    // 或者简单点：今天往回推 WEEKS_TO_SHOW * 7 天，然后调整到那个周的周日
    
    const endDate = new Date(today)
    
    // 计算开始日期：往回推 WEEKS_TO_SHOW 周
    // 为了对齐，我们先找到今天的 weekday
    // 我们的网格通常是从周日开始（第0行）
    
    // 策略：生成 WEEKS_TO_SHOW 列。最后一列包含今天。
    // 最后一列的最后一天应该是今天所在的周六（即使是未来日期，也可以置空）
    // 或者：最后一列就是当前周（到今天为止）
    
    // 让 endDate 为今天
    // 让 startDate 为 (today - weeks * 7) 的那个周日
    const dayOfWeek = today.getDay() // 0 (Sun) - 6 (Sat)
    const daysSinceStartOfWeek = dayOfWeek // 假设周日是一周开始
    
    // 我们需要 WEEKS_TO_SHOW 个完整列（或者近似）
    // 总天数 = (WEEKS_TO_SHOW - 1) * 7 + (daysSinceStartOfWeek + 1)
    // 但为了简单的网格渲染，我们通常渲染完整的 WEEKS_TO_SHOW 列
    
    const totalDays = WEEKS_TO_SHOW * 7
    // 结束日期：为了让今天显示在最后一列的正确位置，
    // 我们假设最后一列是当前周（Sun...Today...Sat）
    // 所以 grid 的最后一天应该是当前周的周六
    const endOfWeek = new Date(today)
    endOfWeek.setDate(today.getDate() + (6 - dayOfWeek))
    
    const startDate = new Date(endOfWeek)
    startDate.setDate(startDate.getDate() - totalDays + 1)

    const weeks: { date: Date; dateStr: string; profit: number | undefined }[][] = []
    
    let current = new Date(startDate)
    
    for (let w = 0; w < WEEKS_TO_SHOW; w++) {
      const week = []
      for (let d = 0; d < 7; d++) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
        const profit = profitMap.get(dateStr)
        
        // 只有当日期 <= today 时才显示数据（虽然 profitMap 里也不会有未来的数据）
        const isFuture = current > today
        
        week.push({
          date: new Date(current),
          dateStr,
          profit: isFuture ? undefined : (profit || 0), // 如果是过去且无数据，视为0；未来则undefined
          isFuture
        })
        
        current.setDate(current.getDate() + 1)
      }
      weeks.push(week)
    }
    
    return weeks
  }, [profitMap])

  // 3. 计算统计数据 (保留原有逻辑)
  const stats = useMemo(() => {
    if (snapshots.length === 0) {
      return { weekProfit: 0, monthProfit: 0, maxAbs: 100 }
    }

    const now = new Date()
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const monthAgo = new Date(now)
    monthAgo.setDate(monthAgo.getDate() - 30)

    let weekProfit = 0
    let monthProfit = 0

    snapshots.forEach((s) => {
      const date = new Date(s.date)
      if (date >= weekAgo) weekProfit += s.profit
      if (date >= monthAgo) monthProfit += s.profit
    })
    
    // 计算用于颜色比例的最大绝对值收益
    const profits = snapshots.map(s => s.profit)
    
    const maxVal = Math.max(...profits, 0)
    const minVal = Math.min(...profits, 0)
    
    const maxAbs = Math.max(Math.abs(maxVal), Math.abs(minVal)) || 100

    return { weekProfit, monthProfit, maxAbs }
  }, [snapshots]) // calendarData dependency removed as we use snapshots directly for global stats

  // 辅助函数：获取颜色等级
  const getColorLevel = (profit: number | undefined) => {
    if (profit === undefined) return 'future'
    if (profit === 0) return 'zero'
    
    const abs = Math.abs(profit)
    const ratio = abs / (stats.maxAbs / 2) // 让颜色更容易饱和，除以 maxAbs 的一半
    
    // 等级 1-4
    let level = 1
    if (ratio > 0.25) level = 2
    if (ratio > 0.5) level = 3
    if (ratio > 0.75) level = 4
    
    return profit > 0 ? `rise-${level}` : `fall-${level}`
  }
  
  // 生成月份标签
  const monthLabels = useMemo(() => {
    const labels: { text: string; index: number }[] = []
    let lastMonth = -1
    
    calendarData.forEach((week, index) => {
      const firstDay = week[0].date
      const month = firstDay.getMonth()
      
      // 如果月份变了，且不是第一列（或者是第一列但刚好是月初），或者是第一列
      // 为了避免太挤，我们只在月份变化且距离上一个标签有一定距离时显示
      // 简单策略：只要月份变了就显示
      if (month !== lastMonth) {
        labels.push({ 
          text: `${month + 1}月`, 
          index 
        })
        lastMonth = month
      }
    })
    return labels
  }, [calendarData])

  if (snapshots.length === 0) {
     // ... Empty state (keeping original simplified)
     return (
      <div className="profit-chart empty">
        <div className="empty-message">
          <span>📊</span>
          <p>暂无收益数据</p>
          <small>系统会自动记录每日收益</small>
        </div>
      </div>
    )
  }

  return (
    <div className="profit-chart">
      <div className="chart-header">
        <h4>投资日历</h4>
        <div className="period-stats">
          <div className="stat-item">
            <span className="stat-label">近7日</span>
            <span className={`stat-value ${stats.weekProfit >= 0 ? 'rise' : 'fall'}`}>
              {stats.weekProfit >= 0 ? '+' : ''}¥{formatMoney(stats.weekProfit, 2)}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">近30日</span>
            <span className={`stat-value ${stats.monthProfit >= 0 ? 'rise' : 'fall'}`}>
              {stats.monthProfit >= 0 ? '+' : ''}¥{formatMoney(stats.monthProfit, 2)}
            </span>
          </div>
        </div>
      </div>

      <div className="calendar-container">
        {/* Month Labels */}
        <div className="month-labels">
          {monthLabels.map((label, i) => (
             <span 
               key={i} 
               className="month-label"
               style={{ left: `${label.index * 16}px` }} // 16px is width of col (12px box + 4px gap)
             >
               {label.text}
             </span>
          ))}
        </div>

        <div className="calendar-grid">
          {/* Weekday Labels (Mon, Wed, Fri) */}
          <div className="weekday-labels">
            <span></span>
            <span>一</span>
            <span></span>
            <span>三</span>
            <span></span>
            <span>五</span>
            <span></span>
          </div>

          {/* Weeks */}
          <div className="weeks-container">
            {calendarData.map((week, wIndex) => (
              <div key={wIndex} className="week-col">
                {week.map((day, dIndex) => (
                  <div
                    key={dIndex}
                    className={`day-cell ${getColorLevel(day.profit)}`}
                    onMouseEnter={() => day.profit !== undefined && setHoveredData({ date: day.dateStr, profit: day.profit })}
                    onMouseLeave={() => setHoveredData(null)}
                    title={`${day.dateStr} 收益: ¥${formatMoney(day.profit || 0, 2)}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        
        {/* Legend */}
        <div className="calendar-legend">
          <span>亏损</span>
          <div className="legend-scale fall">
            <div className="scale-item fall-4"></div>
            <div className="scale-item fall-3"></div>
            <div className="scale-item fall-2"></div>
            <div className="scale-item fall-1"></div>
          </div>
          <div className="scale-item zero"></div>
          <div className="legend-scale rise">
            <div className="scale-item rise-1"></div>
            <div className="scale-item rise-2"></div>
            <div className="scale-item rise-3"></div>
            <div className="scale-item rise-4"></div>
          </div>
          <span>盈利</span>
        </div>

        {/* Floating Tooltip (Optional if standard title attribute is not enough, but title is easiest for now) */}
        {/* We can enhance this later if needed */}
      </div>
    </div>
  )
}
