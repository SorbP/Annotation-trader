import aiosqlite
import uuid
from datetime import datetime, timezone

DB_PATH = "data/annotations.db"


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS annotations (
                id           TEXT PRIMARY KEY,
                created_at   TEXT NOT NULL,
                exchange     TEXT NOT NULL,
                symbol       TEXT NOT NULL,
                timeframe    TEXT NOT NULL,
                signal_time  TEXT NOT NULL,
                signal       INTEGER NOT NULL,
                notes        TEXT
            )
        """)
        await db.commit()


async def save_annotation(exchange: str, symbol: str, timeframe: str, signal_time: str, signal: int, notes: str = None):
    annotation_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO annotations VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (annotation_id, created_at, exchange, symbol, timeframe, signal_time, signal, notes)
        )
        await db.commit()
    return annotation_id


async def get_annotations(exchange: str = None, symbol: str = None):
    query = "SELECT * FROM annotations"
    params = []
    filters = []
    if exchange:
        filters.append("exchange = ?")
        params.append(exchange)
    if symbol:
        filters.append("symbol = ?")
        params.append(symbol)
    if filters:
        query += " WHERE " + " AND ".join(filters)
    query += " ORDER BY signal_time DESC"

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def delete_annotation(annotation_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM annotations WHERE id = ?", (annotation_id,))
        await db.commit()
