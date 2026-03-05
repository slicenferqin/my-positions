import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tabs, Avatar, Dropdown, Button, Card } from '@douyinfe/semi-ui'
import {
  IconUser,
  IconExit,
  IconLineChartStroked,
  IconPlusCircleStroked,
} from '@douyinfe/semi-icons'
import { useFunds, useWatchlist } from '@/hooks'
import { useAuth } from '@/context/AuthContext'
import {
  AddFundForm,
  AddWatchlistForm,
  FundTable,
  WatchlistTable,
  NewsFeed,
  AdminConsole,
  AuthScreen,
  PortfolioKpiBar,
  ActionCenter,
  MarketPulseCompact,
  AlertList,
  InsightSummary,
} from '@/components'
import { parseEstimation } from '@/services'
import {
  fetchDashboardOverview,
  fetchDashboardPreferences,
  updateDashboardPreferences,
} from '@/services/api'
import type { DashboardOverview, DashboardPreference } from '@/types/dashboard'
import './components/home/HomeDashboard.css'

type QuickFilter = 'all' | 'gainers' | 'losers' | 'heavy'
type TableSortKey = 'change' | 'value' | 'profit' | 'today'

const SORT_KEYS: TableSortKey[] = ['change', 'value', 'profit', 'today']

function normalizeTableSort(
  tableSort: DashboardPreference['tableSort'] | undefined
): { key: TableSortKey | null; direction: 'asc' | 'desc' } {
  const key = tableSort?.key
  const direction = tableSort?.direction === 'asc' ? 'asc' : 'desc'

  if (!key || !SORT_KEYS.includes(key as TableSortKey)) {
    return {
      key: null,
      direction,
    }
  }

  return {
    key: key as TableSortKey,
    direction,
  }
}

const DEFAULT_PREFS: DashboardPreference = {
  cardOrder: ['kpi', 'actions', 'market', 'alerts', 'insight'],
  collapsedPanels: {
    profitChart: true,
    portfolioAnalysis: true,
  },
  tableSort: {
    key: 'today',
    direction: 'desc',
  },
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

function buildLocalOverview(
  funds: ReturnType<typeof useFunds>['funds'],
  summary: ReturnType<typeof useFunds>['summary'],
  lastUpdate: Date | null
): DashboardOverview {
  const totalValue = summary.totalValue || 0
  const movers = funds.map((fund) => {
    const parsed = fund.estimation ? parseEstimation(fund.estimation) : null
    const currentValue = parsed ? fund.shares * parsed.estimatedNav : 0
    const lastValue = parsed ? fund.shares * parsed.lastNav : 0
    const todayProfit = parsed ? currentValue - lastValue : 0
    const allocation = totalValue > 0 ? (currentValue / totalValue) * 100 : 0
    return {
      fundCode: fund.code,
      name: fund.name,
      fundId: fund.id,
      todayProfit,
      changePercent: parsed?.changePercent ?? 0,
      allocation,
      value: currentValue,
    }
  })

  const maxAllocation = movers.reduce((max, item) => Math.max(max, item.allocation), 0)
  const maxVolatility = movers.reduce((max, item) => Math.max(max, Math.abs(item.changePercent)), 0)
  const stale = !!lastUpdate && ((Date.now() - lastUpdate.getTime()) / 1000) > 180
  const maxAgeSeconds = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : 0

  const concentrationRisk = clamp((maxAllocation - 20) * 4)
  const volatilityRisk = clamp(maxVolatility * 30)
  const freshnessRisk = stale ? 100 : 10
  const riskScore = clamp(concentrationRisk * 0.45 + volatilityRisk * 0.35 + freshnessRisk * 0.2)

  let riskLevel: 'low' | 'medium' | 'high' = 'low'
  if (riskScore > 66) riskLevel = 'high'
  else if (riskScore > 33) riskLevel = 'medium'

  const alerts: DashboardOverview['alerts'] = []
  const topLoser = [...movers].sort((a, b) => a.todayProfit - b.todayProfit)[0]
  if (topLoser && topLoser.todayProfit < 0) {
    alerts.push({
      id: `loser-${topLoser.fundCode}`,
      type: 'drawdown',
      severity: topLoser.todayProfit < -100 ? 'high' : 'medium',
      title: `${topLoser.name} 今日拖累最大`,
      message: `今日贡献 ${topLoser.todayProfit.toFixed(2)} 元，请关注盘中波动。`,
      fundCode: topLoser.fundCode,
    })
  }

  const heavy = [...movers].sort((a, b) => b.allocation - a.allocation)[0]
  if (heavy && heavy.allocation >= 35) {
    alerts.push({
      id: `heavy-${heavy.fundCode}`,
      type: 'concentration',
      severity: 'medium',
      title: `${heavy.name} 仓位集中`,
      message: `当前仓位占比 ${heavy.allocation.toFixed(1)}%，建议关注分散风险。`,
      fundCode: heavy.fundCode,
    })
  }

  if (stale) {
    alerts.push({
      id: 'stale-data',
      type: 'stale',
      severity: 'high',
      title: '估值数据可能过期',
      message: `距离最近刷新已 ${Math.floor(maxAgeSeconds / 60)} 分钟，建议立即刷新估值。`,
    })
  }

  if (funds.length === 0) {
    alerts.push({
      id: 'empty-fund',
      type: 'empty',
      severity: 'low',
      title: '当前无持仓',
      message: '添加 1-2 只核心仓位即可启用完整决策视图。',
    })
  }

  return {
    generatedAt: Date.now(),
    kpi: {
      fundCount: summary.fundCount,
      totalCost: summary.totalCost,
      totalValue: summary.totalValue,
      totalProfit: summary.totalProfit,
      totalProfitPercent: summary.totalProfitPercent,
      todayProfit: summary.todayProfit,
      todayProfitPercent: summary.todayProfitPercent,
      alertCount: alerts.length,
    },
    riskScore: {
      score: Number(riskScore.toFixed(1)),
      level: riskLevel,
      concentration: Number(concentrationRisk.toFixed(1)),
      volatility: Number(volatilityRisk.toFixed(1)),
      freshness: Number(freshnessRisk.toFixed(1)),
    },
    alerts: alerts.slice(0, 3),
    topMovers: {
      gainers: [...movers].filter((item) => item.todayProfit > 0).sort((a, b) => b.todayProfit - a.todayProfit).slice(0, 3),
      losers: [...movers].filter((item) => item.todayProfit < 0).sort((a, b) => a.todayProfit - b.todayProfit).slice(0, 3),
    },
    marketPulse: [],
    staleState: {
      stale,
      maxAgeSeconds,
      latestUpdateTime: lastUpdate ? lastUpdate.toISOString() : '',
    },
    recommendations: alerts.slice(0, 2).map((item) => item.message),
  }
}

function App() {
  const { user, token, loading: authLoading, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<string>('portfolio')
  const [assetView, setAssetView] = useState<'holding' | 'watchlist'>('holding')
  const [assetModal, setAssetModal] = useState<'none' | 'holding' | 'watchlist'>('none')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [dashboardOverview, setDashboardOverview] = useState<DashboardOverview | null>(null)
  const [dashboardPrefs, setDashboardPrefs] = useState<DashboardPreference>(DEFAULT_PREFS)
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>(DEFAULT_PREFS.collapsedPanels)
  const [tableSort, setTableSort] = useState<{ key: TableSortKey | null; direction: 'asc' | 'desc' }>(
    normalizeTableSort(DEFAULT_PREFS.tableSort)
  )

  const {
    funds,
    summary,
    dailySnapshots,
    loading,
    lastUpdate,
    intradayData,
    refresh,
    reload,
    addFund,
    updateFund,
    removeFund,
    addTransaction,
    removeTransaction,
  } = useFunds(token, 60000)

  const {
    items: watchlistItems,
    loading: watchlistLoading,
    refresh: refreshWatchlist,
    reload: reloadWatchlist,
    addItem: addWatchlistItem,
    removeItem: removeWatchlistItem,
    convertToHolding,
  } = useWatchlist(token, 60000)

  const loadDashboardOverview = useCallback(async () => {
    if (!token) return
    try {
      const overviewResponse = await fetchDashboardOverview(token)
      setDashboardOverview(overviewResponse.overview)
    } catch (error) {
      console.warn('Load dashboard overview failed, using local overview.', error)
    }
  }, [token])

  const loadDashboardPreferencesState = useCallback(async () => {
    if (!token) return
    try {
      const prefResponse = await fetchDashboardPreferences(token)
      setDashboardPrefs(prefResponse.preferences)
      setCollapsedPanels({
        ...DEFAULT_PREFS.collapsedPanels,
        ...(prefResponse.preferences.collapsedPanels || {}),
      })
      setTableSort(normalizeTableSort(prefResponse.preferences.tableSort))
    } catch (error) {
      console.warn('Load dashboard preferences failed, using defaults.', error)
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    loadDashboardPreferencesState()
    loadDashboardOverview()
  }, [token, loadDashboardPreferencesState, loadDashboardOverview])

  useEffect(() => {
    if (token && activeTab === 'portfolio') {
      loadDashboardOverview()
    }
  }, [activeTab, token, funds.length, lastUpdate?.getTime(), loadDashboardOverview])

  const openAddFundModal = useCallback(() => {
    setAssetModal('holding')
  }, [])

  const openAddWatchlistModal = useCallback(() => {
    setAssetModal('watchlist')
  }, [])

  const closeAssetModal = useCallback(() => {
    setAssetModal('none')
  }, [])

  useEffect(() => {
    if (activeTab !== 'portfolio') {
      setAssetModal('none')
    }
  }, [activeTab])

  const handleAddFund = async (fund: { code: string; name?: string; shares: number; cost: number; instrumentType?: 'fund' | 'stock' }) => {
    await addFund(fund)
    setAssetModal('none')
  }

  const handleAddWatchlist = async (payload: { code: string; name?: string; instrumentType?: 'fund' | 'stock' }) => {
    await addWatchlistItem(payload)
    await reloadWatchlist()
    await refreshWatchlist()
    setAssetModal('none')
    setAssetView('watchlist')
  }

  const handleRemoveFund = async (fundId: number) => {
    const fund = funds.find((item) => item.id === fundId)
    if (fund && confirm(`确定要删除持仓 ${fund.name} (${fund.code}) 吗？`)) {
      await removeFund(fundId)
    }
  }

  const handleRemoveWatchlist = async (itemId: number) => {
    const item = watchlistItems.find((entry) => entry.id === itemId)
    if (item && confirm(`确定要删除自选 ${item.name} (${item.code}) 吗？`)) {
      await removeWatchlistItem(itemId)
    }
  }

  const handleConvertWatchlist = async (itemId: number, payload: { shares: number; cost: number }) => {
    await convertToHolding(itemId, payload)
    await reload()
    await refresh()
    await loadDashboardOverview()
    setAssetView('holding')
  }

  const localOverview = useMemo(() => buildLocalOverview(funds, summary, lastUpdate), [funds, summary, lastUpdate])
  const overview = dashboardOverview ?? localOverview

  const secondaryCardOrder = useMemo(() => {
    const preferredOrder = dashboardPrefs.cardOrder || DEFAULT_PREFS.cardOrder
    const cards = ['actions', 'market', 'alerts']
    return cards.sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left)
      const rightIndex = preferredOrder.indexOf(right)
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex)
    })
  }, [dashboardPrefs.cardOrder])

  const filteredFunds = useMemo(() => {
    if (quickFilter === 'all') return funds

    const totalValue = summary.totalValue || 0
    return funds.filter((fund) => {
      const parsed = fund.estimation ? parseEstimation(fund.estimation) : null
      const currentValue = parsed ? fund.shares * parsed.estimatedNav : 0
      const lastValue = parsed ? fund.shares * parsed.lastNav : 0
      const todayProfit = currentValue - lastValue
      const allocation = totalValue > 0 ? (currentValue / totalValue) * 100 : 0

      if (quickFilter === 'gainers') return todayProfit > 0
      if (quickFilter === 'losers') return todayProfit < 0
      if (quickFilter === 'heavy') return allocation >= 35
      return true
    })
  }, [funds, quickFilter, summary.totalValue])

  const trackedAssetCount = funds.length + watchlistItems.length

  const syncPreference = async (payload: Partial<DashboardPreference>) => {
    if (!token) return
    try {
      const response = await updateDashboardPreferences(token, payload)
      setDashboardPrefs(response.preferences)

      if (payload.collapsedPanels) {
        setCollapsedPanels({
          ...DEFAULT_PREFS.collapsedPanels,
          ...(response.preferences.collapsedPanels || {}),
        })
      }

      if (payload.tableSort) {
        setTableSort(normalizeTableSort(response.preferences.tableSort))
      }
    } catch (error) {
      console.warn('Save preferences failed:', error)
    }
  }

  const handleTogglePanel = (panel: 'profitChart' | 'portfolioAnalysis') => {
    const next = {
      ...collapsedPanels,
      [panel]: !collapsedPanels[panel],
    }
    setCollapsedPanels(next)
    syncPreference({ collapsedPanels: next })
  }

  const handleTableSortChange = (next: { key: TableSortKey | null; direction: 'asc' | 'desc' }) => {
    setTableSort(next)
    if (!next.key) return
    syncPreference({
      tableSort: {
        key: next.key,
        direction: next.direction,
      },
    })
  }

  const handleNavigateFund = (fundCode: string) => {
    setQuickFilter('all')
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-fund-code="${fundCode}"]`) as HTMLElement | null
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.classList.add('fund-row-highlight')
        setTimeout(() => target.classList.remove('fund-row-highlight'), 1500)
      }
    })
  }

  const renderTabs = (className?: string) => (
    <Tabs
      className={className}
      type="button"
      activeKey={activeTab}
      onChange={(key) => setActiveTab(key as string)}
    >
      <Tabs.TabPane tab="持仓概览" itemKey="portfolio" />
      <Tabs.TabPane tab="智能情报" itemKey="intelligence" />
      {user?.role === 'admin' && <Tabs.TabPane tab="系统后台" itemKey="admin" />}
    </Tabs>
  )

  const renderSecondaryCard = (card: string) => {
    if (card === 'actions') {
      return (
        <ActionCenter
          token={token!}
          assetCount={trackedAssetCount}
          fundCount={funds.length}
          loading={loading || watchlistLoading}
          lastUpdate={lastUpdate}
          recommendations={overview.recommendations}
          onAddFund={openAddFundModal}
          onAddWatchlist={openAddWatchlistModal}
          onRefresh={async () => {
            await Promise.all([refresh(), refreshWatchlist()])
          }}
          onDataChange={async () => {
            await reload()
            await reloadWatchlist()
            await Promise.all([refresh(), refreshWatchlist()])
            await loadDashboardOverview()
          }}
        />
      )
    }

    if (card === 'market') {
      return <MarketPulseCompact />
    }

    if (card === 'alerts') {
      return <AlertList alerts={overview.alerts} onNavigateFund={handleNavigateFund} />
    }

    return null
  }

  if (authLoading) {
    return (
      <div className="app-container loading-container">
        <div>初始化中...</div>
      </div>
    )
  }

  if (!user || !token) {
    return <AuthScreen />
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-header-main">
          <div className="app-header-left">
            <div className="app-logo">
              <IconLineChartStroked size="large" />
              <span>MyPositions</span>
            </div>
            <div className="app-header-desktop-tabs">
              {renderTabs('app-tabs-desktop')}
            </div>
          </div>

          <div className="app-header-right">
            <div className="market-pulse">
              {(overview.marketPulse || []).slice(0, 2).map((item) => (
                <div key={item.code} className="market-pulse-item">
                  <span className="market-pulse-name">{item.name.replace('指数', '')}</span>
                  <span className={`market-pulse-value ${item.changePercent >= 0 ? 'rise' : 'fall'}`}>
                    {item.price.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>

            <Dropdown
              trigger="click"
              position="bottomRight"
              render={(
                <Dropdown.Menu>
                  <Dropdown.Item icon={<IconUser />}>{user.email}</Dropdown.Item>
                  <Dropdown.Divider />
                  <Dropdown.Item icon={<IconExit />} onClick={logout}>
                    退出登录
                  </Dropdown.Item>
                </Dropdown.Menu>
              )}
            >
              <div className="user-info">
                <Avatar size="small" color="blue">
                  {user.name.charAt(0)}
                </Avatar>
                <span className="user-name">{user.name}</span>
              </div>
            </Dropdown>
          </div>
        </div>

        <div className="app-header-mobile-tabs">
          {renderTabs('app-tabs-mobile')}
        </div>
      </header>

      <main className="app-content">
        <div className="tab-content">
          {activeTab === 'portfolio' ? (
            <div className="home-dashboard">
              <PortfolioKpiBar summary={summary} overview={overview} lastUpdate={lastUpdate} />

              <div className="home-main-grid">
                <section className="home-primary">
                  <Card>
                    <div className="asset-view-bar">
                      <div className="asset-view-toggle">
                        <button
                          className={`asset-view-chip ${assetView === 'holding' ? 'active' : ''}`}
                          onClick={() => setAssetView('holding')}
                        >
                          持仓
                        </button>
                        <button
                          className={`asset-view-chip ${assetView === 'watchlist' ? 'active' : ''}`}
                          onClick={() => setAssetView('watchlist')}
                        >
                          自选
                        </button>
                      </div>
                      {assetView === 'holding' ? (
                        <span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>
                          当前显示 {filteredFunds.length}/{funds.length}
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--semi-color-text-2)' }}>
                          当前显示 {watchlistItems.length} 条自选
                        </span>
                      )}
                    </div>

                    {assetView === 'holding' && (
                      <div className="fund-filter-bar">
                        <div className="fund-filter-chips">
                          {[
                            ['all', '全部持仓'],
                            ['gainers', '今日上涨'],
                            ['losers', '今日下跌'],
                            ['heavy', '重仓风险'],
                          ].map(([key, label]) => (
                            <button
                              key={key}
                              className={`fund-filter-chip ${quickFilter === key ? 'active' : ''}`}
                              onClick={() => setQuickFilter(key as QuickFilter)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>

                  {assetView === 'holding' ? (
                    funds.length === 0 ? (
                      <Card className="home-empty-card">
                        <div className="home-empty-content">
                          <div className="home-empty-icon">
                            <IconPlusCircleStroked size="extra-large" />
                          </div>
                          <h3>空仓待命</h3>
                          <p>先添加 1-2 只核心持仓，启动您的盘中决策工作台</p>
                          <Button theme="solid" style={{ marginTop: '16px' }} onClick={openAddFundModal}>
                            添加第一条持仓
                          </Button>
                        </div>
                      </Card>
                    ) : (
                      <div className="fund-table-shell">
                        <FundTable
                          funds={filteredFunds}
                          intradayData={intradayData}
                          initialSort={tableSort}
                          onSortChange={handleTableSortChange}
                          onRemove={handleRemoveFund}
                          onTransaction={addTransaction}
                          onDeleteTransaction={removeTransaction}
                          onEdit={updateFund}
                        />
                      </div>
                    )
                  ) : (
                    watchlistItems.length === 0 ? (
                      <Card className="home-empty-card">
                        <div className="home-empty-content">
                          <div className="home-empty-icon">
                            <IconPlusCircleStroked size="extra-large" />
                          </div>
                          <h3>暂无自选</h3>
                          <p>把关注的基金或股票先加入自选，合适时再一键建仓</p>
                          <Button theme="solid" style={{ marginTop: '16px' }} onClick={openAddWatchlistModal}>
                            添加第一条自选
                          </Button>
                        </div>
                      </Card>
                    ) : (
                      <div className="fund-table-shell">
                        <WatchlistTable
                          items={watchlistItems}
                          onRemove={handleRemoveWatchlist}
                          onConvert={handleConvertWatchlist}
                        />
                      </div>
                    )
                  )}
                </section>

                <aside className="home-secondary">
                  {secondaryCardOrder.map((card) => (
                    <div key={card} className={`secondary-slot secondary-slot-${card}`}>
                      {renderSecondaryCard(card)}
                    </div>
                  ))}
                </aside>
              </div>

              {funds.length > 0 && (
                <InsightSummary
                  snapshots={dailySnapshots}
                  funds={funds}
                  overview={overview}
                  collapsedPanels={collapsedPanels}
                  onTogglePanel={handleTogglePanel}
                />
              )}
            </div>
          ) : activeTab === 'intelligence' ? (
            <NewsFeed funds={funds} />
          ) : user.role === 'admin' ? (
            <AdminConsole token={token} />
          ) : (
            <Card>
              <p>无权限访问该页面</p>
            </Card>
          )}
        </div>
      </main>

      {assetModal === 'holding' && (
        <AddFundForm onAdd={handleAddFund} onCancel={closeAssetModal} />
      )}
      {assetModal === 'watchlist' && (
        <AddWatchlistForm onAdd={handleAddWatchlist} onCancel={closeAssetModal} />
      )}
    </div>
  )
}

export default App
