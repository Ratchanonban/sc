import React from "react"

import type { BudgetAnalysis, DecisionStats } from "../calculator"

interface DashboardProps {
  stats: DecisionStats | null
  casePrice: number
  budget: number
  budgetAnalysis: BudgetAnalysis | null
  onBudgetChange: (value: number) => void
}

const money = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A"
  return Math.abs(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  })
}

const signedMoney = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A"
  const isNegative = value < 0
  return `${isNegative ? "-" : "+"}${money(value)}`
}

const percent = (value: number | null | undefined, digits = 3) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A"
  return `${(value * 100).toFixed(digits)}%`
}

const Section = ({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) => (
  <section className="sc-section">
    <div className="sc-section__title">{title}</div>
    <div className="sc-section__body">{children}</div>
  </section>
)

const Row = ({
  label,
  value,
  accent = "neutral",
  large = false,
  note,
  stacked = false
}: {
  label: React.ReactNode
  value: React.ReactNode
  accent?: "neutral" | "good" | "bad" | "gold" | "bright"
  large?: boolean
  note?: React.ReactNode
  stacked?: boolean
}) => (
  <div className={`sc-row sc-row--${accent} ${large ? "sc-row--large" : ""}`}>
    <span className="sc-row__label">{label}</span>
    <span className={`sc-row__value ${stacked ? "sc-row__value--stacked" : ""}`}>
      <span className="sc-row__valueMain">{value}</span>
      {note ? <small>{note}</small> : null}
    </span>
  </div>
)

export const Dashboard: React.FC<DashboardProps> = ({
  stats,
  casePrice,
  budget,
  budgetAnalysis,
  onBudgetChange
}) => {
  const hasCaseStats = Boolean(stats && casePrice > 0)
  const floorLossValue = hasCaseStats && stats?.lowestPrice !== null ? stats.lowestPrice - casePrice : null
  const jackpotProfitFactor = hasCaseStats ? stats?.jackpotProfitFactor ?? null : null
  const jackpotCases = hasCaseStats ? stats?.jackpotAvgCasesToOpen ?? null : null
  const jackpotChance = hasCaseStats ? stats?.jackpotProbability ?? null : null
  const jackpotWeightedAvgPrice = hasCaseStats ? stats?.jackpotWeightedAvgPrice ?? null : null
  const jackpotTotalCost = hasCaseStats && jackpotCases !== null ? jackpotCases * casePrice : null

  const reasonTag = hasCaseStats ? stats?.reasonTag : null
  const utilityAlert = hasCaseStats ? stats?.utilityAlert : null
  const conservativeScore = hasCaseStats ? stats?.conservativeScore ?? 0 : 0
  const jackpotScore = hasCaseStats ? stats?.jackpotScore ?? 0 : 0

  return (
    <>
      <aside className="sc-mini sc-left" aria-label="Cursor quick stats - left">
        {hasCaseStats && reasonTag && (
          <Section title="PLAY STRATEGY">
            <div className="sc-strategy-tag">
              <span className="sc-strategy-tag__text">{reasonTag}</span>
            </div>
            {utilityAlert && (
              <div className="sc-strategy-alert">
                {utilityAlert}
              </div>
            )}
          </Section>
        )}
        <Section title="BUDGET CHECK">
          <div className="sc-budget">
          <label className="sc-budget__label" htmlFor="sc-budget-input">
            MANUAL BUDGET
          </label>
          <input
            id="sc-budget-input"
            className="sc-budget__input"
            type="number"
            min="0"
            step="0.01"
            value={Number.isFinite(budget) ? budget : 0}
            onChange={(event) => onBudgetChange(Number.parseFloat(event.target.value || "0"))}
          />
        </div>
        {hasCaseStats ? (
          <>
            <Row label="CASE PRICE" value={money(casePrice)} />
            <Row label="MAX OPENS" value={budgetAnalysis?.maxOpens ?? 0} />
            <Row
              label="1+ WIN CHANCE"
              value={budgetAnalysis ? percent(budgetAnalysis.chanceAtLeastOneBaseWin, 3) : "N/A"}
              accent="good"
              large
            />
            <Row
              label="EXPECTED NET"
              value={budgetAnalysis ? signedMoney(budgetAnalysis.expectedNet) : "N/A"}
              accent={budgetAnalysis && budgetAnalysis.expectedNet >= 0 ? "good" : "bad"}
            />
            <Row
              label="DECISION"
              value={budgetAnalysis ? budgetAnalysis.verdict : "N/A"}
              accent={
                budgetAnalysis?.verdict === "Best Value"
                  ? "good"
                  : budgetAnalysis?.verdict === "Balanced"
                    ? "gold"
                    : budgetAnalysis?.verdict === "High Risk"
                      ? "bad"
                      : "neutral"
              }
              large
            />
            <Row
              label="DECISION SCORE"
              value={budgetAnalysis ? `${budgetAnalysis.decisionScore.toFixed(1)}/10` : "N/A"}
              accent={budgetAnalysis?.verdict === "Best Value" ? "good" : "neutral"}
            />
            <div className="sc-scorehint">
              <span>WR {budgetAnalysis ? `+${budgetAnalysis.scoreBreakdown.strictWin}` : "+0"}</span>
              <span>MED {budgetAnalysis ? `+${budgetAnalysis.scoreBreakdown.median}` : "+0"}</span>
              <span>FLR {budgetAnalysis ? `+${budgetAnalysis.scoreBreakdown.floor}` : "+0"}</span>
              <span>BUD {budgetAnalysis ? `+${budgetAnalysis.scoreBreakdown.budgetSafety}` : "+0"}</span>
              <span>JCK {budgetAnalysis ? `+${budgetAnalysis.scoreBreakdown.jackpot}` : "+0"}</span>
            </div>
          </>
        ) : (
          <div className="sc-scanner__current">
            No case stats detected yet. Open a case page and the overlay will populate automatically.
          </div>
        )}
          </Section>
        </aside>

      {hasCaseStats ? (
        <aside className="sc-mini sc-right" aria-label="Cursor quick stats - right">
          <Section title="RISK VS REWARD">
            <Row
              label="AVG PROFIT (When Win)"
              value={signedMoney(stats.avgProfit)}
              accent="good"
            />
            <Row
              label="AVG LOSS (When Lose)"
              value={signedMoney(stats.avgLoss)}
              accent="bad"
            />
            <Row
              label="VOLATILITY"
              value={
                <>
                  {stats.payoutStdDev !== null ? money(stats.payoutStdDev) : "N/A"}
                  <small> ({((stats.payoutStdDev ?? 0) / (casePrice || 1)).toFixed(2)}× case)</small>
                </>
              }
              accent={stats.volatilityRating === "Low" ? "good" : stats.volatilityRating === "Extreme" ? "bad" : "bright"}
            />
            <Row
              label="RISK FLOOR (Worst-Case)"
              value={
                <>
                  {signedMoney(floorLossValue)}{" "}
                  <small>({stats.worstCaseLossPercent.toFixed(3)}% Lost)</small>
                </>
              }
              accent="bad"
            />
          </Section>

          <Section title="DEEP INSIGHTS">
            <Row
              label="TYPICAL RETURN (Median)"
              value={
                <>
                  {money(stats.medianReturn)}{" "}
                  <small>
                    (
                    {stats.medianReturn !== null && casePrice > 0
                      ? `${((stats.medianReturn / casePrice) * 100).toFixed(1)}%`
                      : "N/A"}
                    {" "}of Case Price)
                  </small>
                </>
              }
            />
            <Row
              label="90% FLOOR"
              value={money(stats.percentile90Floor)}
              accent="good"
              note="Value at or above 90% of outcomes"
            />
            <Row
              label={
                <span title="Weighted average of items worth 5x or more, using the same parsed drop probabilities">
                  WEIGHTED JACKPOT (5x+)
                </span>
              }
              value={money(jackpotWeightedAvgPrice)}
              accent="gold"
              large
              stacked
              note={`(${percent(jackpotChance, 3)} Chance | PF ${
                jackpotProfitFactor !== null ? jackpotProfitFactor.toFixed(2) : "N/A"
              }x)`}
            />
            <Row
              label="Avg Cases to Hit"
              value={
                jackpotCases !== null
                  ? `${jackpotCases.toLocaleString("en-US")} (~${money(jackpotTotalCost)})`
                  : "N/A"
              }
              accent="gold"
            />
          </Section>

          <Section title="ADVANCED METRICS">
            <Row
              label="Conservative Score"
              value={`${(conservativeScore * 100).toFixed(0)}%`}
              accent={conservativeScore > 0.65 ? "good" : conservativeScore > 0.4 ? "gold" : "neutral"}
            />
            <Row
              label="Jackpot Score"
              value={`${(jackpotScore * 100).toFixed(0)}%`}
              accent={jackpotScore > 0.65 ? "gold" : jackpotScore > 0.45 ? "bright" : "neutral"}
            />
            <Row
              label="Sharpe Ratio"
              value={stats.sharpeRatio !== null ? stats.sharpeRatio.toFixed(2) : "N/A"}
              accent={stats.sharpeRatio !== null && stats.sharpeRatio > 0.5 ? "good" : "neutral"}
              note="Return per risk unit"
            />
            <Row
              label="Sortino Ratio"
              value={stats.sortinoRatio !== null ? stats.sortinoRatio.toFixed(2) : "N/A"}
              accent={stats.sortinoRatio !== null && stats.sortinoRatio > 0.5 ? "good" : "neutral"}
              note="Downside-only risk"
            />
            <Row
              label="5x+ Win Rate"
              value={percent(stats.tailWinRate5x, 2)}
              accent={stats.tailWinRate5x !== null && stats.tailWinRate5x > 0.05 ? "gold" : "neutral"}
            />
            <Row
              label="Cost Per 5x Hit"
              value={stats.costPerHit5x !== null ? money(stats.costPerHit5x) : "N/A"}
              note="Expected spend to hit 5x jackpot"
            />
          </Section>
        </aside>
      ) : null}
    </>
  )
}
