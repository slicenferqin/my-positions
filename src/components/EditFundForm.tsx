import { useState } from 'react'
import type { FundWithEstimation } from '@/types'
import { formatMoney } from '@/services'
import './EditFundForm.css'

interface EditFundFormProps {
  fund: FundWithEstimation
  onSave: (code: string, updates: { shares: number; cost: number }) => void
  onCancel: () => void
}

type InputMode = 'cost' | 'price'

export function EditFundForm({ fund, onSave, onCancel }: EditFundFormProps) {
  const [shares, setShares] = useState(fund.shares.toString())
  const [inputMode, setInputMode] = useState<InputMode>('price')

  // 成本价（单价）
  const initialCostPrice = fund.shares > 0 ? fund.cost / fund.shares : 0
  const [costPrice, setCostPrice] = useState(initialCostPrice.toFixed(4))

  // 总成本金额
  const [totalCost, setTotalCost] = useState(fund.cost.toString())

  const [error, setError] = useState('')

  const sharesNum = parseFloat(shares) || 0
  const costPriceNum = parseFloat(costPrice) || 0
  const totalCostNum = parseFloat(totalCost) || 0

  // 根据输入模式计算显示值
  const calculatedTotalCost = inputMode === 'price' ? sharesNum * costPriceNum : totalCostNum
  const calculatedCostPrice = inputMode === 'cost' && sharesNum > 0 ? totalCostNum / sharesNum : costPriceNum

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (sharesNum < 0) {
      setError('份额不能为负数')
      return
    }

    const finalCost = inputMode === 'price' ? sharesNum * costPriceNum : totalCostNum

    if (finalCost < 0) {
      setError('成本不能为负数')
      return
    }

    onSave(fund.code, {
      shares: sharesNum,
      cost: finalCost,
    })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="edit-fund-form" onClick={(e) => e.stopPropagation()}>
        <h3>
          编辑持仓 - {fund.name}
          <span className="fund-code">{fund.code}</span>
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>持有份额</label>
            <input
              type="number"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="输入份额"
              min="0"
              step="any"
            />
          </div>

          <div className="input-mode-selector">
            <button
              type="button"
              className={`mode-btn ${inputMode === 'price' ? 'active' : ''}`}
              onClick={() => setInputMode('price')}
            >
              输入成本价
            </button>
            <button
              type="button"
              className={`mode-btn ${inputMode === 'cost' ? 'active' : ''}`}
              onClick={() => setInputMode('cost')}
            >
              输入总金额
            </button>
          </div>

          {inputMode === 'price' ? (
            <div className="form-group">
              <label>成本价（单价）</label>
              <input
                type="number"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="输入成本价，如 1.6523"
                min="0"
                step="any"
              />
            </div>
          ) : (
            <div className="form-group">
              <label>持仓成本（总金额）</label>
              <input
                type="number"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                placeholder="输入总投入金额"
                min="0"
                step="any"
              />
            </div>
          )}

          <div className="calculated-info">
            {inputMode === 'price' ? (
              <>
                <span className="label">总成本:</span>
                <span className="value">¥{formatMoney(calculatedTotalCost, 2)}</span>
              </>
            ) : (
              <>
                <span className="label">成本价:</span>
                <span className="value">
                  {sharesNum > 0 ? `¥${formatMoney(calculatedCostPrice, 4)}` : '-'}
                </span>
              </>
            )}
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
