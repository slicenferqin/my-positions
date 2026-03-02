import { Button, Card } from '@douyinfe/semi-ui'
import type { DailySnapshot, FundWithEstimation } from '@/types'
import type { DashboardOverview } from '@/types/dashboard'
import { ProfitChart } from '@/components/ProfitChart'
import { PortfolioAnalysis } from '@/components/PortfolioAnalysis'
import './HomeDashboard.css'

interface InsightSummaryProps {
  snapshots: DailySnapshot[]
  funds: FundWithEstimation[]
  overview: DashboardOverview | null
  collapsedPanels: Record<string, boolean>
  onTogglePanel: (panel: 'profitChart' | 'portfolioAnalysis') => void
}

export function InsightSummary({
  snapshots,
  funds,
  overview,
  collapsedPanels,
  onTogglePanel,
}: InsightSummaryProps) {
  const latestAlert = overview?.alerts?.[0]
  const topGainer = overview?.topMovers?.gainers?.[0]
  const topLoser = overview?.topMovers?.losers?.[0]

  return (
    <div className="insight-grid">
      <Card
        className="insight-card"
        title="收益归因"
        headerExtraContent={(
          <Button
            size="small"
            theme="borderless"
            onClick={() => onTogglePanel('profitChart')}
          >
            {collapsedPanels.profitChart ? '展开完整收益日历' : '收起'}
          </Button>
        )}
      >
        {collapsedPanels.profitChart ? (
          <div className="insight-summary-text">
            <div>{latestAlert ? `当前优先处理: ${latestAlert.title}` : '暂无重大波动，组合运行平稳。'}</div>
            <div className="insight-metrics">
              <div className="insight-metric">
                <div className="insight-metric-label">主要领涨</div>
                <div className="insight-metric-value rise">{topGainer ? topGainer.name : '-'}</div>
              </div>
              <div className="insight-metric">
                <div className="insight-metric-label">主要拖累</div>
                <div className="insight-metric-value fall">{topLoser ? topLoser.name : '-'}</div>
              </div>
            </div>
          </div>
        ) : (
          <ProfitChart snapshots={snapshots} mode="full" embedded />
        )}
      </Card>

      <Card
        className="insight-card"
        title="持仓透视"
        headerExtraContent={(
          <Button
            size="small"
            theme="borderless"
            onClick={() => onTogglePanel('portfolioAnalysis')}
          >
            {collapsedPanels.portfolioAnalysis ? '展开完整分析' : '收起'}
          </Button>
        )}
      >
        <PortfolioAnalysis funds={funds} mode={collapsedPanels.portfolioAnalysis ? 'summary' : 'full'} embedded />
      </Card>
    </div>
  )
}
