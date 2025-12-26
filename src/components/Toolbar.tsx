import { useRef, useState } from 'react'
import { storage } from '@/services'
import './Toolbar.css'

interface ToolbarProps {
  onAddFund: () => void
  onRefresh: () => void
  loading: boolean
  fundCount: number
  lastUpdate: Date | null
  onDataChange: () => void
}

interface TooltipProps {
  text: string
  visible: boolean
}

function Tooltip({ text, visible }: TooltipProps) {
  if (!visible) return null
  return <span className="icon-tooltip">{text}</span>
}

export function Toolbar({
  onAddFund,
  onRefresh,
  loading,
  fundCount,
  lastUpdate,
  onDataChange,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [tooltip, setTooltip] = useState<string | null>(null)

  const handleExport = () => {
    const data = storage.exportData()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `我的持仓_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      const result = storage.importData(content)

      if (result.success) {
        alert(result.message)
        onDataChange()
      } else {
        alert(result.message)
      }
    }
    reader.readAsText(file)

    // 清空input以便重复选择同一文件
    e.target.value = ''
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button
          className="icon-btn primary"
          onClick={onAddFund}
          onMouseEnter={() => setTooltip('add')}
          onMouseLeave={() => setTooltip(null)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
          <Tooltip text="添加基金" visible={tooltip === 'add'} />
        </button>
        <button
          className="icon-btn"
          onClick={onRefresh}
          disabled={loading || fundCount === 0}
          onMouseEnter={() => setTooltip('refresh')}
          onMouseLeave={() => setTooltip(null)}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="currentColor"
            className={loading ? 'spin' : ''}
          >
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
          <Tooltip text={loading ? '刷新中...' : '刷新估值'} visible={tooltip === 'refresh'} />
        </button>
      </div>

      <div className="toolbar-right">
        {lastUpdate && (
          <span className="update-time">
            更新于 {lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button
          className="icon-btn"
          onClick={handleExport}
          disabled={fundCount === 0}
          onMouseEnter={() => setTooltip('export')}
          onMouseLeave={() => setTooltip(null)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          </svg>
          <Tooltip text="导出数据" visible={tooltip === 'export'} />
        </button>
        <button
          className="icon-btn"
          onClick={handleImportClick}
          onMouseEnter={() => setTooltip('import')}
          onMouseLeave={() => setTooltip(null)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
          </svg>
          <Tooltip text="导入数据" visible={tooltip === 'import'} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}
