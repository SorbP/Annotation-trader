const ChartManager = (() => {
  let chart, candleSeries, volumeSeries
  let currentData = []
  let markers = []

  function init(container) {
    chart = LightweightCharts.createChart(container, {
      layout: {
        background: { color: "#0d0d0f" },
        textColor: "#6b6b7a",
      },
      grid: {
        vertLines: { color: "#1a1a1f" },
        horzLines: { color: "#1a1a1f" },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "#2a2a32",
      },
      timeScale: {
        borderColor: "#2a2a32",
        timeVisible: true,
        secondsVisible: false,
      },
    })

    // Candlestick series
    candleSeries = chart.addCandlestickSeries({
      upColor:         "#1ce3ed",
      downColor:       "#ff962e",
      borderUpColor:   "#1ce3ed",
      borderDownColor: "#ff962e",
      wickUpColor:     "#1ce3ed",
      wickDownColor:   "#ff962e",
    })

    // Volume series in a separate pane
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    })
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    // Resize observer
    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      })
    })
    ro.observe(container)

    chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight,
    })

    return chart
  }

  function setData(candles) {
    currentData = candles
    candleSeries.setData(candles.map(c => ({
      time:  c.time,
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    })))
    volumeSeries.setData(candles.map(c => ({
      time:  c.time,
      value: c.volume,
      color: c.close >= c.open ? "#1ce3ed44" : "#ff962e44",
    })))
    chart.timeScale().fitContent()
  }

  function setMarkers(annotations) {
    markers = annotations.map(a => ({
      time:     Math.floor(new Date(a.signal_time).getTime() / 1000),
      position: a.signal > 0 ? "belowBar" : "aboveBar",
      color:    a.signal > 0 ? "#26a69a" : "#ef5350",
      shape:    a.signal > 0 ? "arrowUp"  : "arrowDown",
      text:     (a.signal > 0 ? "+" : "") + a.signal,
      id:       a.id,
    }))
    candleSeries.setMarkers(markers)
  }

  function addMarker(annotation) {
    markers = [...markers, {
      time:     Math.floor(new Date(annotation.signal_time).getTime() / 1000),
      position: annotation.signal > 0 ? "belowBar" : "aboveBar",
      color:    annotation.signal > 0 ? "#26a69a" : "#ef5350",
      shape:    annotation.signal > 0 ? "arrowUp"  : "arrowDown",
      text:     (annotation.signal > 0 ? "+" : "") + annotation.signal,
      id:       annotation.id,
    }].sort((a, b) => a.time - b.time)
    candleSeries.setMarkers(markers)
  }

  function removeMarker(annotationId) {
    markers = markers.filter(m => m.id !== annotationId)
    candleSeries.setMarkers(markers)
  }

  function onCrosshairMove(cb) {
    chart.subscribeCrosshairMove(cb)
  }

  function onClick(cb) {
    chart.subscribeClick(cb)
  }

  function getCandleAt(time) {
    return currentData.find(c => c.time === time) || null
  }

  return { init, setData, setMarkers, addMarker, removeMarker, onCrosshairMove, onClick, getCandleAt }
})()
