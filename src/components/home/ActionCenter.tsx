import { useRef, useState, type ChangeEvent } from 'react'
import { Card, Button, Toast } from '@douyinfe/semi-ui'
import { IconPlus, IconRefresh, IconDownload, IconUpload } from '@douyinfe/semi-icons'
import { exportFundsRequest, importFundsRequest } from '@/services/api'
import './HomeDashboard.css'

interface ActionCenterProps {
  token: string
  assetCount: number
  fundCount: number
  loading: boolean
  lastUpdate: Date | null
  recommendations: string[]
  onAddFund: () => void
  onAddWatchlist: () => void
  onRefresh: () => Promise<void> | void
  onDataChange: () => Promise<void> | void
}

export function ActionCenter({
  token,
  assetCount,
  fundCount,
  loading,
  lastUpdate,
  recommendations,
  onAddFund,
  onAddWatchlist,
  onRefresh,
  onDataChange,
}: ActionCenterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [syncing, setSyncing] = useState(false)

  const updateText = lastUpdate
    ? `更新于 ${lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '尚未刷新'

  const handleExport = async () => {
    try {
      setSyncing(true)
      const json = await exportFundsRequest(token)
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `我的持仓_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`
      link.click()
      URL.revokeObjectURL(url)
      Toast.success('导出成功')
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      setSyncing(false)
    }
  }

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        setSyncing(true)
        const payload = JSON.parse(String(e.target?.result || '{}'))
        await importFundsRequest(token, payload)
        await onDataChange()
        Toast.success('导入成功')
      } catch (error) {
        Toast.error(error instanceof Error ? error.message : '导入失败')
      } finally {
        setSyncing(false)
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  return (
    <Card className="action-center-card" title="行动中心" headerExtraContent={<span>{updateText}</span>}>
      <div className="action-center-group">
        <div className="action-center-row">
          <Button theme="solid" icon={<IconPlus />} onClick={onAddFund}>
            添加持仓
          </Button>
          <Button icon={<IconPlus />} onClick={onAddWatchlist}>
            添加自选
          </Button>
        </div>
        <div className="action-center-row">
          <Button icon={<IconRefresh />} onClick={() => onRefresh()} loading={loading} disabled={syncing || assetCount === 0}>
            刷新估值
          </Button>
          <Button icon={<IconUpload />} onClick={() => fileInputRef.current?.click()} disabled={syncing}>
            导入持仓
          </Button>
        </div>
        <div className="action-center-row action-center-row-single">
          <Button icon={<IconDownload />} onClick={handleExport} disabled={syncing || fundCount === 0}>
            导出快照
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        style={{ display: 'none' }}
      />

      <div className="action-center-tips">
        <div>1) 先看异常再操作，避免情绪化调仓</div>
        <div>2) 自选不计入盈亏与风险，适合先观察后建仓</div>
        {recommendations.length > 0 ? (
          recommendations.slice(0, 2).map((item, index) => (
            <div key={`${index}-${item}`}>{index + 3}) {item}</div>
          ))
        ) : (
          <div>3) 当前无高优先级风险，建议按计划执行</div>
        )}
      </div>
    </Card>
  )
}
