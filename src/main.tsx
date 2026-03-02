import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../node_modules/@douyinfe/semi-ui/dist/css/semi.min.css'
import './index.css'
import './theme.css'
import './layout.css'
import { AuthProvider } from '@/context/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
