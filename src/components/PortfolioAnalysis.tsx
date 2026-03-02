import { useMemo, useState, useEffect, useRef } from 'react'
import { Card, Progress, Tag, Space } from '@douyinfe/semi-ui'
import { analyzePortfolio, fetchFundPortfolio } from '@/services'
import type { FundWithEstimation, Stock } from '@/types'

interface PortfolioAnalysisProps {
  funds: FundWithEstimation[]
  mode?: 'summary' | 'full'
  embedded?: boolean
}

export function PortfolioAnalysis({ funds, mode = 'full', embedded = false }: PortfolioAnalysisProps) {
  const [realHoldings, setRealHoldings] = useState<Record<string, Stock[]>>({})
  const loadedCodesRef = useRef(new Set<string>())

  useEffect(() => {
    const loadHoldings = async () => {
      const codesToFetch = funds
        .map((fund) => fund.code)
        .filter((code) => !loadedCodesRef.current.has(code))

      if (codesToFetch.length === 0) return
      codesToFetch.forEach((code) => loadedCodesRef.current.add(code))

      const next: Record<string, Stock[]> = {}
      await Promise.all(codesToFetch.map(async (code) => {
        try {
          const stocks = await fetchFundPortfolio(code)
          if (stocks.length > 0) {
            next[code] = stocks.map((item) => ({
              name: item.name,
              code: item.code,
              ratio: item.percent,
            }))
          }
        } catch (error) {
          console.error(`Load portfolio failed for ${code}`, error)
        }
      }))

      if (Object.keys(next).length > 0) {
        setRealHoldings((prev) => ({ ...prev, ...next }))
      }
    }

    if (funds.length > 0) loadHoldings()
  }, [funds.map((item) => item.code).join(',')])

  const analysis = useMemo(() => analyzePortfolio(funds, realHoldings), [funds, realHoldings])
  const { sectorAllocation, stockExposure, totalAssets, summary, dailyAttribution } = analysis

  const fmtMoney = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`

  const emptyNode = (
    <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--semi-color-text-2)' }}>
      <div style={{ fontSize: '30px', marginBottom: '8px' }}>🧭</div>
      <div>添加持仓后查看持仓透视</div>
    </div>
  )

  const summaryNode = (
    <div>
      <div style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--semi-color-text-1)' }}>
        {summary}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginTop: '10px' }}>
        <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: '8px', padding: '8px' }}>
          <div style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>首位行业</div>
          <div style={{ marginTop: '4px', fontSize: '16px', fontWeight: 600 }}>
            {sectorAllocation[0]?.name || '-'}
          </div>
        </div>
        <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: '8px', padding: '8px' }}>
          <div style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>首位重仓</div>
          <div style={{ marginTop: '4px', fontSize: '16px', fontWeight: 600 }}>
            {stockExposure[0]?.name || '-'}
          </div>
        </div>
      </div>
      <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
        <Tag color="red" size="small">
          领涨: {dailyAttribution.topGainers[0]?.name || '-'}
        </Tag>
        <Tag color="green" size="small">
          拖累: {dailyAttribution.topLosers[0]?.name || '-'}
        </Tag>
      </div>
    </div>
  )

  const fullNode = (
    <div>
      <div style={{
        padding: '10px',
        background: 'var(--semi-color-fill-0)',
        borderRadius: '8px',
        marginBottom: '16px',
        fontSize: '13px',
        color: 'var(--semi-color-text-1)',
      }}>
        {summary}
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>今日异动归因</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '12px', marginBottom: '6px', color: 'var(--semi-color-success)' }}>领涨贡献</div>
            {dailyAttribution.topGainers.slice(0, 3).map((item) => (
              <div key={item.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0' }}>
                <span>{item.name}</span>
                <span className="rise">{fmtMoney(item.amount)}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: '12px', marginBottom: '6px', color: 'var(--semi-color-danger)' }}>领跌拖累</div>
            {dailyAttribution.topLosers.slice(0, 3).map((item) => (
              <div key={item.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0' }}>
                <span>{item.name}</span>
                <span className="fall">{fmtMoney(item.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>行业分布 Top 5</div>
        {sectorAllocation.slice(0, 5).map((item) => (
          <div key={item.name} style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
              <span>{item.name}</span>
              <span>{item.percent.toFixed(1)}%</span>
            </div>
            <Progress percent={Math.min(item.percent * 1.5, 100)} showInfo={false} stroke="var(--semi-color-primary)" />
          </div>
        ))}
      </div>

      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>穿透重仓股 Top 8</div>
        <Space vertical spacing={8} style={{ width: '100%' }}>
          {stockExposure.slice(0, 8).map((item) => (
            <div key={item.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
              <div>
                <span>{item.name}</span>
                <span style={{ marginLeft: '6px', color: 'var(--semi-color-text-2)' }}>{item.code}</span>
              </div>
              <span>{item.percent.toFixed(1)}%</span>
            </div>
          ))}
        </Space>
      </div>

      <div style={{
        marginTop: '12px',
        paddingTop: '10px',
        borderTop: '1px dashed var(--semi-color-border)',
        fontSize: '11px',
        textAlign: 'right',
        color: 'var(--semi-color-text-2)',
      }}>
        透视资产规模: ¥{totalAssets.toFixed(2)}
      </div>
    </div>
  )

  const content = funds.length === 0 || totalAssets === 0
    ? emptyNode
    : mode === 'summary'
      ? summaryNode
      : fullNode

  if (embedded) return content

  return (
    <Card
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>持仓分析</span>
          <Tag color="blue" size="small">X-RAY</Tag>
        </div>
      )}
    >
      {content}
    </Card>
  )
}
