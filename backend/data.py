import ccxt
import statistics
import time
from datetime import datetime, timezone

SUPPORTED_EXCHANGES = ["binance", "kraken", "bybit", "coinbase"]

TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]

# How many days back to fetch by default per timeframe
_DEFAULT_DAYS = {
    "1m":  2,
    "5m":  7,
    "15m": 14,
    "30m": 30,
    "1h":  90,
    "4h":  90,
    "1d":  365,
}

# Max candles per request per exchange (CCXT limit)
_EXCHANGE_BATCH = {
    "binance":  1000,
    "bybit":    200,
    "kraken":   720,
    "coinbase": 300,
}

# Symbol cache: { exchange_id: { symbols: [...], fetched_at: float } }
_symbol_cache: dict = {}
_SYMBOL_TTL = 3600  # seconds

# Exchange instance cache — reuse across requests
_exchange_cache: dict = {}

def _get_exchange(exchange_id: str):
    if exchange_id not in _exchange_cache:
        cls = getattr(ccxt, exchange_id)
        _exchange_cache[exchange_id] = cls({"enableRateLimit": True})
    return _exchange_cache[exchange_id]

# OHLCV cache: { key: { data: [...], fetched_at: float } }
# Keeps the last fetch for 30s so indicator toggles don't re-hit the exchange.
_ohlcv_cache: dict = {}
_OHLCV_TTL = 30  # seconds

def _ohlcv_cache_get(exchange_id, symbol, timeframe, since_iso):
    key = (exchange_id, symbol, timeframe, since_iso or "")
    entry = _ohlcv_cache.get(key)
    if entry and (time.time() - entry["fetched_at"]) < _OHLCV_TTL:
        return entry["data"]
    return None

def _ohlcv_cache_set(exchange_id, symbol, timeframe, since_iso, data):
    key = (exchange_id, symbol, timeframe, since_iso or "")
    _ohlcv_cache[key] = {"data": data, "fetched_at": time.time()}


def _format(candle: list) -> dict:
    return {
        "time":   candle[0] // 1000,
        "open":   candle[1],
        "high":   candle[2],
        "low":    candle[3],
        "close":  candle[4],
        "volume": candle[5],
    }


def fetch_ohlcv(exchange_id: str, symbol: str, timeframe: str, since_iso: str = None):
    cached = _ohlcv_cache_get(exchange_id, symbol, timeframe, since_iso)
    if cached is not None:
        return cached

    exchange = _get_exchange(exchange_id)
    batch_size = _EXCHANGE_BATCH.get(exchange_id, 500)

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    if since_iso:
        dt = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
        since_ms = int(dt.timestamp() * 1000)
    else:
        days = _DEFAULT_DAYS.get(timeframe, 30)
        since_ms = now_ms - days * 86_400_000

    all_candles = []
    while True:
        batch = exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=since_ms, limit=batch_size)
        if not batch:
            break

        # Guard: some exchanges (Kraken) ignore `since` and always return latest data
        if all_candles and batch[0][0] <= all_candles[-1][0]:
            break

        all_candles.extend(batch)

        if len(batch) < batch_size:
            break
        since_ms = batch[-1][0] + 1
        if since_ms >= now_ms:
            break

    result = [_format(c) for c in all_candles]
    _ohlcv_cache_set(exchange_id, symbol, timeframe, since_iso, result)
    return result


def fetch_ticker_price(exchange_id: str, symbol: str) -> float:
    exchange = _get_exchange(exchange_id)
    ticker = exchange.fetch_ticker(symbol)
    return ticker["last"]


def fetch_latest_candles(exchange_id: str, symbol: str, timeframe: str) -> list:
    """Returns the last 2 candles — current (forming) + previous (closed)."""
    exchange = _get_exchange(exchange_id)
    raw = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=2)
    return [_format(c) for c in raw]


def fetch_symbols(exchange_id: str):
    cached = _symbol_cache.get(exchange_id)
    if cached and (time.time() - cached["fetched_at"]) < _SYMBOL_TTL:
        return cached["symbols"]

    exchange = _get_exchange(exchange_id)
    markets = exchange.load_markets()
    all_syms = [s for s in markets.keys() if "/USDT" in s or "/USD" in s]
    # USDT pairs first (main Binance markets), then USD
    symbols = sorted([s for s in all_syms if s.endswith("/USDT")]) + \
              sorted([s for s in all_syms if not s.endswith("/USDT")])
    _symbol_cache[exchange_id] = {"symbols": symbols, "fetched_at": time.time()}
    return symbols


# ── Indicator calculations ─────────────────────────────────────────────────────

def _sma(values: list[float], period: int) -> list[float | None]:
    result = [None] * (period - 1)
    for i in range(period - 1, len(values)):
        result.append(sum(values[i - period + 1 : i + 1]) / period)
    return result


def _ema(values: list[float], period: int) -> list[float | None]:
    if len(values) < period:
        return [None] * len(values)
    k = 2 / (period + 1)
    result = [None] * (period - 1)
    ema_val = sum(values[:period]) / period
    result.append(ema_val)
    for v in values[period:]:
        ema_val = v * k + ema_val * (1 - k)
        result.append(ema_val)
    return result


def _rsi(closes: list[float], period: int = 14) -> list[float | None]:
    if len(closes) < period + 1:
        return [None] * len(closes)
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains  = [max(d, 0) for d in deltas]
    losses = [max(-d, 0) for d in deltas]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    rsi_vals = [None] * period
    rsi_vals.append(100 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss))
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rsi_vals.append(100 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss))
    return rsi_vals


def _macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    macd_line = [
        (f - s) if f is not None and s is not None else None
        for f, s in zip(ema_fast, ema_slow)
    ]
    valid = [(i, v) for i, v in enumerate(macd_line) if v is not None]
    signal_line = [None] * len(closes)
    histogram   = [None] * len(closes)
    if len(valid) >= signal:
        sig_ema = _ema([v for _, v in valid], signal)
        for j, (orig_i, _) in enumerate(valid):
            if sig_ema[j] is not None:
                signal_line[orig_i] = sig_ema[j]
                histogram[orig_i]   = macd_line[orig_i] - sig_ema[j]
    return macd_line, signal_line, histogram


def _ehlers_stoch_cg(candles: list[dict], length: int = 8) -> tuple:
    """
    Ehlers Stochastic CG Oscillator [LazyBear]
    Source: John Ehlers, "Cybernetic Analysis for Stocks and Futures"

    Output oscillates around 0, range approx -1 to +1.
    Overbought: +0.8 / Oversold: -0.8
    Trigger = 0.96 * (v2[1] + 0.02)
    """
    src = [(c["high"] + c["low"]) / 2.0 for c in candles]
    n   = len(src)

    # Step 1: Center of Gravity
    cg = []
    for i in range(n):
        if i < length - 1:
            cg.append(None)
            continue
        nm = sum((1 + j) * src[i - j] for j in range(length))
        dm = sum(src[i - j]            for j in range(length))
        cg.append(-nm / dm + (length + 1) / 2.0 if dm != 0 else 0.0)

    # Step 2: Stochastic normalization of CG
    v1 = []
    for i in range(n):
        if cg[i] is None:
            v1.append(None)
            continue
        window = [cg[j] for j in range(max(0, i - length + 1), i + 1) if cg[j] is not None]
        if len(window) < 2:
            v1.append(None)
            continue
        hi, lo = max(window), min(window)
        v1.append((cg[i] - lo) / (hi - lo) if hi != lo else 0.0)

    # Step 3: Weighted smoothing + rescale to [-1, 1]
    v2 = []
    for i in range(n):
        vs = [v1[i - k] if i - k >= 0 else None for k in range(4)]
        if any(x is None for x in vs):
            v2.append(None)
        else:
            smoothed = (4*vs[0] + 3*vs[1] + 2*vs[2] + vs[3]) / 10.0
            v2.append(2.0 * (smoothed - 0.5))

    # Step 4: Trigger line
    trigger = [None] * n
    for i in range(1, n):
        if v2[i] is not None and v2[i - 1] is not None:
            trigger[i] = 0.96 * (v2[i - 1] + 0.02)

    return v2, trigger


def _bollinger(closes: list[float], period: int = 20, mult: float = 2.0):
    sma    = _sma(closes, period)
    upper  = [None] * (period - 1)
    lower  = [None] * (period - 1)
    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1 : i + 1]
        std = statistics.stdev(window)
        upper.append(sma[i] + mult * std)
        lower.append(sma[i] - mult * std)
    return upper, sma, lower


def calc_indicators(candles: list[dict], requested: list[str]) -> dict:
    times  = [c["time"] for c in candles]
    closes = [c["close"] for c in candles]

    def series(values):
        return [
            {"time": t, "value": round(v, 6)}
            for t, v in zip(times, values)
            if v is not None
        ]

    result = {}

    if "sma20"  in requested: result["sma20"]  = series(_sma(closes, 20))
    if "sma50"  in requested: result["sma50"]  = series(_sma(closes, 50))
    if "sma200" in requested: result["sma200"] = series(_sma(closes, 200))
    if "ema20"  in requested: result["ema20"]  = series(_ema(closes, 20))

    if "bb" in requested:
        upper, mid, lower = _bollinger(closes)
        result["bb_upper"]  = series(upper)
        result["bb_mid"]    = series(mid)
        result["bb_lower"]  = series(lower)

    if "rsi" in requested:
        result["rsi"] = series(_rsi(closes))

    if "macd" in requested:
        macd_line, sig_line, hist = _macd(closes)
        result["macd_line"]   = series(macd_line)
        result["macd_signal"] = series(sig_line)
        result["macd_hist"]   = [
            {"time": t, "value": round(v, 6), "color": "#1ce3ed55" if v >= 0 else "#ff962e55"}
            for t, v in zip(times, hist)
            if v is not None
        ]

    if "stoch" in requested:
        osc, trig = _ehlers_stoch_cg(candles)
        result["stoch_k"] = series(osc)   # main oscillator
        result["stoch_d"] = series(trig)  # trigger line

    return result
