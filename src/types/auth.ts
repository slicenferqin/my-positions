export interface AuthUser {
  id: number
  email: string
  name: string
  role: 'user' | 'admin'
  status?: 'active' | 'disabled'
  lastLoginAt?: number | null
  createdAt?: number
}
