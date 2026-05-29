type ScanResult = {
  url: string
  pageTitle: string
  casePrice: number
  decisionScore: number
  verdict: string
  maxOpens: number
  expectedNet: number
  budget: number
  budgetAnalysis?: {
    decisionScore: number
    verdict: string
  } | null
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const waitForSnapshot = async (tabId: number, budget: number, attempts = 4, intervalMs = 400) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await sendMessageToTab<any>(tabId, {
      type: "SKINCLUB_GET_CASE_SNAPSHOT",
      budget
    }).catch(() => null)

    if (snapshot?.ok) return snapshot
    await delay(intervalMs)
  }

  return null
}

const sendMessageToTab = <T,>(tabId: number, message: object) =>
  new Promise<T>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        reject(new Error(lastError.message))
        return
      }
      resolve(response as T)
    })
  })

const waitForTabComplete = (tabId: number) =>
  new Promise<void>((resolve) => {
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
  })

const setState = async (partial: Partial<ScanState>) => {
  const current = await chrome.storage.local.get(STORAGE_KEY)
  const nextState: ScanState = {
    status: "idle",
    budget: 30,
    queue: [],
    results: [],
    total: 0,
    completed: 0,
    updatedAt: Date.now(),
    ...(current[STORAGE_KEY] as ScanState | undefined),
    ...partial,
    updatedAt: Date.now()
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: nextState })
  return nextState
}

const getState = async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return (stored[STORAGE_KEY] as ScanState | undefined) ?? null
}

const openScannerPage = async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("popup.html"),
    active: true
  })
}

const runQueue = async (queue: string[], budget: number) => {
  await setState({
    status: "running",
    queue,
    results: [],
    total: queue.length,
    completed: 0,
    current: null,
    budget,
    startedAt: Date.now(),
    error: null
  })

  const results: ScanResult[] = []

  for (let index = 0; index < queue.length; index += 1) {
    const url = queue[index]
    let tabId: number | null = null

    try {
      const tab = await chrome.tabs.create({ url, active: false })
      tabId = tab.id ?? null
      if (!tabId) throw new Error("Could not create tab")

      await withTimeout(waitForTabComplete(tabId), 8000, "Page load")
      await delay(500)

      const snapshot = await withTimeout(waitForSnapshot(tabId, budget), 5000, "Snapshot collection")

      if (snapshot?.ok) {
        const result: ScanResult = {
          url,
          pageTitle: snapshot.pageTitle ?? url,
          casePrice: snapshot.casePrice ?? 0,
          decisionScore: snapshot.budgetAnalysis?.decisionScore ?? 0,
          verdict: snapshot.budgetAnalysis?.verdict ?? "Unknown",
          maxOpens: snapshot.budgetAnalysis?.maxOpens ?? 0,
          expectedNet: snapshot.budgetAnalysis?.expectedNet ?? 0,
          budget,
          budgetAnalysis: snapshot.budgetAnalysis
            ? {
                decisionScore: snapshot.budgetAnalysis.decisionScore,
                verdict: snapshot.budgetAnalysis.verdict
              }
            : null,
          scannedAt: Date.now()
        }

        results.push(result)
        await setState({
          status: "running",
          queue,
          results,
          current: url,
          total: queue.length,
          completed: index + 1,
          budget
        })
      } else {
        results.push({
          url,
          pageTitle: "Unavailable",
          casePrice: 0,
          decisionScore: 0,
          verdict: "Error",
          maxOpens: 0,
          expectedNet: 0,
          budget,
          budgetAnalysis: null,
          scannedAt: Date.now()
        })

        await setState({
          status: "running",
          queue,
          results,
          current: url,
          total: queue.length,
          completed: index + 1,
          budget
        })
      }
      } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scan error"
      results.push({
        url,
        pageTitle: message,
        casePrice: 0,
        decisionScore: 0,
        verdict: "Error",
        maxOpens: 0,
        expectedNet: 0,
        budget,
        budgetAnalysis: null,
        scannedAt: Date.now()
      })
      await setState({
        status: "running",
        queue,
        results,
        current: url,
        total: queue.length,
        completed: index + 1,
        budget,
        error: message
      })
      } finally {
      if (tabId !== null) {
        try {
          await chrome.tabs.remove(tabId)
        } catch {
          // ignore cleanup errors
        }
      }
      await delay(500)
    }
  }

  await setState({
    status: "done",
    queue,
    results,
    current: null,
    total: queue.length,
    completed: queue.length,
    budget,
    error: null
  })

  return results
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SKINCLUB_GET_SCAN_STATE") {
    getState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  if (message?.type === "SKINCLUB_SET_SCAN_BUDGET") {
    setState({ budget: Number.isFinite(message.budget) ? message.budget : 30 })
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  if (message?.type === "SKINCLUB_CLEAR_SCAN_STATE") {
    setState({
      status: "idle",
      queue: [],
      results: [],
      current: null,
      total: 0,
      completed: 0,
      startedAt: undefined,
      error: null
    })
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  if (message?.type === "SKINCLUB_START_SCAN") {
    const urls = Array.isArray(message.urls)
      ? Array.from(new Set(message.urls.filter((url: unknown) => typeof url === "string" && url.startsWith("https://"))))
      : []
    const budget = Number.isFinite(message.budget) && message.budget > 0 ? message.budget : 30

    runQueue(urls, budget)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  return false
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setPopup({ popup: "" }).catch(() => undefined)
})

chrome.action.onClicked.addListener(() => {
  openScannerPage().catch(() => undefined)
})
