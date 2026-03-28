const ChartManager = (() => {
  let mainChart, candleSeries, volumeSeries
  let rsiChart,  rsiSeries,  rsiOb, rsiOs
  let macdChart, macdHistSeries, macdLineSeries, macdSignalSeries
  let stochChart, stochKSeries, stochDSeries, stochOb, stochOs, stochZero
  let overlaySeries = {}   // keyed by indicator name
  let currentData  = []
  let markers      = []
  let _syncingRange = false

  let chartType    = "candles"
  let upColor      = "#1ce3ed"
  let downColor    = "#ff962e"
  let primitiveSeries = null

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

  // ── Heikin Ashi calculator ────────────────────────────
  function _calcHA(data) {
    const r = []
    for (let i = 0; i < data.length; i++) {
      const c = data[i]
      const haC = (c.open + c.high + c.low + c.close) / 4
      const haO = i === 0 ? (c.open + c.close) / 2 : (r[i-1].open + r[i-1].close) / 2
      r.push({ time: c.time, open: haO, high: Math.max(c.high, haO, haC), low: Math.min(c.low, haO, haC), close: haC })
    }
    return r
  }

  // ── Visual series factory ─────────────────────────────
  function _makeVisualSeries() {
    if (candleSeries) {
      mainChart.removeSeries(candleSeries)
      candleSeries = null
    }

    switch (chartType) {
      case "candles":
        candleSeries = mainChart.addCandlestickSeries({
          upColor, downColor,
          borderUpColor: upColor, borderDownColor: downColor,
          wickUpColor:   upColor, wickDownColor:   downColor,
        })
        break

      case "hollow":
        candleSeries = mainChart.addCandlestickSeries({
          upColor: "transparent", downColor,
          borderUpColor: upColor, borderDownColor: downColor,
          wickUpColor:   upColor, wickDownColor:   downColor,
        })
        break

      case "bars":
        candleSeries = mainChart.addBarSeries({
          upColor, downColor,
        })
        break

      case "hlc-bars":
        candleSeries = mainChart.addBarSeries({
          upColor, downColor,
          openVisible: false,
        })
        break

      case "heikin-ashi":
        candleSeries = mainChart.addCandlestickSeries({
          upColor, downColor,
          borderUpColor: upColor, borderDownColor: downColor,
          wickUpColor:   upColor, wickDownColor:   downColor,
        })
        break

      case "line":
        candleSeries = mainChart.addLineSeries({
          color: upColor, lineWidth: 1, priceLineVisible: false,
        })
        break

      case "line-markers":
        candleSeries = mainChart.addLineSeries({
          color: upColor, lineWidth: 1, priceLineVisible: false,
          crosshairMarkerVisible: true,
        })
        break

      case "step-line":
        candleSeries = mainChart.addLineSeries({
          color: upColor, lineWidth: 1, priceLineVisible: false,
          lineType: LightweightCharts.LineType.WithSteps,
        })
        break

      case "area":
        candleSeries = mainChart.addAreaSeries({
          lineColor: upColor,
          topColor:    upColor + "44",
          bottomColor: upColor + "00",
          priceLineVisible: false,
        })
        break

      case "baseline":
        candleSeries = mainChart.addBaselineSeries({
          topLineColor:    upColor,
          bottomLineColor: downColor,
          priceLineVisible: false,
        })
        break

      case "columns":
        candleSeries = mainChart.addHistogramSeries({
          priceLineVisible: false,
        })
        break

      default:
        candleSeries = mainChart.addCandlestickSeries({
          upColor, downColor,
          borderUpColor: upColor, borderDownColor: downColor,
          wickUpColor:   upColor, wickDownColor:   downColor,
        })
        break
    }
  }

  // ── Data format helper ────────────────────────────────
  function _seriesData(type, data) {
    switch (type) {
      case "candles":
      case "hollow":
      case "bars":
      case "hlc-bars":
        return data.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))

      case "heikin-ashi":
        return _calcHA(data)

      case "line":
      case "line-markers":
      case "step-line":
      case "area":
      case "baseline":
        return data.map(c => ({ time: c.time, value: c.close }))

      case "columns":
        return data.map(c => ({
          time:  c.time,
          value: Math.abs(c.close - c.open),
          color: c.close >= c.open ? upColor + "88" : downColor + "88",
        }))

      default:
        return data.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
    }
  }

  // ── Chart type switcher ───────────────────────────────
  function setChartType(type) {
    chartType = type
    _makeVisualSeries()
    candleSeries.setData(_seriesData(type, currentData))
    candleSeries.setMarkers(markers)
    primitiveSeries.setData(currentData.map(c => ({ time: c.time, value: c.close })))
  }

  function setColors(up, down) {
    upColor   = up
    downColor = down
    setChartType(chartType)
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    const mainContainer = document.getElementById("chart-main")
    mainChart = makeChart(mainContainer)
    observeResize(mainContainer, mainChart)

    candleSeries = mainChart.addCandlestickSeries({
      upColor, downColor,
      borderUpColor: upColor, borderDownColor: downColor,
      wickUpColor:   upColor, wickDownColor:   downColor,
    })

    volumeSeries = mainChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    })
    mainChart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    // Persistent primitive series — invisible, never removed, used by Drawing layer
    primitiveSeries = mainChart.addLineSeries({
      visible:                false,
      lastValueVisible:       false,
      priceLineVisible:       false,
      crosshairMarkerVisible: false,
    })

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

    // Full-height vertical crosshair line spanning all panes
    const chartArea = document.getElementById("chart-area")
    const vLine = document.createElement("div")
    vLine.style.cssText = [
      "position:absolute", "top:0", "bottom:0", "width:0",
      "border-left:1px dashed #55556a",
      "pointer-events:none", "z-index:10", "display:none",
    ].join(";")
    chartArea.appendChild(vLine)

    const mainEl = document.getElementById("chart-main")
    let _cachedOffset = null
    const _refreshOffset = () => {
      const ar = chartArea.getBoundingClientRect()
      const mr = mainEl.getBoundingClientRect()
      _cachedOffset = mr.left - ar.left
    }
    _refreshOffset()
    new ResizeObserver(_refreshOffset).observe(chartArea)

    mainChart.subscribeCrosshairMove(param => {
      if (!param.point || param.point.x < 0) { vLine.style.display = "none"; return }
      vLine.style.left    = (_cachedOffset + param.point.x) + "px"
      vLine.style.display = "block"
    })
  }

  // Candles to show by default per timeframe
  const _TF_BARS = {
    "1m": 120, "5m": 96, "15m": 96, "30m": 72,
    "1h": 72, "4h": 60, "1d": 60,
  }

  function setView(timeframe) {
    if (!currentData.length) return
    const bars = _TF_BARS[timeframe] || 60
    const last  = currentData.length - 1
    const from  = Math.max(0, last - bars + 1)
    mainChart.timeScale().setVisibleLogicalRange({ from, to: last + 3 })
  }

  // ── Data ─────────────────────────────────────────────
  function setData(candles) {
    currentData = candles
    candleSeries.setData(_seriesData(chartType, candles))
    volumeSeries.setData(candles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? "#1ce3ed33" : "#ff962e33",
    })))
    primitiveSeries.setData(candles.map(c => ({ time: c.time, value: c.close })))
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
    // Snapshot the main chart range before sub-chart setData triggers sync events,
    // then restore it so indicator loading never moves the viewport.
    const _savedRange = mainChart.timeScale().getVisibleLogicalRange()
    const _restore = () => {
      if (_savedRange) mainChart.timeScale().setVisibleLogicalRange(_savedRange)
    }

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
        rsiOb.setData(times.map(t => ({ time: t, value: 70 })))
        rsiOs.setData(times.map(t => ({ time: t, value: 30 })))
      }
      _restore(); return
    }
    if (name === "macd_line")   { macdLineSeries.setData(data);   _restore(); return }
    if (name === "macd_signal") { macdSignalSeries.setData(data); _restore(); return }
    if (name === "macd_hist")   { macdHistSeries.setData(data);   _restore(); return }

    if (name === "stoch_k") {
      stochKSeries.setData(data)
      const times = data.map(d => d.time)
      if (times.length) {
        stochOb.setData(  times.map(t => ({ time: t, value:  0.8 })))
        stochOs.setData(  times.map(t => ({ time: t, value: -0.8 })))
        stochZero.setData(times.map(t => ({ time: t, value:  0.0 })))
      }
      _restore(); return
    }
    if (name === "stoch_d") { stochDSeries.setData(data); _restore(); return }

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

  function _showPane(wrapId, chartId, subChart, visible) {
    const range = mainChart.timeScale().getVisibleLogicalRange()
    document.getElementById(wrapId).classList.toggle("hidden", !visible)
    setTimeout(() => {
      subChart.applyOptions({
        width:  document.getElementById(chartId).clientWidth,
        height: document.getElementById(chartId).clientHeight,
      })
      if (range) mainChart.timeScale().setVisibleLogicalRange(range)
    }, 0)
  }

  function showRsiPane(visible)  { _showPane("chart-rsi-wrap",   "chart-rsi",   rsiChart,   visible) }
  function showMacdPane(visible) { _showPane("chart-macd-wrap",  "chart-macd",  macdChart,  visible) }
  function showStochPane(visible){ _showPane("chart-stoch-wrap", "chart-stoch", stochChart, visible) }

  // ── Events ───────────────────────────────────────────
  function updateLastPrice(price) {
    if (!currentData.length) return
    const last = currentData[currentData.length - 1]

    const isOHLC = ["candles", "hollow", "bars", "hlc-bars", "heikin-ashi"].includes(chartType)
    if (isOHLC) {
      const updated = {
        time:  last.time,
        open:  last.open,
        high:  Math.max(last.high, price),
        low:   Math.min(last.low,  price),
        close: price,
      }
      candleSeries.update(chartType === "heikin-ashi"
        ? _calcHA([{ ...last, ...updated }])[0]
        : updated
      )
      currentData[currentData.length - 1] = { ...last, ...updated }
    } else {
      candleSeries.update({ time: last.time, value: price })
      currentData[currentData.length - 1] = { ...last, close: price }
    }

    primitiveSeries.update({ time: last.time, value: price })
  }

  function updateCandle(candle) {
    const isNewCandle = candle.time > (currentData.at(-1)?.time ?? 0)

    switch (chartType) {
      case "candles":
      case "hollow":
      case "bars":
      case "hlc-bars":
        candleSeries.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close })
        break

      case "heikin-ashi": {
        // Recalculate last 2 HA candles so haO of the new bar is correct
        const prev = currentData.length >= 2 ? currentData[currentData.length - 2] : null
        const last = currentData.at(-1)
        if (!isNewCandle && last && prev) {
          const haData = _calcHA([prev, candle])
          candleSeries.update(haData[1])
        } else if (!isNewCandle && last) {
          candleSeries.update(_calcHA([candle])[0])
        } else {
          // new bar: use previous HA close/open to seed haO
          const prevHA = currentData.length
            ? _calcHA(currentData.slice(-1))[0]
            : null
          const haO = prevHA ? (prevHA.open + prevHA.close) / 2 : (candle.open + candle.close) / 2
          const haC = (candle.open + candle.high + candle.low + candle.close) / 4
          candleSeries.update({
            time:  candle.time,
            open:  haO,
            high:  Math.max(candle.high, haO, haC),
            low:   Math.min(candle.low,  haO, haC),
            close: haC,
          })
        }
        break
      }

      case "line":
      case "line-markers":
      case "step-line":
      case "area":
      case "baseline":
        candleSeries.update({ time: candle.time, value: candle.close })
        break

      case "columns":
        candleSeries.update({
          time:  candle.time,
          value: Math.abs(candle.close - candle.open),
          color: candle.close >= candle.open ? upColor + "88" : downColor + "88",
        })
        break

      default:
        candleSeries.update({ time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close })
        break
    }

    volumeSeries.update({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? "#1ce3ed33" : "#ff962e33" })
    primitiveSeries.update({ time: candle.time, value: candle.close })

    if (isNewCandle) {
      currentData.push(candle)
    } else {
      currentData[currentData.length - 1] = candle
    }
  }

  function onCrosshairMove(cb) { mainChart.subscribeCrosshairMove(cb) }
  function onClick(cb)         { mainChart.subscribeClick(cb) }

  function getCandleAt(time) { return currentData.find(c => c.time === time) || null }

  function getChart()        { return mainChart }
  function getCandleSeries() { return primitiveSeries }

  return {
    init, setData, setView, updateCandle, updateLastPrice, setMarkers, addMarker, removeMarker,
    setIndicator, clearIndicator, clearAllIndicators,
    showRsiPane, showMacdPane, showStochPane,
    onCrosshairMove, onClick, getCandleAt,
    getChart, getCandleSeries,
    setChartType, setColors,
  }
})()
