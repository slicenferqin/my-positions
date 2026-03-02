import { useState } from 'react'
import { Card, Form, Input, Button, Tabs, Toast } from '@douyinfe/semi-ui'
import {
  IconMail,
  IconLock,
  IconUser,
  IconLineChartStroked,
  IconCloudStroked,
  IconBellStroked,
  IconAIStrokedLevel1,
  IconHelm,
} from '@douyinfe/semi-icons'
import { useAuth } from '@/context/AuthContext'

type Mode = 'login' | 'register'

export function AuthScreen() {
  const { login, register, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (values: any) => {
    setSubmitting(true)
    try {
      if (mode === 'login') {
        await login({ email: values.email, password: values.password })
      } else {
        await register({
          email: values.email,
          password: values.password,
          name: values.name || '投资者'
        })
      }
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '操作失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '24px'
    }}>
      <Card
        style={{
          width: '100%',
          maxWidth: '440px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
        }}
        bodyStyle={{ padding: '32px' }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ color: 'var(--semi-color-primary)', marginBottom: '8px', lineHeight: 1 }}>
            <IconLineChartStroked size="extra-large" />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 8px 0' }}>
            MyPositions
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--semi-color-text-2)', margin: 0 }}>
            智能投资组合追踪 · AI 情报分析
          </p>
        </div>

        {/* Tabs */}
        <Tabs
          type="button"
          activeKey={mode}
          onChange={(key) => setMode(key as Mode)}
          style={{ marginBottom: '24px' }}
        >
          <Tabs.TabPane tab="登录" itemKey="login" />
          <Tabs.TabPane tab="注册" itemKey="register" />
        </Tabs>

        {/* Form */}
        <Form
          onSubmit={handleSubmit}
          labelPosition="left"
          labelAlign="left"
        >
          {mode === 'register' && (
            <Form.Input
              field="name"
              label="昵称"
              placeholder="用于展示"
              prefix={<IconUser />}
              rules={[{ required: false }]}
            />
          )}

          <Form.Input
            field="email"
            label="邮箱"
            placeholder="you@example.com"
            prefix={<IconMail />}
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          />

          <Form.Input
            field="password"
            label="密码"
            type="password"
            placeholder="至少 6 位"
            prefix={<IconLock />}
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少 6 位' }
            ]}
          />

          <Button
            htmlType="submit"
            theme="solid"
            block
            size="large"
            loading={submitting || loading}
            style={{ marginTop: '24px' }}
          >
            {mode === 'login' ? '立即登录' : '创建账户'}
          </Button>
        </Form>

        {/* Features */}
        <div style={{
          marginTop: '32px',
          paddingTop: '24px',
          borderTop: '1px solid var(--semi-color-border)'
        }}>
          <div style={{ fontSize: '13px', color: 'var(--semi-color-text-2)', lineHeight: '1.8' }}>
            <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <IconCloudStroked />
              云端保存持仓 & 历史流水
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <IconBellStroked />
              实时财经快讯 Webhook 推送
            </div>
            <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <IconAIStrokedLevel1 />
              AI 智能分析新闻影响
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <IconHelm />
              Docker 一键部署，数据自主可控
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
