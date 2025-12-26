import { useState } from 'react'
import { useFunds } from '@/hooks'
import { PortfolioSummary, AddFundForm, FundTable, Toolbar, MarketIndices, ProfitChart, NewsFeed, PortfolioAnalysis } from '@/components'
import { isTradingTime } from '@/services'
import './App.css'

type Tab = 'positions' | 'news'

function App() {
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
  } = useFunds(60000)

  const tradingTime = isTradingTime()

  const handleAddFund = async (fund: {
    code: string
    name: string
    shares: number
    cost: number
  }) => {
    await addFund(fund)
    setShowAddForm(false)
  }

  const handleRemoveFund = (code: string) => {
    const fund = funds.find((f) => f.code === code)
    if (confirm(`确定要删除 ${fund?.name || code} 吗？`)) {
      removeFund(code)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="tab-switcher">
            <button 
              className={`tab-btn ${activeTab === 'positions' ? 'active' : ''}`}
              onClick={() => setActiveTab('positions')}
            >
              我的持仓
            </button>
            <button 
              className={`tab-btn ${activeTab === 'news' ? 'active' : ''}`}
              onClick={() => setActiveTab('news')}
            >
              7x24快讯
            </button>
          </div>
          {activeTab === 'positions' && (
            <span className={`trading-status ${tradingTime ? 'trading' : 'closed'}`}>
              {tradingTime ? '交易中' : '已休市'}
            </span>
          )}
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'positions' ? (
          <>
            <MarketIndices />
            {funds.length > 0 && <PortfolioSummary summary={summary} />}
            
            <div className="dashboard-content">
              <div className="dashboard-main">
                {funds.length > 0 && <ProfitChart snapshots={dailySnapshots} />}

                <Toolbar
                  onAddFund={() => setShowAddForm(true)}
                  onRefresh={refresh}
                  loading={loading}
                  fundCount={funds.length}
                  lastUpdate={lastUpdate}
                  onDataChange={() => {
                    reload()
                    refresh()
                  }}
                />

                {funds.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📊</div>
                    <h3>还没有添加基金</h3>
                    <p>点击"添加基金"开始追踪您的持仓，或通过"导入"恢复数据</p>
                    <button className="add-btn-large" onClick={() => setShowAddForm(true)}>
                      添加第一只基金
                    </button>
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
              </div>
              
              {funds.length > 0 && (
                <div className="dashboard-sidebar">
                  <PortfolioAnalysis funds={funds} />
                </div>
              )}
            </div>
          </>
        ) : (
          <NewsFeed funds={funds} />
        )}
      </main>

      <footer className="app-footer">
        数据来源: {activeTab === 'positions' ? '天天基金' : '财联社'} | {activeTab === 'positions' ? '估值仅供参考，以实际净值为准' : '资讯仅供参考，投资需谨慎'}
      </footer>

      {showAddForm && (
        <AddFundForm
          onAdd={handleAddFund}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </div>
  )
}

export default App
