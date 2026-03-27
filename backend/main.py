import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.db import init_db, save_annotation, get_annotations, delete_annotation
from backend.data import fetch_ohlcv, fetch_symbols, calc_indicators, SUPPORTED_EXCHANGES, TIMEFRAMES


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("data", exist_ok=True)
    await init_db()
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
    limit: int = Query(500),
):
    if exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {exchange}")
    try:
        data = await asyncio.to_thread(fetch_ohlcv, exchange, symbol, timeframe, since, limit)
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


VALID_INDICATORS = {"sma20", "sma50", "sma200", "ema20", "bb", "rsi", "macd"}


@app.get("/api/indicators")
async def indicators(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("1h"),
    since: str = Query(None),
    limit: int = Query(500),
    indicators: str = Query("sma20,sma50,rsi,macd"),
):
    if exchange not in SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {exchange}")
    requested = [i.strip() for i in indicators.split(",") if i.strip() in VALID_INDICATORS]
    if not requested:
        return {}
    try:
        candles = await asyncio.to_thread(fetch_ohlcv, exchange, symbol, timeframe, since, limit)
        return await asyncio.to_thread(calc_indicators, candles, requested)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/annotations/{annotation_id}")
async def remove_annotation(annotation_id: str):
    await delete_annotation(annotation_id)
    return {"ok": True}
