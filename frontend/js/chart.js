const ChartManager = (() => {
  let mainChart, candleSeries, volumeSeries
  let rsiChart,  rsiSeries,  rsiOb, rsiOs
  let macdChart, macdHistSeries, macdLineSeries, macdSignalSeries
  let stochChart, stochKSeries, stochDSeries, stochOb, stochOs, stochZero
  let overlaySeries = {}   // keyed by indicator name
  let currentData  = []
  let markers      = []
  let _syncingRange = false

  // ── Chart factory ────────────────────────────────────
  function makeChart(container, opts = {}) {
    return LightweightCharts.createChart(container, {
      layout: { background: { color: "#0d0d0f" }, textColor: "#6b6b7a" },
      grid:   { vertLines: { color: "#1a1a1f" }, horzLines: { color: "#1a1a1f" } },
      rightPriceScale: { borderColor: "#2a2a32" },
      timeScale: { borderColor: "#2a2a32", timeVisible: true, secondsVisible: false },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      handleScroll:   { mouseWheel: true, pressedMouseMove: true },
      handleScale:    { mouseWheel: true, pinch: true },
      ...opts,
    })
  }

  function syncTimeScales(...charts) {
    charts.forEach(source => {
      source.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (_syncingRange || !range) return
        _syncingRange = true
        charts.forEach(target => {
          if (target !== source) target.timeScale().setVisibleLogicalRange(range)
        })
        _syncingRange = false
      })
    })
  }

  function observeResize(container, chart) {
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight })
    })
    ro.observe(container)
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight })
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    const mainContainer = document.getElementById("chart-main")
    mainChart = makeChart(mainContainer)
    observeResize(mainContainer, mainChart)

    candleSeries = mainChart.addCandlestickSeries({
      upColor: "#1ce3ed", downColor: "#ff962e",
      borderUpColor: "#1ce3ed", borderDownColor: "#ff962e",
      wickUpColor:   "#1ce3ed", wickDownColor:   "#ff962e",
    })

    volumeSeries = mainChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    })
    mainChart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    // RSI chart
    const rsiContainer = document.getElementById("chart-rsi")
    rsiChart = makeChart(rsiContainer, {
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } },
    })
    observeResize(rsiContainer, rsiChart)

    const fixedScale = () => ({ priceRange: { minValue: 0, maxValue: 100 } })
    rsiSeries = rsiChart.addLineSeries({ color: "#26a69a", lineWidth: 1, priceLineVisible: false, autoscaleInfoProvider: fixedScale })

    rsiOb = rsiChart.addLineSeries({ color: "#ef535055", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
    rsiOs = rsiChart.addLineSeries({ color: "#26a69a55", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })

    // MACD chart
    const macdContainer = document.getElementById("chart-macd")
    macdChart = makeChart(macdContainer)
    observeResize(macdContainer, macdChart)

    macdHistSeries   = macdChart.addHistogramSeries({ priceLineVisible: false })
    macdLineSeries   = macdChart.addLineSeries({ color: "#5c6bc0", lineWidth: 1, priceLineVisible: false })
    macdSignalSeries = macdChart.addLineSeries({ color: "#ff962e", lineWidth: 1, priceLineVisible: false })

    // Stochastic chart
    const stochContainer = document.getElementById("chart-stoch")
    stochChart = makeChart(stochContainer, {
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } },
    })
    observeResize(stochContainer, stochChart)

    const stochScale = () => ({ priceRange: { minValue: -1, maxValue: 1 } })
    stochKSeries = stochChart.addLineSeries({ color: "#ff6b9d", lineWidth: 1, priceLineVisible: false, autoscaleInfoProvider: stochScale })
    stochDSeries = stochChart.addLineSeries({ color: "#ffffff99", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, autoscaleInfoProvider: stochScale })
    stochOb = stochChart.addLineSeries({ color: "#ef535055", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
    stochOs = stochChart.addLineSeries({ color: "#26a69a55", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
    // Zero reference line — always visible, lets you see where center is
    stochZero = stochChart.addLineSeries({ color: "#ffffff22", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Solid, priceLineVisible: false, lastValueVisible: false })

    syncTimeScales(mainChart, rsiChart, macdChart, stochChart)
  }

  // ── Data ─────────────────────────────────────────────
  function setData(candles) {
    currentData = candles
    candleSeries.setData(candles.map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    })))
    volumeSeries.setData(candles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? "#1ce3ed33" : "#ff962e33",
    })))
    mainChart.timeScale().fitContent()
  }

  // ── Markers ──────────────────────────────────────────
  function setMarkers(annotations) {
    markers = _toMarkers(annotations)
    candleSeries.setMarkers(markers)
  }

  function addMarker(annotation) {
    markers = [...markers, ..._toMarkers([annotation])].sort((a, b) => a.time - b.time)
    candleSeries.setMarkers(markers)
  }

  function removeMarker(id) {
    markers = markers.filter(m => m.id !== id)
    candleSeries.setMarkers(markers)
  }

  function _toMarkers(annotations) {
    return annotations.map(a => ({
      time:     Math.floor(new Date(a.signal_time).getTime() / 1000),
      position: a.signal > 0 ? "belowBar" : "aboveBar",
      color:    a.signal > 0 ? "#1ce3ed"  : "#ff962e",
      shape:    a.signal > 0 ? "arrowUp"  : "arrowDown",
      text:     (a.signal > 0 ? "+" : "") + a.signal,
      id:       a.id,
    }))
  }

  // ── Indicators ───────────────────────────────────────
  function setIndicator(name, data) {
    const COLORS = {
      sma20:  "#f0e040", sma50: "#ff9800", sma200: "#e040fb",
      ema20:  "#40c4ff",
      bb_upper: "#aaaaaa", bb_mid: "#aaaaaa55", bb_lower: "#aaaaaa",
    }

    // Sub-chart indicators
    if (name === "rsi") {
      rsiSeries.setData(data)
      const times = data.map(d => d.time)
      if (times.length) {
        const obData = times.map(t => ({ time: t, value: 70 }))
        const osData = times.map(t => ({ time: t, value: 30 }))
        rsiOb.setData(obData)
        rsiOs.setData(osData)
      }
      return
    }
    if (name === "macd_line")   { macdLineSeries.setData(data);   return }
    if (name === "macd_signal") { macdSignalSeries.setData(data); return }
    if (name === "macd_hist")   { macdHistSeries.setData(data);   return }

    if (name === "stoch_k") {
      stochKSeries.setData(data)
      const times = data.map(d => d.time)
      if (times.length) {
        stochOb.setData(  times.map(t => ({ time: t, value:  0.8 })))
        stochOs.setData(  times.map(t => ({ time: t, value: -0.8 })))
        stochZero.setData(times.map(t => ({ time: t, value:  0.0 })))
      }
      return
    }
    if (name === "stoch_d") { stochDSeries.setData(data); return }

    // Overlay: remove old series if exists
    clearIndicator(name)

    const color = COLORS[name] || "#ffffff"
    const series = mainChart.addLineSeries({
      color,
      lineWidth:        name === "sma200" ? 2 : 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    series.setData(data)
    overlaySeries[name] = series
  }

  function clearIndicator(name) {
    if (overlaySeries[name]) {
      mainChart.removeSeries(overlaySeries[name])
      delete overlaySeries[name]
    }
  }

  function clearAllIndicators() {
    Object.keys(overlaySeries).forEach(clearIndicator)
    rsiSeries.setData([])
    rsiOb.setData([])
    rsiOs.setData([])
    macdHistSeries.setData([])
    macdLineSeries.setData([])
    macdSignalSeries.setData([])
  }

  function showRsiPane(visible) {
    document.getElementById("chart-rsi-wrap").classList.toggle("hidden", !visible)
    setTimeout(() => rsiChart.applyOptions({
      width: document.getElementById("chart-rsi").clientWidth,
      height: document.getElementById("chart-rsi").clientHeight,
    }), 0)
  }

  function showMacdPane(visible) {
    document.getElementById("chart-macd-wrap").classList.toggle("hidden", !visible)
    setTimeout(() => macdChart.applyOptions({
      width: document.getElementById("chart-macd").clientWidth,
      height: document.getElementById("chart-macd").clientHeight,
    }), 0)
  }

  function showStochPane(visible) {
    document.getElementById("chart-stoch-wrap").classList.toggle("hidden", !visible)
    setTimeout(() => stochChart.applyOptions({
      width: document.getElementById("chart-stoch").clientWidth,
      height: document.getElementById("chart-stoch").clientHeight,
    }), 0)
  }

  // ── Events ───────────────────────────────────────────
  function updateLastPrice(price) {
    if (!currentData.length) return
    const last = currentData[currentData.length - 1]
    const updated = {
      time:  last.time,
      open:  last.open,
      high:  Math.max(last.high, price),
      low:   Math.min(last.low,  price),
      close: price,
    }
    candleSeries.update(updated)
    currentData[currentData.length - 1] = { ...last, ...updated }
  }

  function updateCandle(candle) {
    candleSeries.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close })
    volumeSeries.update({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? "#1ce3ed33" : "#ff962e33" })
    if (candle.time > (currentData.at(-1)?.time ?? 0)) {
      currentData.push(candle)
    } else {
      currentData[currentData.length - 1] = candle
    }
  }

  function onCrosshairMove(cb) { mainChart.subscribeCrosshairMove(cb) }
  function onClick(cb)         { mainChart.subscribeClick(cb) }

  function getCandleAt(time) { return currentData.find(c => c.time === time) || null }

  function getChart()       { return mainChart }
  function getCandleSeries(){ return candleSeries }

  return {
    init, setData, updateCandle, updateLastPrice, setMarkers, addMarker, removeMarker,
    setIndicator, clearIndicator, clearAllIndicators,
    showRsiPane, showMacdPane, showStochPane,
    onCrosshairMove, onClick, getCandleAt,
    getChart, getCandleSeries,
  }
})()
