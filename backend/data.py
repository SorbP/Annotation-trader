import ccxt
import statistics
from datetime import datetime, timezone

SUPPORTED_EXCHANGES = ["binance", "kraken", "bybit", "coinbase"]

TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]


def fetch_ohlcv(exchange_id: str, symbol: str, timeframe: str, since_iso: str, limit: int = 500):
    exchange_class = getattr(ccxt, exchange_id)
    exchange = exchange_class({"enableRateLimit": True})

    since_ms = None
    if since_iso:
        dt = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
        since_ms = int(dt.timestamp() * 1000)

    raw = exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=since_ms, limit=limit)

    return [
        {
            "time":   candle[0] // 1000,
            "open":   candle[1],
            "high":   candle[2],
            "low":    candle[3],
            "close":  candle[4],
            "volume": candle[5],
        }
        for candle in raw
    ]


def fetch_symbols(exchange_id: str):
    exchange_class = getattr(ccxt, exchange_id)
    exchange = exchange_class({"enableRateLimit": True})
    markets = exchange.load_markets()
    return sorted([s for s in markets.keys() if "/USDT" in s or "/USD" in s])


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

    return result
