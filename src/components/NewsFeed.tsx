import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { fetchNews, analyzePortfolio, fetchFundPortfolio } from '@/services'
import type { NewsItem, PortfolioAnalysis, FundWithEstimation, Stock, WebhookConfig } from '@/types'
import { DEFAULT_WEBHOOK_CONFIG } from '@/types'
import { fetchWebhookConfig, updateWebhookConfig, testWebhook, refreshPortfolioRequest } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import './NewsFeed.css'

function LiveClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const dateStr = time.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/\//g, '.')
  
  const weekDay = time.toLocaleDateString('zh-CN', { weekday: 'long' })
  const timeStr = time.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })

  return (
    <div className="live-clock">
      <span className="date">{dateStr}</span>
      <span className="weekday">{weekDay}</span>
      <span className="time">{timeStr}</span>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="news-card skeleton-card">
      <div className="skeleton skeleton-header"></div>
      <div className="skeleton skeleton-text"></div>
      <div className="skeleton skeleton-text"></div>
      <div className="skeleton skeleton-footer"></div>
    </div>
  )
}

interface NewsCardProps {
  item: NewsItem
  isNew?: boolean
  isHighlighted?: boolean
  sentiment?: 'bullish' | 'bearish' | null
  aiAnalysis?: string | null
  onTagClick?: (tag: string) => void
}

function NewsCard({ item, isNew, isHighlighted, sentiment, aiAnalysis, onTagClick }: NewsCardProps) {
  const [expanded, setExpanded] = useState(false)
  const date = new Date(item.ctime * 1000)
  const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  
  // 智能内容解析
  let displayTitle = item.title || ''
  let displayContent = item.content || item.brief || ''
  
  // 总是尝试匹配内容开头的【】
  const match = displayContent.match(/^【(.*?)】/)
  if (match) {
    // 总是从内容中移除【...】
    displayContent = displayContent.substring(match[0].length)
    
    // 如果没有 API 提供的标题，就使用提取的标题
    if (!displayTitle) {
      displayTitle = match[1]
    }
  }
  
  // 清理正文开头的标点符号
  displayContent = displayContent.replace(/^[，。！？：:,. \n]+/, '')

  const isLongContent = displayContent.length > 150

  // 处理图片链接 - 使用本地代理解决防盗链和跨域问题
  const getProxyImageUrl = (url: string) => {
    if (!url) return null
    // 修复：处理逗号分隔的多张图片 URL，取第一张
    const firstUrl = url.split(',')[0].trim()
    // 移除 URL 中的 query 参数
    const cleanUrl = firstUrl.split('?')[0]
    // 提取路径部分（支持 img.cls.cn 和 image.cls.cn）
    const path = cleanUrl.replace(/^https?:\/\/(img|image)\.cls\.cn/, '')
    // 确保以 / 开头
    const safePath = path.startsWith('/') ? path : `/${path}`
    return `/img-proxy${safePath}`
  }

  const imageUrl = item.img ? getProxyImageUrl(item.img) : null

  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<string | undefined>(undefined)

  // 当展开状态改变时，更新高度
  useEffect(() => {
    if (expanded && contentRef.current) {
      // 展开时，设置为实际高度
      setContentHeight(`${contentRef.current.scrollHeight}px`)
    } else {
      // 收起时，移除内联高度，让 CSS 处理（回到默认折叠高度）
      setContentHeight(undefined)
    }
  }, [expanded])

  const handleTextClick = () => {
    if (!isLongContent) return
    
    // 如果是展开状态，且用户正在选中文本，则不折叠
    if (expanded) {
      const selection = window.getSelection()
      if (selection && selection.toString().length > 0) {
        return
      }
    }
    
    setExpanded(!expanded)
  }

  return (
    <div className={`news-card ${isNew ? 'new-item' : ''} ${isHighlighted ? 'highlighted' : ''}`}>
      <div className="news-meta-row">
        <span className="news-time-red">{timeStr}</span>
        <span className="news-source">财联社 {date.getDate()}日</span>
        {isHighlighted && <span className="news-badge-holdings">持仓相关</span>}
      </div>
      
      <div className="news-body">
        <div 
          ref={contentRef}
          className={`news-text ${isLongContent ? 'collapsible' : ''} ${expanded ? 'expanded' : ''}`}
          onClick={handleTextClick}
          title={isLongContent ? (expanded ? "点击收起" : "点击展开") : undefined}
          style={contentHeight ? { maxHeight: contentHeight } : undefined}
        >
          {displayTitle && (
            <span className={`news-title-inline ${sentiment || ''}`}>【{displayTitle}】</span>
          )}
          {displayContent}
          
          {isLongContent && !expanded && (
            <div className="expand-overlay">
              <span className="expand-btn">点击展开</span>
            </div>
          )}
        </div>
        
        {imageUrl && (
          <div className="news-image">
            <img src={imageUrl} alt="新闻配图" referrerPolicy="no-referrer" />
          </div>
        )}
      </div>

      {aiAnalysis && (
        <div className="news-ai-analysis-card">
          <div className="analysis-header">
            <span className="ai-icon">🤖</span> AI 深度解读
          </div>
          <div className="analysis-content">
            <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
          </div>
        </div>
      )}

      <div className="news-footer">
        <div className="news-tags">
          {item.subjects?.map(sub => (
            <span 
              key={sub.subject_id} 
              className="news-tag"
              onClick={(e) => {
                e.stopPropagation();
                onTagClick?.(sub.subject_name);
              }}
            >
              {sub.subject_name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

interface NewsFeedProps {
  funds?: FundWithEstimation[]
}

export function NewsFeed({ funds = [] }: NewsFeedProps) {
  const { token } = useAuth()
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [showImportantOnly, setShowImportantOnly] = useState(false)
  const [showHoldingsOnly, setShowHoldingsOnly] = useState(false)
  
  // Webhook state
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>(DEFAULT_WEBHOOK_CONFIG)
  const [showWebhookPanel, setShowWebhookPanel] = useState(false)
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookTesting, setWebhookTesting] = useState(false)
  
  useEffect(() => {
    if (!token) return
    setWebhookLoading(true)
    fetchWebhookConfig(token)
      .then(({ config }) => setWebhookConfig(config))
      .catch((error) => console.error('加载 Webhook 配置失败:', error))
      .finally(() => setWebhookLoading(false))
  }, [token])

  const handleSaveWebhookConfig = useCallback(async () => {
    if (!token) return
    setWebhookSaving(true)
    try {
      const { config } = await updateWebhookConfig(token, webhookConfig)
      setWebhookConfig(config)
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存失败')
    } finally {
      setWebhookSaving(false)
    }
  }, [token, webhookConfig])

  const handleTestWebhook = useCallback(async () => {
    if (!token) return
    setWebhookTesting(true)
    try {
      const { success } = await testWebhook(token)
      alert(success ? '测试消息已发送' : '测试失败，请检查配置')
    } catch (error) {
      alert(error instanceof Error ? error.message : '测试失败')
    } finally {
      setWebhookTesting(false)
    }
  }, [token])

  const handleRefreshKeywords = useCallback(async () => {
    if (!token) return
    try {
      await refreshPortfolioRequest(token)
      alert('已触发后台刷新，稍后自动生效')
    } catch (error) {
      alert(error instanceof Error ? error.message : '刷新失败')
    }
  }, [token])
  
  // 资产透视分析结果
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<PortfolioAnalysis | null>(null)
  const [realHoldings, setRealHoldings] = useState<Record<string, Stock[]>>({})

  // 加载真实持仓数据
  useEffect(() => {
    let mounted = true
    
    async function loadHoldings() {
      if (funds.length === 0) return
      
      const newHoldings: Record<string, Stock[]> = {}
      // 找出尚未加载持仓数据的基金
      const pendingFunds = funds.filter(f => !realHoldings[f.code])
      
      if (pendingFunds.length === 0) return

      await Promise.all(pendingFunds.map(async (fund) => {
        try {
          const stocks = await fetchFundPortfolio(fund.code)
          if (stocks.length > 0) {
            newHoldings[fund.code] = stocks.map(s => ({
              code: s.code,
              name: s.name,
              ratio: s.percent
            }))
          }
        } catch (e) {
          console.warn(`Failed to load portfolio for ${fund.code}`, e)
        }
      }))
      
      if (mounted && Object.keys(newHoldings).length > 0) {
        setRealHoldings(prev => ({ ...prev, ...newHoldings }))
      }
    }
    
    loadHoldings()
    
    return () => { mounted = false }
  }, [funds]) // 这里依赖 funds，当基金列表变化时触发

  // 当持仓或持仓数据变化时，进行资产透视分析
  useEffect(() => {
    if (funds.length > 0) {
      const analysis = analyzePortfolio(funds, realHoldings)
      setPortfolioAnalysis(analysis)
    } else {
      setPortfolioAnalysis(null)
    }
  }, [funds, realHoldings])

  const loadNews = async (isAutoRefresh = false, loadMore = false) => {
    if (!isAutoRefresh && !loadMore) setLoading(true)
    if (loadMore) setLoadingMore(true)

    try {
      // 如果是加载更多，使用当前列表中最后一条的时间作为 maxTime
      const maxTime = loadMore && news.length > 0 ? news[news.length - 1].ctime : undefined
      const data = await fetchNews({ limit: loadMore ? 20 : 50, maxTime })
      
      if (data && data.length > 0) {
        setNews(prev => {
          if (loadMore) {
            // 过滤重复
            const existingIds = new Set(prev.map(n => n.id || String(n.ctime)))
            const newItems = data.filter(n => !existingIds.has(n.id || String(n.ctime)))
            return [...prev, ...newItems]
          }

          // 如果是第一次加载，直接设置
          if (prev.length === 0) return data
          
          // 找出新条目
          const prevIds = new Set(prev.map(item => item.id || String(item.ctime)))
          const currentNewIds = new Set<string>()
          const newItems: NewsItem[] = []
          
          data.forEach(item => {
            const id = item.id || String(item.ctime)
            if (!prevIds.has(id)) {
              currentNewIds.add(id)
              newItems.push(item)
            }
          })
          
          if (currentNewIds.size > 0) {
            setNewIds(currentNewIds)
            setTimeout(() => {
              setNewIds(new Set())
            }, 3000)
            
            // 合并新数据，去重
            const existingIds = new Set(data.map(n => n.id || String(n.ctime)))
            const oldItems = prev.filter(n => !existingIds.has(n.id || String(n.ctime)))
            
            return [...data, ...oldItems]
          }
          
          return prev
        })
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const [aiAnalysisResults, setAiAnalysisResults] = useState<Record<string, string>>({})
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set())

  const analyzeItem = useCallback((item: NewsItem) => {
    // heuristic for importance since level is not in type
    let isImportant = (item.reading_num || 0) > 50000
    let isHighlighted = false
    let sentiment: 'bullish' | 'bearish' | null = null

    // Check for portfolio keywords
    if (portfolioAnalysis?.keywords) {
      const content = (item.title + item.content).toLowerCase()
      for (const keyword of portfolioAnalysis.keywords) {
        if (content.includes(keyword.toLowerCase())) {
          isHighlighted = true
          break
        }
      }
    }

    // Basic sentiment analysis (simple heuristic)
    if (item.content.includes('利好') || item.content.includes('上涨') || item.content.includes('突破')) {
      sentiment = 'bullish'
    } else if (item.content.includes('利空') || item.content.includes('下跌') || item.content.includes('跌破')) {
      sentiment = 'bearish'
    }

    return { isImportant, isHighlighted, sentiment }
  }, [portfolioAnalysis])

  // Automatic AI Analysis for highlighted items - 已禁用
  // useEffect(() => {
  //   if (!portfolioAnalysis || news.length === 0) return

  //   const processQueue = async () => {
  //     // Find items that are highlighted, not analyzed, and not currently analyzing
  //     const candidates = news.filter(item => {
  //       const id = item.id || String(item.ctime)
  //       const { isHighlighted } = analyzeItem(item)
  //       return isHighlighted && !aiAnalysisResults[id] && !analyzingIds.has(id)
  //     })

  //     // Take only the top 5 most recent to avoid flood
  //     const batch = candidates.slice(0, 5)
      
  //     if (batch.length === 0) return

  //     // Mark as analyzing
  //     setAnalyzingIds(prev => {
  //       const next = new Set(prev)
  //       batch.forEach(item => next.add(item.id || String(item.ctime)))
  //       return next
  //     })

  //     // Process batch
  //     await Promise.allSettled(batch.map(async (item) => {
  //       const id = item.id || String(item.ctime)
  //       try {
  //         const stocks = Array.from(portfolioAnalysis.keywords)
  //         const prompt = generateSingleNewsAnalysisPrompt(item, stocks)
  //         const result = await callAIAnalysis(prompt)
          
  //         setAiAnalysisResults(prev => ({
  //           ...prev,
  //           [id]: result
  //         }))
  //       } catch (error) {
  //         console.error(`AI analysis failed for ${id}`, error)
  //       } finally {
  //         setAnalyzingIds(prev => {
  //           const next = new Set(prev)
  //           next.delete(id)
  //           return next
  //         })
  //       }
  //     }))
  //   }

  //   processQueue()
  // }, [news, portfolioAnalysis, analyzeItem, aiAnalysisResults, analyzingIds])

  useEffect(() => {
    loadNews()
    // 每60秒自动刷新
    const timer = setInterval(() => loadNews(true), 60000)
    return () => clearInterval(timer)
  }, [])

  // Infinite Scroll Handler
  useEffect(() => {
    const onScroll = () => {
      if (loading || loadingMore || searchTerm || selectedTag || showImportantOnly) return
      const scrollTop = window.scrollY
      const clientHeight = window.innerHeight
      const scrollHeight = document.documentElement.scrollHeight
      
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadNews(false, true)
      }
    }
    
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [loading, loadingMore, searchTerm, selectedTag, showImportantOnly, news]) // dependency on news is needed to get latest maxTime

  // Filtered News
  const filteredNews = useMemo(() => {
    return news.filter(item => {
      const { isImportant, isHighlighted } = analyzeItem(item)
      const text = (item.title + item.content + (item.subjects?.map(s => s.subject_name).join(' ') || '')).toLowerCase()
      
      // Filter by Search
      if (searchTerm && !text.includes(searchTerm.toLowerCase())) return false
      
      // Filter by Tag
      if (selectedTag) {
        const hasTag = item.subjects?.some(s => s.subject_name === selectedTag)
        if (!hasTag) return false
      }
      
      // Filter by Importance
      if (showImportantOnly && !isImportant) return false

      // Filter by Holdings
      if (showHoldingsOnly) {
        // 使用 analyzeItem 已经计算出的高亮状态（基于透视关键词）
        if (!isHighlighted) return false
      }
      
      return true
    })
  }, [news, searchTerm, selectedTag, showImportantOnly, showHoldingsOnly, portfolioAnalysis, analyzeItem])

  return (
    <div className="news-feed">
      <div className="news-feed-header">
        <LiveClock />
        <div className="update-indicator">
          <span className="update-text">电报持续更新中</span>
          <div className="equalizer">
            <div className="equalizer-bar"></div>
            <div className="equalizer-bar"></div>
            <div className="equalizer-bar"></div>
          </div>
        </div>
        
        {/* Controls */}
        <div className="news-controls">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input 
              type="text" 
              className="search-input"
              placeholder="搜索资讯 / 代码 / 关键词..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="filter-toggle" onClick={() => setShowHoldingsOnly(!showHoldingsOnly)}>
            <div className={`toggle-switch ${showHoldingsOnly ? 'active' : ''}`}>
              <div className="toggle-knob"></div>
            </div>
            <span>只看持仓</span>
          </div>

          <div className="filter-toggle" onClick={() => setShowImportantOnly(!showImportantOnly)}>
            <div className={`toggle-switch ${showImportantOnly ? 'active' : ''}`}>
              <div className="toggle-knob"></div>
            </div>
            <span>只看重要</span>
          </div>

          <div className="filter-toggle" onClick={() => setShowWebhookPanel(!showWebhookPanel)}>
            <div className={`toggle-switch ${webhookConfig.enabled ? 'active' : ''}`}>
              <div className="toggle-knob"></div>
            </div>
            <span>Webhook{webhookConfig.enabled ? '已启用' : '推送'}</span>
          </div>
        </div>

        {/* Webhook Configuration Panel */}
        {showWebhookPanel && (
          <div className="webhook-panel" style={{ marginTop: '16px', padding: '16px', background: 'var(--card-bg)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Webhook 配置 {webhookLoading && '（加载中...）'}</h4>
              <button 
                onClick={() => setShowWebhookPanel(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Webhook URL
              </label>
              <input
                type="text"
                value={webhookConfig.url}
                onChange={(e) => setWebhookConfig((prev) => ({ ...prev, url: e.target.value }))}
                placeholder="https://..."
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '13px' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                密钥（可选，用于签名验证）
              </label>
              <input
                type="password"
                value={webhookConfig.secret || ''}
                onChange={(e) => setWebhookConfig((prev) => ({ ...prev, secret: e.target.value }))}
                placeholder="可选"
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={webhookConfig.holdingsOnly}
                  onChange={(e) => setWebhookConfig((prev) => ({ ...prev, holdingsOnly: e.target.checked }))}
                />
                仅发送持仓相关
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={webhookConfig.enabled}
                  onChange={(e) => setWebhookConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
                启用推送
              </label>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                推送间隔（分钟）
              </label>
              <input
                type="number"
                min={1}
                value={webhookConfig.interval}
                onChange={(e) => setWebhookConfig((prev) => ({ ...prev, interval: Math.max(1, parseInt(e.target.value) || 1) }))}
                style={{ width: '120px', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={handleSaveWebhookConfig}
                disabled={webhookSaving || !token}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--primary-color)', color: '#fff' }}
              >
                {webhookSaving ? '保存中...' : '保存配置'}
              </button>
              <button
                onClick={handleTestWebhook}
                disabled={!webhookConfig.enabled || webhookTesting}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)' }}
              >
                {webhookTesting ? '测试中...' : '发送测试'}
              </button>
              <button
                onClick={handleRefreshKeywords}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--text-secondary)' }}
              >
                刷新持仓关键词
              </button>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span>状态: {webhookConfig.enabled ? '已启用' : '未启用'}，仅持仓：{webhookConfig.holdingsOnly ? '是' : '否'}</span>
              <span>最后发送: {webhookConfig.lastSentTime ? new Date(webhookConfig.lastSentTime).toLocaleTimeString('zh-CN') : '暂无记录'}</span>
              <span>累计推送: {webhookConfig.sentCount ?? 0} 条 | 跟踪关键词: {webhookConfig.keywordsTracked ?? 0}</span>
            </div>
          </div>
        )}
        
        {/* Portfolio X-Ray Summary */}
        {showHoldingsOnly && portfolioAnalysis && (
          <div className="portfolio-insight">
            <div className="insight-icon">🔍</div>
            <div className="insight-content">
              <div className="insight-title">持仓深度透视</div>
              <div className="insight-text">{portfolioAnalysis.summary}</div>
            </div>
          </div>
        )}
        
        {/* Active Tag Filter Indicator */}
        {selectedTag && (
          <div style={{ marginTop: '12px' }}>
            <span className="news-tag" style={{ background: 'var(--primary-color)', color: 'white' }}>
              {selectedTag}
              <span 
                style={{ marginLeft: '6px', cursor: 'pointer' }} 
                onClick={() => setSelectedTag(null)}
              >
                ✕
              </span>
            </span>
            <span className="active-filter-tag">已筛选标签</span>
          </div>
        )}
      </div>

      <div className="news-list">
        {loading && news.length === 0 ? (
          // Initial Loading Skeletons
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            {filteredNews.map(item => {
              const { sentiment, isHighlighted } = analyzeItem(item)
              const id = item.id || String(item.ctime)
              return (
                <NewsCard 
                  key={id} 
                  item={item} 
                  isHighlighted={isHighlighted}
                  isNew={newIds.has(id)}
                  sentiment={sentiment}
                  aiAnalysis={aiAnalysisResults[id]}
                  onTagClick={tag => {
                    setSelectedTag(tag)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                />
              )
            })}
            
            {filteredNews.length === 0 && !loading && (
              <div className="empty-state">
                {showHoldingsOnly ? '暂无持仓相关资讯' : (searchTerm || selectedTag ? '没有找到相关资讯' : '暂无资讯')}
              </div>
            )}
            
            {loadingMore && (
              <div className="load-more-trigger">
                <div className="equalizer">
                  <div className="equalizer-bar"></div>
                  <div className="equalizer-bar"></div>
                  <div className="equalizer-bar"></div>
                </div>
                <span style={{ marginLeft: '8px' }}>加载更多...</span>
              </div>
            )}
            
            {!loadingMore && news.length > 0 && !searchTerm && !selectedTag && !showImportantOnly && (
              <div className="load-more-trigger">
                <span>下滑加载更多</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
