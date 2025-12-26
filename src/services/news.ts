import type { NewsResponse, NewsItem } from '@/types'

const CLS_API_URL = '/nodeapi/telegraphList'

interface FetchNewsParams {
  limit?: number
  maxTime?: number // for pagination
}

export const fetchNews = async ({ limit = 20, maxTime }: FetchNewsParams = {}): Promise<NewsItem[]> => {
  try {
    const params = new URLSearchParams({
      app: 'CailianpressWeb',
      os: 'web',
      refresh_type: '1',
      order: '1',
      rn: limit.toString(),
      sv: '8.4.6'
    })

    if (maxTime) {
      params.append('max_time', maxTime.toString())
    }

    const response = await fetch(`${CLS_API_URL}?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch news: ${response.status}`)
    }

    const text = await response.text()
    try {
      const data: any = JSON.parse(text)
      
      // 财联社接口返回结构可能不一致，尝试适配
      // 有时返回 code=200, 有时可能是 error=0
      // 检查 data.data.roll_data 是否存在
      if (data.data && Array.isArray(data.data.roll_data)) {
        return data.data.roll_data
      }
      
      // 如果没有数据，返回空数组而不是抛出错误
      if (data.data && data.data.roll_data === null) {
        return []
      }
      
      if (data.code !== 200 && data.error !== 0) {
        throw new Error(data.msg || `Failed to fetch news, code: ${data.code || data.error}`)
      }
      
      throw new Error('Invalid response structure')
    } catch (e) {
      console.error('Failed to parse news response:', text.substring(0, 200))
      throw e
    }
  } catch (error) {
    console.error('Error fetching news:', error)
    return []
  }
}

// 提取基金名称关键词的辅助函数
export const extractFundKeywords = (fundName: string): string => {
  // 移除常见的后缀和前缀
  let name = fundName
    .replace(/[A-Z]$/, '') // 移除末尾的 A/C 等字母
    .replace(/（.*?）/g, '') // 移除括号内容
    .replace(/\(.*?\)/g, '')
    .replace(/基金|指数|混合|股票|联接|ETF|LOF|发起式|债券|货币/g, '') // 移除类型词
    .replace(/招商|中欧|易方达|广发|富国|汇添富|南方|嘉实|工银|华夏|天弘|博时|鹏华/g, '') // 移除常见基金公司名（可选，视需求而定）
    .replace(/中证|国证|沪深/g, '') // 移除指数前缀
  
  return name.trim()
}

// 构建 AI 分析的 Prompt
export function generateAnalysisPrompt(stocks: string[], news: NewsItem[]): string {
  // 过滤相关新闻
  const relatedNews = news.filter(item => {
    const text = (item.title + item.content).toLowerCase()
    return stocks.some(stock => text.includes(stock.toLowerCase()))
  })

  // 如果没有相关新闻，取前 10 条重要新闻
  const newsToAnalyze = relatedNews.length > 0 ? relatedNews : news.slice(0, 10)
  const isRelated = relatedNews.length > 0

  return `
你是一位专业的金融分析师。我持有以下基金，它们的前十大重仓股包含：
${stocks.join('、')}

最近市场上有以下${isRelated ? '与我持仓相关' : '重要'}快讯：
${newsToAnalyze.map((n, i) => `
${i + 1}. 【${n.title || '快讯'}】 ${new Date(n.ctime * 1000).toLocaleString()}
${n.content.substring(0, 300)}...
`).join('\n')}

请根据上述信息：
1. 分析这些新闻对我的持仓（具体到股票或板块）有何具体影响（利好/利空/中性）。
2. 如果有重大利好或风险，请特别提示。
3. 给出简要的操作建议（如继续持有、关注风险等）。
`
}

export function generateSingleNewsAnalysisPrompt(news: NewsItem, stocks: string[]): string {
  return `
你是一位专业的金融分析师。我的投资组合重仓了以下股票：
${stocks.join('、')}

刚刚抓取到一条可能相关的快讯：
【${news.title || '快讯'}】 ${new Date(news.ctime * 1000).toLocaleString()}
${news.content}

请简要分析这条快讯对我的持仓股票有何具体影响（利好/利空/中性），并说明理由。
请直接给出分析结果，不要废话，字数控制在100字以内。
`
}

export async function callAIAnalysis(prompt: string): Promise<string> {
  try {
    const response = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `Request failed: ${response.status}`)
    }

    const data = await response.json()
    return data.result
  } catch (error) {
    console.error('AI Analysis failed:', error)
    throw error
  }
}
