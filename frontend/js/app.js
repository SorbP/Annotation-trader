(() => {
  // ── State ──────────────────────────────────────────
  let state = {
    exchange:  null,
    symbol:    null,
    timeframe: null,
    since:     null,
  }

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

  // ── Init chart ─────────────────────────────────────
  ChartManager.init(document.getElementById("chart"))

  // ── Crosshair info ─────────────────────────────────
  ChartManager.onCrosshairMove(param => {
    if (!param.time) { crosshairInfo.textContent = ""; return }
    const candle = ChartManager.getCandleAt(param.time)
    if (!candle) return
    const dt = new Date(candle.time * 1000).toUTCString()
    crosshairInfo.textContent =
      `${dt}  O: ${candle.open}  H: ${candle.high}  L: ${candle.low}  C: ${candle.close}  V: ${Math.round(candle.volume)}`
  })

  // ── Click to annotate ──────────────────────────────
  ChartManager.onClick(param => {
    if (!param.time || !state.exchange) return
    const candle = ChartManager.getCandleAt(param.time)
    if (!candle) return
    Annotate.open(candle, {
      exchange:  state.exchange,
      symbol:    state.symbol,
      timeframe: state.timeframe,
    })
  })

  // ── On annotation saved ────────────────────────────
  Annotate.onSaved(annotation => {
    ChartManager.addMarker(annotation)
    prependAnnotationItem(annotation)
    annotationCount.textContent = parseInt(annotationCount.textContent) + 1
  })

  // ── Bootstrap: load exchanges & timeframes ─────────
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

    // Default timeframe to 1h
    timeframeSelect.value = "1h"
  }

  // ── Exchange change → load symbols ─────────────────
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

  // ── Load chart data ────────────────────────────────
  loadBtn.addEventListener("click", async () => {
    const exchange  = exchangeSelect.value
    const symbol    = symbolSelect.value
    const timeframe = timeframeSelect.value
    const since     = sinceInput.value ? new Date(sinceInput.value).toISOString() : null

    if (!exchange || !symbol || !timeframe) return

    state = { exchange, symbol, timeframe, since }
    setStatus("Loading chart...")
    loadBtn.disabled = true

    try {
      const [candles, annotations] = await Promise.all([
        API.ohlcv(exchange, symbol, timeframe, since),
        API.listAnnotations(exchange, symbol),
      ])

      ChartManager.setData(candles)
      ChartManager.setMarkers(annotations)
      renderAnnotationList(annotations)
      setStatus(`${candles.length} candles · ${annotations.length} annotations`)
    } catch (err) {
      setStatus("Error: " + err.message)
    } finally {
      loadBtn.disabled = false
    }
  })

  // ── Annotation list rendering ──────────────────────
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

    el.querySelector(".ann-delete").addEventListener("click", async (e) => {
      e.stopPropagation()
      await API.deleteAnnotation(a.id)
      el.remove()
      ChartManager.removeMarker(a.id)
      annotationCount.textContent = Math.max(0, parseInt(annotationCount.textContent) - 1)
    })

    annotationList.prepend(el)
  }

  function setStatus(msg) { statusEl.textContent = msg }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  bootstrap()
})()
