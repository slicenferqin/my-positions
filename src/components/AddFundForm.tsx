import { useState } from 'react'
import './AddFundForm.css'

interface AddFundFormProps {
  onAdd: (fund: { code: string; name: string; shares: number; cost: number }) => Promise<void>
  onCancel: () => void
}

export function AddFundForm({ onAdd, onCancel }: AddFundFormProps) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [shares, setShares] = useState('')
  const [cost, setCost] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 验证
    if (!code.trim()) {
      setError('请输入基金代码')
      return
    }

    if (!/^\d{6}$/.test(code.trim())) {
      setError('基金代码格式错误，应为6位数字')
      return
    }

    const sharesNum = parseFloat(shares) || 0
    const costNum = parseFloat(cost) || 0

    if (sharesNum < 0 || costNum < 0) {
      setError('份额和成本不能为负数')
      return
    }

    setLoading(true)
    try {
      await onAdd({
        code: code.trim(),
        name: name.trim(),
        shares: sharesNum,
        cost: costNum,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
      setLoading(false)
    }
  }

  return (
    <div className="add-fund-overlay" onClick={onCancel}>
      <div className="add-fund-form" onClick={(e) => e.stopPropagation()}>
        <h3>添加基金</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="code">基金代码 *</label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="如: 007345"
              maxLength={6}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="name">基金名称 (可选)</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="留空则自动获取"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="shares">持有份额 (可选)</label>
            <input
              id="shares"
              type="number"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="如: 1000.5678"
              min="0"
              step="any"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="cost">持仓成本 (可选)</label>
            <input
              id="cost"
              type="number"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="总投入金额"
              min="0"
              step="any"
              disabled={loading}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={onCancel} disabled={loading}>
              取消
            </button>
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? '添加中...' : '添加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
