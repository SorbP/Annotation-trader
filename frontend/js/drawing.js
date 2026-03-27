const Drawing = (() => {
  let activeTool = "pointer"
  let hlines     = []    // { priceLine }
  let trendlines = []    // { primitive, series }
  let pendingTrendP1 = null  // first click of trendline

  // ── Tool selection ────────────────────────────────────
  function setTool(tool) {
    activeTool = tool
    document.querySelectorAll(".draw-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.tool === tool)
    })
    const el = document.getElementById("chart-main")
    el.style.cursor = tool === "pointer" ? "crosshair" : "cell"
    pendingTrendP1 = null
  }

  function getTool() { return activeTool }

  // ── Horizontal line ───────────────────────────────────
  function placeHLine(price) {
    const series = ChartManager.getCandleSeries()
    const pl = series.createPriceLine({
      price,
      color:            "#ffffff88",
      lineWidth:        1,
      lineStyle:        LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title:            "",
    })
    hlines.push({ priceLine: pl })
  }

  // ── Trend line ────────────────────────────────────────
  class TrendLineRenderer {
    constructor(p1, p2, chartRef, seriesRef) {
      this._p1 = p1; this._p2 = p2
      this._chart = chartRef; this._series = seriesRef
    }

    draw(target) {
      const x1 = this._chart.timeScale().timeToCoordinate(this._p1.time)
      const y1 = this._series.priceToCoordinate(this._p1.price)
      const x2 = this._chart.timeScale().timeToCoordinate(this._p2.time)
      const y2 = this._series.priceToCoordinate(this._p2.price)
      if (x1 === null || y1 === null || x2 === null || y2 === null) return

      target.useMediaCoordinateSpace(scope => {
        const ctx = scope.context
        ctx.save()
        ctx.strokeStyle = "#ffffff99"
        ctx.lineWidth   = 1
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()

        // Endpoint dots
        ctx.fillStyle = "#ffffffcc"
        ;[[x1, y1], [x2, y2]].forEach(([x, y]) => {
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill()
        })
        ctx.restore()
      })
    }
  }

  class TrendLinePrimitive {
    constructor(p1, p2) {
      this._p1 = p1; this._p2 = p2
      this._chart  = null
      this._series = null
      this._views  = []
    }

    attached({ chart, series }) {
      this._chart  = chart
      this._series = series
      this._views  = [{ renderer: () => new TrendLineRenderer(this._p1, this._p2, chart, series) }]
    }

    paneViews()     { return this._views }
    updateAllViews(){}
  }

  function placeTrendLine(p1, p2) {
    const series    = ChartManager.getCandleSeries()
    const primitive = new TrendLinePrimitive(p1, p2)
    series.attachPrimitive(primitive)
    trendlines.push({ primitive, series })
  }

  // ── Handle chart click ────────────────────────────────
  function handleClick(param) {
    if (!param.time) return

    if (activeTool === "hline") {
      if (param.point) {
        const series = ChartManager.getCandleSeries()
        const price  = series.coordinateToPrice(param.point.y)
        if (price !== null) placeHLine(price)
      }
      return
    }

    if (activeTool === "trendline") {
      const candle = ChartManager.getCandleAt(param.time)
      if (!candle) return
      const point = { time: candle.time, price: candle.close }

      if (!pendingTrendP1) {
        pendingTrendP1 = point
      } else {
        placeTrendLine(pendingTrendP1, point)
        pendingTrendP1 = null
      }
      return
    }
  }

  // ── Clear all ─────────────────────────────────────────
  function clearAll() {
    const series = ChartManager.getCandleSeries()
    hlines.forEach(({ priceLine }) => series.removePriceLine(priceLine))
    trendlines.forEach(({ primitive, series: s }) => s.detachPrimitive(primitive))
    hlines    = []
    trendlines = []
    pendingTrendP1 = null
  }

  return { setTool, getTool, handleClick, clearAll }
})()
