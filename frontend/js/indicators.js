const Indicators = (() => {
  const active = new Set()   // currently enabled indicator keys
  let lastParams = null      // { exchange, symbol, timeframe, since, limit }

  // Map button ind name → what we request from API
  const IND_API_MAP = {
    sma20:  ["sma20"],
    sma50:  ["sma50"],
    sma200: ["sma200"],
    ema20:  ["ema20"],
    bb:     ["bb"],
    rsi:    ["rsi"],
    macd:   ["macd"],
    stoch:  ["stoch"],
  }

  // ── Toggle an indicator on/off ────────────────────────
  async function toggle(name) {
    const btn = document.querySelector(`.ind-btn[data-ind="${name}"]`)

    if (active.has(name)) {
      active.delete(name)
      btn?.classList.remove("active")
      _clearIndicator(name)
      _updateSubPanes()
      return
    }

    if (!lastParams) return  // no data loaded yet

    active.add(name)
    btn?.classList.add("active")
    _updateSubPanes()

    await _fetchAndApply([name])
  }

  // ── Called after new chart data is loaded ─────────────
  async function refresh(params) {
    lastParams = params
    if (active.size === 0) return
    await _fetchAndApply([...active])
  }

  // ── Internal ──────────────────────────────────────────
  async function _fetchAndApply(names) {
    if (!lastParams) return
    const { exchange, symbol, timeframe, since, limit } = lastParams
    const apiInds = [...new Set(names.flatMap(n => IND_API_MAP[n] || []))]
    if (!apiInds.length) return

    try {
      const data = await API.indicators(exchange, symbol, timeframe, since, limit, apiInds.join(","))
      for (const [key, series] of Object.entries(data)) {
        ChartManager.setIndicator(key, series)
      }
    } catch (err) {
      console.error("Indicator fetch failed:", err)
    }
  }

  function _clearIndicator(name) {
    if (name === "rsi") {
      ChartManager.setIndicator("rsi", [])
    } else if (name === "macd") {
      ChartManager.setIndicator("macd_line",   [])
      ChartManager.setIndicator("macd_signal", [])
      ChartManager.setIndicator("macd_hist",   [])
    } else if (name === "bb") {
      ChartManager.clearIndicator("bb_upper")
      ChartManager.clearIndicator("bb_mid")
      ChartManager.clearIndicator("bb_lower")
    } else if (name === "stoch") {
      ChartManager.setIndicator("stoch_k", [])
      ChartManager.setIndicator("stoch_d", [])
    } else {
      ChartManager.clearIndicator(name)
    }
  }

  function _updateSubPanes() {
    ChartManager.showRsiPane(active.has("rsi"))
    ChartManager.showMacdPane(active.has("macd"))
    ChartManager.showStochPane(active.has("stoch"))
  }

  return { toggle, refresh }
})()
