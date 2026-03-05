import { useState } from 'react'
import { Modal, Form, Toast, RadioGroup, Radio } from '@douyinfe/semi-ui'
import './ModalActionBar.css'

interface AddWatchlistFormProps {
  onAdd: (payload: { code: string; name?: string; instrumentType?: 'fund' | 'stock' }) => Promise<void>
  onCancel: () => void
}

export function AddWatchlistForm({ onAdd, onCancel }: AddWatchlistFormProps) {
  const [loading, setLoading] = useState(false)
  const [instrumentType, setInstrumentType] = useState<'fund' | 'stock'>('fund')

  const handleSubmit = async (values: Record<string, unknown>) => {
    const code = String(values.code || '').trim()
    if (instrumentType === 'fund') {
      if (!/^\d{6}$/.test(code)) {
        Toast.error('基金代码格式错误，应为6位数字')
        return
      }
    } else if (!/^(\d{6}|(SH|SZ|BJ)\d{6}|(SH|SZ|BJ)\.\d{6}|\d{6}\.(SH|SZ|BJ))$/i.test(code)) {
      Toast.error('股票代码格式错误，示例: 600519 或 SH600519')
      return
    }

    setLoading(true)
    try {
      await onAdd({
        code,
        name: String(values.name || '').trim() || undefined,
        instrumentType,
      })
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '添加失败')
      setLoading(false)
    }
  }

  return (
    <Modal
      title="添加自选"
      visible={true}
      onCancel={onCancel}
      getPopupContainer={() => document.body}
      zIndex={2200}
      footer={null}
      motion={false}
      width="min(460px, calc(100vw - 24px))"
      centered
      bodyStyle={{ maxHeight: '72vh', overflowY: 'auto', paddingBottom: '14px' }}
    >
      <div style={{ marginBottom: '16px' }}>
        <RadioGroup
          type="button"
          value={instrumentType}
          onChange={(event) => setInstrumentType(event.target.value as 'fund' | 'stock')}
        >
          <Radio value="fund">基金自选</Radio>
          <Radio value="stock">股票自选</Radio>
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
          placeholder="留空将默认使用代码"
        />

        <div className="modal-action-bar">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '8px 16px',
              border: '1px solid var(--semi-color-border)',
              background: 'transparent',
              borderRadius: '4px',
              cursor: 'pointer',
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
              cursor: 'pointer',
            }}
          >
            {loading ? '添加中...' : '加入自选'}
          </button>
        </div>
      </Form>
    </Modal>
  )
}
