import type { FundEstimation } from './fund'

export interface WatchlistItem {
  id: number
  instrumentType: 'fund' | 'stock'
  market?: string
  code: string
  name: string
  sortOrder: number
  addedAt?: number | null
  updatedAt?: number | null
}

export interface WatchlistWithEstimation extends WatchlistItem {
  estimation: FundEstimation | null
  loading: boolean
  error: string | null
}
