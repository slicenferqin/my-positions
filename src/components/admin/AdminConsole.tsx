import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Select, Switch, Tag, Toast } from '@douyinfe/semi-ui'
import {
  fetchAdminAIConfig,
  fetchAdminAnalysisJobs,
  fetchAdminAnalysisMetrics,
  fetchAdminAuditLogs,
  fetchAdminPipelineHealth,
  fetchAdminPrompt,
  retryAdminAnalysisJob,
  updateAdminAIConfig,
  updateAdminPrompt,
} from '@/services/api'
import type { AdminAIConfig, AnalysisJobRecord, AuditLogEntry, PromptTemplateRecord } from '@/types'
import './AdminConsole.css'

interface AdminConsoleProps {
  token: string
}

const SCENES = ['news_global', 'news_user_insight']

export function AdminConsole({ token }: AdminConsoleProps) {
  const [loading, setLoading] = useState(false)
  const [aiConfig, setAiConfig] = useState<AdminAIConfig | null>(null)
  const [aiApiKey, setAiApiKey] = useState('')
  const [promptScene, setPromptScene] = useState('news_global')
  const [promptContent, setPromptContent] = useState('')
  const [promptHistory, setPromptHistory] = useState<PromptTemplateRecord[]>([])
  const [jobs, setJobs] = useState<AnalysisJobRecord[]>([])
  const [metrics, setMetrics] = useState<any>(null)
  const [pipelineHealth, setPipelineHealth] = useState<any>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])

  const loadAIConfig = useCallback(async () => {
    const response = await fetchAdminAIConfig(token)
    setAiConfig(response.config)
  }, [token])

  const loadPrompt = useCallback(async () => {
    const response = await fetchAdminPrompt(token, promptScene)
    setPromptHistory(response.items)
    setPromptContent(response.active?.content || '')
  }, [token, promptScene])

  const loadJobs = useCallback(async () => {
    const response = await fetchAdminAnalysisJobs(token, { page: 1, perPage: 20 })
    setJobs(response.items)
  }, [token])

  const loadMetrics = useCallback(async () => {
    const [metricsResp, healthResp] = await Promise.all([
      fetchAdminAnalysisMetrics(token),
      fetchAdminPipelineHealth(token),
    ])
    setMetrics(metricsResp)
    setPipelineHealth(healthResp)
  }, [token])

  const loadAudit = useCallback(async () => {
    const response = await fetchAdminAuditLogs(token, { page: 1, perPage: 20 })
    setAuditLogs(response.items)
  }, [token])

  const reloadAll = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadAIConfig(), loadPrompt(), loadJobs(), loadMetrics(), loadAudit()])
    } catch (error) {
      Toast.error('加载后台数据失败: ' + (error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [loadAIConfig, loadPrompt, loadJobs, loadMetrics, loadAudit])

  useEffect(() => {
    reloadAll()
  }, [reloadAll])

  useEffect(() => {
    loadPrompt().catch(() => {})
  }, [loadPrompt])

  const handleSaveAIConfig = async () => {
    if (!aiConfig) return
    const models = Object.entries(aiConfig.defaultModels || {}).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        acc[key] = value.trim()
      }
      return acc
    }, {})
    try {
      const response = await updateAdminAIConfig(token, {
        baseUrl: aiConfig.baseUrl,
        apiKey: aiApiKey || undefined,
        enabled: aiConfig.enabled,
        defaultModels: models,
      })
      setAiConfig(response.config)
      setAiApiKey('')
      Toast.success('AI 配置已更新')
      await loadAudit()
    } catch (error) {
      Toast.error('保存 AI 配置失败: ' + (error as Error).message)
    }
  }

  const handleSavePrompt = async () => {
    if (!promptContent.trim()) {
      Toast.warning('提示词不能为空')
      return
    }
    try {
      await updateAdminPrompt(token, promptScene, {
        content: promptContent,
        status: 'active',
      })
      Toast.success('提示词已发布')
      await Promise.all([loadPrompt(), loadAudit()])
    } catch (error) {
      Toast.error('保存提示词失败: ' + (error as Error).message)
    }
  }

  const handleRetryJob = async (jobId: number) => {
    try {
      await retryAdminAnalysisJob(token, jobId)
      Toast.success('任务已重试')
      await Promise.all([loadJobs(), loadMetrics(), loadAudit()])
    } catch (error) {
      Toast.error('重试失败: ' + (error as Error).message)
    }
  }

  return (
    <section className="admin-console">
      <div className="admin-console-header">
        <div>
          <h3>Admin 控制台</h3>
          <p>系统级 AI 配置、提示词版本、任务队列、成本质量、审计日志</p>
        </div>
        <Button loading={loading} onClick={reloadAll}>刷新后台状态</Button>
      </div>

      <div className="admin-grid">
        <Card title="AI 配置" className="admin-card">
          {aiConfig ? (
            <div className="admin-form-grid">
              <label className="admin-field">
                <span>Provider</span>
                <Input value={aiConfig.provider} disabled />
              </label>
              <label className="admin-field">
                <span>Base URL</span>
                <Input
                  value={aiConfig.baseUrl || ''}
                  onChange={(value) => setAiConfig({ ...aiConfig, baseUrl: value })}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label className="admin-field">
                <span>快速模型</span>
                <Input
                  value={aiConfig.defaultModels?.ai_model_fast || ''}
                  onChange={(value) =>
                    setAiConfig({
                      ...aiConfig,
                      defaultModels: {
                        ...aiConfig.defaultModels,
                        ai_model_fast: value,
                      },
                    })
                  }
                />
              </label>
              <label className="admin-field">
                <span>深度模型</span>
                <Input
                  value={aiConfig.defaultModels?.ai_model_deep || ''}
                  onChange={(value) =>
                    setAiConfig({
                      ...aiConfig,
                      defaultModels: {
                        ...aiConfig.defaultModels,
                        ai_model_deep: value,
                      },
                    })
                  }
                />
              </label>
              <label className="admin-field">
                <span>API Key</span>
                <Input
                  mode="password"
                  value={aiApiKey}
                  onChange={setAiApiKey}
                  placeholder={aiConfig.apiKeyMasked ? `已设置 ${aiConfig.apiKeyMasked}` : 'sk-...'}
                />
              </label>
              <div className="admin-field admin-switch-row">
                <span>启用 AI</span>
                <Switch
                  checked={Boolean(aiConfig.enabled)}
                  onChange={(checked) => setAiConfig({ ...aiConfig, enabled: checked })}
                />
              </div>
              <div className="admin-actions">
                <Button theme="solid" onClick={handleSaveAIConfig}>保存 AI 配置</Button>
              </div>
            </div>
          ) : (
            <div>加载中...</div>
          )}
        </Card>

        <Card title="提示词模板" className="admin-card">
          <div className="admin-prompt-header">
            <Select
              value={promptScene}
              style={{ width: 220 }}
              onChange={(value) => setPromptScene(String(value || 'news_global'))}
            >
              {SCENES.map((scene) => (
                <Select.Option key={scene} value={scene}>
                  {scene}
                </Select.Option>
              ))}
            </Select>
            <Button onClick={handleSavePrompt} theme="solid">发布新版本</Button>
          </div>

          <textarea
            className="admin-prompt-editor"
            value={promptContent}
            onChange={(event) => setPromptContent(event.target.value)}
            rows={8}
            placeholder="输入当前场景 Prompt"
          />

          <div className="admin-prompt-history">
            {promptHistory.slice(0, 6).map((item) => (
              <div key={item.id} className="admin-history-item">
                <div>
                  <strong>{item.version}</strong>
                  <Tag size="small" color={item.status === 'active' ? 'green' : 'grey'} style={{ marginLeft: 8 }}>
                    {item.status}
                  </Tag>
                </div>
                <small>{item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '--'}</small>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="admin-grid">
        <Card title="任务队列" className="admin-card">
          <div className="admin-job-list">
            {jobs.length === 0 && <div className="admin-empty">暂无任务</div>}
            {jobs.map((job) => (
              <div key={job.id} className="admin-job-item">
                <div className="admin-job-main">
                  <div>
                    <strong>#{job.id}</strong> · {job.jobType}
                  </div>
                  <div className="admin-job-meta">
                    <Tag size="small" color={job.status === 'failed' ? 'red' : job.status === 'success' ? 'green' : 'orange'}>
                      {job.status}
                    </Tag>
                    <span>{job.newsId || '-'}</span>
                    <span>重试 {job.retryCount}</span>
                  </div>
                </div>
                <div className="admin-job-side">
                  {job.latestRun && <small>P95: {job.latestRun.latencyMs}ms</small>}
                  {job.status === 'failed' && (
                    <Button size="small" onClick={() => handleRetryJob(job.id)}>
                      重试
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="质量与成本" className="admin-card">
          {metrics && (
            <div className="admin-metrics-grid">
              <div className="metric-box">
                <span>24h 成功率</span>
                <strong>{metrics.throughput.successRate24h}%</strong>
              </div>
              <div className="metric-box">
                <span>24h Runs</span>
                <strong>{metrics.throughput.runs24h}</strong>
              </div>
              <div className="metric-box">
                <span>P95 延迟</span>
                <strong>{metrics.latency.p95}ms</strong>
              </div>
              <div className="metric-box">
                <span>Token 成本</span>
                <strong>{metrics.tokens.costEstimate}</strong>
              </div>
              <div className="metric-box">
                <span>待处理任务</span>
                <strong>{metrics.queue.pending}</strong>
              </div>
              <div className="metric-box">
                <span>失败任务</span>
                <strong>{metrics.queue.failed}</strong>
              </div>
            </div>
          )}

          {pipelineHealth && (
            <div className="admin-health-row">
              <Tag color={pipelineHealth.status === 'healthy' ? 'green' : pipelineHealth.status === 'degraded' ? 'orange' : 'red'}>
                Pipeline {pipelineHealth.status}
              </Tag>
              <span>最新新闻延迟: {pipelineHealth.source?.ageSeconds ?? '--'}s</span>
              <span>内存队列: {pipelineHealth.workers?.analysisQueueMemory ?? 0}</span>
            </div>
          )}
        </Card>
      </div>

      <Card title="审计日志（最近 20 条）" className="admin-card">
        <div className="admin-audit-list">
          {auditLogs.length === 0 && <div className="admin-empty">暂无审计记录</div>}
          {auditLogs.map((log) => (
            <div key={log.id} className="admin-audit-item">
              <div>
                <strong>{log.action}</strong> · {log.resourceType}
                {log.resourceId ? ` (${log.resourceId})` : ''}
              </div>
              <small>{log.createdAt ? new Date(log.createdAt).toLocaleString('zh-CN') : '--'}</small>
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}
