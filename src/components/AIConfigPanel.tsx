import { useState, useEffect } from 'react'
import { Card, Button, Space, Toast, Input, Switch } from '@douyinfe/semi-ui'
import { IconSave, IconRefresh } from '@douyinfe/semi-icons'
import { fetchAdminAIConfig, updateAdminAIConfig } from '@/services/api'
import { useAuth } from '@/context/AuthContext'

export function AIConfigPanel() {
  const { token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [config, setConfig] = useState({
    provider: 'default',
    baseUrl: '',
    defaultModels: {
      ai_model_fast: 'gpt-4o-mini',
      ai_model_deep: 'gpt-4o',
    },
    enabled: false,
    apiKeyMasked: '',
    stats: {
      pendingJobs: 0,
      runningJobs: 0,
      todayAnalyzed: 0,
    },
  })

  const loadConfig = async () => {
    if (!token) return
    setLoading(true)
    try {
      const response = await fetchAdminAIConfig(token)
      setConfig({
        ...config,
        ...response.config,
        defaultModels: {
          ai_model_fast: response.config.defaultModels?.ai_model_fast || 'gpt-4o-mini',
          ai_model_deep: response.config.defaultModels?.ai_model_deep || 'gpt-4o',
        },
      })
    } catch (error) {
      Toast.error('加载配置失败: ' + (error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleSave = async () => {
    if (!token) return
    setSaving(true)
    try {
      await updateAdminAIConfig(token, {
        baseUrl: config.baseUrl,
        apiKey: apiKey || undefined,
        enabled: config.enabled,
        defaultModels: {
          ai_model_fast: config.defaultModels.ai_model_fast || 'gpt-4o-mini',
          ai_model_deep: config.defaultModels.ai_model_deep || 'gpt-4o',
        },
      })
      setApiKey('')
      Toast.success('配置已保存')
      await loadConfig()
    } catch (error) {
      Toast.error('保存失败: ' + (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title="AI 分析配置"
      headerExtraContent={
        <Space>
          <Button icon={<IconRefresh />} onClick={loadConfig} loading={loading} size="small">
            刷新
          </Button>
          <Button theme="solid" icon={<IconSave />} onClick={handleSave} loading={saving} size="small">
            保存
          </Button>
        </Space>
      }
    >
      <div style={{ display: 'grid', gap: '12px' }}>
        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>启用 AI 分析</span>
          <Switch checked={config.enabled} onChange={(checked) => setConfig({ ...config, enabled: checked })} />
        </label>

        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>API 端点</span>
          <Input
            placeholder="https://api.openai.com/v1"
            value={config.baseUrl}
            onChange={(value) => setConfig({ ...config, baseUrl: value })}
          />
        </label>

        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>API Key</span>
          <Input
            mode="password"
            placeholder={config.apiKeyMasked ? `已设置 ${config.apiKeyMasked}` : 'sk-...'}
            value={apiKey}
            onChange={setApiKey}
          />
        </label>

        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>快速模型</span>
          <Input
            placeholder="gpt-4o-mini"
            value={config.defaultModels.ai_model_fast}
            onChange={(value) =>
              setConfig({
                ...config,
                defaultModels: {
                  ...config.defaultModels,
                  ai_model_fast: value,
                },
              })
            }
          />
        </label>

        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>深度模型</span>
          <Input
            placeholder="gpt-4o"
            value={config.defaultModels.ai_model_deep}
            onChange={(value) =>
              setConfig({
                ...config,
                defaultModels: {
                  ...config.defaultModels,
                  ai_model_deep: value,
                },
              })
            }
          />
        </label>
      </div>

      <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--semi-color-border)' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>分析统计</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
          <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: '8px', padding: '12px' }}>
            <div style={{ fontSize: '12px', color: 'var(--semi-color-text-2)', marginBottom: '6px' }}>今日已分析</div>
            <div style={{ fontSize: '20px', fontWeight: 600 }}>{config.stats.todayAnalyzed}</div>
          </div>
          <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: '8px', padding: '12px' }}>
            <div style={{ fontSize: '12px', color: 'var(--semi-color-text-2)', marginBottom: '6px' }}>运行中任务</div>
            <div style={{ fontSize: '20px', fontWeight: 600 }}>{config.stats.runningJobs}</div>
          </div>
          <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: '8px', padding: '12px' }}>
            <div style={{ fontSize: '12px', color: 'var(--semi-color-text-2)', marginBottom: '6px' }}>队列待处理</div>
            <div style={{ fontSize: '20px', fontWeight: 600 }}>{config.stats.pendingJobs}</div>
          </div>
        </div>
      </div>
    </Card>
  )
}
