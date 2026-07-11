"""Phase 7: Generate the synthetic 10,000-transaction training dataset.

Each row = one historical COD order with 5 features and a label:
  phone_valid     1/0   was the phone a valid Bangladeshi mobile?
  address_score   0-1   how complete the address looked (1 = complete)
  return_rate     0-1   this customer's past return rate
  past_orders     int   how many completed orders the customer had
  district_risk   0-1   regional risk parameter
  label           1 = delivery FAILED (returned), 0 = delivered

The label is drawn from a logistic probability built the way real failures
happen — bad phones, vague addresses and repeat-returners fail far more
often — so the model has a realistic (not perfect) signal to learn.
"""
import csv
import math
import random
from pathlib import Path

random.seed(42)  # reproducible dataset

OUT = Path(__file__).parent / "dataset.csv"
ROWS = 10_000


def make_row():
    phone_valid = 1 if random.random() < 0.85 else 0
    address_score = round(random.random(), 2)
    past_orders = random.choice([0, 0, 0, 1, 2, 3, 5, 8, 12])
    return_rate = round(random.betavariate(1.2, 4), 2) if past_orders > 0 else 0.0
    district_risk = random.choice([0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4])

    # True failure probability (the "world" the model must discover):
    # a weighted risk signal squashed through a logistic curve, so risky
    # combinations fail most of the time and clean orders rarely do.
    raw_risk = (
        1.0 * (1 - phone_valid)
        + 0.8 * (1 - address_score)
        + 1.2 * return_rate
        + 0.6 * district_risk
        + (0.4 if past_orders == 0 else 0)
    )
    p_fail = 1 / (1 + math.exp(-(4 * raw_risk - 4.5)))
    label = 1 if random.random() < p_fail else 0

    return [phone_valid, address_score, return_rate, past_orders, district_risk, label]


def main():
    with open(OUT, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["phone_valid", "address_score", "return_rate", "past_orders", "district_risk", "label"])
        for _ in range(ROWS):
            writer.writerow(make_row())
    print(f"✅ Wrote {ROWS} rows to {OUT}")


if __name__ == "__main__":
    main()
