import { useMemo, useState } from 'react'
import { Button, InputNumber, Modal, Space, Toast } from '@douyinfe/semi-ui'
import { IconDeleteStroked, IconPlusCircleStroked } from '@douyinfe/semi-icons'
import type { WatchlistWithEstimation } from '@/types'
import { formatChangePercent, formatMoney, parseEstimation } from '@/services'
import './WatchlistTable.css'

interface WatchlistTableProps {
  items: WatchlistWithEstimation[]
  onRemove: (itemId: number) => Promise<void> | void
  onConvert: (itemId: number, payload: { shares: number; cost: number }) => Promise<void> | void
}

function normalizeInstrumentType(value: string | undefined): 'fund' | 'stock' {
  return value === 'stock' ? 'stock' : 'fund'
}

function toUpdateText(value?: string): string {
  if (!value) return '--'
  const text = value.replace('T', ' ')
  return text.slice(5, 16)
}

export function WatchlistTable({ items, onRemove, onConvert }: WatchlistTableProps) {
  const [convertingId, setConvertingId] = useState<number | null>(null)
  const [shares, setShares] = useState<number>(100)
  const [cost, setCost] = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)

  const convertingItem = useMemo(
    () => items.find((item) => item.id === convertingId) || null,
    [items, convertingId]
  )

  const openConvertModal = (item: WatchlistWithEstimation) => {
    const parsed = item.estimation ? parseEstimation(item.estimation) : null
    const initialShares = 100
    const initialCost = parsed ? Number((parsed.estimatedNav * initialShares).toFixed(2)) : 0
    setConvertingId(item.id)
    setShares(initialShares)
    setCost(initialCost)
  }

  const handleSubmitConvert = async () => {
    if (!convertingItem) return
    if (shares <= 0) {
      Toast.error('持有份额必须大于0')
      return
    }
    if (cost < 0) {
      Toast.error('持仓成本不能为负数')
      return
    }
    setSubmitting(true)
    try {
      await onConvert(convertingItem.id, { shares, cost })
      setConvertingId(null)
      Toast.success('已转为持仓')
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '建仓失败')
    } finally {
      setSubmitting(false)
    }
  }

  const renderPriceCell = (item: WatchlistWithEstimation) => {
    const parsed = item.estimation ? parseEstimation(item.estimation) : null
    if (!parsed) {
      return <span className="watchlist-price-empty">待刷新</span>
    }
    return (
      <div className={`watchlist-price-cell ${parsed.trend}`}>
        <span className="watchlist-price">{formatMoney(parsed.estimatedNav, 4)}</span>
        <span className="watchlist-change">{formatChangePercent(parsed.changePercent)}</span>
      </div>
    )
  }

  const renderActionButtons = (item: WatchlistWithEstimation) => (
    <Space spacing={6}>
      <Button
        size="small"
        theme="solid"
        icon={<IconPlusCircleStroked />}
        onClick={() => openConvertModal(item)}
      >
        建仓
      </Button>
      <Button
        size="small"
        type="danger"
        icon={<IconDeleteStroked />}
        onClick={() => onRemove(item.id)}
      >
        删除
      </Button>
    </Space>
  )

  return (
    <div className="watchlist-table-container">
      <div className="watchlist-table-desktop">
        <div className="watchlist-table-scroll">
          <table className="watchlist-table">
            <thead>
              <tr>
                <th className="col-name">资产名称</th>
                <th className="col-nav">现价/涨跌</th>
                <th className="col-time">更新时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.loading ? 'loading' : ''}>
                  <td className="col-name">
                    <div className="watchlist-name-cell">
                      <span className="name">{item.name}</span>
                      <span className="code">
                        {item.code}
                        <em>{normalizeInstrumentType(item.instrumentType) === 'stock' ? '股票' : '基金'}</em>
                      </span>
                    </div>
                  </td>
                  <td className="col-nav">{renderPriceCell(item)}</td>
                  <td className="col-time">{toUpdateText(item.estimation?.gztime)}</td>
                  <td className="col-actions">{renderActionButtons(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="watchlist-mobile-list">
        {items.map((item) => {
          const parsed = item.estimation ? parseEstimation(item.estimation) : null
          return (
            <article key={`watchlist-mobile-${item.id}`} className={`watchlist-mobile-card ${item.loading ? 'loading' : ''}`}>
              <div className="watchlist-mobile-header">
                <div className="watchlist-name-cell">
                  <span className="name">{item.name}</span>
                  <span className="code">
                    {item.code}
                    <em>{normalizeInstrumentType(item.instrumentType) === 'stock' ? '股票' : '基金'}</em>
                  </span>
                </div>
                {parsed ? (
                  <div className={`watchlist-mobile-price ${parsed.trend}`}>
                    <span className="watchlist-price">{formatMoney(parsed.estimatedNav, 4)}</span>
                    <span className="watchlist-change">{formatChangePercent(parsed.changePercent)}</span>
                  </div>
                ) : (
                  <span className="watchlist-price-empty">待刷新</span>
                )}
              </div>

              <div className="watchlist-mobile-footer">
                <span className="watchlist-update-time">更新: {toUpdateText(item.estimation?.gztime)}</span>
                <div className="watchlist-mobile-actions">{renderActionButtons(item)}</div>
              </div>
            </article>
          )
        })}
      </div>

      {convertingItem && (
        <Modal
          title={`转持仓 - ${convertingItem.name}`}
          visible={true}
          onCancel={() => setConvertingId(null)}
          footer={null}
          width={440}
        >
          <div className="watchlist-convert-form">
            <label>
              <span>持有份额</span>
              <InputNumber
                value={shares}
                onChange={(value) => setShares(Number(value) || 0)}
                min={0}
                precision={4}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <span>持仓成本</span>
              <InputNumber
                value={cost}
                onChange={(value) => setCost(Number(value) || 0)}
                min={0}
                precision={2}
                style={{ width: '100%' }}
              />
            </label>
            <div className="watchlist-convert-actions">
              <Button onClick={() => setConvertingId(null)} disabled={submitting}>取消</Button>
              <Button theme="solid" loading={submitting} onClick={handleSubmitConvert}>
                确认建仓
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
