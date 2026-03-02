import { useState } from 'react'
import { Modal, Form, Toast, RadioGroup, Radio } from '@douyinfe/semi-ui'

interface AddFundFormProps {
  onAdd: (fund: { code: string; name?: string; shares: number; cost: number; instrumentType?: 'fund' | 'stock' }) => Promise<void>
  onCancel: () => void
}

export function AddFundForm({ onAdd, onCancel }: AddFundFormProps) {
  const [loading, setLoading] = useState(false)
  const [instrumentType, setInstrumentType] = useState<'fund' | 'stock'>('fund')

  const handleSubmit = async (values: any) => {
    const code = values.code?.trim() || ''
    if (instrumentType === 'fund') {
      if (!/^\d{6}$/.test(code)) {
        Toast.error('基金代码格式错误，应为6位数字')
        return
      }
    } else if (!/^(\d{6}|(SH|SZ|BJ)\d{6}|(SH|SZ|BJ)\.\d{6}|\d{6}\.(SH|SZ|BJ))$/i.test(code)) {
      Toast.error('股票代码格式错误，示例: 600519 或 SH600519')
      return
    }

    const sharesNum = parseFloat(values.shares) || 0
    const costNum = parseFloat(values.cost) || 0

    if (sharesNum < 0 || costNum < 0) {
      Toast.error('份额和成本不能为负数')
      return
    }

    setLoading(true)
    try {
      await onAdd({
        code,
        name: values.name?.trim() || undefined,
        shares: sharesNum,
        cost: costNum,
        instrumentType,
      })
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '添加失败')
      setLoading(false)
    }
  }

  return (
    <Modal
      title="添加持仓"
      visible={true}
      onCancel={onCancel}
      getPopupContainer={() => document.body}
      zIndex={2200}
      footer={null}
      width={480}
    >
      <div style={{ marginBottom: '16px' }}>
        <RadioGroup
          type="button"
          value={instrumentType}
          onChange={(event) => setInstrumentType(event.target.value as 'fund' | 'stock')}
        >
          <Radio value="fund">基金持仓</Radio>
          <Radio value="stock">股票持仓</Radio>
        </RadioGroup>
      </div>

      <Form
        onSubmit={handleSubmit}
        labelPosition="left"
        labelAlign="right"
        labelWidth="100px"
      >
        <Form.Input
          field="code"
          label={instrumentType === 'fund' ? '基金代码' : '股票代码'}
          placeholder={instrumentType === 'fund' ? '如: 007345' : '如: 600519 / SH600519'}
          rules={[
            { required: true, message: `请输入${instrumentType === 'fund' ? '基金' : '股票'}代码` },
          ]}
          maxLength={12}
        />

        <Form.Input
          field="name"
          label={instrumentType === 'fund' ? '基金名称' : '股票名称'}
          placeholder="留空则自动获取"
        />

        <Form.InputNumber
          field="shares"
          label="持有份额"
          placeholder="如: 1000.5678"
          min={0}
          precision={4}
        />

        <Form.InputNumber
          field="cost"
          label="持仓成本"
          placeholder="总投入金额"
          min={0}
          precision={2}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '8px 16px',
              border: '1px solid var(--semi-color-border)',
              background: 'transparent',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'var(--semi-color-primary)',
              color: 'white',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {loading ? '添加中...' : '添加'}
          </button>
        </div>
      </Form>
    </Modal>
  )
}
