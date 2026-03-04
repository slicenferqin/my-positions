import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Card,
  Button,
  Input,
  InputNumber,
  Radio,
  RadioGroup,
  Select,
  Space,
  Collapse,
  Switch,
  Toast,
  Spin,
  Tag,
} from '@douyinfe/semi-ui'
import { IconSearch, IconRefresh, IconInbox } from '@douyinfe/semi-icons'
import { useAuth } from '@/context/AuthContext'
import {
  fetchNewsFeed,
  fetchNotificationEndpoints,
  submitNewsFeedback,
  testWebhook,
  updateNotificationEndpoints,
} from '@/services/api'
import { NewsAnalysisCard } from '@/components'
import type { FundWithEstimation, NewsFeedItemV2 } from '@/types'
import './NewsFeed.css'

interface NewsFeedProps {
  funds?: FundWithEstimation[]
}

interface WebhookConfigState {
  id?: number
  enabled: boolean
  url: string
  secret: string
  hasSecret: boolean
  secretMasked: string
  cooldownSec: number
}

const DEFAULT_WEBHOOK_CONFIG: WebhookConfigState = {
  enabled: false,
  url: '',
  secret: '',
  hasSecret: false,
  secretMasked: '',
  cooldownSec: 300,
}

function relevanceScopeMeta(scope: string | undefined, score: number) {
  const normalized = (scope || '').toLowerCase()
  if (normalized === 'mixed') {
    return { label: '持仓+自选相关', color: 'orange' as const }
  }
  if (normalized === 'watchlist') {
    return { label: '自选相关', color: 'blue' as const }
  }
  if (normalized === 'holding' || score > 0) {
    return { label: '持仓相关', color: 'red' as const }
  }
  return null
}

export function NewsFeed({ funds = [] }: NewsFeedProps) {
  const { token } = useAuth()
  const [mode, setMode] = useState<'all' | 'relevant'>('all')
  const [news, setNews] = useState<NewsFeedItemV2[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const [searchTerm, setSearchTerm] = useState('')
  const [sentimentFilter, setSentimentFilter] = useState<string>('')
  const [impactFilter, setImpactFilter] = useState<string>('')

  const [webhookConfig, setWebhookConfig] = useState<WebhookConfigState>(DEFAULT_WEBHOOK_CONFIG)
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({})
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 768px)').matches
  })
  const [isFilterExpanded, setIsFilterExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return !window.matchMedia('(max-width: 768px)').matches
  })
  const latestTopNewsIdRef = useRef('')
  const initializedRef = useRef(false)

  const loadNews = useCallback(async (options?: { silent?: boolean; source?: 'manual' | 'poll' }) => {
    if (!token) return
    if (!options?.silent) {
      setLoading(true)
    }
    try {
      const response = await fetchNewsFeed(token, {
        mode,
        page,
        perPage: 30,
        sentiment: sentimentFilter || undefined,
        impact: impactFilter || undefined,
      })

      const nextItems = response.items || []
      const nextTopNewsId = nextItems[0]?.news.id || ''
      if (
        initializedRef.current &&
        options?.source === 'poll' &&
        nextTopNewsId &&
        latestTopNewsIdRef.current &&
        nextTopNewsId !== latestTopNewsIdRef.current
      ) {
        const previousTopIndex = nextItems.findIndex((item) => item.news.id === latestTopNewsIdRef.current)
        const newCount = previousTopIndex > 0 ? previousTopIndex : 1
        Toast.info(`检测到 ${newCount} 条新情报，已自动更新`)
      }

      setNews(nextItems)
      setTotal(response.total)
      if (nextTopNewsId) {
        latestTopNewsIdRef.current = nextTopNewsId
      }
      initializedRef.current = true
    } catch (error) {
      if (!options?.silent) {
        Toast.error('加载失败: ' + (error as Error).message)
      }
    } finally {
      if (!options?.silent) {
        setLoading(false)
      }
    }
  }, [token, mode, page, sentimentFilter, impactFilter])

  useEffect(() => {
    loadNews()
  }, [loadNews])

  useEffect(() => {
    if (!token || !autoRefresh) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadNews({ silent: true, source: 'poll' })
    }, 30000)
    return () => window.clearInterval(timer)
  }, [token, autoRefresh, loadNews])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const media = window.matchMedia('(max-width: 768px)')
    const onMediaChange = () => {
      setIsMobile(media.matches)
    }
    onMediaChange()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onMediaChange)
      return () => media.removeEventListener('change', onMediaChange)
    }

    media.addListener(onMediaChange)
    return () => media.removeListener(onMediaChange)
  }, [])

  useEffect(() => {
    setIsFilterExpanded(!isMobile)
  }, [isMobile])

  useEffect(() => {
    if (!token) return
    fetchNotificationEndpoints(token)
      .then(({ endpoints }) => {
        const webhook = endpoints.find((item) => item.channelType === 'webhook')
        if (!webhook) {
          setWebhookConfig(DEFAULT_WEBHOOK_CONFIG)
          return
        }

        setWebhookConfig({
          id: webhook.id,
          enabled: Boolean(webhook.enabled),
          url: webhook.endpointUrl || '',
          secret: '',
          hasSecret: Boolean(webhook.hasSecret),
          secretMasked: webhook.secretMasked || '',
          cooldownSec: Number(webhook.cooldownSec) || 300,
        })
      })
      .catch(() => {})
  }, [token])

  const handleSaveWebhook = async () => {
    if (!token) return
    setWebhookSaving(true)
    try {
      await updateNotificationEndpoints(token, [
        {
          id: webhookConfig.id,
          channelType: 'webhook',
          endpointUrl: webhookConfig.url,
          enabled: webhookConfig.enabled,
          cooldownSec: webhookConfig.cooldownSec,
          quietHours: {},
          secret: webhookConfig.secret || undefined,
        },
      ])
      Toast.success('推送配置已保存')
      setWebhookConfig((prev) => ({
        ...prev,
        hasSecret: prev.hasSecret || Boolean(prev.secret),
        secretMasked: prev.secret ? '****' : prev.secretMasked,
        secret: '',
      }))
    } catch (error) {
      Toast.error('保存失败: ' + (error as Error).message)
    } finally {
      setWebhookSaving(false)
    }
  }

  const handleTestWebhook = async () => {
    if (!token) return
    try {
      await testWebhook(token)
      Toast.success('测试消息已发送')
    } catch (error) {
      Toast.error('测试失败: ' + (error as Error).message)
    }
  }

  const handleFeedback = async (newsId: string, action: 'useful' | 'not_useful' | 'already_acted') => {
    if (!token) return
    try {
      await submitNewsFeedback(token, newsId, { action })
      setFeedbackMap((prev) => ({ ...prev, [newsId]: action }))
      Toast.success('已记录反馈')
    } catch (error) {
      Toast.error('反馈失败: ' + (error as Error).message)
    }
  }

  const filteredNews = useMemo(
    () =>
      news.filter((item) => {
        if (!searchTerm) return true
        const term = searchTerm.toLowerCase()
        return (
          item.news.title?.toLowerCase().includes(term) ||
          item.news.content?.toLowerCase().includes(term) ||
          item.news.brief?.toLowerCase().includes(term)
        )
      }),
    [news, searchTerm]
  )

  const bullishCount = filteredNews.filter((item) => item.globalAnalysis?.sentiment === 'bullish').length
  const bearishCount = filteredNews.filter((item) => item.globalAnalysis?.sentiment === 'bearish').length
  const relevantCount = filteredNews.filter((item) => (item.relevance?.relevanceScore || 0) > 0).length
  const pageCount = Math.max(1, Math.ceil(total / 30))

  const activeFilters = [
    sentimentFilter ? `情绪:${sentimentFilter === 'bullish' ? '利好' : sentimentFilter === 'bearish' ? '利空' : '中性'}` : '',
    impactFilter ? `影响:${impactFilter === 'major' ? '重大' : impactFilter === 'moderate' ? '一般' : '轻微'}` : '',
    searchTerm ? `关键词:${searchTerm}` : '',
  ].filter(Boolean)

  return (
    <section className="news-feed">
      <Card className="news-toolbar-card">
        <div className="news-toolbar-header">
          <div>
            <h3>智能情报流</h3>
            <p>全局统一解读 + 持仓个性化洞察，30 秒完成决策判断</p>
          </div>
          <Tag color="blue" type="light">
            当前持仓 {funds.length} 只
          </Tag>
        </div>

        <div className="news-toolbar-controls">
          <div className="news-toolbar-primary">
            <div className="news-primary-mode">
              <RadioGroup
                type="button"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as 'all' | 'relevant')
                  setPage(1)
                }}
              >
                <Radio value="all">全部新闻</Radio>
                <Radio value="relevant">与我相关</Radio>
              </RadioGroup>
            </div>

            <div className="news-primary-search">
              <Input
                className="news-search-input"
                prefix={<IconSearch />}
                placeholder="搜索标题或正文"
                value={searchTerm}
                onChange={setSearchTerm}
              />
            </div>

            <div className="news-primary-actions">
              <Button icon={<IconRefresh />} onClick={() => loadNews({ source: 'manual' })}>
                刷新
              </Button>
              <Button
                type="tertiary"
                onClick={() => setIsFilterExpanded((prev) => !prev)}
              >
                {isFilterExpanded ? '收起筛选' : '更多筛选'}
              </Button>
            </div>
          </div>

          <div className={`news-toolbar-advanced ${isFilterExpanded ? 'expanded' : 'collapsed'}`}>
            <Select
              placeholder="情绪筛选"
              value={sentimentFilter}
              onChange={(value) => setSentimentFilter((value as string) || '')}
              style={{ width: 128 }}
            >
              <Select.Option value="">全部情绪</Select.Option>
              <Select.Option value="bullish">利好</Select.Option>
              <Select.Option value="bearish">利空</Select.Option>
              <Select.Option value="neutral">中性</Select.Option>
            </Select>

            <Select
              placeholder="影响等级"
              value={impactFilter}
              onChange={(value) => setImpactFilter((value as string) || '')}
              style={{ width: 128 }}
            >
              <Select.Option value="">全部影响</Select.Option>
              <Select.Option value="major">重大</Select.Option>
              <Select.Option value="moderate">一般</Select.Option>
              <Select.Option value="minor">轻微</Select.Option>
            </Select>

            <div className="news-auto-refresh">
              <Switch checked={autoRefresh} onChange={setAutoRefresh} size="small" />
              <Tag size="small" type="ghost">{autoRefresh ? '自动刷新 30s' : '自动刷新关闭'}</Tag>
            </div>
          </div>
        </div>

        {activeFilters.length > 0 && (
          <div className="news-active-filters">
            {activeFilters.map((label) => (
              <Tag key={label} size="small" type="light">
                {label}
              </Tag>
            ))}
          </div>
        )}
      </Card>

      <div className="news-feed-layout">
        <div className="news-feed-main">
          {loading ? (
            <Card className="news-state-card">
              <Spin size="large" />
            </Card>
          ) : filteredNews.length === 0 ? (
            <Card className="news-state-card">
              <div className="news-empty">
                <div className="news-empty-icon">
                  <IconInbox size="extra-large" />
                </div>
                <div className="news-empty-title">暂无符合条件的新闻</div>
                <div className="news-empty-subtitle">调整筛选条件或稍后刷新再试</div>
              </div>
            </Card>
          ) : (
            <div className="news-list">
              {filteredNews.map((item) => {
                const relevanceScore = item.relevance?.relevanceScore || 0
                const scopeMeta = relevanceScopeMeta(item.relevance?.matchScope, relevanceScore)
                const matchedEntities = (item.whyRelevant?.matchedEntities || []).filter((target) => target.type === 'sector')
                const matchedWatchlist = item.relevance?.matchedWatchlist || item.whyRelevant?.matchedWatchlist || []
                const feedbackAction = feedbackMap[item.news.id]

                return (
                  <Card key={item.news.id} className={`news-item-card ${relevanceScore > 0 ? 'is-relevant' : ''}`}>
                    <div className="news-item-meta">
                      <div className="news-item-meta-left">
                        <span className="news-item-time">
                          {new Date(item.news.ctime * 1000).toLocaleString('zh-CN')}
                        </span>
                        <Tag size="small" type="ghost">财联社</Tag>
                        {scopeMeta && <Tag color={scopeMeta.color} size="small">{scopeMeta.label}</Tag>}
                      </div>
                    </div>

                    {item.news.title && <h4 className="news-item-title">{item.news.title}</h4>}

                    <div className="news-item-content">{item.news.content || item.news.brief}</div>

                    {item.globalAnalysis && <NewsAnalysisCard analysis={item.globalAnalysis} relevance={item.relevance} />}

                    {relevanceScore > 0 && (
                      <div className="news-relevance-reason">
                        <div className="news-relevance-title">为什么与我相关</div>
                        <div className="news-relevance-tags">
                          <Space wrap spacing={4}>
                            {matchedEntities.length > 0
                              ? matchedEntities.slice(0, 5).map((target, index) => (
                                  <Tag key={`${target.type}-${target.name}-${index}`} size="small" type="light">
                                    板块: {target.name}
                                  </Tag>
                                ))
                              : (
                                <Tag size="small" type="light">
                                  与关注资产存在关联
                                </Tag>
                              )}
                            {matchedWatchlist.slice(0, 3).map((name, index) => (
                              <Tag key={`watchlist-${name}-${index}`} size="small" color="blue" type="light">
                                自选命中: {name}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                      </div>
                    )}

                    {item.personalizedInsight && (
                      <div className="news-personalized-insight">
                        <div className="news-personalized-title">个性化解读</div>
                        <div className="news-personalized-summary">{item.personalizedInsight.personalSummary}</div>
                        <div className="news-personalized-hints">
                          <div><strong>风险提示：</strong>{item.personalizedInsight.riskHint}</div>
                          <div><strong>机会提示：</strong>{item.personalizedInsight.opportunityHint}</div>
                        </div>
                      </div>
                    )}

                    <div className="news-feedback-actions">
                      <Space>
                        <Button
                          size="small"
                          type={feedbackAction === 'useful' ? 'primary' : 'tertiary'}
                          onClick={() => handleFeedback(item.news.id, 'useful')}
                        >
                          有帮助
                        </Button>
                        <Button
                          size="small"
                          type={feedbackAction === 'already_acted' ? 'primary' : 'tertiary'}
                          onClick={() => handleFeedback(item.news.id, 'already_acted')}
                        >
                          已处理
                        </Button>
                        <Button
                          size="small"
                          type={feedbackAction === 'not_useful' ? 'primary' : 'tertiary'}
                          onClick={() => handleFeedback(item.news.id, 'not_useful')}
                        >
                          忽略
                        </Button>
                      </Space>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          {total > 30 && (
            <div className="news-pagination">
              <Space>
                <Button disabled={page === 1} onClick={() => setPage((prev) => prev - 1)}>
                  上一页
                </Button>
                <span>
                  第 {page} 页 / 共 {pageCount} 页
                </span>
                <Button disabled={page >= pageCount} onClick={() => setPage((prev) => prev + 1)}>
                  下一页
                </Button>
              </Space>
            </div>
          )}
        </div>

        <aside className="news-feed-side">
          <Card title="情报概览" className="news-side-card">
            <div className="news-metrics">
              <div className="news-metric">
                <span className="news-metric-label">当前结果</span>
                <strong className="news-metric-value">{filteredNews.length}</strong>
              </div>
              <div className="news-metric">
                <span className="news-metric-label">相关情报</span>
                <strong className="news-metric-value">{relevantCount}</strong>
              </div>
              <div className="news-metric">
                <span className="news-metric-label">利好</span>
                <strong className="news-metric-value rise">{bullishCount}</strong>
              </div>
              <div className="news-metric">
                <span className="news-metric-label">利空</span>
                <strong className="news-metric-value fall">{bearishCount}</strong>
              </div>
            </div>
          </Card>

          <Collapse defaultActiveKey={['webhook']} className="news-side-collapse">
            <Collapse.Panel header="Webhook 推送配置" itemKey="webhook">
              <Card className="news-side-card">
                <div className="news-webhook-form">
                  <label className="news-webhook-field news-webhook-switch">
                    <span>启用推送</span>
                    <Switch
                      checked={webhookConfig.enabled}
                      onChange={(checked) => setWebhookConfig({ ...webhookConfig, enabled: checked })}
                    />
                  </label>

                  <label className="news-webhook-field">
                    <span>Webhook URL</span>
                    <Input
                      placeholder="https://..."
                      value={webhookConfig.url}
                      onChange={(value) => setWebhookConfig({ ...webhookConfig, url: value })}
                    />
                  </label>

                  <label className="news-webhook-field">
                    <span>密钥（可选）</span>
                    <Input
                      placeholder={webhookConfig.hasSecret ? `已设置 ${webhookConfig.secretMasked}` : '用于签名'}
                      value={webhookConfig.secret}
                      onChange={(value) => setWebhookConfig({ ...webhookConfig, secret: value })}
                    />
                  </label>

                  <label className="news-webhook-field">
                    <span>推送间隔（秒）</span>
                    <InputNumber
                      value={webhookConfig.cooldownSec}
                      onChange={(value) =>
                        setWebhookConfig({
                          ...webhookConfig,
                          cooldownSec: Number(value) || DEFAULT_WEBHOOK_CONFIG.cooldownSec,
                        })
                      }
                      min={60}
                      max={3600}
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>

                <div className="news-webhook-actions">
                  <Space>
                    <Button theme="solid" onClick={handleSaveWebhook} loading={webhookSaving}>
                      保存配置
                    </Button>
                    <Button onClick={handleTestWebhook}>发送测试消息</Button>
                  </Space>
                </div>
              </Card>
            </Collapse.Panel>
          </Collapse>
        </aside>
      </div>
    </section>
  )
}
