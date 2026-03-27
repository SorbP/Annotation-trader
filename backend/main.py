import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.db import init_db, save_annotation, get_annotations, delete_annotation
from backend.data import fetch_ohlcv, fetch_latest_candles, fetch_ticker_price, fetch_symbols, calc_indicators, SUPPORTED_EXCHANGES, TIMEFRAMES


async def _warm_symbol_cache():
    for exchange_id in SUPPORTED_EXCHANGES:
        try:
            await asyncio.to_thread(fetch_symbols, exchange_id)
            print(f"[cache] symbols ready: {exchange_id}")
        except Exception as e:
            print(f"[cache] failed {exchange_id}: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("data", exist_ok=True)
    await init_db()
    asyncio.create_task(_warm_symbol_cache())
    yield


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
async def root():
    return FileResponse("frontend/index.html")


@app.get("/api/exchanges")
async def exchanges():
    return SUPPORTED_EXCHANGES


@app.get("/api/timeframes")
async def timeframes():
    return TIMEFRAMES


@app.get("/api/symbols")
async def symbols(exchange: str = Query(...)):
    if exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {exchange}")
    try:
        result = await asyncio.to_thread(fetch_symbols, exchange)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/ohlcv")
async def ohlcv(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("1h"),
    since: str = Query(None),
):
    if exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {exchange}")
    try:
        data = await asyncio.to_thread(fetch_ohlcv, exchange, symbol, timeframe, since)
        return data
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/ticker")
async def ticker(exchange: str = Query(...), symbol: str = Query(...)):
    if exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {exchange}")
    try:
        price = await asyncio.to_thread(fetch_ticker_price, exchange, symbol)
        return {"price": price}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/ohlcv/latest")
async def ohlcv_latest(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("1h"),
):
    if exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {exchange}")
    try:
        data = await asyncio.to_thread(fetch_latest_candles, exchange, symbol, timeframe)
        return data
    except Exception as e:
        raise HTTPException(500, str(e))


class AnnotationIn(BaseModel):
    exchange: str
    symbol: str
    timeframe: str
    signal_time: str
    signal: int = Field(..., ge=-5, le=5)
    notes: str = None

    def model_post_init(self, __context):
        if self.signal == 0:
            raise ValueError("signal cannot be 0")


@app.post("/api/annotations")
async def create_annotation(body: AnnotationIn):
    if body.signal == 0:
        raise HTTPException(400, "signal cannot be 0")
    annotation_id = await save_annotation(
        body.exchange, body.symbol, body.timeframe,
        body.signal_time, body.signal, body.notes
    )
    return {"id": annotation_id}


@app.get("/api/annotations")
async def list_annotations(exchange: str = None, symbol: str = None):
    return await get_annotations(exchange, symbol)


VALID_INDICATORS = {"sma20", "sma50", "sma200", "ema20", "bb", "rsi", "macd", "stoch"}

# Warmup candles needed per indicator before first valid value
_WARMUP = {"sma200": 200, "sma50": 50, "sma20": 20, "ema20": 20,
           "bb": 20, "rsi": 14, "macd": 35, "stoch": 12}

_TF_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
          "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}


@app.get("/api/indicators")
async def indicators(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("1h"),
    since: str = Query(None),
    indicators: str = Query("sma20,sma50,rsi,macd"),
):
    if exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {exchange}")
    requested = [i.strip() for i in indicators.split(",") if i.strip() in VALID_INDICATORS]
    if not requested:
        return {}
    try:
        # Extend since back by the warmup period so indicators start at chart start
        warmup = max(_WARMUP.get(ind, 0) for ind in requested)
        tf_ms  = _TF_MS.get(timeframe, 3_600_000)
        now_ms = int(__import__("datetime").datetime.now(__import__("datetime").timezone.utc).timestamp() * 1000)

        if since:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            chart_start_ms = int(dt.timestamp() * 1000)
        else:
            from backend.data import _DEFAULT_DAYS
            days = _DEFAULT_DAYS.get(timeframe, 30)
            chart_start_ms = now_ms - days * 86_400_000

        warmup_since_ms = chart_start_ms - warmup * tf_ms
        warmup_since_iso = __import__("datetime").datetime.fromtimestamp(
            warmup_since_ms / 1000, tz=__import__("datetime").timezone.utc
        ).isoformat()

        candles = await asyncio.to_thread(fetch_ohlcv, exchange, symbol, timeframe, warmup_since_iso)

        raw = await asyncio.to_thread(calc_indicators, candles, requested)

        # Trim: remove values that fall before the chart's actual start time
        chart_start_s = chart_start_ms // 1000
        trimmed = {}
        for key, series in raw.items():
            trimmed[key] = [pt for pt in series if pt["time"] >= chart_start_s]

        return trimmed
    except Exception as e:
        raise HTTPException(500, str(e))



@app.delete("/api/annotations/{annotation_id}")
async def remove_annotation(annotation_id: str):
    await delete_annotation(annotation_id)
    return {"ok": True}
