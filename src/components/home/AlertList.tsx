import { Card } from '@douyinfe/semi-ui'
import type { DashboardAlert } from '@/types/dashboard'
import './HomeDashboard.css'

interface AlertListProps {
  alerts: DashboardAlert[]
  onNavigateFund?: (fundCode: string) => void
}

export function AlertList({ alerts, onNavigateFund }: AlertListProps) {
  return (
    <Card title="异常提醒">
      <div className="alert-list">
        {alerts.length === 0 && <div className="alert-empty">当前无高优先级异常</div>}
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`alert-item ${alert.severity}`}
            onClick={() => alert.fundCode && onNavigateFund?.(alert.fundCode)}
          >
            <div className="alert-title">{alert.title}</div>
            <div className="alert-message">{alert.message}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
