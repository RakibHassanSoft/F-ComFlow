"""F-ComFlow AI service — FastAPI entry point.

Endpoints:
  GET  /api/health                 health check (Phase 0 exit gate)
  POST /api/v1/ai/parse-order     chat -> structured draft order (Phase 3)
  POST /api/v1/ai/risk-score      order facts -> COD risk score (Phase 7)

Run locally:  uvicorn app.main:app --port 8000 --reload
"""
from dotenv import load_dotenv

load_dotenv()  # read ai/.env before anything else

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .parser import parse_order
from .risk import score, model_info

app = FastAPI(title="F-ComFlow AI", version="1.0.0")

# The Node API calls this service server-to-server; open CORS is fine here
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------- request/response models (Pydantic validates every request) ----------
class ProductIn(BaseModel):
    id: str
    name: str


class ParseRequest(BaseModel):
    chatText: str = Field(min_length=1)
    customerName: str | None = None
    products: list[ProductIn] = []


class RiskRequest(BaseModel):
    phoneValid: bool
    address: str = ""
    district: str = ""
    returnRate: float = Field(ge=0, le=1, default=0)
    pastOrders: int = Field(ge=0, default=0)


# ---------- endpoints ----------
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "fcomflow-ai", "risk_model": model_info()}


@app.post("/api/v1/ai/parse-order")
def parse(req: ParseRequest):
    if not req.chatText.strip():
        raise HTTPException(422, "chatText is empty")
    return parse_order(req.chatText, req.customerName, [p.model_dump() for p in req.products])


@app.post("/api/v1/ai/risk-score")
def risk(req: RiskRequest):
    return score(req.phoneValid, req.address, req.district, req.returnRate, req.pastOrders)
