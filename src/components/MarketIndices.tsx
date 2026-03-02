import { useEffect, useState } from 'react'
import { Card, Space, Spin } from '@douyinfe/semi-ui'
import type { MarketIndex } from '@/services'
import { fetchMarketIndices } from '@/services'

interface MarketIndicesProps {
  refreshInterval?: number
  mode?: 'full' | 'compact'
  title?: string
  maxItems?: number
}

export function MarketIndices({
  refreshInterval = 30000,
  mode = 'full',
  title = '市场指数',
  maxItems = 4,
}: MarketIndicesProps) {
  const [indices, setIndices] = useState<MarketIndex[]>([])
  const [loading, setLoading] = useState(true)

  const loadIndices = async () => {
    const data = await fetchMarketIndices()
    setIndices(data)
    setLoading(false)
  }

  useEffect(() => {
    loadIndices()
    const timer = setInterval(loadIndices, refreshInterval)
    return () => clearInterval(timer)
  }, [refreshInterval])

  if (loading && indices.length === 0) {
    return (
      <Card title={title}>
        <div style={{ textAlign: 'center', padding: '24px' }}>
          <Spin />
        </div>
      </Card>
    )
  }

  const visible = indices.slice(0, maxItems)

  if (mode === 'compact') {
    return (
      <Card
        className="market-pulse-compact"
        title={title}
        headerExtraContent={<span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>实时</span>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
          {visible.map((index) => {
            const isRise = index.changePercent >= 0
            return (
              <div
                key={index.code}
                style={{
                  borderRadius: '8px',
                  border: `1px solid ${isRise ? 'rgba(245, 34, 45, 0.24)' : 'rgba(82, 196, 26, 0.28)'}`,
                  background: isRise ? 'var(--rise-bg)' : 'var(--fall-bg)',
                  padding: '8px 10px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--semi-color-text-1)' }}>{index.name}</div>
                <div style={{ fontSize: '16px', marginTop: '2px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {index.price.toFixed(2)}
                </div>
                <div
                  style={{
                    marginTop: '2px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: isRise ? 'var(--rise-color)' : 'var(--fall-color)',
                  }}
                >
                  {isRise ? '+' : ''}{index.changePercent.toFixed(2)}%
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    )
  }

  return (
    <Card title={title} headerExtraContent={<span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>实时</span>}>
      <Space vertical spacing="loose" style={{ width: '100%' }}>
        {visible.map((index) => {
          const isRise = index.changePercent >= 0
          return (
            <div
              key={index.code}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                background: isRise ? 'var(--rise-bg)' : 'var(--fall-bg)',
                borderRadius: '8px',
                border: `1px solid ${isRise ? 'rgba(245, 34, 45, 0.24)' : 'rgba(82, 196, 26, 0.28)'}`
              }}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}>
                  {index.name}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 600, fontFamily: 'monospace' }}>
                  {index.price.toFixed(2)}
                </div>
              </div>
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 600,
                  color: isRise ? 'var(--rise-color)' : 'var(--fall-color)',
                  fontFamily: 'monospace'
                }}
              >
                {isRise ? '+' : ''}{index.changePercent.toFixed(2)}%
              </div>
            </div>
          )
        })}
      </Space>
    </Card>
  )
}
