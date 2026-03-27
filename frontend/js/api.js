const API = {
  async get(path) {
    const res = await fetch(path)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },

  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.json()
  },

  async delete(path) {
    const res = await fetch(path, { method: "DELETE" })
    if (!res.ok) throw new Error(res.statusText)
    return res.json()
  },

  exchanges: () => API.get("/api/exchanges"),
  timeframes: () => API.get("/api/timeframes"),
  symbols: (exchange) => API.get(`/api/symbols?exchange=${encodeURIComponent(exchange)}`),

  ohlcv: (exchange, symbol, timeframe, since, limit = 500) => {
    let url = `/api/ohlcv?exchange=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`
    if (since) url += `&since=${encodeURIComponent(since)}`
    return API.get(url)
  },

  saveAnnotation: (data) => API.post("/api/annotations", data),
  listAnnotations: (exchange, symbol) => {
    let url = "/api/annotations"
    const params = []
    if (exchange) params.push(`exchange=${encodeURIComponent(exchange)}`)
    if (symbol)   params.push(`symbol=${encodeURIComponent(symbol)}`)
    if (params.length) url += "?" + params.join("&")
    return API.get(url)
  },
  deleteAnnotation: (id) => API.delete(`/api/annotations/${id}`),
}
