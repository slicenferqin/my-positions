import { useMemo, useState, useRef } from 'react'
import type { IntradayPoint } from '@/types'
import './TrendChart.css'

interface TrendChartProps {
  data: IntradayPoint[]
  height?: number
  width?: number | string
  lineColor?: string
  areaColor?: string
}

export function TrendChart({ 
  data, 
  height = 120, 
  width = '100%',
  lineColor = '#f5222d',
  areaColor = 'rgba(245, 34, 45, 0.1)'
}: TrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { points, min, max, baseValue } = useMemo(() => {
    if (!data || data.length === 0) {
      return { points: [], min: 0, max: 0, baseValue: 0 }
    }

    // Calculate base value (yesterday's close) from the first point or average
    // value = base * (1 + change%) => base = value / (1 + change%)
    // It should be consistent across all points
    const first = data[0]
    const baseValue = first.value / (1 + first.changePercent / 100)
    
    let min = baseValue
    let max = baseValue
    
    data.forEach(p => {
      if (p.value < min) min = p.value
      if (p.value > max) max = p.value
    })

    // Add some padding to range
    const range = max - min
    const padding = range === 0 ? baseValue * 0.01 : range * 0.1
    min -= padding
    max += padding

    return { points: data, min, max, baseValue }
  }, [data])

  if (!data || data.length === 0) {
    return (
      <div className="trend-chart-empty" style={{ height }}>
        暂无走势数据
      </div>
    )
  }

  const chartWidth = 1000 // Internal SVG coordinate width
  const chartHeight = 200 // Internal SVG coordinate height

  // Map value to Y coordinate (flip Y because SVG 0 is top)
  const getY = (val: number) => {
    const range = max - min
    if (range === 0) return chartHeight / 2
    return chartHeight - ((val - min) / range) * chartHeight
  }

  // Map index to X coordinate
  const getX = (index: number) => {
    return (index / (points.length - 1)) * chartWidth
  }

  // Generate path
  const pathD = points.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(p.value).toFixed(1)}`
  ).join(' ')

  // Generate area path (close to bottom)
  const areaD = `${pathD} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`

  // Zero line (yesterday's close)
  const zeroY = getY(baseValue)

  // Determine color based on latest value
  const latest = points[points.length - 1]
  const isRise = latest.changePercent >= 0
  const actualLineColor = isRise ? 'var(--rise-color)' : 'var(--fall-color)'
  const actualAreaColor = isRise ? 'var(--rise-bg)' : 'var(--fall-bg)'

  // Interactive handlers
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || points.length === 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const width = rect.width
    
    if (width === 0) return

    // Calculate index
    const index = Math.round((x / width) * (points.length - 1))
    const clampedIndex = Math.max(0, Math.min(index, points.length - 1))
    
    setHoverIndex(clampedIndex)
  }

  const handleMouseLeave = () => {
    setHoverIndex(null)
  }

  // Tooltip data
  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null
  const hoveredX = hoverIndex !== null ? getX(hoverIndex) : 0
  const hoveredY = hoveredPoint ? getY(hoveredPoint.value) : 0
  const hoveredIsRise = hoveredPoint ? hoveredPoint.changePercent >= 0 : false
  const colorClass = hoveredIsRise ? 'rise' : 'fall'
  const sign = hoveredIsRise ? '+' : ''
  
  // Calculate tooltip left position percentage
  // Clamp it to avoid going off-screen (simple clamp for now 5% - 95%)
  let tooltipLeft = hoverIndex !== null 
    ? (hoverIndex / (points.length - 1)) * 100 
    : 0
  
  // Adjust transform based on position to keep it in view
  // If it's near left edge, translateX(0)
  // If it's near right edge, translateX(-100%)
  // Default is translateX(-50%)
  let tooltipTransform = 'translateX(-50%)'
  if (tooltipLeft < 20) tooltipTransform = 'translateX(0)'
  if (tooltipLeft > 80) tooltipTransform = 'translateX(-100%)'

  return (
    <div 
      className="trend-chart" 
      style={{ height, width }}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <svg 
        viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
        preserveAspectRatio="none"
        width="100%" 
        height="100%"
      >
        {/* Baseline (Yesterday Close) */}
        <line 
          x1="0" 
          y1={zeroY} 
          x2={chartWidth} 
          y2={zeroY} 
          stroke="var(--border-color)" 
          strokeDasharray="4 4" 
          strokeWidth="1"
        />

        {/* Area */}
        <path d={areaD} fill={actualAreaColor} opacity="0.2" />

        {/* Line */}
        <path 
          d={pathD} 
          fill="none" 
          stroke={actualLineColor} 
          strokeWidth="2" 
          strokeLinejoin="round" 
          strokeLinecap="round" 
        />

        {/* Interactive Highlight */}
        {hoverIndex !== null && (
          <>
             <line 
                x1={hoveredX} 
                y1="0" 
                x2={hoveredX} 
                y2={chartHeight} 
                stroke="var(--text-secondary)" 
                strokeWidth="1" 
                strokeDasharray="3 3"
                opacity="0.5"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hoveredX}
                cy={hoveredY}
                r="4"
                fill="var(--bg-card)"
                stroke={actualLineColor}
                strokeWidth="2"
              />
          </>
        )}
      </svg>
      
      {/* Tooltip */}
      {hoveredPoint && (
        <div 
          className="chart-tooltip"
          style={{ 
            left: `${tooltipLeft}%`,
            transform: tooltipTransform
          }}
        >
          <div className="tooltip-header">
            <span className="time">{hoveredPoint.time}</span>
          </div>
          <div className={`tooltip-value ${colorClass}`}>
            {hoveredPoint.value.toFixed(4)}
            <small>{sign}{hoveredPoint.changePercent.toFixed(2)}%</small>
          </div>
        </div>
      )}

      <div className="trend-info">
        <span className="min-label">{min.toFixed(4)}</span>
        <span className="max-label">{max.toFixed(4)}</span>
      </div>
    </div>
  )
}
