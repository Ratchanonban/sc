import React, { useEffect, useMemo, useState } from "react"

type ScanResult = {
  url: string
  pageTitle: string
  casePrice: number
  decisionScore: number
  verdict: string
  maxOpens: number
  expectedNet: number
  budget: number
  scannedAt: number
}

type ScanState = {
  status: "idle" | "running" | "done" | "error"
  budget: number
  queue: string[]
  results: ScanResult[]
  current?: string | null
  total: number
  completed: number
  startedAt?: number
  updatedAt: number
  error?: string | null
}

const STORAGE_KEY = "skinclub-scan-state"

const api = {
  send: (message: object) =>
    new Promise<any>((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError
        if (error) {
          reject(new Error(error.message))
          return
        }
        resolve(response)
      })
    }),
  state: async () => {
    const response = await api.send({ type: "SKINCLUB_GET_SCAN_STATE" })
    return response?.state as ScanState | null
  }
}

const money = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  })

const normalizeUrls = (input: string) =>
  Array.from(
    new Set(
      input
        .split(/[\n, \t]+/)
        .map((part) => part.trim())
        .filter((part) => part.startsWith("https://"))
    )
  )

const defaultState: ScanState = {
  status: "idle",
  budget: 30,
  queue: [],
  results: [],
  total: 0,
  completed: 0,
  updatedAt: Date.now(),
  error: null
}

const popupStyle: React.CSSProperties = {
  width: 420,
  minHeight: 560,
  padding: 14,
  color: "#fff",
  background: "linear-gradient(180deg, #0c0a17 0%, #090812 100%)",
  fontFamily: "Inter, system-ui, sans-serif"
}

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.03)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  padding: 12
}

export default function Popup() {
  const [state, setState] = useState<ScanState>(defaultState)
  const [budget, setBudget] = useState(30)
  const [urlsText, setUrlsText] = useState("")
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const queuedUrls = useMemo(() => normalizeUrls(urlsText), [urlsText])

  const refreshState = async () => {
    const nextState = await api.state()
    if (nextState) {
      setState(nextState)
      setBudget(nextState.budget ?? 30)
    }
  }

  useEffect(() => {
    refreshState().catch(() => undefined)
    setReady(true)
    const listener = () => refreshState().catch(() => undefined)
    chrome.storage?.onChanged?.addListener(listener)
    const intervalId = window.setInterval(() => refreshState().catch(() => undefined), 2500)
    return () => {
      chrome.storage?.onChanged?.removeListener(listener)
      window.clearInterval(intervalId)
    }
  }, [])

  const addLinksFromCurrentPage = async () => {
    setBusy(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return

      const response = await new Promise<any>((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id!, { type: "SKINCLUB_COLLECT_CASE_LINKS" }, (result) => {
          const error = chrome.runtime.lastError
          if (error) {
            reject(new Error(error.message))
            return
          }
          resolve(result)
        })
      })

      const collected = Array.isArray(response?.links) ? response.links : []
      setUrlsText((prev) => normalizeUrls(`${prev}\n${collected.join("\n")}`).join("\n"))
    } finally {
      setBusy(false)
    }
  }

  const scanCurrentTab = async () => {
    setBusy(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const activeUrl = tab?.url ?? ""
      const urls =
        activeUrl.startsWith("https://") && activeUrl.includes("/cases/open/")
          ? [activeUrl]
          : []

      if (urls.length === 0) {
        setState((current) => ({
          ...current,
          status: "idle",
          error: "Open a case page first"
        }))
        return
      }

      setUrlsText(urls.join("\n"))
      setState((current) => ({
        ...current,
        status: "running",
        error: null,
        queue: urls,
        total: urls.length,
        completed: 0,
        current: urls[0] ?? null
      }))
      await api.send({
        type: "SKINCLUB_START_SCAN",
        urls,
        budget
      })
      await refreshState()
    } finally {
      setBusy(false)
    }
  }

  const startScan = async () => {
    const urls = normalizeUrls(urlsText)
    if (urls.length === 0) return

    setBusy(true)
    try {
      await api.send({
        type: "SKINCLUB_START_SCAN",
        urls,
        budget
      })
      await refreshState()
    } finally {
      setBusy(false)
    }
  }

  const clearState = async () => {
    setBusy(true)
    try {
      await api.send({ type: "SKINCLUB_CLEAR_SCAN_STATE" })
      setUrlsText("")
      await refreshState()
    } finally {
      setBusy(false)
    }
  }

  const setBudgetAndPersist = async (nextBudget: number) => {
    const safeBudget = Number.isFinite(nextBudget) && nextBudget > 0 ? nextBudget : 30
    setBudget(safeBudget)
    await api.send({ type: "SKINCLUB_SET_SCAN_BUDGET", budget: safeBudget })
  }

  const sortedResults = [...state.results].sort((left, right) => right.decisionScore - left.decisionScore)

  return (
    <div style={popupStyle}>
      <div style={{ marginBottom: 10, color: ready ? "#4ade80" : "#fbbf24", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {ready ? "Scanner ready" : "Loading scanner..."}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Scanner
          </div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Skin.club Case Scanner</div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>Made by Cursor</div>
        </div>
        <div style={{ color: state.status === "running" ? "#4ade80" : "#fbbf24", fontWeight: 700 }}>
          {state.status.toUpperCase()}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 12, color: "#d1d5db", marginBottom: 6 }}>Budget</label>
        <input
          type="number"
          min="1"
          step="0.01"
          value={budget}
          onChange={(event) => setBudgetAndPersist(Number.parseFloat(event.target.value || "30"))}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.09)",
            background: "rgba(8,10,20,0.8)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            outline: "none"
          }}
        />
      </div>

      <div style={{ ...cardStyle, marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 12, color: "#d1d5db", marginBottom: 6 }}>
          Case URLs
        </label>
        <textarea
          value={urlsText}
          onChange={(event) => setUrlsText(event.target.value)}
          placeholder="Paste case URLs here, one per line"
          rows={6}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.09)",
            background: "rgba(8,10,20,0.8)",
            color: "#fff",
            fontSize: 12,
            resize: "vertical",
            outline: "none",
            lineHeight: 1.4
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button onClick={scanCurrentTab} disabled={busy} style={buttonStyle("#f59e0b")}>
            Scan current tab
          </button>
          <button onClick={addLinksFromCurrentPage} disabled={busy} style={buttonStyle("#4f46e5")}>
            Add links from page
          </button>
          <button onClick={startScan} disabled={busy || queuedUrls.length === 0} style={buttonStyle("#10b981")}>
            Start scan
          </button>
          <button onClick={clearState} disabled={busy} style={buttonStyle("#374151")}>
            Clear
          </button>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 10 }}>
        <div style={summaryGrid}>
          <Summary label="Queued" value={state.queue.length || queuedUrls.length} />
          <Summary label="Done" value={state.completed} />
          <Summary label="Top" value={sortedResults[0]?.decisionScore ?? 0} suffix="/10" />
        </div>
        <div style={{ marginTop: 8, color: "#9ca3af", fontSize: 12 }}>
          {state.total > 0
            ? `Progress ${state.completed}/${state.total}${state.current ? ` · scanning ${state.current}` : ""}`
            : "Ready to scan"}
        </div>
      </div>

      <div style={{ ...cardStyle, maxHeight: 260, overflow: "auto" }}>
        <div style={{ marginBottom: 8, color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Ranking
        </div>
        {sortedResults.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>No results yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sortedResults.map((result) => (
              <div
                key={`${result.url}-${result.scannedAt}`}
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.03)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {result.pageTitle}
                    </div>
                    <div style={{ color: "#9ca3af", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {result.url}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, color: scoreColor(result.decisionScore), fontSize: 15 }}>
                      {result.decisionScore.toFixed(1)}/10
                    </div>
                    <div style={{ color: verdictColor(result.verdict), fontSize: 12, fontWeight: 700 }}>
                      {result.verdict}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 6, color: "#d1d5db", fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                  <span>{money(result.casePrice)}</span>
                  <span>{result.maxOpens} opens</span>
                  <span style={{ color: result.expectedNet >= 0 ? "#4ade80" : "#f87171" }}>
                    {result.expectedNet >= 0 ? "+" : ""}
                    {money(Math.abs(result.expectedNet))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Summary({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>
        {value}
        {suffix}
      </div>
    </div>
  )
}

const buttonStyle = (background: string): React.CSSProperties => ({
  border: "none",
  borderRadius: 10,
  padding: "9px 12px",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
  background,
  flex: "1 1 auto",
  minWidth: 0
})

const summaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 8
}

const scoreColor = (score: number) =>
  score >= 8 ? "#4ade80" : score >= 6 ? "#fbbf24" : score >= 4 ? "#fb7185" : "#f87171"

const verdictColor = (verdict: string) => {
  if (verdict === "Strong") return "#4ade80"
  if (verdict === "Good") return "#fbbf24"
  if (verdict === "Risky") return "#fb7185"
  return "#9ca3af"
}
