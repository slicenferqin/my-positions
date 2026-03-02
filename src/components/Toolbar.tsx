import { useRef, useState } from 'react'
import { Card, Button, Space, Toast, Tooltip } from '@douyinfe/semi-ui'
import { IconPlus, IconRefresh, IconDownload, IconUpload } from '@douyinfe/semi-icons'
import { useAuth } from '@/context/AuthContext'
import { exportFundsRequest, importFundsRequest } from '@/services/api'

interface ToolbarProps {
  onAddFund: () => void
  onRefresh: () => void
  loading: boolean
  fundCount: number
  lastUpdate: Date | null
  onDataChange: () => Promise<void> | void
}

export function Toolbar({ onAddFund, onRefresh, loading, fundCount, lastUpdate, onDataChange }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [syncing, setSyncing] = useState(false)
  const { token } = useAuth()

  const handleExport = async () => {
    if (!token) return
    try {
      setSyncing(true)
      const json = await exportFundsRequest(token)
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `我的持仓_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
      Toast.success('导出成功')
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      setSyncing(false)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return
    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        setSyncing(true)
        const payload = JSON.parse(event.target?.result as string)
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
    e.target.value = ''
  }

  return (
    <Card
      title="操作面板"
      headerExtraContent={
        lastUpdate && (
          <span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>
            更新于 {lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )
      }
    >
      <Space wrap>
        <Tooltip content="添加持仓">
          <Button
            theme="solid"
            icon={<IconPlus />}
            onClick={onAddFund}
          >
            添加持仓
          </Button>
        </Tooltip>

        <Tooltip content="刷新估值">
          <Button
            icon={<IconRefresh />}
            onClick={onRefresh}
            loading={loading}
            disabled={fundCount === 0 || syncing}
          >
            刷新
          </Button>
        </Tooltip>

        <Tooltip content="导出数据">
          <Button
            icon={<IconDownload />}
            onClick={handleExport}
            disabled={fundCount === 0 || syncing}
            loading={syncing && !loading}
          >
            导出
          </Button>
        </Tooltip>

        <Tooltip content="导入数据">
          <Button
            icon={<IconUpload />}
            onClick={handleImportClick}
            disabled={syncing}
          >
            导入
          </Button>
        </Tooltip>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          style={{ display: 'none' }}
        />
      </Space>

      <div style={{
        marginTop: '16px',
        fontSize: '13px',
        color: 'var(--semi-color-text-2)',
        lineHeight: '1.6'
      }}>
        <div>💾 支持导入/导出 JSON 格式数据</div>
        <div>🔄 自动同步云端，多设备访问</div>
      </div>
    </Card>
  )
}
