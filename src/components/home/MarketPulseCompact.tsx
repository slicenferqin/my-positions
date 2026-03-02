import { MarketIndices } from '@/components/MarketIndices'

interface MarketPulseCompactProps {
  refreshInterval?: number
}

export function MarketPulseCompact({ refreshInterval = 30000 }: MarketPulseCompactProps) {
  return <MarketIndices mode="compact" title="市场脉搏" refreshInterval={refreshInterval} />
}
