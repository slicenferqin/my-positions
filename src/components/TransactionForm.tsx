import { useState } from 'react'
import type { FundWithEstimation, Transaction, TransactionType } from '@/types'
import { parseEstimation, formatMoney } from '@/services'
import './TransactionForm.css'

interface TransactionFormProps {
  fund: FundWithEstimation
  onSubmit: (transaction: Omit<Transaction, 'id' | 'fundCode'>) => void
  onCancel: () => void
  onDeleteTransaction?: (id: string) => void
}

export function TransactionForm({ fund, onSubmit, onCancel, onDeleteTransaction }: TransactionFormProps) {
  const parsed = fund.estimation ? parseEstimation(fund.estimation) : null
  const currentNav = parsed?.estimatedNav || 0

  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form')
  const [type, setType] = useState<TransactionType>('buy')
  const [shares, setShares] = useState('')
  const [price, setPrice] = useState(currentNav.toFixed(4))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const sharesNum = parseFloat(shares) || 0
  const priceNum = parseFloat(price) || 0
  const amount = sharesNum * priceNum

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (sharesNum <= 0) {
      setError('请输入有效的份额')
      return
    }

    if (priceNum <= 0) {
      setError('请输入有效的价格')
      return
    }

    if (type === 'sell' && sharesNum > fund.shares) {
      setError(`卖出份额不能超过持有份额 (${formatMoney(fund.shares, 2)})`)
      return
    }

    onSubmit({
      type,
      shares: sharesNum,
      price: priceNum,
      amount,
      date,
      note: note.trim() || undefined,
    })
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这条调仓记录吗？') && onDeleteTransaction) {
      onDeleteTransaction(id)
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="transaction-form" onClick={(e) => e.stopPropagation()}>
        <div className="form-header">
          <h3>
            调仓 - {fund.name}
            <span className="fund-code">{fund.code}</span>
          </h3>
          <div className="form-tabs">
            <button 
              className={`tab-btn ${activeTab === 'form' ? 'active' : ''}`}
              onClick={() => setActiveTab('form')}
            >
              新增记录
            </button>
            <button 
              className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              历史记录
            </button>
          </div>
        </div>

        {activeTab === 'form' ? (
          <>
            <div className="current-position">
              <span>当前持仓: {formatMoney(fund.shares, 2)} 份</span>
              {parsed && <span>估算净值: {formatMoney(parsed.estimatedNav, 4)}</span>}
            </div>

            <form onSubmit={handleSubmit}>
              <div className="type-selector">
                <button
                  type="button"
                  className={`type-btn buy ${type === 'buy' ? 'active' : ''}`}
                  onClick={() => setType('buy')}
                >
                  买入
                </button>
                <button
                  type="button"
                  className={`type-btn sell ${type === 'sell' ? 'active' : ''}`}
                  onClick={() => setType('sell')}
                >
                  卖出
                </button>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>份额</label>
                  <input
                    type="number"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    placeholder="输入份额"
                    min="0"
                    step="any"
                  />
                </div>
                <div className="form-group">
                  <label>单价(净值)</label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="输入单价"
                    min="0"
                    step="any"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>日期</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>备注 (选填)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="添加备注..."
                />
              </div>

              <div className="amount-preview">
                预计金额: <span>¥{formatMoney(amount)}</span>
              </div>

              {error && <div className="error-message">{error}</div>}

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={onCancel}>
                  取消
                </button>
                <button type="submit" className="btn-submit">
                  确认调仓
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="history-list">
            {!fund.transactions || fund.transactions.length === 0 ? (
              <div className="no-history">暂无调仓记录</div>
            ) : (
              <div className="history-items">
                {[...(fund.transactions || [])].reverse().map((tx) => (
                  <div key={tx.id} className="history-item">
                    <div className="history-info">
                      <div className="history-main">
                        <span className={`history-type ${tx.type}`}>
                          {tx.type === 'buy' ? '买入' : '卖出'}
                        </span>
                        <span className="history-shares">{formatMoney(tx.shares)}份</span>
                        <span className="history-amount">¥{formatMoney(tx.amount)}</span>
                      </div>
                      <div className="history-meta">
                        <span>{tx.date}</span>
                        <span>@{formatMoney(tx.price, 4)}</span>
                        {tx.note && <span className="history-note">{tx.note}</span>}
                      </div>
                    </div>
                    <button 
                      className="btn-delete"
                      onClick={() => handleDelete(tx.id)}
                      title="删除记录"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
