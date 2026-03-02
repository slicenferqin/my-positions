import { useMemo, useState } from 'react'
import { Card } from '@douyinfe/semi-ui'
import { IconLineChartStroked } from '@douyinfe/semi-icons'
import type { DailySnapshot } from '@/types'
import { formatMoney } from '@/services'
import './ProfitChart.css'

interface ProfitChartProps {
  snapshots: DailySnapshot[]
  mode?: 'summary' | 'full'
  embedded?: boolean
}

export function ProfitChart({ snapshots, mode = 'full', embedded = false }: ProfitChartProps) {
  const [hoveredData, setHoveredData] = useState<{ date: string; profit: number } | null>(null)
  const WEEKS_TO_SHOW = 52

  const orderedSnapshots = useMemo(
    () => [...snapshots].sort((a, b) => a.date.localeCompare(b.date)),
    [snapshots]
  )

  const profitMap = useMemo(() => {
    const map = new Map<string, number>()
    orderedSnapshots.forEach((snapshot) => {
      map.set(snapshot.date, snapshot.profit)
    })
    return map
  }, [orderedSnapshots])

  const stats = useMemo(() => {
    if (orderedSnapshots.length === 0) {
      return { weekProfit: 0, monthProfit: 0, maxAbs: 100 }
    }

    const now = new Date()
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const monthAgo = new Date(now)
    monthAgo.setDate(monthAgo.getDate() - 30)

    let weekProfit = 0
    let monthProfit = 0

    orderedSnapshots.forEach((snapshot) => {
      const date = new Date(snapshot.date)
      if (date >= weekAgo) weekProfit += snapshot.profit
      if (date >= monthAgo) monthProfit += snapshot.profit
    })

    const profits = orderedSnapshots.map((snapshot) => snapshot.profit)
    const maxVal = Math.max(...profits, 0)
    const minVal = Math.min(...profits, 0)
    const maxAbs = Math.max(Math.abs(maxVal), Math.abs(minVal)) || 100

    return { weekProfit, monthProfit, maxAbs }
  }, [orderedSnapshots])

  const miniTrend = useMemo(() => {
    const items = orderedSnapshots.slice(-14)
    const maxAbs = Math.max(...items.map((item) => Math.abs(item.profit)), 1)
    return items.map((item) => ({
      ...item,
      height: Math.max(10, Math.round((Math.abs(item.profit) / maxAbs) * 42)),
    }))
  }, [orderedSnapshots])

  const calendarData = useMemo(() => {
    const today = new Date()
    const dayOfWeek = today.getDay()
    const totalDays = WEEKS_TO_SHOW * 7
    const endOfWeek = new Date(today)
    endOfWeek.setDate(today.getDate() + (6 - dayOfWeek))

    const startDate = new Date(endOfWeek)
    startDate.setDate(startDate.getDate() - totalDays + 1)

    const weeks: any[][] = []
    let current = new Date(startDate)

    for (let weekIndex = 0; weekIndex < WEEKS_TO_SHOW; weekIndex++) {
      const week = []
      for (let day = 0; day < 7; day++) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
        const profit = profitMap.get(dateStr)
        const isFuture = current > today

        week.push({
          date: new Date(current),
          dateStr,
          profit: isFuture ? undefined : (profit || 0),
          isFuture,
        })

        current.setDate(current.getDate() + 1)
      }
      weeks.push(week)
    }
    return weeks
  }, [profitMap])

  const monthLabels = useMemo(() => {
    const labels: { text: string; index: number }[] = []
    let lastMonth = -1

    calendarData.forEach((week, index) => {
      const firstDay = week[0].date
      const month = firstDay.getMonth()
      if (month !== lastMonth) {
        labels.push({ text: `${month + 1}月`, index })
        lastMonth = month
      }
    })
    return labels
  }, [calendarData])

  const getColorLevel = (profit: number | undefined) => {
    if (profit === undefined) return 'future'
    if (profit === 0) return 'zero'

    const abs = Math.abs(profit)
    const ratio = abs / (stats.maxAbs / 2)
    let level = 1
    if (ratio > 0.25) level = 2
    if (ratio > 0.5) level = 3
    if (ratio > 0.75) level = 4
    return profit > 0 ? `rise-${level}` : `fall-${level}`
  }

  const statLine = (
    <div className="profit-stat-line">
      <div>
        <span>近7日 </span>
        <strong className={stats.weekProfit >= 0 ? 'rise' : 'fall'}>
          {stats.weekProfit >= 0 ? '+' : ''}¥{formatMoney(stats.weekProfit, 2)}
        </strong>
      </div>
      <div>
        <span>近30日 </span>
        <strong className={stats.monthProfit >= 0 ? 'rise' : 'fall'}>
          {stats.monthProfit >= 0 ? '+' : ''}¥{formatMoney(stats.monthProfit, 2)}
        </strong>
      </div>
    </div>
  )

  if (orderedSnapshots.length === 0) {
    const emptyNode = (
      <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--semi-color-text-2)' }}>
        <div style={{ color: 'var(--semi-color-primary)', marginBottom: '8px', lineHeight: 1 }}>
          <IconLineChartStroked size="extra-large" />
        </div>
        <div>暂无收益数据</div>
      </div>
    )

    if (embedded) return emptyNode

    return <Card title="收益日历">{emptyNode}</Card>
  }

  if (mode === 'summary') {
    const summaryNode = (
      <div className="profit-summary">
        {statLine}
        <div className="profit-mini-chart">
          {miniTrend.map((item) => (
            <div
              key={item.date}
              className={`profit-mini-bar ${item.profit >= 0 ? 'rise' : 'fall'}`}
              style={{ height: `${item.height}px` }}
              title={`${item.date}: ${item.profit >= 0 ? '+' : ''}${formatMoney(item.profit, 2)}`}
            />
          ))}
        </div>
        <div className="profit-mini-caption">近 14 日每日收益波动</div>
      </div>
    )

    if (embedded) return summaryNode
    return <Card title="收益摘要">{summaryNode}</Card>
  }

  const fullNode = (
    <div className="profit-chart">
      {statLine}
      <div className="calendar-container">
        <div className="month-labels">
          {monthLabels.map((label, index) => (
            <span key={index} className="month-label" style={{ left: `${label.index * 16}px` }}>
              {label.text}
            </span>
          ))}
        </div>

        <div className="calendar-grid">
          <div className="weekday-labels">
            <span />
            <span>一</span>
            <span />
            <span>三</span>
            <span />
            <span>五</span>
            <span />
          </div>

          <div className="weeks-container">
            {calendarData.map((week, weekIndex) => (
              <div key={weekIndex} className="week-col">
                {week.map((day: any, dayIndex: number) => (
                  <div
                    key={dayIndex}
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

        {hoveredData && (
          <div className="profit-hover-tip">
            {hoveredData.date}：{hoveredData.profit >= 0 ? '+' : ''}¥{formatMoney(hoveredData.profit, 2)}
          </div>
        )}

        <div className="calendar-legend">
          <span>亏损</span>
          <div className="legend-scale fall">
            <div className="scale-item fall-4" />
            <div className="scale-item fall-3" />
            <div className="scale-item fall-2" />
            <div className="scale-item fall-1" />
          </div>
          <div className="scale-item zero" />
          <div className="legend-scale rise">
            <div className="scale-item rise-1" />
            <div className="scale-item rise-2" />
            <div className="scale-item rise-3" />
            <div className="scale-item rise-4" />
          </div>
          <span>盈利</span>
        </div>
      </div>
    </div>
  )

  if (embedded) return fullNode

  return <Card title="收益日历">{fullNode}</Card>
}
