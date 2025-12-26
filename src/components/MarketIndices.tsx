import { useEffect, useState } from 'react'
import type { MarketIndex } from '@/services'
import { fetchMarketIndices } from '@/services'
import './MarketIndices.css'

interface MarketIndicesProps {
  refreshInterval?: number
}

export function MarketIndices({ refreshInterval = 30000 }: MarketIndicesProps) {
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
    return <div className="market-indices loading">加载指数...</div>
  }

  return (
    <div className="market-indices">
      {indices.map((index) => {
        const isRise = index.changePercent >= 0;
        return (
          <div key={index.code} className={`index-item ${isRise ? 'rise-bg' : 'fall-bg'}`}>
            <div className="index-header">
              <span className="index-name">{index.name}</span>
              <span className={`index-change ${isRise ? 'rise' : 'fall'}`}>
                {isRise ? '+' : ''}{index.changePercent.toFixed(2)}%
              </span>
            </div>
            <span className="index-price">{index.price.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  )
}
