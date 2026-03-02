import { Card } from '@douyinfe/semi-ui'
import type { PortfolioSummary as PortfolioSummaryType } from '@/types'
import { formatMoney } from '@/services'

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
    <Card
      title="资产概览"
      headerExtraContent={
        <span style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>
          {fundCount} 只基金
        </span>
      }
    >
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '13px', color: 'var(--semi-color-text-2)', marginBottom: '8px' }}>
          总市值
        </div>
        <div style={{ fontSize: '28px', fontWeight: 600 }}>
          ¥{formatMoney(totalValue, 2)}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '16px',
        paddingTop: '16px',
        borderTop: '1px solid var(--semi-color-border)'
      }}>
        <div>
          <div style={{ fontSize: '13px', color: 'var(--semi-color-text-2)', marginBottom: '4px' }}>
            持仓成本
          </div>
          <div style={{ fontSize: '16px', fontWeight: 500 }}>
            ¥{formatMoney(totalCost, 2)}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '13px', color: 'var(--semi-color-text-2)', marginBottom: '4px' }}>
            累计盈亏
          </div>
          <div style={{
            fontSize: '16px',
            fontWeight: 500,
            color: totalProfit >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)'
          }}>
            {totalProfit >= 0 ? '+' : ''}¥{formatMoney(totalProfit, 2)}
            <span style={{ fontSize: '13px', marginLeft: '4px' }}>
              ({totalProfitPercent >= 0 ? '+' : ''}{formatMoney(totalProfitPercent, 2)}%)
            </span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '13px', color: 'var(--semi-color-text-2)', marginBottom: '4px' }}>
            今日盈亏
          </div>
          <div style={{
            fontSize: '16px',
            fontWeight: 500,
            color: todayProfit >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)'
          }}>
            {todayProfit >= 0 ? '+' : ''}¥{formatMoney(todayProfit, 2)}
            <span style={{ fontSize: '13px', marginLeft: '4px' }}>
              ({todayProfitPercent >= 0 ? '+' : ''}{formatMoney(todayProfitPercent, 2)}%)
            </span>
          </div>
        </div>

        {yesterdayProfit !== null && (
          <div>
            <div style={{ fontSize: '13px', color: 'var(--semi-color-text-2)', marginBottom: '4px' }}>
              昨日收益
            </div>
            <div style={{
              fontSize: '16px',
              fontWeight: 500,
              color: yesterdayProfit >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)'
            }}>
              {yesterdayProfit >= 0 ? '+' : ''}¥{formatMoney(yesterdayProfit, 2)}
              {yesterdayProfitPercent !== null && (
                <span style={{ fontSize: '13px', marginLeft: '4px' }}>
                  ({yesterdayProfitPercent >= 0 ? '+' : ''}{formatMoney(yesterdayProfitPercent, 2)}%)
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
