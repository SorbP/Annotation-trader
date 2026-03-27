const PaneManager = (() => {
  const area = () => document.getElementById("chart-area")

  // Returns visible sub-chart panes in current DOM order
  function visiblePanes() {
    return [...area().querySelectorAll(".sub-chart:not(.hidden)")]
  }

  // ── Resize ────────────────────────────────────────
  function initResize() {
    area().addEventListener("mousedown", e => {
      const handle = e.target.closest(".resize-handle")
      if (!handle) return
      const pane = handle.closest(".sub-chart")
      if (!pane) return

      e.preventDefault()
      const startY  = e.clientY
      const startH  = pane.getBoundingClientRect().height
      document.body.style.cursor = "ns-resize"
      document.body.style.userSelect = "none"

      function onMove(e) {
        const delta = e.clientY - startY
        const newH  = Math.max(60, startH + delta)
        pane.style.flex = `0 0 ${newH}px`
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup",   onUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup",   onUp)
    })
  }

  // ── Drag-to-reorder ───────────────────────────────
  function initReorder() {
    let ghost      = null
    let dragged    = null
    let indicator  = null   // drop indicator line
    let startY     = 0
    let insertBefore = null // target pane to insert before (null = append)

    area().addEventListener("mousedown", e => {
      const header = e.target.closest(".pane-header")
      if (!header) return
      const pane = header.closest(".sub-chart")
      if (!pane) return

      e.preventDefault()
      dragged = pane
      startY  = e.clientY

      const rect = pane.getBoundingClientRect()

      // Ghost — floating copy that follows cursor
      ghost = pane.cloneNode(true)
      ghost.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top:  ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        opacity: 0.75;
        pointer-events: none;
        z-index: 1000;
        background: var(--surface);
        border: 1px solid var(--accent);
        border-radius: 4px;
      `
      document.body.appendChild(ghost)

      // Drop indicator
      indicator = document.createElement("div")
      indicator.className = "pane-drop-indicator"
      document.body.appendChild(indicator)

      pane.classList.add("is-dragging")
      document.body.style.cursor    = "grabbing"
      document.body.style.userSelect = "none"

      function onMove(e) {
        const dy = e.clientY - startY
        ghost.style.top = `${rect.top + dy}px`

        // Determine drop position
        const panes = visiblePanes().filter(p => p !== dragged)
        insertBefore = null

        let indicatorY = null

        for (let i = 0; i < panes.length; i++) {
          const r = panes[i].getBoundingClientRect()
          if (e.clientY < r.top + r.height / 2) {
            insertBefore = panes[i]
            indicatorY = r.top
            break
          }
        }

        if (indicatorY === null) {
          // Append after last
          const last = panes[panes.length - 1]
          if (last) {
            const r = last.getBoundingClientRect()
            indicatorY = r.bottom
          }
        }

        if (indicatorY !== null) {
          indicator.style.cssText = `
            position: fixed;
            left:   ${rect.left}px;
            top:    ${indicatorY - 2}px;
            width:  ${rect.width}px;
            height: 3px;
            background: var(--accent);
            z-index: 1001;
            border-radius: 2px;
            pointer-events: none;
          `
        }
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup",   onUp)

        ghost.remove()
        indicator.remove()
        dragged.classList.remove("is-dragging")
        document.body.style.cursor     = ""
        document.body.style.userSelect = ""

        // Perform the DOM move
        if (insertBefore) {
          area().insertBefore(dragged, insertBefore)
        } else {
          area().appendChild(dragged)
        }

        ghost = null; indicator = null; dragged = null
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup",   onUp)
    })
  }

  function init() {
    initResize()
    initReorder()
  }

  return { init }
})()
