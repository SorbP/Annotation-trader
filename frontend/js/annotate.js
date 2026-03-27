const Annotate = (() => {
  let currentCandle = null
  let selectedSignal = null
  let onSavedCallback = null

  const panel       = document.getElementById("annotation-panel")
  const timeLabel   = document.getElementById("annotation-time")
  const saveBtn     = document.getElementById("save-btn")
  const cancelBtn   = document.getElementById("cancel-btn")
  const notesInput  = document.getElementById("notes-input")
  const sigBtns     = document.querySelectorAll(".sig-btn")

  sigBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      sigBtns.forEach(b => b.classList.remove("selected"))
      btn.classList.add("selected")
      selectedSignal = parseInt(btn.dataset.value)
      saveBtn.disabled = false
    })
  })

  cancelBtn.addEventListener("click", close)

  saveBtn.addEventListener("click", async () => {
    if (!currentCandle || selectedSignal === null) return
    saveBtn.disabled = true
    saveBtn.textContent = "Saving..."

    try {
      const result = await API.saveAnnotation({
        exchange:    currentCandle.exchange,
        symbol:      currentCandle.symbol,
        timeframe:   currentCandle.timeframe,
        signal_time: new Date(currentCandle.time * 1000).toISOString(),
        signal:      selectedSignal,
        notes:       notesInput.value.trim() || null,
      })

      if (onSavedCallback) {
        onSavedCallback({
          id:          result.id,
          exchange:    currentCandle.exchange,
          symbol:      currentCandle.symbol,
          timeframe:   currentCandle.timeframe,
          signal_time: new Date(currentCandle.time * 1000).toISOString(),
          signal:      selectedSignal,
          notes:       notesInput.value.trim() || null,
        })
      }
      close()
    } catch (err) {
      alert("Failed to save: " + err.message)
    } finally {
      saveBtn.textContent = "Save"
    }
  })

  function open(candle, meta) {
    currentCandle = { ...candle, ...meta }
    selectedSignal = null
    notesInput.value = ""
    saveBtn.disabled = true
    sigBtns.forEach(b => b.classList.remove("selected"))

    const dt = new Date(candle.time * 1000)
    timeLabel.textContent = `${meta.symbol} · ${meta.timeframe} · ${dt.toUTCString()}`
    panel.classList.remove("hidden")
  }

  function close() {
    panel.classList.add("hidden")
    currentCandle = null
    selectedSignal = null
  }

  function onSaved(cb) { onSavedCallback = cb }

  return { open, close, onSaved }
})()
