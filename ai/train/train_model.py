"""Phase 7: Train the COD risk classifier and save the versioned artifact.

Run:  python train/train_model.py
The exit gate requires AUC >= 0.78 on a held-out test split — this script
prints the AUC and refuses to save a model that misses the bar.

Uses the XGBoost classifier (as specified in the project report), with
scikit-learn's GradientBoosting as an automatic fallback if xgboost
isn't installed.
"""
import csv
from pathlib import Path

import joblib
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

try:
    from xgboost import XGBClassifier
    def make_model():
        return XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.1,
                             eval_metric="logloss", random_state=42)
    MODEL_KIND = "XGBoost"
except ImportError:  # xgboost not installed -> same model family from sklearn
    from sklearn.ensemble import GradientBoostingClassifier
    def make_model():
        return GradientBoostingClassifier(n_estimators=200, max_depth=3, random_state=42)
    MODEL_KIND = "GradientBoosting (sklearn fallback)"

HERE = Path(__file__).parent
DATASET = HERE / "dataset.csv"
MODEL_DIR = HERE.parent / "models"
MODEL_PATH = MODEL_DIR / "risk_model_v1.joblib"

FEATURES = ["phone_valid", "address_score", "return_rate", "past_orders", "district_risk"]


def load_dataset():
    if not DATASET.exists():
        # Generate it on first run so training is one command
        from generate_dataset import main as generate
        generate()
    X, y = [], []
    with open(DATASET) as f:
        for row in csv.DictReader(f):
            X.append([float(row[c]) for c in FEATURES])
            y.append(int(row["label"]))
    return X, y


def main():
    X, y = load_dataset()
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = make_model()
    model.fit(X_train, y_train)

    auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])
    print(f"Model: {MODEL_KIND}")
    print(f"Held-out AUC: {auc:.3f}  (exit gate: >= 0.78)")

    if auc < 0.78:
        raise SystemExit("❌ AUC below the exit gate — model NOT saved. Investigate before shipping.")

    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump({"model": model, "features": FEATURES, "version": "v1", "auc": round(auc, 3)}, MODEL_PATH)
    print(f"✅ Saved {MODEL_PATH.name} (version v1)")


if __name__ == "__main__":
    main()
