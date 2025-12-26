import { parseEstimation } from './fundApi'
import type { UserFund, FundWithEstimation, PortfolioAnalysis, FundDetails, Stock, AttributionItem } from '@/types'

// Mock Database of Fund Holdings (Top 10 Stocks)
// 数据来源：2024年Q3季报（模拟数据）
const MOCK_FUND_DB: Record<string, FundDetails> = {
  '005827': {
    code: '005827',
    name: '易方达蓝筹精选混合',
    sectors: ['白酒', '互联网', '消费'],
    topStocks: [
      { name: '五粮液', code: '000858', ratio: 9.8 },
      { name: '贵州茅台', code: '600519', ratio: 9.6 },
      { name: '腾讯控股', code: '00700', ratio: 9.2 },
      { name: '泸州老窖', code: '000568', ratio: 8.5 },
      { name: '洋河股份', code: '002304', ratio: 7.8 },
      { name: '中国海洋石油', code: '00883', ratio: 5.5 },
      { name: '美团-W', code: '03690', ratio: 4.8 },
      { name: '山西汾酒', code: '600809', ratio: 4.5 },
      { name: '古井贡酒', code: '000596', ratio: 3.2 },
      { name: '香港交易所', code: '00388', ratio: 3.0 },
    ]
  },
  '012414': {
    code: '012414',
    name: '招商中证白酒指数C',
    sectors: ['白酒'],
    topStocks: [
      { name: '五粮液', code: '000858', ratio: 15.2 },
      { name: '贵州茅台', code: '600519', ratio: 14.8 },
      { name: '山西汾酒', code: '600809', ratio: 13.5 },
      { name: '泸州老窖', code: '000568', ratio: 12.8 },
      { name: '洋河股份', code: '002304', ratio: 8.5 },
      { name: '古井贡酒', code: '000596', ratio: 6.2 },
      { name: '今世缘', code: '603369', ratio: 4.5 },
      { name: '舍得酒业', code: '600702', ratio: 3.2 },
      { name: '口子窖', code: '603589', ratio: 2.5 },
      { name: '水井坊', code: '600779', ratio: 2.0 },
    ]
  },
  '003096': {
    code: '003096',
    name: '中欧医疗健康混合C',
    sectors: ['医药', '医疗服务'],
    topStocks: [
      { name: '恒瑞医药', code: '600276', ratio: 9.8 },
      { name: '药明康德', code: '603259', ratio: 8.6 },
      { name: '迈瑞医疗', code: '300760', ratio: 7.2 },
      { name: '爱尔眼科', code: '300015', ratio: 6.5 },
      { name: '片仔癀', code: '600436', ratio: 5.5 },
      { name: '同仁堂', code: '600085', ratio: 4.8 },
      { name: '凯莱英', code: '002821', ratio: 4.2 },
      { name: '泰格医药', code: '300347', ratio: 3.5 },
      { name: '康龙化成', code: '300759', ratio: 3.0 },
      { name: '益丰药房', code: '603939', ratio: 2.5 },
    ]
  },
  '001618': {
    code: '001618',
    name: '天弘中证电子指数C',
    sectors: ['半导体', '电子', '芯片'],
    topStocks: [
      { name: '立讯精密', code: '002475', ratio: 8.5 },
      { name: '京东方A', code: '000725', ratio: 7.2 },
      { name: '海康威视', code: '002415', ratio: 6.8 },
      { name: '中芯国际', code: '688981', ratio: 6.5 },
      { name: '韦尔股份', code: '603501', ratio: 5.2 },
      { name: '北方华创', code: '002371', ratio: 4.8 },
      { name: '兆易创新', code: '603986', ratio: 4.2 },
      { name: '卓胜微', code: '300782', ratio: 3.5 },
      { name: '紫光国微', code: '002049', ratio: 3.2 },
      { name: '圣邦股份', code: '300661', ratio: 2.8 },
    ]
  },
  '000001': { // 假设华夏成长
     code: '000001',
     name: '华夏成长混合',
     sectors: ['新能源', '科技'],
     topStocks: [
       { name: '宁德时代', code: '300750', ratio: 8.5 },
       { name: '比亚迪', code: '002594', ratio: 7.2 },
       { name: '阳光电源', code: '300274', ratio: 5.5 },
       { name: '隆基绿能', code: '601012', ratio: 4.8 },
       { name: '通威股份', code: '600438', ratio: 4.2 },
       { name: '天齐锂业', code: '002466', ratio: 3.5 },
       { name: '亿纬锂能', code: '300014', ratio: 3.2 },
       { name: '赣锋锂业', code: '002460', ratio: 2.8 },
       { name: '华友钴业', code: '603799', ratio: 2.5 },
       { name: '恩捷股份', code: '002812', ratio: 2.2 },
     ]
  },
  '161725': { // 招商中证白酒A
      code: '161725',
      name: '招商中证白酒指数A',
      sectors: ['白酒'],
      topStocks: [
        { name: '五粮液', code: '000858', ratio: 15.2 },
        { name: '贵州茅台', code: '600519', ratio: 14.8 },
        { name: '山西汾酒', code: '600809', ratio: 13.5 },
        { name: '泸州老窖', code: '000568', ratio: 12.8 },
        { name: '洋河股份', code: '002304', ratio: 8.5 },
        { name: '古井贡酒', code: '000596', ratio: 6.2 },
        { name: '今世缘', code: '603369', ratio: 4.5 },
        { name: '舍得酒业', code: '600702', ratio: 3.2 },
        { name: '口子窖', code: '603589', ratio: 2.5 },
        { name: '水井坊', code: '600779', ratio: 2.0 },
      ]
  }
}

// 默认兜底数据（用于未知基金）
const DEFAULT_FUND: FundDetails = {
  code: 'DEFAULT',
  name: '未知基金',
  sectors: ['混合'],
  topStocks: [
    { name: '贵州茅台', code: '600519', ratio: 5.0 },
    { name: '宁德时代', code: '300750', ratio: 3.0 },
    { name: '中国平安', code: '601318', ratio: 2.0 },
    { name: '招商银行', code: '600036', ratio: 2.0 },
  ]
}

// 辅助：股票到板块的映射（增强分析）
const STOCK_SECTOR_MAP: Record<string, string> = {
  '贵州茅台': '白酒', '五粮液': '白酒', '泸州老窖': '白酒', '山西汾酒': '白酒', '洋河股份': '白酒',
  '宁德时代': '新能源', '比亚迪': '新能源', '阳光电源': '光伏', '隆基绿能': '光伏', '通威股份': '光伏',
  '腾讯控股': '互联网', '美团-W': '互联网', '快手-W': '互联网', '阿里巴巴': '互联网',
  '恒瑞医药': '医药', '药明康德': 'CXO', '迈瑞医疗': '医疗器械', '爱尔眼科': '医疗服务', '片仔癀': '中药',
  '立讯精密': '消费电子', '京东方A': '面板', '海康威视': '安防', '中芯国际': '半导体', '韦尔股份': '半导体',
  '中国平安': '保险', '招商银行': '银行', '中信证券': '证券', '万科A': '地产',
  '中国海洋石油': '石油', '中国神华': '煤炭', '长江电力': '电力'
}

export function analyzePortfolio(
  funds: FundWithEstimation[],
  realHoldings?: Record<string, Stock[]>
): PortfolioAnalysis {
  const keywords = new Set<string>()
  const topStocksSet = new Set<string>()
  const sectorsSet = new Set<string>()
  
  // 聚合数据
  const stockAgg: Record<string, { value: number; code: string; name: string }> = {}
  const sectorAgg: Record<string, number> = {}
  let totalAssets = 0

  // Daily Attribution Data
  const sectorDailyProfit: Record<string, number> = {}
  const fundAttribution: AttributionItem[] = []
  let totalDailyProfit = 0

  funds.forEach(fund => {
    // 计算基金当前市值
    const currentNav = fund.estimation?.gsz ? Number(fund.estimation.gsz) : fund.cost // Fallback
    const fundValue = fund.shares * currentNav
    totalAssets += fundValue
    
    // Calculate Daily Profit for this fund
    const gszzl = fund.estimation?.gszzl ? Number(fund.estimation.gszzl) : 0
    const dailyProfit = fundValue * (gszzl / 100)
    totalDailyProfit += dailyProfit

    fundAttribution.push({
      name: fund.name,
      code: fund.code,
      amount: dailyProfit,
      returnRate: gszzl,
      percent: 0
    })

    if (fundValue <= 0) return

    // 优先使用真实持仓数据
    let stocks = realHoldings?.[fund.code]
    let sectors: string[] = []

    if (stocks && stocks.length > 0) {
      console.log(`[Portfolio] Using REAL data for ${fund.code} (${fund.name})`, stocks)
      // 如果有真实持仓，尝试推断板块
      const inferredSectors = new Set<string>()
      stocks.slice(0, 3).forEach(s => {
        const sector = STOCK_SECTOR_MAP[s.name]
        if (sector) inferredSectors.add(sector)
      })
      sectors = Array.from(inferredSectors)
      if (sectors.length === 0) sectors = ['混合'] // 无法推断时
    } else {
      console.log(`[Portfolio] Using MOCK/DEFAULT data for ${fund.code} (${fund.name})`)
      // 降级到 Mock 数据
      let details = MOCK_FUND_DB[fund.code]
      if (!details) {
        // 简单模糊匹配逻辑
        if (fund.name.includes('白酒') || fund.name.includes('消费')) details = MOCK_FUND_DB['005827']
        else if (fund.name.includes('医疗') || fund.name.includes('医药')) details = MOCK_FUND_DB['003096']
        else if (fund.name.includes('电子') || fund.name.includes('半导体')) details = MOCK_FUND_DB['001618']
        else if (fund.name.includes('新能源') || fund.name.includes('成长')) details = MOCK_FUND_DB['000001']
        else details = DEFAULT_FUND
      }
      stocks = details.topStocks
      sectors = details.sectors
    }

    // Distribute daily profit to sectors
    if (sectors.length > 0) {
        const profitPerSector = dailyProfit / sectors.length
        sectors.forEach(s => {
            if (!sectorDailyProfit[s]) sectorDailyProfit[s] = 0
            sectorDailyProfit[s] += profitPerSector
        })
    } else {
        if (!sectorDailyProfit['其他']) sectorDailyProfit['其他'] = 0
        sectorDailyProfit['其他'] += dailyProfit
    }

    // 收集关键词
    sectors.forEach(s => {
      sectorsSet.add(s)
      keywords.add(s)
    })
    
    // 穿透持仓计算
    stocks.forEach(stock => {
      topStocksSet.add(stock.name)
      keywords.add(stock.name)
      
      const stockValue = fundValue * (stock.ratio / 100)
      
      // Stock Aggregation
      if (!stockAgg[stock.name]) {
        stockAgg[stock.name] = { value: 0, code: stock.code, name: stock.name }
      }
      stockAgg[stock.name].value += stockValue
      
      // Sector Aggregation (per stock)
      const sector = STOCK_SECTOR_MAP[stock.name] || sectors[0] || '其他'
      if (!sectorAgg[sector]) sectorAgg[sector] = 0
      sectorAgg[sector] += stockValue
    })
  })

  // Format Stock Exposure
  const stockExposure = Object.values(stockAgg)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10) // Top 10
    .map(item => ({
      ...item,
      percent: totalAssets > 0 ? (item.value / totalAssets) * 100 : 0
    }))

  // Format Sector Allocation
  const sectorAllocation = Object.entries(sectorAgg)
    .map(([name, value]) => ({
      name,
      value,
      percent: totalAssets > 0 ? (value / totalAssets) * 100 : 0
    }))
    .sort((a, b) => b.value - a.value)

  // Generate Summary
  const top3Sectors = sectorAllocation.slice(0, 3).map(s => s.name).join('、')
  const top3Stocks = stockExposure.slice(0, 3).map(s => s.name).join('、')
  
  const summary = `透视发现您重点布局了【${top3Sectors || '混合'}】等板块，前三大隐形重仓股为 ${top3Stocks || '暂无数据'}。`

  // Process Daily Attribution
  const topGainers = fundAttribution
    .filter(i => i.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)

  const topLosers = fundAttribution
    .filter(i => i.amount < 0)
    .sort((a, b) => a.amount - b.amount) // Most negative first
    .slice(0, 3)

  const sectorContribution = Object.entries(sectorDailyProfit)
    .map(([name, amount]) => ({ name, amount, code: '', returnRate: 0, percent: 0 }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 6)

  return {
    keywords,
    topStocks: topStocksSet,
    sectors: sectorsSet,
    summary,
    sectorAllocation,
    stockExposure,
    totalAssets,
    dailyAttribution: {
      topGainers,
      topLosers,
      sectorContribution,
      totalDailyProfit
    }
  }
}
