import cssText from "data-text:~contents/components/theme.css"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import React, { useEffect, useRef, useState } from "react"

import { Dashboard } from "./components/Dashboard"
import { analyzeBudget, calculateStats, type BudgetAnalysis, type DecisionStats } from "./calculator"
import { scrapeItemsFromDOM } from "./scraper"

type CaseSnapshot = {
  casePrice: number
  pageTitle: string
  stats: DecisionStats
}

export const config: PlasmoCSConfig = {
  matches: ["https://*.skin.club/*", "https://skin.club/*"]
}

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText
  return style
}

const parsePositivePrice = (node: Element | null) => {
  if (!node) return 0
  const text = node.textContent?.replace(/[^0-9.]/g, "") ?? "0"
  const price = Number.parseFloat(text)
  return Number.isFinite(price) ? price : 0
}

const isVisibleElement = (node: Element) => {
  const style = window.getComputedStyle(node)
  const rect = node.getBoundingClientRect()

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0
  )
}

const getFontWeightValue = (value: string) => {
  if (value === "bold") return 700
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) ? parsedValue : 400
}

const getAncestorPosition = (node: Element) => {
  let current: Element | null = node
  for (let depth = 0; current && depth < 4; depth += 1) {
    const style = window.getComputedStyle(current)
    if (style.position === "fixed" || style.position === "sticky") return style.position
    current = current.parentElement
  }
  return ""
}

const collectCaseLinks = () => {
  const links = Array.from(document.querySelectorAll('a[href*="/cases/open/"]'))
    .map((anchor) => {
      const href = anchor.getAttribute("href")
      if (!href) return null
      try {
        return new URL(href, window.location.origin).href
      } catch {
        return null
      }
    })
    .filter((href): href is string => Boolean(href))

  const selfLink =
    window.location.pathname.includes("/cases/open/") && window.location.href.startsWith("https://")
      ? [window.location.href]
      : []

  return Array.from(new Set([...selfLink, ...links]))
}

const isInteractiveAncestor = (node: Element) =>
  Boolean(
    node.closest('button, a, [role="button"], [data-testid*="button"], [class*="button"], [class*="cta"]')
  )

const hasActionContext = (node: Element) => {
  const text = `${node.textContent ?? ""} ${node.parentElement?.textContent ?? ""} ${node.parentElement?.parentElement?.textContent ?? ""}`.toLowerCase()
  return /ฝาก|deposit|open|buy|purchase|add funds|balance|button|cta|ซื้อ|เปิดกล่อง|เพิ่มเงิน|ขาย/.test(text)
}

const detectCasePrice = (container: Document) => {
  const dedicatedSelectors = [
    ".roulette-case__price [data-sign='positive']",
    ".roulette-case__price span[data-sign='positive']",
    ".roulette-case__price [translate='no']",
    ".roulette-case__price"
  ]

  for (const selector of dedicatedSelectors) {
    const nodes = Array.from(container.querySelectorAll(selector))
    const visibleCandidates = nodes
      .map((node) => ({
        node,
        price: parsePositivePrice(node)
      }))
      .filter(({ node, price }) => price > 0 && isVisibleElement(node))

    if (visibleCandidates.length > 0) {
      visibleCandidates.sort((left, right) => {
        const leftRect = left.node.getBoundingClientRect()
        const rightRect = right.node.getBoundingClientRect()
        const leftStyle = window.getComputedStyle(left.node)
        const rightStyle = window.getComputedStyle(right.node)
        const leftWeight = getFontWeightValue(leftStyle.fontWeight)
        const rightWeight = getFontWeightValue(rightStyle.fontWeight)

        const leftScore = leftRect.width + leftRect.height + leftWeight
        const rightScore = rightRect.width + rightRect.height + rightWeight

        return rightScore - leftScore
      })

      return visibleCandidates[0]?.price ?? 0
    }
  }

  const nodes = Array.from(container.querySelectorAll('[data-sign="positive"]'))
  const candidates = nodes
    .map((node) => {
      const price = parsePositivePrice(node)
      if (price <= 0 || !isVisibleElement(node)) return null
      if (isInteractiveAncestor(node) || hasActionContext(node)) return null

      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      const fontSize = Number.parseFloat(style.fontSize || "0")
      const fontWeight = getFontWeightValue(style.fontWeight)
      const ancestorPosition = getAncestorPosition(node)
      const isHeaderWallet = rect.top < window.innerHeight * 0.22 && rect.left > window.innerWidth * 0.65
      const isCentralHero = rect.top > 90 && rect.top < window.innerHeight * 0.72
      const isCenteredHorizontally =
        rect.left > window.innerWidth * 0.12 && rect.right < window.innerWidth * 0.88

      let score = 0

      if (ancestorPosition === "fixed" || ancestorPosition === "sticky") score -= 20
      if (isHeaderWallet) score -= 30
      if (isCentralHero) score += 6
      if (isCenteredHorizontally) score += 5
      if (rect.top > 120 && rect.top < window.innerHeight * 0.85) score += 2
      if (fontSize >= 18) score += 4
      else if (fontSize >= 15) score += 2
      if (fontWeight >= 700) score += 2
      else if (fontWeight >= 600) score += 1
      if (price >= 0.5 && price <= 500) score += 2
      if (price < 0.5 && isHeaderWallet) score -= 10
      if (rect.top > window.innerHeight * 0.75) score -= 8

      return { node, price, score }
    })
    .filter((candidate): candidate is { node: Element; price: number; score: number } => Boolean(candidate))

  if (candidates.length === 0) return 0

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score

    const leftRect = left.node.getBoundingClientRect()
    const rightRect = right.node.getBoundingClientRect()

    return leftRect.top - rightRect.top
  })

  return candidates[0]?.price ?? 0
}

const buildCaseSnapshot = (): CaseSnapshot | null => {
  const casePrice = detectCasePrice(document)
  const items = scrapeItemsFromDOM(document.body)
  if (casePrice <= 0 || items.length === 0) return null

  const stats = calculateStats(items, casePrice)
  return {
    casePrice,
    pageTitle: document.querySelector("h1")?.textContent?.trim() || document.title,
    stats
  }
}

const SkinClubOverlay = () => {
  const [stats, setStats] = useState<DecisionStats | null>(null)
  const [casePrice, setCasePrice] = useState(0)
  const [budget, setBudget] = useState(() => {
    const storedValue = window.localStorage.getItem("skinclub-ev-budget")
    const parsedValue = storedValue ? Number.parseFloat(storedValue) : 30
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 30
  })
  const lastSignatureRef = useRef<string>("")
  const lastPathRef = useRef<string>("")
  const casePriceRef = useRef(0)

  useEffect(() => {
    let frameId = 0
    let observer: MutationObserver | null = null

    const scanPage = () => {
      const currentPath = window.location.pathname
      if (currentPath !== lastPathRef.current) {
        lastPathRef.current = currentPath
        casePriceRef.current = 0
        lastSignatureRef.current = ""
        setCasePrice(0)
        setStats(null)
      }

      const items = scrapeItemsFromDOM(document.body)
      const detectedPrice = detectCasePrice(document)
      const currentPrice =
        detectedPrice > 0 && (casePriceRef.current === 0 || detectedPrice >= 0.5)
          ? detectedPrice
          : casePriceRef.current > 0
            ? casePriceRef.current
            : detectedPrice
      const nextStats = calculateStats(items, currentPrice)

      const signature = [
        currentPrice,
        items.length,
        nextStats.expectedValuePercent.toFixed(4),
        nextStats.baseWinRate.toFixed(6),
        nextStats.strictWinRate.toFixed(6),
        nextStats.medianReturn ?? "null",
        nextStats.highestPrice ?? "null"
      ].join("|")

      if (signature !== lastSignatureRef.current) {
        lastSignatureRef.current = signature
        if (detectedPrice >= 0.5 || casePriceRef.current === 0) {
          casePriceRef.current = currentPrice
        }
        setCasePrice(currentPrice)
        setStats(nextStats)
      }
    }

    const scheduleScan = () => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(scanPage)
    }

    observer = new MutationObserver(scheduleScan)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    })

    scheduleScan()
    window.addEventListener("load", scheduleScan)

    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frameId)
      window.removeEventListener("load", scheduleScan)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem("skinclub-ev-budget", String(budget))
  }, [budget])

  const budgetAnalysis: BudgetAnalysis | null = analyzeBudget(stats, casePrice, budget)

  return (
    <Dashboard
      stats={stats}
      casePrice={casePrice}
      budget={budget}
      budgetAnalysis={budgetAnalysis}
      onBudgetChange={setBudget}
    />
  )
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SKINCLUB_COLLECT_CASE_LINKS") {
      sendResponse({ ok: true, links: collectCaseLinks() })
      return false
    }

    if (message?.type === "SKINCLUB_GET_CASE_SNAPSHOT") {
      const snapshot = buildCaseSnapshot()
      if (!snapshot) {
        sendResponse({ ok: false, reason: "snapshot-unavailable" })
        return false
      }

      const budgetValue =
        Number.isFinite(message?.budget) && message.budget > 0 ? message.budget : 30
      const budgetAnalysis = analyzeBudget(snapshot.stats, snapshot.casePrice, budgetValue)

      sendResponse({
        ok: true,
        ...snapshot,
        budget: budgetValue,
        budgetAnalysis
      })
      return false
    }

    return false
  })
}

export default SkinClubOverlay
