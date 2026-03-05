import React, { useState, useMemo, useEffect } from 'react'
import { IconEditStroked, IconDeleteStroked, IconMoneyExchangeStroked } from '@douyinfe/semi-icons'
import type { FundWithEstimation, Transaction, IntradayPoint } from '@/types'
import { parseEstimation, formatChangePercent, formatMoney } from '@/services'
import { FundDetailRow } from './FundDetailRow'
import { TransactionForm } from './TransactionForm'
import { EditFundForm } from './EditFundForm'
import './FundTable.css'

interface FundTableProps {
  funds: FundWithEstimation[]
  intradayData: Map<string, IntradayPoint[]>
  onRemove: (fundId: number) => Promise<void> | void
  onTransaction: (fundId: number, transaction: Omit<Transaction, 'id' | 'fundCode'>) => Promise<void> | void
  onDeleteTransaction?: (fundId: number, transactionId: string | number) => Promise<void> | void
  onEdit: (fundId: number, updates: { shares: number; cost: number }) => Promise<void> | void
  initialSort?: {
    key: SortKey
    direction: SortDirection
  }
  onSortChange?: (sort: { key: SortKey; direction: SortDirection }) => void
}

type SortKey = 'change' | 'value' | 'profit' | 'today' | null
type SortDirection = 'asc' | 'desc'

function holdingMapKey(fund: Pick<FundWithEstimation, 'code' | 'instrumentType'>): string {
  const instrumentType = fund.instrumentType === 'stock' ? 'stock' : 'fund'
  return `${instrumentType}:${(fund.code || '').toUpperCase()}`
}

export function FundTable({
  funds,
  intradayData,
  onRemove,
  onTransaction,
  onDeleteTransaction,
  onEdit,
  initialSort,
  onSortChange,
}: FundTableProps) {
  const [expandedFundId, setExpandedFundId] = useState<number | null>(null)
  const [transactionFundId, setTransactionFundId] = useState<number | null>(null)
  const [editingFundId, setEditingFundId] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>(initialSort?.key ?? null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSort?.direction ?? 'desc')

  useEffect(() => {
    if (!initialSort) return
    setSortKey(initialSort.key ?? null)
    setSortDirection(initialSort.direction ?? 'desc')
  }, [initialSort?.key, initialSort?.direction])

  // 获取当前正在进行调仓的基金的最新状态
  const transactionFund = useMemo(() => {
    return funds.find(f => f.id === transactionFundId) || null
  }, [funds, transactionFundId])

  const editingFund = useMemo(() => {
    return funds.find(f => f.id === editingFundId) || null
  }, [funds, editingFundId])

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
    let nextKey: SortKey = key
    let nextDirection: SortDirection = 'desc'

    if (sortKey === key) {
      // 再次点击同一列：切换方向或取消排序
      if (sortDirection === 'desc') {
        nextDirection = 'asc'
      } else {
        nextKey = null
        nextDirection = 'desc'
      }
    }

    setSortKey(nextKey)
    setSortDirection(nextDirection)
    onSortChange?.({ key: nextKey, direction: nextDirection })
  }

  const getSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDirection === 'desc' ? ' ↓' : ' ↑'
  }

  const toggleExpand = (fundId: number) => {
    setExpandedFundId(prev => prev === fundId ? null : fundId)
  }

  const renderActionButtons = (fund: FundWithEstimation) => (
    <>
      <button
        className="btn-icon btn-edit"
        onClick={(e) => {
          e.stopPropagation()
          setTransactionFundId(null)
          setEditingFundId(fund.id ?? null)
        }}
        title="编辑"
        disabled={!fund.id}
      >
        <IconEditStroked />
      </button>
      <button
        className="btn-icon btn-trade"
        onClick={(e) => {
          e.stopPropagation()
          setEditingFundId(null)
          setTransactionFundId(fund.id ?? null)
        }}
        title="调仓"
        disabled={!fund.id}
      >
        <IconMoneyExchangeStroked />
      </button>
      <button
        className="btn-icon btn-remove"
        onClick={(e) => {
          e.stopPropagation()
          if (fund.id) {
            onRemove(fund.id)
          }
        }}
        title="删除"
      >
        <IconDeleteStroked />
      </button>
    </>
  )

  return (
    <div className="fund-table-container">
      <div className="fund-table-desktop">
        <div className="fund-table-scroll">
          <table className="fund-table">
            <thead>
              <tr>
                <th className="col-name">资产名称</th>
                <th className="col-nav sortable" onClick={() => handleSort('change')}>
                  现价/涨跌{getSortIndicator('change')}
                </th>
                <th className="col-value sortable" onClick={() => handleSort('value')}>
                  持仓市值{getSortIndicator('value')}
                </th>
                <th className="col-profit sortable" onClick={() => handleSort('profit')}>
                  累计盈亏{getSortIndicator('profit')}
                </th>
                <th className="col-today sortable" onClick={() => handleSort('today')}>
                  今日盈亏{getSortIndicator('today')}
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
                const isExpanded = expandedFundId === fund.id

                return (
                  <React.Fragment key={fund.id ?? fund.code}>
                    <tr
                      className={`${fund.loading ? 'loading' : ''} ${isExpanded ? 'expanded' : ''}`}
                      data-fund-code={fund.code}
                      onClick={() => fund.id && toggleExpand(fund.id)}
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
                      <td className="col-actions">{renderActionButtons(fund)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="detail-row">
                        <td colSpan={6} style={{ padding: 0, border: 'none' }}>
                          <FundDetailRow
                            fund={fund}
                            intradayData={intradayData.get(holdingMapKey(fund))}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="fund-mobile-list">
        {sortedFunds.map((fund) => {
          const parsed = fund.estimation ? parseEstimation(fund.estimation) : null
          const currentValue = parsed ? fund.shares * parsed.estimatedNav : 0
          const lastValue = parsed ? fund.shares * parsed.lastNav : 0
          const profit = currentValue - fund.cost
          const profitPercent = fund.cost > 0 ? (profit / fund.cost) * 100 : 0
          const todayProfit = currentValue - lastValue
          const isExpanded = expandedFundId === fund.id

          return (
            <React.Fragment key={`mobile-${fund.id ?? fund.code}`}>
              <article
                className={`fund-mobile-card ${fund.loading ? 'loading' : ''} ${isExpanded ? 'expanded' : ''}`}
                data-fund-code={fund.code}
                onClick={() => fund.id && toggleExpand(fund.id)}
              >
                <div className="fund-mobile-header">
                  <div className="fund-name-cell">
                    <span className="name">{fund.name || '加载中...'}</span>
                    <span className="code">{fund.code}</span>
                  </div>
                  <div className={`fund-mobile-price ${parsed?.trend || 'flat'}`}>
                    <span className="nav">{parsed ? formatMoney(parsed.estimatedNav, 4) : '-'}</span>
                    {parsed && <span className="change">{formatChangePercent(parsed.changePercent)}</span>}
                  </div>
                </div>

                <div className="fund-mobile-metrics">
                  <div className="fund-mobile-metric">
                    <span className="label">今日盈亏</span>
                    <span className={`value ${todayProfit >= 0 ? 'rise' : 'fall'}`}>
                      {fund.shares > 0 && parsed
                        ? `${todayProfit >= 0 ? '+' : ''}¥${formatMoney(todayProfit, 2)}`
                        : '-'}
                    </span>
                  </div>
                  <div className="fund-mobile-metric">
                    <span className="label">累计盈亏</span>
                    <span className={`value ${profit >= 0 ? 'rise' : 'fall'}`}>
                      {fund.shares > 0 ? `${profit >= 0 ? '+' : ''}¥${formatMoney(profit, 2)}` : '-'}
                    </span>
                    <span className={`sub ${profit >= 0 ? 'rise' : 'fall'}`}>
                      {fund.shares > 0 ? `${profitPercent >= 0 ? '+' : ''}${formatMoney(profitPercent, 2)}%` : ''}
                    </span>
                  </div>
                </div>

                <div className="fund-mobile-actions">
                  {renderActionButtons(fund)}
                </div>
              </article>

              {isExpanded && (
                <div className="fund-mobile-detail">
                  <FundDetailRow
                    fund={fund}
                    intradayData={intradayData.get(holdingMapKey(fund))}
                  />
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>

      {transactionFund && (
        <TransactionForm
          fund={transactionFund}
          onSubmit={async (transaction) => {
            if (!transactionFund?.id) return
            await onTransaction(transactionFund.id, transaction)
            setTransactionFundId(null)
          }}
          onCancel={() => setTransactionFundId(null)}
          onDeleteTransaction={
            onDeleteTransaction 
                ? async (id) => {
                    if (transactionFund?.id) {
                      await onDeleteTransaction(transactionFund.id, id)
                    }
                  }
                : undefined
            }
          />
      )}

      {editingFund && (
        <EditFundForm
          fund={editingFund}
          onSave={async (id, updates) => {
            await onEdit(id, updates)
            setEditingFundId(null)
          }}
          onCancel={() => setEditingFundId(null)}
        />
      )}
    </div>
  )
}
