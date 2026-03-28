(() => {
  // ── State ──────────────────────────────────────────
  let state = { exchange: null, symbol: null, timeframe: null, since: null }
  let liveInterval   = null
  let tickerInterval = null

  // ── Elements ───────────────────────────────────────
  const exchangeSelect  = document.getElementById("exchange-select")
  const symbolSelect    = document.getElementById("symbol-select")
  const timeframeSelect = document.getElementById("timeframe-select")
  const sinceInput      = document.getElementById("since-input")
  const loadBtn         = document.getElementById("load-btn")
  const statusEl        = document.getElementById("status")
  const crosshairInfo   = document.getElementById("crosshair-info")
  const annotationList  = document.getElementById("annotation-list")
  const annotationCount = document.getElementById("annotation-count")

  // ── Init ───────────────────────────────────────────
  ChartManager.init()
  PaneManager.init()
  Drawing.init()

  // ── Indicator buttons ──────────────────────────────
  document.querySelectorAll(".ind-btn").forEach(btn => {
    const color = btn.dataset.color || "#ffffff"
    btn.style.setProperty("--ind-color", color)
    btn.addEventListener("click", () => Indicators.toggle(btn.dataset.ind))
  })

  // ── Drawing tool buttons ───────────────────────────
  document.querySelectorAll(".draw-btn").forEach(btn => {
    btn.addEventListener("click", () => Drawing.setTool(btn.dataset.tool))
  })

  document.getElementById("clear-drawings-btn").addEventListener("click", () => {
    Drawing.clearAll()
  })

  document.getElementById("snap-btn").addEventListener("click", () => {
    Drawing.toggleSnap()
  })

  // ── Chart events ───────────────────────────────────
  ChartManager.onCrosshairMove(param => {
    if (!param.time) { crosshairInfo.textContent = ""; return }
    const c = ChartManager.getCandleAt(param.time)
    if (!c) return
    const dt = new Date(c.time * 1000).toUTCString()
    crosshairInfo.textContent =
      `${dt}  O: ${c.open}  H: ${c.high}  L: ${c.low}  C: ${c.close}  V: ${Math.round(c.volume)}`
  })

  ChartManager.onClick(param => {
    const tool = Drawing.getTool()

    // Drawing tools get priority
    if (tool !== "pointer") {
      Drawing.handleClick(param)
      return
    }

    // Pointer mode → annotate
    if (!param.time || !state.exchange) return
    const candle = ChartManager.getCandleAt(param.time)
    if (!candle) return
    Annotate.open(candle, { exchange: state.exchange, symbol: state.symbol, timeframe: state.timeframe })
  })

  Annotate.onSaved(annotation => {
    ChartManager.addMarker(annotation)
    ChartManager.setView(state.timeframe)
    prependAnnotationItem(annotation)
    annotationCount.textContent = parseInt(annotationCount.textContent) + 1
  })

  // ── Chart type panel ───────────────────────────────
  const chartTypeBtn   = document.getElementById("chart-type-btn")
  const chartTypePanel = document.getElementById("chart-type-panel")
  const ctUpColor      = document.getElementById("ct-up-color")
  const ctDownColor    = document.getElementById("ct-down-color")

  chartTypeBtn.addEventListener("click", e => {
    e.stopPropagation()
    const rect = chartTypeBtn.getBoundingClientRect()
    chartTypePanel.style.left = rect.left + "px"
    chartTypePanel.style.top  = (rect.bottom + 4) + "px"
    chartTypePanel.classList.toggle("hidden")
  })

  const CT_LABELS = {
    "candles": "Candles", "hollow": "Hollow Candles", "bars": "Bars",
    "hlc-bars": "HLC Bars", "heikin-ashi": "Heikin Ashi",
    "line": "Line", "line-markers": "Line + Markers", "step-line": "Step Line",
    "area": "Area", "baseline": "Baseline", "columns": "Columns"
  }

  chartTypePanel.querySelectorAll(".ct-item").forEach(item => {
    item.addEventListener("click", () => {
      const type = item.dataset.type
      ChartManager.setChartType(type)
      chartTypePanel.querySelectorAll(".ct-item").forEach(i => i.classList.remove("active"))
      item.classList.add("active")
      chartTypeBtn.textContent = (CT_LABELS[type] || type) + " \u25BE"
      chartTypePanel.classList.add("hidden")
    })
  })

  ctUpColor.addEventListener("input", () => {
    ChartManager.setColors(ctUpColor.value, ctDownColor.value)
  })
  ctDownColor.addEventListener("input", () => {
    ChartManager.setColors(ctUpColor.value, ctDownColor.value)
  })

  document.addEventListener("mousedown", e => {
    if (!chartTypePanel.contains(e.target) && e.target !== chartTypeBtn)
      chartTypePanel.classList.add("hidden")
  })

  // ── Context menu ───────────────────────────────────
  const ctxMenu      = document.getElementById("chart-context-menu")
  const ctxHLine     = document.getElementById("ctx-hline")
  let   ctxMenuPrice = null

  document.addEventListener("contextmenu", e => {
    const container = document.getElementById("chart-main")
    if (!container.contains(e.target)) return
    e.preventDefault()
    e.stopPropagation()

    // Right-click on an existing drawing → show its property panel
    const hit = Drawing.findNear(e.clientX, e.clientY)
    if (hit) {
      ctxMenu.classList.add("hidden")
      Drawing.showProps(hit, e.clientX, e.clientY)
      return
    }

    // Right-click on empty chart → show add-line menu
    const localY = e.clientY - container.getBoundingClientRect().top
    ctxMenuPrice = ChartManager.getCandleSeries().coordinateToPrice(localY)
    ctxMenu.style.left = e.clientX + "px"
    ctxMenu.style.top  = e.clientY + "px"
    ctxMenu.classList.remove("hidden")
  }, true)

  ctxHLine.addEventListener("click", () => {
    if (ctxMenuPrice !== null) Drawing.placeHLine(ctxMenuPrice)
    ctxMenu.classList.add("hidden")
  })

  document.addEventListener("mousedown", e => {
    if (!ctxMenu.contains(e.target)) ctxMenu.classList.add("hidden")
  })

  // ── Bootstrap ──────────────────────────────────────
  async function bootstrap() {
    const [exchanges, timeframes] = await Promise.all([API.exchanges(), API.timeframes()])

    exchanges.forEach(ex => {
      const opt = document.createElement("option")
      opt.value = ex; opt.textContent = ex
      exchangeSelect.appendChild(opt)
    })

    timeframes.forEach(tf => {
      const opt = document.createElement("option")
      opt.value = tf; opt.textContent = tf
      timeframeSelect.appendChild(opt)
    })

    timeframeSelect.value = "1h"
    exchangeSelect.value  = "binance"

    // Load Binance symbols, then pre-select BTC/USDT and auto-load
    setStatus("Loading symbols...")
    try {
      const symbols = await API.symbols("binance")
      symbolSelect.innerHTML = "<option value=''>Symbol...</option>"
      symbols.forEach(s => {
        const opt = document.createElement("option")
        opt.value = s; opt.textContent = s
        symbolSelect.appendChild(opt)
      })
      symbolSelect.disabled    = false
      timeframeSelect.disabled = false
      sinceInput.disabled      = false
      symbolSelect.value       = "BTC/USDT"
      updateLoadBtn()
      setStatus("")

      // Auto-load the chart, then enable default indicators
      await loadChart()
      await Promise.all([Indicators.toggle("rsi"), Indicators.toggle("stoch")])
      ChartManager.setView("1h")
    } catch (err) {
      setStatus("Error: " + err.message)
    }
  }

  exchangeSelect.addEventListener("change", async () => {
    const ex = exchangeSelect.value
    if (!ex) return
    symbolSelect.disabled = true
    symbolSelect.innerHTML = "<option>Loading...</option>"
    timeframeSelect.disabled = true
    sinceInput.disabled = true
    loadBtn.disabled = true
    setStatus("Loading symbols...")
    try {
      const symbols = await API.symbols(ex)
      symbolSelect.innerHTML = "<option value=''>Symbol...</option>"
      symbols.forEach(s => {
        const opt = document.createElement("option")
        opt.value = s; opt.textContent = s
        symbolSelect.appendChild(opt)
      })
      symbolSelect.disabled = false
      timeframeSelect.disabled = false
      sinceInput.disabled = false
      setStatus("")
    } catch (err) {
      setStatus("Error: " + err.message)
    }
  })

  symbolSelect.addEventListener("change", updateLoadBtn)
  timeframeSelect.addEventListener("change", updateLoadBtn)
  function updateLoadBtn() {
    loadBtn.disabled = !(symbolSelect.value && timeframeSelect.value)
  }

  // ── Load chart ─────────────────────────────────────
  async function loadChart() {
    const exchange  = exchangeSelect.value
    const symbol    = symbolSelect.value
    const timeframe = timeframeSelect.value
    const since     = sinceInput.value ? new Date(sinceInput.value).toISOString() : null
    if (!exchange || !symbol || !timeframe) return

    state = { exchange, symbol, timeframe, since }
    setStatus("Loading chart...")
    loadBtn.disabled = true
    stopLive()

    try {
      const [candles, annotations] = await Promise.all([
        API.ohlcv(exchange, symbol, timeframe, since),
        API.listAnnotations(exchange, symbol),
      ])

      ChartManager.setData(candles)
      ChartManager.setMarkers(annotations)
      ChartManager.setView(timeframe)
      renderAnnotationList(annotations)
      setStatus(`${candles.length} candles · ${annotations.length} annotations · live`)

      await Indicators.refresh(state)
      startLive()
      startTicker()
    } catch (err) {
      setStatus("Error: " + err.message)
    } finally {
      loadBtn.disabled = false
    }
  }

  loadBtn.addEventListener("click", loadChart)

  // ── Annotation list ────────────────────────────────
  function renderAnnotationList(annotations) {
    annotationList.innerHTML = ""
    annotationCount.textContent = annotations.length
    annotations.forEach(prependAnnotationItem)
  }

  function prependAnnotationItem(a) {
    const isPos = a.signal > 0
    const dt    = new Date(a.signal_time)
    const label = dt.toLocaleDateString() + " " + dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

    const el = document.createElement("div")
    el.className = "annotation-item"
    el.dataset.id = a.id
    el.innerHTML = `
      <div class="ann-meta">
        <span class="ann-symbol">${a.symbol} · ${a.timeframe}</span>
        <span class="ann-time">${label}</span>
        ${a.notes ? `<span class="ann-notes">${escapeHtml(a.notes)}</span>` : ""}
      </div>
      <span class="ann-signal ${isPos ? "positive" : "negative"}">${isPos ? "+" : ""}${a.signal}</span>
      <button class="ann-delete" title="Delete">×</button>
    `

    el.querySelector(".ann-delete").addEventListener("click", async () => {
      await API.deleteAnnotation(a.id)
      el.remove()
      ChartManager.removeMarker(a.id)
      annotationCount.textContent = Math.max(0, parseInt(annotationCount.textContent) - 1)
    })

    annotationList.prepend(el)
  }

  // ── Live polling ───────────────────────────────────
  function startLive() {
    let inFlight = false
    const tick = async () => {
      if (!state.exchange || inFlight) return
      inFlight = true
      try {
        const candles = await API.latestCandles(state.exchange, state.symbol, state.timeframe)
        candles.forEach(c => ChartManager.updateCandle(c))
      } catch (err) {
        console.warn("[live]", err.message)
      } finally {
        inFlight = false
      }
    }
    liveInterval = setInterval(tick, 5000)
  }

  function stopLive() {
    if (liveInterval)   { clearInterval(liveInterval);   liveInterval   = null }
    if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null }
  }

  function startTicker() {
    let inFlight = false
    const tick = async () => {
      if (!state.exchange || inFlight) return
      inFlight = true
      try {
        const { price } = await API.ticker(state.exchange, state.symbol)
        ChartManager.updateLastPrice(price)
      } catch (err) {
        console.warn("[ticker]", err.message)
      } finally {
        inFlight = false
      }
    }
    tickerInterval = setInterval(tick, 2000)
  }

  function setStatus(msg) { statusEl.textContent = msg }
  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

bootstrap()
})()
