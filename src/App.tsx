import { useState } from 'react'
import { useFunds } from '@/hooks'
import { useAuth } from '@/context/AuthContext'
import { PortfolioSummary, AddFundForm, FundTable, Toolbar, MarketIndices, ProfitChart, NewsFeed, PortfolioAnalysis, AuthScreen } from '@/components'
import { isTradingTime } from '@/services'
import './App.css'

type Tab = 'positions' | 'news'

function App() {
  const { user, token, loading: authLoading, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('positions')
  const [showAddForm, setShowAddForm] = useState(false)
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

  const tradingTime = isTradingTime()

  const handleAddFund = async (fund: {
    code: string
    name?: string
    shares: number
    cost: number
  }) => {
    await addFund(fund)
    setShowAddForm(false)
  }

  const handleRemoveFund = async (fundId: number) => {
    const fund = funds.find((f) => f.id === fundId)
    if (fund && confirm(`确定要删除 ${fund.name} (${fund.code}) 吗？`)) {
      await removeFund(fundId)
    }
  }

  if (authLoading) {
    return (
      <div className="app auth-loading">
        <div className="loading-indicator">初始化...</div>
      </div>
    )
  }

  if (!user || !token) {
    return <AuthScreen />
  }

  return (
    <div className="app">
      <div className="grid-overlay" aria-hidden="true" />
      <div className="aurora aurora-left" aria-hidden="true" />
      <div className="aurora aurora-right" aria-hidden="true" />

      <header className="command-header">
        <div className="brand-identity">
          <p className="brand-eyebrow">NEO·QUANT OPS</p>
          <h1>MyPositions 控制台</h1>
        </div>

        <div className="header-controls">
          <div className="tab-dial">
            <button
              className={`dial-btn ${activeTab === 'positions' ? 'active' : ''}`}
              onClick={() => setActiveTab('positions')}
            >
              持仓矩阵
            </button>
            <button
              className={`dial-btn ${activeTab === 'news' ? 'active' : ''}`}
              onClick={() => setActiveTab('news')}
            >
              情报流
            </button>
          </div>
          {activeTab === 'positions' && (
            <span className={`market-pulse ${tradingTime ? 'live' : 'rest'}`}>
              <span className="pulse-dot" />
              {tradingTime ? '交易中 · Shanghai / Shenzhen' : '已休市 · Beta calm'}
            </span>
          )}
          <div className="user-chip">
            <div>
              <p className="user-label">当前席位</p>
              <strong>{user.name}</strong>
            </div>
            <button onClick={logout}>退出</button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'positions' ? (
          <>
            <section className="overview-grid">
              <article className="panel metrics-panel">
                <div className="panel-heading">
                  <span>指数雷达</span>
                  <small>实时拉链数据</small>
                </div>
                <MarketIndices />
              </article>

              <article className="panel summary-panel">
                <div className="panel-heading">
                  <span>组合脉搏</span>
                  <small>多维收益视角</small>
                </div>
                {funds.length > 0 ? (
                  <PortfolioSummary summary={summary} />
                ) : (
                  <div className="summary-empty">
                    <p>还没有任何自选基金</p>
                    <button onClick={() => setShowAddForm(true)}>立刻建仓</button>
                  </div>
                )}
              </article>

              <article className="panel action-panel">
                <div className="panel-heading">
                  <span>操作面板</span>
                  <small>导入、导出、刷新</small>
                </div>
                <Toolbar
                  onAddFund={() => setShowAddForm(true)}
                  onRefresh={refresh}
                  loading={loading}
                  fundCount={funds.length}
                  lastUpdate={lastUpdate}
                  onDataChange={async () => {
                    await reload()
                    await refresh()
                  }}
                />
                <p className="panel-subtext">最近同步：{lastUpdate ? lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '尚未刷新'}</p>
              </article>
            </section>

            {funds.length > 0 && (
              <section className="depth-grid">
                <article className="panel chart-panel">
                  <div className="panel-heading">
                    <span>盈亏轨迹</span>
                    <small>近 30 日变化</small>
                  </div>
                  <ProfitChart snapshots={dailySnapshots} />
                </article>
                <article className="panel analysis-panel">
                  <div className="panel-heading">
                    <span>资产解剖</span>
                    <small>仓位热力 & 贡献</small>
                  </div>
                  <PortfolioAnalysis funds={funds} />
                </article>
              </section>
            )}

            <section className="panel table-panel">
              {funds.length === 0 ? (
                <div className="void-state">
                  <div className="void-glow">◎</div>
                  <h3>空舱待命</h3>
                  <p>把自选基金加入矩阵，自动拉取估值、交易和情报。</p>
                  <button onClick={() => setShowAddForm(true)}>添加第一只基金</button>
                </div>
              ) : (
                <FundTable
                  funds={funds}
                  intradayData={intradayData}
                  onRemove={handleRemoveFund}
                  onTransaction={addTransaction}
                  onDeleteTransaction={removeTransaction}
                  onEdit={updateFund}
                />
              )}
            </section>
          </>
        ) : (
          <section className="panel news-panel">
            <div className="panel-heading">
              <span>情报流</span>
              <small>24/7 财联社推送</small>
            </div>
            <NewsFeed funds={funds} />
          </section>
        )}
      </main>

      <footer className="app-footer">
        <span>数据联结 · {activeTab === 'positions' ? '东方财富&天天基金' : '财联社&Claude Webhook'}</span>
        <span>Alpha build · 投资有风险</span>
      </footer>

      {showAddForm && (
        <AddFundForm onAdd={handleAddFund} onCancel={() => setShowAddForm(false)} />
      )}
    </div>
  )
}

export default App
