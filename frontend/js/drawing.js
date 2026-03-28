const Drawing = (() => {
  let activeTool     = "pointer"
  let drawings       = []
  let pendingTrendP1 = null
  let pendingFibP1   = null
  let hoveredId      = null
  let selectedId     = null
  let dragState      = null
  let snapEnabled    = false  // toggled by the snap button
  let snapTarget     = null   // { time, price } — current magnetic snap point

  const _chart  = () => ChartManager.getChart()
  const _series = () => ChartManager.getCandleSeries()

  function _fmtPrice(p) {
    if (p === null || p === undefined) return ""
    const abs = Math.abs(p)
    if (abs >= 1000) return p.toFixed(2)
    if (abs >= 1)    return p.toFixed(4)
    return p.toFixed(6)
  }

  let _rafPending = false
  function _forceRedraw() {
    if (_rafPending) return
    _rafPending = true
    requestAnimationFrame(() => {
      _rafPending = false
      try { _chart().applyOptions({}) } catch (_) {}
    })
  }

  // ── Tool ─────────────────────────────────────────────
  function setTool(tool) {
    activeTool     = tool
    pendingTrendP1 = null
    pendingFibP1   = null
    snapTarget     = null
    _hideSnapDot()
    document.querySelectorAll(".draw-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.tool === tool))
    PropPanel.hide()
  }
  function getTool() { return activeTool }

  // ── Snap indicator ────────────────────────────────────
  function _showSnapDot(x, y) {
    const dot = document.getElementById("snap-dot")
    if (!dot || x === null || y === null) return
    dot.style.left    = x + "px"
    dot.style.top     = y + "px"
    dot.style.display = "block"
  }
  function _hideSnapDot() {
    const dot = document.getElementById("snap-dot")
    if (dot) dot.style.display = "none"
  }

  function toggleSnap() {
    snapEnabled = !snapEnabled
    document.getElementById("snap-btn").classList.toggle("active", snapEnabled)
    if (!snapEnabled) { snapTarget = null; _hideSnapDot() }
  }

  // Called on every crosshair move — updates snap target
  function _onCrosshairMove(param) {
    if (!snapEnabled || !param.time || !param.point) {
      snapTarget = null
      _hideSnapDot()
      return
    }
    const candle = ChartManager.getCandleAt(param.time)
    if (!candle) { snapTarget = null; _hideSnapDot(); return }

    const mouseY = param.point.y
    const candidates = [
      { price: candle.high  },
      { price: candle.low   },
      { price: candle.open  },
      { price: candle.close },
    ]

    let best = null, minDist = Infinity
    candidates.forEach(c => {
      const py = _series().priceToCoordinate(c.price)
      if (py === null) return
      const d = Math.abs(py - mouseY)
      if (d < minDist) { minDist = d; best = { ...c, py } }
    })

    if (best) {
      snapTarget = { time: candle.time, price: best.price }
      const px = _chart().timeScale().timeToCoordinate(candle.time)
      _showSnapDot(px, best.py)
    } else {
      snapTarget = null
      _hideSnapDot()
    }
  }

  // ── H-Line primitive ──────────────────────────────────
  class HLineRenderer {
    constructor(d, series) { this._d = d; this._s = series }
    draw(target) {
      const y = this._s.priceToCoordinate(this._d.price)
      if (y === null) return
      const isSelected = this._d.id === selectedId
      const isHovered  = this._d.id === hoveredId
      target.useMediaCoordinateSpace(scope => {
        const ctx = scope.context
        const w   = scope.mediaSize.width
        ctx.save()
        ctx.globalAlpha = isSelected ? 1 : isHovered ? 0.9 : 0.7
        ctx.strokeStyle = this._d.color
        ctx.lineWidth   = isSelected ? this._d.lineWidth + 0.5 : this._d.lineWidth
        if      (this._d.lineStyle === "dashed") ctx.setLineDash([8, 5])
        else if (this._d.lineStyle === "dotted") ctx.setLineDash([2, 4])
        else ctx.setLineDash([])
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()

        // Selection handle
        if (isSelected) {
          ctx.setLineDash([])
          ctx.fillStyle = this._d.color
          ctx.beginPath(); ctx.arc(w / 2, y, 5, 0, Math.PI * 2); ctx.fill()
        }
        ctx.restore()
      })
    }
  }

  class HLinePriceAxisView {
    constructor(d, series) { this._d = d; this._s = series }
    coordinate() { return this._s ? (this._s.priceToCoordinate(this._d.price) ?? -9999) : -9999 }
    text()       { return _fmtPrice(this._d.price) }
    textColor()  { return "#000000" }
    backColor()  { return this._d.color }
  }

  class HLinePrimitive {
    constructor(d) { this._d = d; this._s = null }
    attached({ series })  { this._s = series }
    paneViews()           { return [{ renderer: () => new HLineRenderer(this._d, this._s) }] }
    priceAxisViews()      { return [new HLinePriceAxisView(this._d, this._s)] }
    updateAllViews()      {}
  }

  // ── Trend-line primitive ──────────────────────────────
  class TrendLineRenderer {
    constructor(d, chart, series) { this._d = d; this._c = chart; this._s = series }
    draw(target) {
      const x1 = this._c.timeScale().timeToCoordinate(this._d.p1.time)
      const y1 = this._s.priceToCoordinate(this._d.p1.price)
      const x2 = this._c.timeScale().timeToCoordinate(this._d.p2.time)
      const y2 = this._s.priceToCoordinate(this._d.p2.price)
      if (x1 === null || y1 === null || x2 === null || y2 === null) return
      const isSelected = this._d.id === selectedId
      const isHovered  = this._d.id === hoveredId
      target.useMediaCoordinateSpace(scope => {
        const ctx = scope.context
        ctx.save()
        ctx.globalAlpha = isSelected ? 1 : isHovered ? 0.9 : 0.7
        ctx.strokeStyle = this._d.color
        ctx.lineWidth   = this._d.lineWidth
        if      (this._d.lineStyle === "dashed") ctx.setLineDash([8, 5])
        else if (this._d.lineStyle === "dotted") ctx.setLineDash([2, 4])
        else ctx.setLineDash([])
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = this._d.color
        const r = isSelected ? 5 : 3
        ;[[x1, y1], [x2, y2]].forEach(([x, y]) => {
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
        })
        ctx.restore()
      })
    }
  }

  class TrendLinePriceAxisView {
    constructor(d, getPrice, series) { this._d = d; this._getP = getPrice; this._s = series }
    coordinate() { return this._s ? (this._s.priceToCoordinate(this._getP()) ?? -9999) : -9999 }
    text()       { return _fmtPrice(this._getP()) }
    textColor()  { return "#000000" }
    backColor()  { return this._d.color }
  }

  class TrendLinePrimitive {
    constructor(d) { this._d = d; this._c = null; this._s = null }
    attached({ chart, series }) { this._c = chart; this._s = series }
    paneViews()      { return [{ renderer: () => new TrendLineRenderer(this._d, this._c, this._s) }] }
    priceAxisViews() {
      return [
        new TrendLinePriceAxisView(this._d, () => this._d.p1.price, this._s),
        new TrendLinePriceAxisView(this._d, () => this._d.p2.price, this._s),
      ]
    }
    updateAllViews() {}
  }

  // ── Fibonacci ─────────────────────────────────────────
  const FIB_DEFAULTS = [
    { ratio: 0,     label: "0%",          color: "#6b6b7a", lineStyle: "dashed", lineWidth: 1,   enabled: false },
    { ratio: 0.236, label: "23.6%",       color: "#f0e040", lineStyle: "dashed", lineWidth: 1,   enabled: true  },
    { ratio: 0.382, label: "38.2%",       color: "#26a69a", lineStyle: "dashed", lineWidth: 1,   enabled: true  },
    { ratio: 0.5,   label: "50%",         color: "#1ce3ed", lineStyle: "dashed", lineWidth: 1,   enabled: true  },
    { ratio: 0.618, label: "61.8%",       color: "#ffd700", lineStyle: "solid",  lineWidth: 2,   enabled: true  },
    { ratio: 0.65,  label: "65% \u2605GP",color: "#ffd700", lineStyle: "solid",  lineWidth: 2,   enabled: true  },
    { ratio: 0.786, label: "78.6%",       color: "#e040fb", lineStyle: "dashed", lineWidth: 1,   enabled: true  },
    { ratio: 1,     label: "100%",        color: "#6b6b7a", lineStyle: "dashed", lineWidth: 1,   enabled: false },
  ]

  function _fibPrice(d, ratio) {
    return d.p2.price + ratio * (d.p1.price - d.p2.price)
  }

  class FibRenderer {
    constructor(d, chart, series) { this._d = d; this._c = chart; this._s = series }
    draw(target) {
      if (!this._s) return
      const isSelected = this._d.id === selectedId
      const isHovered  = this._d.id === hoveredId
      target.useMediaCoordinateSpace(scope => {
        const ctx = scope.context
        const w   = scope.mediaSize.width
        ctx.save()
        ctx.globalAlpha = isSelected ? 1 : isHovered ? 0.9 : 0.8
        ctx.font        = "10px 'Segoe UI', sans-serif"

        this._d.levels.forEach(lv => {
          if (!lv.enabled) return
          const price = _fibPrice(this._d, lv.ratio)
          const y     = this._s.priceToCoordinate(price)
          if (y === null) return
          ctx.strokeStyle = lv.color
          ctx.lineWidth   = lv.lineWidth
          if      (lv.lineStyle === "dashed") ctx.setLineDash([6, 4])
          else if (lv.lineStyle === "dotted") ctx.setLineDash([2, 4])
          else ctx.setLineDash([])
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = lv.color
          ctx.fillText(lv.label, 6, y - 3)
        })

        // Anchor point handles when selected
        if (isSelected && this._c) {
          const anchors = [this._d.p1, this._d.p2]
          anchors.forEach(pt => {
            const x = this._c.timeScale().timeToCoordinate(pt.time)
            const y = this._s.priceToCoordinate(pt.price)
            if (x === null || y === null) return
            ctx.globalAlpha = 1
            ctx.strokeStyle = "#ffffff"
            ctx.lineWidth   = 2
            ctx.fillStyle   = "rgba(255,255,255,0.15)"
            ctx.setLineDash([])
            ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2)
            ctx.fill(); ctx.stroke()
          })
        }

        ctx.restore()
      })
    }
  }

  class FibPriceAxisView {
    constructor(d, lv, series) { this._d = d; this._lv = lv; this._s = series }
    coordinate() {
      if (!this._s || !this._lv.enabled) return -9999
      return this._s.priceToCoordinate(_fibPrice(this._d, this._lv.ratio)) ?? -9999
    }
    text()      { return _fmtPrice(_fibPrice(this._d, this._lv.ratio)) }
    textColor() { return "#000000" }
    backColor() { return this._lv.color }
  }

  class FibPrimitive {
    constructor(d) { this._d = d; this._c = null; this._s = null }
    attached({ chart, series }) { this._c = chart; this._s = series }
    paneViews()      { return [{ renderer: () => new FibRenderer(this._d, this._c, this._s) }] }
    priceAxisViews() { return this._d.levels.map(lv => new FibPriceAxisView(this._d, lv, this._s)) }
    updateAllViews() {}
  }

  // ── Place drawings ────────────────────────────────────
  function placeHLine(price, opts = {}) {
    const d = {
      id: crypto.randomUUID(), type: "hline", price,
      color: opts.color || "#ffffff", lineWidth: opts.lineWidth || 1, lineStyle: opts.lineStyle || "dashed",
    }
    d.primitive = new HLinePrimitive(d)
    _series().attachPrimitive(d.primitive)
    drawings.push(d)
    return d
  }

  function placeFib(p1, p2) {
    const d = {
      id: crypto.randomUUID(), type: "fib", p1, p2,
      levels: FIB_DEFAULTS.map(lv => ({ ...lv })),
    }
    d.primitive = new FibPrimitive(d)
    _series().attachPrimitive(d.primitive)
    drawings.push(d)
    return d
  }

  function placeTrendLine(p1, p2) {
    const d = {
      id: crypto.randomUUID(), type: "trendline", p1, p2,
      color: "#ffffff", lineWidth: 1, lineStyle: "solid",
    }
    d.primitive = new TrendLinePrimitive(d)
    _series().attachPrimitive(d.primitive)
    drawings.push(d)
    return d
  }

  // ── Hit detection ─────────────────────────────────────
  const HIT_PX = 7

  function findNear(clientX, clientY) {
    const rect = document.getElementById("chart-main").getBoundingClientRect()
    const lx = clientX - rect.left, ly = clientY - rect.top
    for (const d of drawings) {
      if (d.type === "hline") {
        const lineY = _series().priceToCoordinate(d.price)
        if (lineY !== null && Math.abs(ly - lineY) <= HIT_PX) return d
      } else if (d.type === "trendline") {
        const x1 = _chart().timeScale().timeToCoordinate(d.p1.time)
        const y1 = _series().priceToCoordinate(d.p1.price)
        const x2 = _chart().timeScale().timeToCoordinate(d.p2.time)
        const y2 = _series().priceToCoordinate(d.p2.price)
        if (x1 === null || y1 === null || x2 === null || y2 === null) continue
        if (_ptSegDist(lx, ly, x1, y1, x2, y2) <= HIT_PX) return d
      } else if (d.type === "fib") {
        for (const lv of d.levels) {
          if (!lv.enabled) continue
          const lineY = _series().priceToCoordinate(_fibPrice(d, lv.ratio))
          if (lineY !== null && Math.abs(ly - lineY) <= HIT_PX) return d
        }
      }
    }
    return null
  }

  function _ptSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (!lenSq) return Math.hypot(px - ax, py - ay)
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  }

  // ── Mutate / delete ───────────────────────────────────
  function removeDrawing(id) {
    const idx = drawings.findIndex(d => d.id === id)
    if (idx === -1) return
    _series().detachPrimitive(drawings[idx].primitive)
    drawings.splice(idx, 1)
    if (hoveredId  === id) hoveredId  = null
    if (selectedId === id) selectedId = null
    _forceRedraw()
  }

  function updateDrawing(id, props) {
    const d = drawings.find(d => d.id === id)
    if (!d) return
    Object.assign(d, props)
    _forceRedraw()
  }

  // ── Mouse & keyboard events ───────────────────────────
  function _initEvents() {
    const container = document.getElementById("chart-main")

    // Crosshair → snap
    ChartManager.onCrosshairMove(_onCrosshairMove)

    // Hover / cursor
    container.addEventListener("mousemove", e => {
      if (dragState) return
      const d     = findNear(e.clientX, e.clientY)
      const newId = d ? d.id : null
      if (newId !== hoveredId) { hoveredId = newId; _forceRedraw() }
      container.style.cursor = newId ? "grab" : ""
    })

    container.addEventListener("mouseleave", () => {
      if (hoveredId !== null) { hoveredId = null; _forceRedraw() }
    })

    // Drag / select (capture = before LW Charts panning)
    document.addEventListener("mousedown", e => {
      if (e.button !== 0) return
      const d = findNear(e.clientX, e.clientY)

      if (!d) {
        // Clicked on empty chart → deselect
        if (selectedId !== null) { selectedId = null; _forceRedraw() }
        return
      }

      e.stopPropagation()
      e.preventDefault()
      PropPanel.hide()

      // Select it
      selectedId = d.id
      _forceRedraw()

      if (d.type === "hline") {
        const startY = e.clientY, startPrice = d.price
        let moved = false
        dragState = { d }
        document.body.style.cursor = "grabbing"

        function onMove(e) {
          moved = true
          const py = (_series().priceToCoordinate(startPrice) ?? 0) + (e.clientY - startY)
          const p  = _series().coordinateToPrice(py)
          if (p !== null) { d.price = p; _forceRedraw() }
        }
        function onUp(e) {
          document.removeEventListener("mousemove", onMove)
          document.removeEventListener("mouseup",   onUp)
          document.body.style.cursor = ""
          dragState = null
          if (!moved) PropPanel.show(d, e.clientX, e.clientY)
        }
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup",   onUp)
      } else {
        function onUp(e) {
          document.removeEventListener("mouseup", onUp)
          PropPanel.show(d, e.clientX, e.clientY)
        }
        document.addEventListener("mouseup", onUp)
      }
    }, true)

    // Delete key removes selected drawing; Escape deselects
    document.addEventListener("keydown", e => {
      const tag = document.activeElement?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) { removeDrawing(selectedId); PropPanel.hide() }
      }
      if (e.key === "Escape") {
        selectedId = null
        _forceRedraw()
        PropPanel.hide()
      }
    })
  }

  // Returns nearest of candle.high / candle.low based on mouse Y
  function _nearestExtreme(candle, mouseY) {
    if (!candle) return null
    const hy = _series().priceToCoordinate(candle.high)
    const ly = _series().priceToCoordinate(candle.low)
    if (hy === null && ly === null) return candle.close
    if (hy === null) return candle.low
    if (ly === null) return candle.high
    return Math.abs(mouseY - hy) <= Math.abs(mouseY - ly) ? candle.high : candle.low
  }

  // ── Click handler (from ChartManager events) ──────────
  function handleClick(param) {
    if (!param.time) return

    if (activeTool === "hline") {
      // h-lines: snap target if enabled, otherwise exact click price
      const price = snapTarget ? snapTarget.price
        : (param.point ? _series().coordinateToPrice(param.point.y) : null)
      if (price !== null) placeHLine(price)
      return
    }

    if (activeTool === "trendline" || activeTool === "fib") {
      // snap target if enabled; otherwise nearest high/low by mouse Y
      let pt
      if (snapTarget) {
        pt = snapTarget
      } else {
        const candle = ChartManager.getCandleAt(param.time)
        if (!candle) return
        const price = _nearestExtreme(candle, param.point?.y ?? 0)
        pt = { time: candle.time, price }
      }

      if (activeTool === "trendline") {
        if (!pendingTrendP1) { pendingTrendP1 = pt }
        else { placeTrendLine(pendingTrendP1, pt); pendingTrendP1 = null }
      } else {
        if (!pendingFibP1) { pendingFibP1 = pt }
        else { placeFib(pendingFibP1, pt); pendingFibP1 = null }
      }
    }
  }

  // ── Clear all ─────────────────────────────────────────
  function clearAll() {
    drawings.forEach(d => _series().detachPrimitive(d.primitive))
    drawings = []; hoveredId = null; selectedId = null; dragState = null
    pendingTrendP1 = null; pendingFibP1 = null; snapTarget = null
    _hideSnapDot(); PropPanel.hide(); _forceRedraw()
  }

  // ── Property panel (dynamic content) ─────────────────
  const PropPanel = (() => {
    function _el() { return document.getElementById("drawing-props") }

    function show(d, x, y) {
      const el = _el()
      d.type === "fib" ? _buildFib(el, d) : _buildLine(el, d)
      el.classList.remove("hidden")
      const pw = el.offsetWidth || 240, ph = el.offsetHeight || 200
      el.style.left = Math.min(x, window.innerWidth  - pw - 8) + "px"
      el.style.top  = Math.min(y, window.innerHeight - ph - 8) + "px"
    }

    function _buildLine(el, d) {
      const PRESETS = ["#ffffff", "#1ce3ed", "#ff962e", "#f0e040", "#e040fb", "#ff6b9d", "#26a69a"]
      const col = (d.color || "#ffffff").slice(0, 7)
      el.innerHTML = `
        <div class="props-section-label">Color</div>
        <div class="props-colors">
          ${PRESETS.map(c => `<span class="color-dot${col === c ? " active" : ""}" data-color="${c}" style="background:${c}"></span>`).join("")}
          <input type="color" id="props-color-input" value="${col}">
        </div>
        <div class="props-section-label">Style</div>
        <div class="props-row">
          <button class="props-btn${d.lineStyle === "solid"  ? " active" : ""}" data-style="solid">— Solid</button>
          <button class="props-btn${d.lineStyle === "dashed" ? " active" : ""}" data-style="dashed">╌ Dashed</button>
          <button class="props-btn${d.lineStyle === "dotted" ? " active" : ""}" data-style="dotted">··· Dotted</button>
        </div>
        <div class="props-section-label">Width</div>
        <div class="props-row">
          <button class="props-btn${d.lineWidth === 1 ? " active" : ""}" data-width="1">1 px</button>
          <button class="props-btn${d.lineWidth === 2 ? " active" : ""}" data-width="2">2 px</button>
          <button class="props-btn${d.lineWidth === 3 ? " active" : ""}" data-width="3">3 px</button>
        </div>
        <button id="props-delete-btn">Delete line</button>`

      el.querySelectorAll(".color-dot").forEach(dot => dot.addEventListener("click", () => {
        updateDrawing(d.id, { color: dot.dataset.color })
        el.querySelectorAll(".color-dot").forEach(x => x.classList.toggle("active", x === dot))
        el.querySelector("#props-color-input").value = dot.dataset.color
      }))
      el.querySelector("#props-color-input").addEventListener("input", e => {
        updateDrawing(d.id, { color: e.target.value })
        el.querySelectorAll(".color-dot").forEach(x => x.classList.remove("active"))
      })
      el.querySelectorAll("[data-style]").forEach(b => b.addEventListener("click", () => {
        updateDrawing(d.id, { lineStyle: b.dataset.style })
        el.querySelectorAll("[data-style]").forEach(x => x.classList.toggle("active", x === b))
      }))
      el.querySelectorAll("[data-width]").forEach(b => b.addEventListener("click", () => {
        updateDrawing(d.id, { lineWidth: parseInt(b.dataset.width) })
        el.querySelectorAll("[data-width]").forEach(x => x.classList.toggle("active", x === b))
      }))
      el.querySelector("#props-delete-btn").addEventListener("click", () => {
        removeDrawing(d.id); hide()
      })
    }

    function _buildFib(el, d) {
      el.innerHTML = `
        <div class="props-section-label" style="margin-bottom:6px">Fibonacci Levels</div>
        <div id="fib-levels-list"></div>
        <button id="props-delete-btn" style="margin-top:10px;width:100%">Delete Fibonacci</button>`

      const list = el.querySelector("#fib-levels-list")
      d.levels.forEach(lv => {
        const row = document.createElement("div")
        row.className = "fib-level-row" + (lv.enabled ? "" : " fib-disabled")
        row.innerHTML = `
          <input type="checkbox" class="fib-chk" ${lv.enabled ? "checked" : ""} title="Toggle">
          <span class="fib-swatch" style="background:${lv.color}" title="Change color"></span>
          <input type="color" class="fib-cpick" value="${lv.color.slice(0,7)}" style="display:none">
          <span class="fib-lv-label">${lv.label}</span>
          <button class="fib-sty-btn${lv.lineStyle === "solid"  ? " active" : ""}" data-style="solid"  title="Solid">—</button>
          <button class="fib-sty-btn${lv.lineStyle === "dashed" ? " active" : ""}" data-style="dashed" title="Dashed">╌</button>
          <button class="fib-sty-btn${lv.lineStyle === "dotted" ? " active" : ""}" data-style="dotted" title="Dotted">·</button>`
        list.appendChild(row)

        const chk = row.querySelector(".fib-chk")
        const sw  = row.querySelector(".fib-swatch")
        const cp  = row.querySelector(".fib-cpick")

        chk.addEventListener("change", () => {
          lv.enabled = chk.checked
          row.classList.toggle("fib-disabled", !lv.enabled)
          _forceRedraw()
        })
        sw.addEventListener("click", () => cp.click())
        cp.addEventListener("input", () => {
          lv.color = cp.value; sw.style.background = cp.value; _forceRedraw()
        })
        row.querySelectorAll(".fib-sty-btn").forEach(btn => btn.addEventListener("click", () => {
          lv.lineStyle = btn.dataset.style
          row.querySelectorAll(".fib-sty-btn").forEach(b => b.classList.toggle("active", b === btn))
          _forceRedraw()
        }))
      })

      el.querySelector("#props-delete-btn").addEventListener("click", () => {
        removeDrawing(d.id); hide()
      })
    }

    function hide() { _el().classList.add("hidden") }

    function init() {
      document.addEventListener("mousedown", e => {
        const el = _el()
        if (!el.classList.contains("hidden") && !el.contains(e.target)) hide()
      })
    }

    return { show, hide, init }
  })()

  // ── Public init ───────────────────────────────────────
  function init() { _initEvents(); PropPanel.init() }

  return {
    init, setTool, getTool, handleClick, clearAll, placeHLine, findNear, toggleSnap,
    showProps: (d, x, y) => PropPanel.show(d, x, y),
  }
})()
