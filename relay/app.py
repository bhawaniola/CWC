"""Transport relay — plays a satellite uplink or a cell tower.

Pods can only reach the control center THROUGH one of these containers,
so `docker stop satellite` genuinely kills that path.
Simulate rain fade / degradation:  GET /set?loss=0.4&latency_ms=300
"""
import asyncio
import os
import random

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

NAME = os.getenv("NAME", "relay")
CC_URL = os.getenv("CC_URL", "http://control-center:9000")

state = {"loss": 0.0, "latency_ms": int(os.getenv("LATENCY_MS", "50"))}

app = FastAPI(title=f"relay-{NAME}")
client = httpx.AsyncClient(timeout=5.0)


@app.get("/health")
async def health():
    return {"name": NAME, "loss": state["loss"], "latency_ms": state["latency_ms"]}


@app.get("/set")
async def set_conditions(loss: float | None = None, latency_ms: int | None = None):
    if loss is not None:
        state["loss"] = max(0.0, min(1.0, loss))
    if latency_ms is not None:
        state["latency_ms"] = max(0, latency_ms)
    return {"name": NAME, **state}


@app.post("/ingest")
async def ingest(event: dict):
    await asyncio.sleep(state["latency_ms"] / 1000)
    if random.random() < state["loss"]:
        return JSONResponse({"error": f"{NAME}: packet lost"}, status_code=503)
    r = await client.post(f"{CC_URL}/ingest", json={"via": NAME, "event": event})
    return JSONResponse(r.json(), status_code=r.status_code)
