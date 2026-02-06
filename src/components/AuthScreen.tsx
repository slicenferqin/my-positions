import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import './AuthScreen.css'

type Mode = 'login' | 'register'

export function AuthScreen() {
  const { login, register, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email || !password) {
      setError('请输入完整的账号和密码')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      if (mode === 'login') {
        await login({ email, password })
      } else {
        await register({ email, password, name })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <div className="auth-header">
          <h1>My Positions</h1>
          <p>智能基金看板 · 实时估值 · Webhook 推送</p>
        </div>

        <div className="auth-toggle">
          <button
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
            disabled={submitting}
          >
            登录
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
            disabled={submitting}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label>昵称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="用于展示" />
            </div>
          )}
          <div className="form-group">
            <label>邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit" disabled={submitting || loading}>
            {submitting ? '处理中...' : mode === 'login' ? '立即登录' : '创建账户'}
          </button>
        </form>

        <ul className="auth-features">
          <li>📊 云端保存持仓 & 历史流水</li>
          <li>🔔 后台实时拉取财经快讯并推送 Webhook</li>
          <li>🧠 本地 Claude AI 快速解读事件影响</li>
          <li>⚙️ Docker 一键部署，随时掌控账户</li>
        </ul>
      </div>
    </div>
  )
}
