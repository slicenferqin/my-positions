import { useState } from 'react'
import { Modal, InputNumber, Radio, RadioGroup, Toast, Button } from '@douyinfe/semi-ui'
import type { FundWithEstimation } from '@/types'
import { formatMoney } from '@/services'
import './ModalActionBar.css'

interface EditFundFormProps {
  fund: FundWithEstimation
  onSave: (fundId: number, updates: { shares: number; cost: number }) => void
  onCancel: () => void
}

type InputMode = 'cost' | 'price'

export function EditFundForm({ fund, onSave, onCancel }: EditFundFormProps) {
  const initialCostPrice = fund.shares > 0 ? fund.cost / fund.shares : 0
  const [shares, setShares] = useState(fund.shares)
  const [inputMode, setInputMode] = useState<InputMode>('price')
  const [costPrice, setCostPrice] = useState(initialCostPrice)
  const [totalCost, setTotalCost] = useState(fund.cost)

  const calculatedTotalCost = inputMode === 'price' ? shares * costPrice : totalCost
  const calculatedCostPrice = inputMode === 'cost' && shares > 0 ? totalCost / shares : costPrice

  const handleSubmit = () => {
    if (shares < 0) {
      Toast.error('份额不能为负数')
      return
    }

    const finalCost = inputMode === 'price' ? shares * costPrice : totalCost

    if (finalCost < 0) {
      Toast.error('成本不能为负数')
      return
    }

    if (!fund.id) return
    onSave(fund.id, {
      shares,
      cost: finalCost,
    })
  }

  return (
    <Modal
      title={
        <div>
          编辑持仓 - {fund.name}
          <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--semi-color-text-2)' }}>
            {fund.code}
          </span>
        </div>
      }
      visible={true}
      onCancel={onCancel}
      footer={null}
      motion={false}
      width="min(480px, calc(100vw - 24px))"
      centered
      bodyStyle={{ maxHeight: '74vh', overflowY: 'auto' }}
    >
      <div style={{ display: 'grid', gap: '12px' }}>
        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>持有份额</span>
          <InputNumber value={shares} onChange={(value) => setShares(Number(value) || 0)} min={0} precision={4} style={{ width: '100%' }} />
        </label>

        <div>
          <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
            输入方式
          </div>
          <RadioGroup
            type="button"
            value={inputMode}
            onChange={(e) => setInputMode(e.target.value as InputMode)}
          >
            <Radio value="price">输入成本价</Radio>
            <Radio value="cost">输入总金额</Radio>
          </RadioGroup>
        </div>

        {inputMode === 'price' ? (
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>成本价（单价）</span>
            <InputNumber
              value={costPrice}
              onChange={(value) => setCostPrice(Number(value) || 0)}
              min={0}
              precision={4}
              placeholder="如 1.6523"
              style={{ width: '100%' }}
            />
          </label>
        ) : (
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontSize: '13px', color: 'var(--semi-color-text-2)' }}>持仓成本（总额）</span>
            <InputNumber
              value={totalCost}
              onChange={(value) => setTotalCost(Number(value) || 0)}
              min={0}
              precision={2}
              placeholder="总投入金额"
              style={{ width: '100%' }}
            />
          </label>
        )}

        <div
          style={{
            padding: '12px',
            background: 'var(--semi-color-bg-1)',
            borderRadius: '8px',
            marginTop: '8px',
          }}
        >
          {inputMode === 'price' ? (
            <div style={{ fontSize: '14px' }}>
              <span style={{ color: 'var(--semi-color-text-2)' }}>总成本: </span>
              <span style={{ fontWeight: 600 }}>¥{formatMoney(calculatedTotalCost, 2)}</span>
            </div>
          ) : (
            <div style={{ fontSize: '14px' }}>
              <span style={{ color: 'var(--semi-color-text-2)' }}>成本价: </span>
              <span style={{ fontWeight: 600 }}>
                {shares > 0 ? `¥${formatMoney(calculatedCostPrice, 4)}` : '-'}
              </span>
            </div>
          )}
        </div>

        <div className="modal-action-bar">
          <Button onClick={onCancel}>取消</Button>
          <Button theme="solid" onClick={handleSubmit}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
