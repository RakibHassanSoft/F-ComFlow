"""Phase 7: COD risk scoring.

If the trained model artifact exists (ai/models/risk_model_v1.joblib),
predictions come from the ML model. If not, a transparent weighted-rule
score is used — so the service ALWAYS answers, exactly as the exit gate
demands ("risk service down = graceful degradation", and inside the
service: "model missing = rule fallback").

The Node API computes the raw facts (it has the database); this module
turns them into features, a 0-100 score, and human-readable reasons.
"""
from pathlib import Path

import joblib

from .districts import DISTRICTS, DISTRICT_RISK, DEFAULT_DISTRICT_RISK

MODEL_PATH = Path(__file__).parent.parent / "models" / "risk_model_v1.joblib"

_artifact = None
if MODEL_PATH.exists():
    _artifact = joblib.load(MODEL_PATH)  # {"model", "features", "version", "auc"}


def model_info() -> dict:
    if _artifact:
        return {"engine": "ml", "version": _artifact["version"], "auc": _artifact["auc"]}
    return {"engine": "rules", "version": None, "auc": None}


def build_features(phone_valid: bool, address: str, district: str,
                   return_rate: float, past_orders: int) -> tuple[list[float], list[str]]:
    """Turn raw facts into the model's feature vector + explanation strings."""
    factors: list[str] = []

    if not phone_valid:
        factors.append("Phone number format is invalid")

    # Address completeness: 1 = complete, 0 = useless
    address_score = 1.0
    if len(address) < 10:
        address_score = 0.0
    elif len(address) < 25:
        address_score = 0.5
    if not any(ch.isdigit() for ch in address):
        address_score = min(address_score, 0.5)  # no house/road number
    if address_score < 1.0:
        factors.append("Address looks incomplete")

    if past_orders == 0:
        factors.append("New customer — no delivery history")
    elif return_rate > 0.3:
        factors.append(f"Customer returned {round(return_rate * 100)}% of past orders")

    district_risk = DISTRICT_RISK.get(district, DEFAULT_DISTRICT_RISK) if district in DISTRICTS else 1.0
    if district_risk >= DEFAULT_DISTRICT_RISK:
        factors.append(f"{district} has a higher COD return rate")

    features = [1.0 if phone_valid else 0.0, address_score, return_rate, float(past_orders), district_risk]
    return features, factors


def score(phone_valid: bool, address: str, district: str,
          return_rate: float, past_orders: int) -> dict:
    features, factors = build_features(phone_valid, address, district, return_rate, past_orders)

    if _artifact:
        # ML path: probability of delivery failure -> 0-100 score
        proba = _artifact["model"].predict_proba([features])[0][1]
        risk_score = round(float(proba) * 100)
    else:
        # Rule path: same weights the dataset was built around
        phone_valid_f, address_score, rr, past, district_risk = features
        risk = (
            0.25 * (1 - phone_valid_f)
            + 0.30 * (1 - address_score)
            + 0.25 * (rr if past > 0 else 0.5)
            + 0.20 * district_risk
        )
        risk_score = round(min(1.0, risk) * 100)

    level = "HIGH" if risk_score >= 60 else "MEDIUM" if risk_score >= 35 else "LOW"
    return {"score": risk_score, "level": level, "factors": factors, **model_info()}
