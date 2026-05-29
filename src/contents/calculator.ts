import type { CaseItem } from "./scraper"

export interface DecisionStats {
  expectedValuePercent: number
  expectedPayout: number
  baseWinRate: number
  strictWinRate: number
  avgProfit: number | null
  avgLoss: number | null
  riskRewardRatio: number | null
  medianReturn: number | null
  medianWinnerProfit: number | null
  worstCaseLossPercent: number
  lowestPrice: number | null
  highestPrice: number | null
  jackpotItemPrice: number | null
  jackpotWeightedAvgPrice: number | null
  jackpotThresholdPrice: number
  jackpotProfitFactor: number | null
  jackpotAvgCasesToOpen: number | null
  jackpotProbability: number | null
  payoutVariance: number | null
  payoutStdDev: number | null
  volatilityRating: "Low" | "Medium" | "High" | "Extreme" | null
  percentile90Floor: number | null
  totalProbability: number
  // New metrics
  sharpeRatio: number | null
  sortinoRatio: number | null
  tailWinRate5x: number | null
  costPerHit5x: number | null
  skewness: number | null
  kurtosis: number | null
  downstdDev: number | null
  conservativeScore: number
  jackpotScore: number
  reasonTag: string
  utilityAlert: string | null
}

export type BudgetVerdict = "Strong" | "Good" | "Risky" | "Avoid"

export interface BudgetAnalysis {
  bankroll: number
  maxOpens: number
  expectedSpend: number
  expectedGrossReturn: number
  expectedNet: number
  expectedROI: number
  chanceAtLeastOneBaseWin: number
  chanceAtLeastOneStrictWin: number
  bustRiskNoBaseWin: number
  bustRiskNoStrictWin: number
  decisionScore: number
  verdict: BudgetVerdict
  scoreBreakdown: {
    strictWin: number
    median: number
    floor: number
    budgetSafety: number
    jackpot: number
  }
}

type NormalizedItem = CaseItem & { weight: number }

const clampNonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0)

const formatPriceWeight = (items: CaseItem[]): NormalizedItem[] => {
  const rawPercentages = items.map((item) => {
    if (typeof item.percentage === "number" && Number.isFinite(item.percentage)) {
      return item.percentage
    }
    return 0
  })

  const interpretAsFraction = rawPercentages.every((value) => value <= 1)
  const normalized = items
    .map((item, index) => ({
      ...item,
      weight: clampNonNegative(rawPercentages[index] ?? 0) / (interpretAsFraction ? 1 : 100)
    }))
    .filter((item) => item.weight > 0)

  const totalWeight = normalized.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return []

  return normalized.map((item) => ({
    ...item,
    weight: item.weight / totalWeight
  }))
}

const weightedMedian = (items: NormalizedItem[]): number | null => {
  if (items.length === 0) return null

  const sorted = [...items].sort((left, right) => left.price - right.price)
  const threshold = 0.5
  let cumulative = 0

  for (const item of sorted) {
    cumulative += item.weight
    if (cumulative >= threshold) {
      return item.price
    }
  }

  return sorted[sorted.length - 1]?.price ?? null
}

const weightedQuantile = (items: NormalizedItem[], q: number): number | null => {
  if (items.length === 0) return null

  const sorted = [...items].sort((left, right) => left.price - right.price)
  const threshold = Math.max(0, Math.min(1, q))
  let cumulative = 0

  for (const item of sorted) {
    cumulative += item.weight
    if (cumulative >= threshold) {
      return item.price
    }
  }

  return sorted[sorted.length - 1]?.price ?? null
}

const sumWeight = (items: NormalizedItem[], predicate: (item: NormalizedItem) => boolean) =>
  items.reduce((sum, item) => sum + (predicate(item) ? item.weight : 0), 0)

const sumWeightedValue = (
  items: NormalizedItem[],
  predicate: (item: NormalizedItem) => boolean,
  mapper: (item: NormalizedItem) => number
) => items.reduce((sum, item) => sum + (predicate(item) ? mapper(item) * item.weight : 0), 0)

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const quantizeScore = (value: number) =>
  Math.round(Math.min(10, Math.max(0, value / 7)) * 10) / 10

// ============ Advanced Metrics ============

// Compute returns (payout - casePrice) for all items
const computeReturns = (items: NormalizedItem[], casePrice: number): number[] =>
  items.map((item) => item.price - casePrice)

// Sharpe Ratio: (mean return) / stddev
const computeSharpeRatio = (items: NormalizedItem[], casePrice: number): number | null => {
  if (items.length === 0) return null
  const returns = computeReturns(items, casePrice)
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
  const stdDev = Math.sqrt(variance)
  return stdDev > 0.001 ? mean / stdDev : 0
}

// Sortino Ratio: (mean return) / downside_stddev
const computeSortinoRatio = (items: NormalizedItem[], casePrice: number): number | null => {
  if (items.length === 0) return null
  const returns = computeReturns(items, casePrice)
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
  const downside = returns.filter((r) => r < 0)
  if (downside.length === 0) return mean > 0 ? 10 : 0 // all wins
  const dsVariance = downside.reduce((sum, r) => sum + r ** 2, 0) / downside.length
  const dsStdDev = Math.sqrt(dsVariance)
  return dsStdDev > 0.001 ? mean / dsStdDev : 0
}

// Downside StdDev (only negative returns)
const computeDownsideStdDev = (items: NormalizedItem[], casePrice: number): number | null => {
  if (items.length === 0) return null
  const returns = computeReturns(items, casePrice)
  const downside = returns.filter((r) => r < 0)
  if (downside.length === 0) return 0
  const dsVariance = downside.reduce((sum, r) => sum + r ** 2, 0) / downside.length
  return Math.sqrt(dsVariance)
}

// Tail Win Rate (multiplier): prob of payout >= m * casePrice
const computeTailWinRate = (items: NormalizedItem[], casePrice: number, multiplier: number): number => {
  const threshold = casePrice * multiplier
  return sumWeight(items, (item) => item.price >= threshold)
}

// Skewness
const computeSkewness = (items: NormalizedItem[], casePrice: number): number | null => {
  if (items.length === 0) return null
  const returns = computeReturns(items, casePrice)
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
  const stdDev = Math.sqrt(variance)
  if (stdDev < 0.001) return 0
  const thirdMoment = returns.reduce((sum, r) => sum + (r - mean) ** 3, 0) / returns.length
  return thirdMoment / (stdDev ** 3)
}

// Kurtosis (excess)
const computeKurtosis = (items: NormalizedItem[], casePrice: number): number | null => {
  if (items.length === 0) return null
  const returns = computeReturns(items, casePrice)
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
  const stdDev = Math.sqrt(variance)
  if (stdDev < 0.001) return 0
  const fourthMoment = returns.reduce((sum, r) => sum + (r - mean) ** 4, 0) / returns.length
  return fourthMoment / (stdDev ** 4) - 3 // excess kurtosis
}

export function calculateStats(items: CaseItem[], casePrice: number): DecisionStats {
  const safeCasePrice = Number.isFinite(casePrice) && casePrice > 0 ? casePrice : 0
  const normalizedItems = formatPriceWeight(items)

  if (safeCasePrice <= 0 || normalizedItems.length === 0) {
    return {
      expectedValuePercent: 0,
      expectedPayout: 0,
      baseWinRate: 0,
      strictWinRate: 0,
      avgProfit: null,
      avgLoss: null,
      riskRewardRatio: null,
      medianReturn: null,
      medianWinnerProfit: null,
      worstCaseLossPercent: 0,
      lowestPrice: null,
      highestPrice: null,
      jackpotItemPrice: null,
      jackpotWeightedAvgPrice: null,
      jackpotThresholdPrice: safeCasePrice * 5,
      jackpotProfitFactor: null,
      jackpotAvgCasesToOpen: null,
      jackpotProbability: null,
      totalProbability: 0
    }
  }

  const expectedPayout = normalizedItems.reduce((sum, item) => sum + item.price * item.weight, 0)
  const expectedValuePercent = (expectedPayout / safeCasePrice) * 100

  const payoutVariance = normalizedItems.reduce((sum, item) => {
    const diff = item.price - expectedPayout
    return sum + item.weight * diff * diff
  }, 0)
  const payoutStdDev = Math.sqrt(payoutVariance)
  const relativeStdDev = safeCasePrice > 0 ? payoutStdDev / safeCasePrice : 0
  const volatilityRating: DecisionStats["volatilityRating"] =
    relativeStdDev <= 0.5
      ? "Low"
      : relativeStdDev <= 1.0
        ? "Medium"
        : relativeStdDev <= 2.0
          ? "High"
          : "Extreme"
  const percentile90Floor = weightedQuantile(normalizedItems, 0.1)

  const baseWinRate = sumWeight(normalizedItems, (item) => item.price >= safeCasePrice)
  const strictThreshold = safeCasePrice * 1.1
  const strictWinRate = sumWeight(normalizedItems, (item) => item.price >= strictThreshold)

  const winProfit = sumWeightedValue(
    normalizedItems,
    (item) => item.price >= safeCasePrice,
    (item) => item.price - safeCasePrice
  )
  const lossAmount = sumWeightedValue(
    normalizedItems,
    (item) => item.price < safeCasePrice,
    (item) => safeCasePrice - item.price
  )

  const avgProfit = baseWinRate > 0 ? winProfit / baseWinRate : null
  const avgLoss =
    baseWinRate < 1 ? -(lossAmount / Math.max(1 - baseWinRate, Number.EPSILON)) : null

  const riskRewardRatio =
    avgProfit === null || avgLoss === null
      ? null
      : Math.abs(avgLoss) === 0
        ? avgProfit > 0
          ? Number.POSITIVE_INFINITY
          : null
        : avgProfit / Math.abs(avgLoss)

  const medianReturn = weightedMedian(normalizedItems)

  const winningItems = normalizedItems.filter((item) => item.price >= safeCasePrice)
  const winningTotalWeight = winningItems.reduce((sum, item) => sum + item.weight, 0)
  const normalizedWinningItems =
    winningTotalWeight > 0
      ? winningItems.map((item) => ({
          ...item,
          weight: item.weight / winningTotalWeight
        }))
      : []

  const medianWinnerPrice = weightedMedian(normalizedWinningItems)
  const medianWinnerProfit =
    medianWinnerPrice === null ? null : medianWinnerPrice - safeCasePrice

  const sortedByPrice = [...normalizedItems].sort((left, right) => left.price - right.price)
  const lowestPrice = sortedByPrice[0]?.price ?? null
  const highestPrice = sortedByPrice[sortedByPrice.length - 1]?.price ?? null
  const worstCaseLossPercent =
    lowestPrice === null
      ? 0
      : Math.max(0, ((safeCasePrice - lowestPrice) / safeCasePrice) * 100)

  const jackpotThresholdPrice = safeCasePrice * 5

  // Build jackpot pool using the raw `items` percentages (not the normalized weights)
  // Interpret percentages the same way as `formatPriceWeight`: if all values <= 1 treat as fractions, else divide by 100
  const rawPercentages = items.map((item) => {
    if (typeof item.percentage === "number" && Number.isFinite(item.percentage)) return item.percentage
    return 0
  })
  const interpretAsFraction = rawPercentages.every((value) => value <= 1)
  const probabilities = rawPercentages.map((value) => clampNonNegative(value) / (interpretAsFraction ? 1 : 100))

  let totalJackpotChance = 0
  let weightedJackpotSum = 0
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const p = probabilities[i] ?? 0
    if (Number.isFinite(item.price) && item.price >= jackpotThresholdPrice && p > 0) {
      totalJackpotChance += p
      weightedJackpotSum += item.price * p
    }
  }

  const jackpotItemPrice = null // keep max separate; not used for display per new rules
  const jackpotProbability = totalJackpotChance === 0 ? null : totalJackpotChance

  const jackpotWeightedAvgPrice = totalJackpotChance > 0 ? weightedJackpotSum / totalJackpotChance : null

  const jackpotProfitFactor =
    jackpotWeightedAvgPrice === null ? null : jackpotWeightedAvgPrice / safeCasePrice

  const jackpotAvgCasesToOpen =
    jackpotProbability && jackpotProbability > 0
      ? Math.ceil(1 / jackpotProbability)
      : null

  // ============ New Metrics ============
  const sharpeRatio = computeSharpeRatio(normalizedItems, safeCasePrice)
  const sortinoRatio = computeSortinoRatio(normalizedItems, safeCasePrice)
  const downstdDev = computeDownsideStdDev(normalizedItems, safeCasePrice)
  const tailWinRate5x = computeTailWinRate(normalizedItems, safeCasePrice, 5)
  const costPerHit5x = tailWinRate5x > 0 ? safeCasePrice / tailWinRate5x : null
  const skewness = computeSkewness(normalizedItems, safeCasePrice)
  const kurtosis = computeKurtosis(normalizedItems, safeCasePrice)

  // ============ Dual-Stream Scoring ============
  // Conservative stream: focus on safety & downside
  const floor90Normalized = clamp01(
    percentile90Floor !== null && safeCasePrice > 0
      ? (percentile90Floor / safeCasePrice + 0.5) / 1.5
      : 0
  )
  const sortinoNormalized = clamp01((sortinoRatio !== null ? sortinoRatio : 0) / 2)
  const evNormalized = clamp01((expectedValuePercent / 100 + 0.5) / 1.5)
  const downsideRisk = clamp01(1 - Math.max(0, worstCaseLossPercent / 100))

  const conservativeScore =
    0.3 * floor90Normalized +
    0.3 * sortinoNormalized +
    0.2 * evNormalized +
    0.2 * downsideRisk

  // Jackpot stream: focus on upside & tail opportunity
  const tailWinNormalized = clamp01(tailWinRate5x * 20) // 5% → 0.1, 10% → 0.2, etc
  const costEfficiency = costPerHit5x !== null ? clamp01(1 - Math.log(costPerHit5x / safeCasePrice + 1) / Math.log(10)) : 0
  const sharpNormalized = clamp01((sharpeRatio !== null ? sharpeRatio : 0) / 2)
  const skewBonus = clamp01(Math.max(0, skewness !== null ? skewness : 0) * 0.3)

  const jackpotScore =
    0.4 * tailWinNormalized +
    0.3 * costEfficiency +
    0.2 * sharpNormalized +
    0.1 * skewBonus

  // Risk penalties
  const kurtosisPenalty = clamp01(1 - Math.max(0, (kurtosis !== null ? kurtosis : 0) / 10) * 0.3)
  const skewPenalty = clamp01(1 - Math.max(0, -(skewness !== null ? skewness : 0) * 0.15))

  // Final composite score
  const baseComposite = Math.max(conservativeScore, jackpotScore) * 0.8 + 
    0.5 * (conservativeScore + jackpotScore) * 0.05 +
    (Math.abs(conservativeScore - jackpotScore) < 0.2 ? 0.15 : 0) // balance bonus
  const finalCompositeScore = baseComposite * kurtosisPenalty * skewPenalty

  // Reason tag
  let reasonTag = ""
  if (conservativeScore > jackpotScore + 0.15) {
    reasonTag =
      conservativeScore > 0.65
        ? "Strong Conservative Base"
        : conservativeScore > 0.4
          ? "Modest Conservative Play"
          : "Shaky Conservative"
  } else if (jackpotScore > conservativeScore + 0.15) {
    reasonTag =
      jackpotScore > 0.65
        ? "Jackpot Opportunity"
        : jackpotScore > 0.45
          ? "Jackpot Gamble"
          : "Risky Jackpot Attempt"
  } else {
    reasonTag = "Balanced Play"
  }

  // Alert if discrepancy
  let utilityAlert: string | null = null
  if (jackpotScore > 0.6 && percentile90Floor !== null && percentile90Floor < -safeCasePrice * 0.5) {
    utilityAlert = "⚠️ Jackpot draw but heavy downside risk"
  } else if (tailWinRate5x < 0.02 && jackpotScore > 0.5) {
    utilityAlert = "⚠️ Jackpot is rare; high variance expected"
  }

  return {
    expectedValuePercent,
    expectedPayout,
    baseWinRate,
    strictWinRate,
    avgProfit,
    avgLoss,
    riskRewardRatio,
    medianReturn,
    medianWinnerProfit,
    worstCaseLossPercent,
    lowestPrice,
    highestPrice,
    jackpotItemPrice,
    jackpotWeightedAvgPrice,
    jackpotThresholdPrice,
    jackpotProfitFactor,
    jackpotAvgCasesToOpen,
    jackpotProbability,
    payoutVariance,
    payoutStdDev,
    volatilityRating,
    percentile90Floor,
    totalProbability: normalizedItems.reduce((sum, item) => sum + item.weight, 0),
    sharpeRatio,
    sortinoRatio,
    tailWinRate5x,
    costPerHit5x,
    skewness,
    kurtosis,
    downstdDev,
    conservativeScore,
    jackpotScore,
    reasonTag,
    utilityAlert
  }
}

export function analyzeBudget(
  stats: DecisionStats | null,
  casePrice: number,
  bankroll: number
): BudgetAnalysis | null {
  const safeBankroll = Number.isFinite(bankroll) && bankroll > 0 ? bankroll : 0
  const safeCasePrice = Number.isFinite(casePrice) && casePrice > 0 ? casePrice : 0

  if (!stats || safeBankroll <= 0 || safeCasePrice <= 0) return null

  const maxOpens = Math.floor(safeBankroll / safeCasePrice)
  if (maxOpens <= 0) {
    return {
      bankroll: safeBankroll,
      maxOpens: 0,
      expectedSpend: 0,
      expectedGrossReturn: 0,
      expectedNet: 0,
      expectedROI: 0,
      chanceAtLeastOneBaseWin: 0,
      chanceAtLeastOneStrictWin: 0,
      bustRiskNoBaseWin: 1,
      bustRiskNoStrictWin: 1,
      decisionScore: 0,
      verdict: "Avoid",
      scoreBreakdown: {
        strictWin: 0,
        median: 0,
        floor: 0,
        budgetSafety: 0,
        jackpot: 0
      }
    }
  }

  const baseMissChance = clamp01(1 - stats.baseWinRate)
  const strictMissChance = clamp01(1 - stats.strictWinRate)
  const bustRiskNoBaseWin = Math.pow(baseMissChance, maxOpens)
  const bustRiskNoStrictWin = Math.pow(strictMissChance, maxOpens)
  const chanceAtLeastOneBaseWin = 1 - bustRiskNoBaseWin
  const chanceAtLeastOneStrictWin = 1 - bustRiskNoStrictWin

  const expectedSpend = maxOpens * safeCasePrice
  const expectedGrossReturn = maxOpens * stats.expectedPayout
  const expectedNet = expectedGrossReturn - expectedSpend
  const expectedROI = expectedSpend > 0 ? (expectedNet / expectedSpend) * 100 : 0

  const medianRatio =
    stats.medianReturn !== null && safeCasePrice > 0
      ? stats.medianReturn / safeCasePrice
      : 0
  const floorSafety = clamp01(1 - stats.worstCaseLossPercent / 100)
  const strictStrength = clamp01((stats.strictWinRate - 0.02) / 0.18)
  const medianStrength = clamp01((medianRatio - 0.3) / 0.65)
  const budgetSafety = clamp01((chanceAtLeastOneStrictWin - 0.1) / 0.9)
  const jackpotBoost = clamp01((stats.jackpotProbability ?? 0) * 12)

  const rawScore =
    strictStrength * 18 +
    medianStrength * 34 +
    floorSafety * 24 +
    budgetSafety * 18 +
    jackpotBoost * 6

  const decisionScore = quantizeScore(rawScore)

  const verdict: BudgetVerdict =
    decisionScore >= 8
      ? "Strong"
      : decisionScore >= 6
        ? "Good"
        : decisionScore >= 4
          ? "Risky"
          : "Avoid"

  return {
    bankroll: safeBankroll,
    maxOpens,
    expectedSpend,
    expectedGrossReturn,
    expectedNet,
    expectedROI,
    chanceAtLeastOneBaseWin,
    chanceAtLeastOneStrictWin,
    bustRiskNoBaseWin,
    bustRiskNoStrictWin,
    decisionScore,
    verdict,
    scoreBreakdown: {
      strictWin: Math.round((strictStrength * 18 / 7) * 10) / 10,
      median: Math.round((medianStrength * 34 / 7) * 10) / 10,
      floor: Math.round((floorSafety * 24 / 7) * 10) / 10,
      budgetSafety: Math.round((budgetSafety * 18 / 7) * 10) / 10,
      jackpot: Math.round((jackpotBoost * 6 / 7) * 10) / 10
    }
  }
}
