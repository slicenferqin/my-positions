import { useState } from 'react'
import { Tag, Space, Progress } from '@douyinfe/semi-ui'
import { IconChevronDown, IconChevronUp } from '@douyinfe/semi-icons'
import type { NewsAnalysisResult, UserRelevance } from '@/types/news'
import './NewsAnalysisCard.css'

interface NewsAnalysisCardProps {
  analysis: NewsAnalysisResult
  relevance?: UserRelevance | null
}

export function NewsAnalysisCard({ analysis, relevance }: NewsAnalysisCardProps) {
  const [expanded, setExpanded] = useState(false)
  const sectorImpacts =
    analysis.sectorImpacts?.length > 0
      ? analysis.sectorImpacts
      : analysis.sectors.map((sector) => ({ sector, polarity: analysis.sentiment }))

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish':
        return 'green'
      case 'bearish':
        return 'red'
      default:
        return 'grey'
    }
  }

  const getSentimentText = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish':
        return '利好'
      case 'bearish':
        return '利空'
      default:
        return '中性'
    }
  }

  const getImpactColor = (level: string) => {
    switch (level) {
      case 'major':
        return 'red'
      case 'moderate':
        return 'orange'
      default:
        return 'grey'
    }
  }

  const getImpactText = (level: string) => {
    switch (level) {
      case 'major':
        return '重大'
      case 'moderate':
        return '一般'
      default:
        return '轻微'
    }
  }

  const hitTargets = relevance ? [...relevance.matchedSectors].filter(Boolean) : []

  return (
    <div className="news-analysis-card">
      <div className="news-analysis-header">
        <div className="news-analysis-title">
          <span className="news-analysis-badge">AI</span>
          <span>智能解读</span>
        </div>
        <Space spacing={6} wrap>
          <Tag color={getSentimentColor(analysis.sentiment)} size="small">
            {getSentimentText(analysis.sentiment)}
          </Tag>
          <Tag color={getImpactColor(analysis.impactLevel)} size="small">
            {getImpactText(analysis.impactLevel)}
          </Tag>
          {sectorImpacts.slice(0, 2).map((item) => (
            <Tag key={item.sector} size="small" type="light">
              {item.sector} · {getSentimentText(item.polarity)}
            </Tag>
          ))}
          {sectorImpacts.length > 2 && (
            <span className="news-analysis-more">+{sectorImpacts.length - 2}</span>
          )}
        </Space>
      </div>

      {analysis.summary && (
        <p className="news-analysis-summary">{analysis.summary}</p>
      )}

      {relevance && relevance.relevanceScore > 0 && (
        <div className="news-analysis-relevance">
          <div className="news-analysis-relevance-head">
            <span>与我相关度</span>
            <strong>{Math.round(relevance.relevanceScore * 100)}%</strong>
          </div>
          <Progress
            percent={relevance.relevanceScore * 100}
            showInfo={false}
            stroke="var(--semi-color-primary)"
            size="small"
          />
          {hitTargets.length > 0 && (
            <div className="news-analysis-hit">
              命中: {hitTargets.join('、')}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="news-analysis-toggle"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span>{expanded ? '收起详情' : '展开详情'}</span>
        {expanded ? <IconChevronUp size="small" /> : <IconChevronDown size="small" />}
      </button>

      {expanded && (
        <div className="news-analysis-details">
          {analysis.background && (
            <div className="news-analysis-block">
              <div className="news-analysis-label">背景信息</div>
              <div className="news-analysis-text">{analysis.background}</div>
            </div>
          )}

          {sectorImpacts.length > 0 && (
            <div className="news-analysis-block">
              <div className="news-analysis-label">板块影响</div>
              <Space wrap spacing={4}>
                {sectorImpacts.map((item) => (
                  <Tag key={`${item.sector}-${item.polarity}`} size="small" type="light">
                    {item.sector} · {getSentimentText(item.polarity)}
                  </Tag>
                ))}
              </Space>
            </div>
          )}

          {analysis.tags.length > 0 && (
            <div className="news-analysis-block">
              <div className="news-analysis-label">关键词</div>
              <Space wrap spacing={4}>
                {analysis.tags.map((tag) => (
                  <Tag key={tag} size="small" type="light">
                    {tag}
                  </Tag>
                ))}
              </Space>
            </div>
          )}

          <div className="news-analysis-model">
            模型: {analysis.modelUsed}
            {analysis.analyzedAt && (
              <> · {new Date(analysis.analyzedAt).toLocaleString('zh-CN')}</>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
