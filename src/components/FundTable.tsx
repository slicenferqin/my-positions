import React, { useState, useMemo } from 'react'
import type { FundWithEstimation, Transaction, IntradayPoint } from '@/types'
import { parseEstimation, formatChangePercent, formatMoney } from '@/services'
import { FundDetailRow } from './FundDetailRow'
import { TransactionForm } from './TransactionForm'
import { EditFundForm } from './EditFundForm'
import './FundTable.css'

interface FundTableProps {
  funds: FundWithEstimation[]
  intradayData: Map<string, IntradayPoint[]>
  onRemove: (code: string) => void
  onTransaction: (code: string, transaction: Omit<Transaction, 'id' | 'fundCode'>) => void
  onDeleteTransaction?: (code: string, transactionId: string) => void
  onEdit: (code: string, updates: { shares: number; cost: number }) => void
}

type SortKey = 'change' | 'value' | 'profit' | 'today' | null
type SortDirection = 'asc' | 'desc'

export function FundTable({ funds, intradayData, onRemove, onTransaction, onDeleteTransaction, onEdit }: FundTableProps) {
  const [expandedFundCode, setExpandedFundCode] = useState<string | null>(null)
  const [transactionFundCode, setTransactionFundCode] = useState<string | null>(null)
  const [editingFund, setEditingFund] = useState<FundWithEstimation | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // 获取当前正在进行调仓的基金的最新状态
  const transactionFund = useMemo(() => {
    return funds.find(f => f.code === transactionFundCode) || null
  }, [funds, transactionFundCode])

  // 计算每个基金的排序数值
  const getFundValues = (fund: FundWithEstimation) => {
    const parsed = fund.estimation ? parseEstimation(fund.estimation) : null
    const currentValue = parsed ? fund.shares * parsed.estimatedNav : 0
    const lastValue = parsed ? fund.shares * parsed.lastNav : 0
    const profit = currentValue - fund.cost
    const todayProfit = currentValue - lastValue
    const changePercent = parsed?.changePercent || 0

    return { currentValue, profit, todayProfit, changePercent }
  }

  // 排序后的基金列表
  const sortedFunds = useMemo(() => {
    if (!sortKey) return funds

    return [...funds].sort((a, b) => {
      const aValues = getFundValues(a)
      const bValues = getFundValues(b)

      let aVal: number, bVal: number
      switch (sortKey) {
        case 'change':
          aVal = aValues.changePercent
          bVal = bValues.changePercent
          break
        case 'value':
          aVal = aValues.currentValue
          bVal = bValues.currentValue
          break
        case 'profit':
          aVal = aValues.profit
          bVal = bValues.profit
          break
        case 'today':
          aVal = aValues.todayProfit
          bVal = bValues.todayProfit
          break
        default:
          return 0
      }

      return sortDirection === 'desc' ? bVal - aVal : aVal - bVal
    })
  }, [funds, sortKey, sortDirection])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      // 再次点击同一列：切换方向或取消排序
      if (sortDirection === 'desc') {
        setSortDirection('asc')
      } else {
        setSortKey(null)
      }
    } else {
      setSortKey(key)
      setSortDirection('desc')
    }
  }

  const getSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDirection === 'desc' ? ' ↓' : ' ↑'
  }

  const toggleExpand = (code: string) => {
    setExpandedFundCode(prev => prev === code ? null : code)
  }

  return (
    <div className="fund-table-container">
      <table className="fund-table">
        <thead>
          <tr>
            <th className="col-name">基金名称</th>
            <th className="col-nav sortable" onClick={() => handleSort('change')}>
              净值/涨跌{getSortIndicator('change')}
            </th>
            <th className="col-value sortable" onClick={() => handleSort('value')}>
              持仓市值{getSortIndicator('value')}
            </th>
            <th className="col-profit sortable" onClick={() => handleSort('profit')}>
              持仓收益{getSortIndicator('profit')}
            </th>
            <th className="col-today sortable" onClick={() => handleSort('today')}>
              今日收益{getSortIndicator('today')}
            </th>
            <th className="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {sortedFunds.map((fund) => {
            const parsed = fund.estimation ? parseEstimation(fund.estimation) : null
            const currentValue = parsed ? fund.shares * parsed.estimatedNav : 0
            const lastValue = parsed ? fund.shares * parsed.lastNav : 0
            const profit = currentValue - fund.cost
            const profitPercent = fund.cost > 0 ? (profit / fund.cost) * 100 : 0
            const todayProfit = currentValue - lastValue
            const isExpanded = expandedFundCode === fund.code

            return (
              <React.Fragment key={fund.code}>
                <tr
                  className={`${fund.loading ? 'loading' : ''} ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => toggleExpand(fund.code)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="col-name">
                    <div className="fund-name-cell">
                      <span className="name">{fund.name || '加载中...'}</span>
                      <span className="code">{fund.code}</span>
                    </div>
                  </td>
                  <td className={`col-nav ${parsed?.trend || ''}`}>
                    {parsed ? (
                      <div className="nav-change-cell">
                        <span className="nav">{formatMoney(parsed.estimatedNav, 4)}</span>
                        <span className="change">{formatChangePercent(parsed.changePercent)}</span>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="col-value">
                    {fund.shares > 0 ? `¥${formatMoney(currentValue, 2)}` : '-'}
                  </td>
                  <td className={`col-profit ${profit >= 0 ? 'rise' : 'fall'}`}>
                    {fund.shares > 0 ? (
                      <>
                        {profit >= 0 ? '+' : ''}¥{formatMoney(profit, 2)}
                        <small>({profitPercent >= 0 ? '+' : ''}{formatMoney(profitPercent, 2)}%)</small>
                      </>
                    ) : '-'}
                  </td>
                  <td className={`col-today ${todayProfit >= 0 ? 'rise' : 'fall'}`}>
                    {fund.shares > 0 && parsed ? (
                      <>
                        {todayProfit >= 0 ? '+' : ''}¥{formatMoney(todayProfit, 2)}
                      </>
                    ) : '-'}
                  </td>
                  <td className="col-actions">
                    <button
                      className="btn-icon btn-edit"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingFund(fund)
                      }}
                      title="编辑"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn-icon btn-trade"
                      onClick={(e) => {
                        e.stopPropagation()
                        setTransactionFundCode(fund.code)
                      }}
                      title="调仓"
                    >
                      💱
                    </button>
                    <button
                      className="btn-icon btn-remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemove(fund.code)
                      }}
                      title="删除"
                    >
                      ×
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="detail-row">
                    <td colSpan={6} style={{ padding: 0, border: 'none' }}>
                      <FundDetailRow 
                        fund={fund} 
                        intradayData={intradayData.get(fund.code)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>

      {transactionFund && (
        <TransactionForm
          fund={transactionFund}
          onSubmit={(transaction) => {
            onTransaction(transactionFund.code, transaction)
            setTransactionFundCode(null)
          }}
          onCancel={() => setTransactionFundCode(null)}
          onDeleteTransaction={
            onDeleteTransaction 
              ? (id) => onDeleteTransaction(transactionFund.code, id)
              : undefined
          }
        />
      )}

      {editingFund && (
        <EditFundForm
          fund={editingFund}
          onSave={(code, updates) => {
            onEdit(code, updates)
            setEditingFund(null)
          }}
          onCancel={() => setEditingFund(null)}
        />
      )}
    </div>
  )
}
