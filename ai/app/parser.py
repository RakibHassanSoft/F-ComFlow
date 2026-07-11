"""Phase 3: The AI Order Parser (Python side).

Two engines, same output shape:
  1. Gemini 1.5 Flash  — used automatically when GEMINI_API_KEY is set in .env
  2. Rule-based NLP    — always available, needs no API key, and is the
                         fallback whenever Gemini fails or times out

The Node API sends: chat text + customer name + the tenant's product list.
We return: name, phone, address, district, product, quantity + confidence flags.
"""
import json
import os
import re

import httpx

from .districts import find_district

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-1.5-flash:generateContent"
)

BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


# ---------------------------------------------------------------- rule engine
def parse_with_rules(chat_text: str, customer_name: str | None, products: list[dict]) -> dict:
    """Careful pattern-matching over Banglish/Bengali/English chat."""
    text = chat_text.translate(BN_DIGITS)  # Bengali numerals -> English
    low_confidence: dict[str, bool] = {}

    # Phone: valid Bangladeshi mobile = 11 digits starting 013-019
    phone_match = re.search(r"01[3-9]\d{8}", re.sub(r"[\s-]", "", text))
    phone = phone_match.group(0) if phone_match else None
    if not phone:
        low_confidence["phone"] = True

    # District: match the official 64-district list (+ spelling variants)
    district = find_district(text)
    if not district:
        low_confidence["district"] = True

    # Product: match the tenant's own catalog names inside the chat
    matched = None
    for p in products:
        if p["name"].lower() in text.lower():
            matched = p
            break
    if not matched:
        low_confidence["product"] = True

    # Quantity: "2 ta", "3 pcs", "2 pieces" ... default 1
    qty_match = re.search(r"(\d+)\s*(ta|pcs|pieces?|kg|টা)", text, re.IGNORECASE)
    quantity = max(1, int(qty_match.group(1))) if qty_match else 1
    if not qty_match:
        low_confidence["quantity"] = True

    # Address: the line that mentions address keywords, minus the phone
    address = None
    for line in (l.strip() for l in text.split("\n") if l.strip()):
        if re.search(r"address|thikana|house|flat|road|village|thana|para|more|point|bari|deliver to", line, re.IGNORECASE):
            address = re.sub(r".*?(address|thikana|deliver to)\s*(dilam)?:?\s*", "", line, flags=re.IGNORECASE)
            address = re.sub(r"01[3-9]\d{8}", "", address).strip(" ,.-")
            break
    if not address:
        low_confidence["address"] = True

    return {
        "customerName": customer_name,
        "phone": phone,
        "address": address,
        "district": district,
        "productId": matched["id"] if matched else None,
        "productName": matched["name"] if matched else None,
        "quantity": quantity,
        "lowConfidence": low_confidence,
        "engine": "rules",
    }


# ---------------------------------------------------------------- gemini engine
def parse_with_gemini(chat_text: str, customer_name: str | None, products: list[dict]) -> dict:
    """Schema-constrained Gemini call. Raises on any failure — the caller
    falls back to the rule engine, so a Gemini outage never breaks parsing."""
    api_key = os.environ["GEMINI_API_KEY"]
    product_names = ", ".join(p["name"] for p in products) or "none"

    prompt = f"""You extract order details from a Bangladeshi social-commerce chat.
The chat may mix Bengali, English and Banglish. Return ONLY JSON with keys:
phone (11-digit string starting 01, or null), address (string or null),
district (one official Bangladeshi district name, or null),
product (exactly one of: {product_names}; or null), quantity (integer, default 1).

Chat:
{chat_text}"""

    response = httpx.post(
        GEMINI_URL,
        params={"key": api_key},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
        },
        timeout=10,
    )
    response.raise_for_status()
    data = json.loads(response.json()["candidates"][0]["content"]["parts"][0]["text"])

    # NEVER trust the model blindly — re-validate everything it returns
    phone = data.get("phone")
    if not (isinstance(phone, str) and re.fullmatch(r"01[3-9]\d{8}", phone)):
        phone = None
    district = find_district(str(data.get("district") or ""))
    matched = next((p for p in products if p["name"].lower() == str(data.get("product") or "").lower()), None)
    quantity = data.get("quantity")
    quantity = quantity if isinstance(quantity, int) and quantity >= 1 else 1
    address = data.get("address") if isinstance(data.get("address"), str) else None

    low_confidence = {}
    if not phone: low_confidence["phone"] = True
    if not district: low_confidence["district"] = True
    if not matched: low_confidence["product"] = True
    if not address: low_confidence["address"] = True

    return {
        "customerName": customer_name,
        "phone": phone,
        "address": address,
        "district": district,
        "productId": matched["id"] if matched else None,
        "productName": matched["name"] if matched else None,
        "quantity": quantity,
        "lowConfidence": low_confidence,
        "engine": "gemini",
    }


# ---------------------------------------------------------------- entry point
def parse_order(chat_text: str, customer_name: str | None, products: list[dict]) -> dict:
    if os.environ.get("GEMINI_API_KEY"):
        try:
            return parse_with_gemini(chat_text, customer_name, products)
        except Exception:
            pass  # Gemini down / bad output -> rule engine takes over
    return parse_with_rules(chat_text, customer_name, products)
