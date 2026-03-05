import { useState } from 'react'
import { Modal, Tabs, Radio, RadioGroup, Button, Toast, List, Input, InputNumber, DatePicker } from '@douyinfe/semi-ui'
import type { FundWithEstimation, Transaction, TransactionType } from '@/types'
import { parseEstimation, formatMoney } from '@/services'
import './ModalActionBar.css'

interface TransactionFormProps {
  fund: FundWithEstimation
  onSubmit: (transaction: Omit<Transaction, 'id' | 'fundCode'>) => Promise<void> | void
  onCancel: () => void
  onDeleteTransaction?: (id: string | number) => Promise<void> | void
}

export function TransactionForm({ fund, onSubmit, onCancel, onDeleteTransaction }: TransactionFormProps) {
  const parsed = fund.estimation ? parseEstimation(fund.estimation) : null
  const currentNav = parsed?.estimatedNav || 0

  const [activeTab, setActiveTab] = useState<string>('form')
  const [type, setType] = useState<TransactionType>('buy')
  const [shares, setShares] = useState<number>(0)
  const [price, setPrice] = useState<number>(currentNav)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  const amount = shares * price

  const handleSubmit = () => {
    if (shares <= 0) {
      Toast.error('请输入有效的份额')
      return
    }

    if (price <= 0) {
      Toast.error('请输入有效的价格')
      return
    }

    if (type === 'sell' && shares > fund.shares) {
      Toast.error(`卖出份额不能超过持有份额 (${formatMoney(fund.shares, 2)})`)
      return
    }

    onSubmit({
      type,
      shares,
      price,
      amount,
      date,
      note: note.trim() || undefined,
    })
  }

  const handleDelete = (id: string | number) => {
    if (confirm('确定要删除这条调仓记录吗？') && onDeleteTransaction) {
      onDeleteTransaction(id)
    }
  }

  return (
    <Modal
      title={
        <div>
          调仓 - {fund.name}
          <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--semi-color-text-2)' }}>
            {fund.code}
          </span>
        </div>
      }
      visible={true}
      onCancel={onCancel}
      footer={null}
      motion={false}
      width="min(560px, calc(100vw - 20px))"
      centered
      bodyStyle={{ maxHeight: '76vh', overflowY: 'auto' }}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <Tabs.TabPane tab="新增记录" itemKey="form">
          <div
            style={{
              padding: '12px',
              background: 'var(--semi-color-bg-1)',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '13px',
            }}
          >
            <span>当前持仓: {formatMoney(fund.shares, 2)} 份</span>
            {parsed && (
              <span style={{ marginLeft: '16px' }}>
                估算净值: {formatMoney(parsed.estimatedNav, 4)}
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            <div>
              <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>交易类型</div>
              <RadioGroup
                type="button"
                value={type}
                onChange={(e) => setType(e.target.value as TransactionType)}
              >
                <Radio value="buy">买入</Radio>
                <Radio value="sell">卖出</Radio>
              </RadioGroup>
            </div>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>份额</span>
              <InputNumber
                value={shares}
                onChange={(value) => setShares(Number(value) || 0)}
                min={0}
                precision={4}
                placeholder="输入份额"
                style={{ width: '100%' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>单价(净值)</span>
              <InputNumber
                value={price}
                onChange={(value) => setPrice(Number(value) || 0)}
                min={0}
                precision={4}
                placeholder="输入单价"
                style={{ width: '100%' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>日期</span>
              <DatePicker
                value={new Date(date)}
                onChange={(value) => {
                  if (value instanceof Date) {
                    setDate(value.toISOString().slice(0, 10))
                    return
                  }
                  if (Array.isArray(value) && value[0] instanceof Date) {
                    setDate(value[0].toISOString().slice(0, 10))
                    return
                  }
                  setDate('')
                }}
                type="date"
                style={{ width: '100%' }}
              />
            </label>

            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>备注</span>
              <Input value={note} onChange={setNote} placeholder="添加备注（选填）" />
            </label>

            <div
              style={{
                padding: '12px',
                background: 'var(--semi-color-bg-1)',
                borderRadius: '8px',
                marginTop: '8px',
                marginBottom: '8px',
              }}
            >
              <span style={{ color: 'var(--semi-color-text-2)' }}>预计金额: </span>
              <span style={{ fontWeight: 600, fontSize: '16px' }}>¥{formatMoney(amount)}</span>
            </div>

            <div className="modal-action-bar">
              <Button onClick={onCancel}>取消</Button>
              <Button theme="solid" onClick={handleSubmit}>确认调仓</Button>
            </div>
          </div>
        </Tabs.TabPane>

        <Tabs.TabPane tab="历史记录" itemKey="history">
          {!fund.transactions || fund.transactions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--semi-color-text-2)' }}>
              暂无调仓记录
            </div>
          ) : (
            <List
              dataSource={[...(fund.transactions || [])].reverse()}
              renderItem={(tx: Transaction) => (
                <List.Item
                  main={
                    <div>
                      <div style={{ marginBottom: '4px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            marginRight: '8px',
                            background:
                              tx.type === 'buy'
                                ? 'var(--semi-color-success-light-default)'
                                : 'var(--semi-color-danger-light-default)',
                            color: tx.type === 'buy' ? 'var(--semi-color-success)' : 'var(--semi-color-danger)',
                          }}
                        >
                          {tx.type === 'buy' ? '买入' : '卖出'}
                        </span>
                        <span style={{ fontWeight: 500 }}>{formatMoney(tx.shares)}份</span>
                        <span style={{ marginLeft: '8px' }}>¥{formatMoney(tx.amount)}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>
                        <span>{tx.date}</span>
                        <span style={{ marginLeft: '8px' }}>@{formatMoney(tx.price, 4)}</span>
                        {tx.note && <span style={{ marginLeft: '8px' }}>{tx.note}</span>}
                      </div>
                    </div>
                  }
                  extra={
                    <Button type="danger" size="small" onClick={() => handleDelete(tx.id)}>
                      删除
                    </Button>
                  }
                />
              )}
            />
          )}
        </Tabs.TabPane>
      </Tabs>
    </Modal>
  )
}
