#!/usr/bin/env python3
"""Generate simulated graveyard status data with reusable probe functions."""

from __future__ import annotations

import json
import random
import subprocess
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path
from typing import cast
from concurrent.futures import ThreadPoolExecutor, as_completed

ROSTER_PATH = Path(__file__).resolve().parents[1] / "data" / "roster.json"
_SOURCE_CONFIG = Path.home() / ".config" / "opencode" / "oh-my-opencode.json"
WEIGHTED_HTTP_STATUSES = [200, 200, 200, 200, 200, 429, 408, 500, 401, 404, 400]


def ensure_roster() -> None:
    """Auto-sync roster from source config if roster.json is missing or stale."""
    if _SOURCE_CONFIG.exists():
        if not ROSTER_PATH.exists() or _SOURCE_CONFIG.stat().st_mtime > ROSTER_PATH.stat().st_mtime:
            import shutil
            ROSTER_PATH.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(_SOURCE_CONFIG, ROSTER_PATH)
            print(f"Synced roster from source config")

STATUS_MAP = {
    200: ("ALIVE", "OK"),
    429: ("RATE_LIMIT", "WARN"),
    408: ("TIMEOUT", "ERROR"),
    500: ("PROVIDER_ERROR", "ERROR"),
    401: ("UNAUTHORIZED", "CRITICAL"),
    404: ("MODEL_NOT_FOUND", "CRITICAL"),
    400: ("BAD_REQUEST", "ERROR"),
}


def normalize_model(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    return str(value)


def read_json(path: Path) -> object:
    text = path.read_text(encoding="utf-8")
    return cast(object, json.loads(text))


def coerce_mapping(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    typed_map = cast(dict[str, object], value)
    return typed_map


def load_roster() -> list[dict[str, str | None]]:
    items: list[dict[str, str | None]] = []
    try:
        roster_raw = read_json(ROSTER_PATH)
    except Exception as exc:  # noqa: BLE001 - defensive read
        print(f"Warning: failed to read roster: {exc}", file=sys.stderr)
        return items

    roster = coerce_mapping(roster_raw)
    if roster is None:
        print("Warning: roster root is not a mapping", file=sys.stderr)
        return items

    agents = coerce_mapping(roster.get("agents"))
    if agents is not None:
        for name, entry in agents.items():
            entry_map = coerce_mapping(entry)
            model = normalize_model(entry_map.get("model") if entry_map else None)
            items.append({"name": name, "type": "agent", "model": model})
    else:
        print("Warning: roster 'agents' is not a mapping", file=sys.stderr)

    categories = coerce_mapping(roster.get("categories"))
    if categories is not None:
        for name, entry in categories.items():
            entry_map = coerce_mapping(entry)
            model = normalize_model(entry_map.get("model") if entry_map else None)
            items.append({"name": name, "type": "category", "model": model})
    else:
        print("Warning: roster 'categories' is not a mapping", file=sys.stderr)

    return items


# --------------- tier helpers ---------------

TIER_ORDER = ["top", "high", "mid", "light"]


def _classify_tier(model_name: str) -> str:
    """Classify a model name into an ability tier."""
    low = model_name.lower()
    if "opus" in low:
        return "top"
    if "gpt-5" in low or "pro-high" in low or "pro" in low:
        return "high"
    if "sonnet" in low:
        return "mid"
    return "light"


def get_model_tiers() -> dict[str, list[str]]:
    """Return {tier: [model, ...]} built dynamically from roster config."""
    tiers: dict[str, list[str]] = {t: [] for t in TIER_ORDER}
    try:
        roster_raw = read_json(ROSTER_PATH)
    except Exception:
        return tiers
    roster = coerce_mapping(roster_raw)
    if roster is None:
        return tiers
    seen: set[str] = set()
    for section_key in ("agents", "categories"):
        section = coerce_mapping(roster.get(section_key))
        if section is None:
            continue
        for _name, entry in section.items():
            entry_map = coerce_mapping(entry)
            model = normalize_model(entry_map.get("model") if entry_map else None)
            if model and model not in seen:
                seen.add(model)
                tiers[_classify_tier(model)].append(model)
    return tiers


def suggest_replacement(
    failed_model: str,
    current_status_items: list[dict[str, object]],
) -> str | None:
    """Suggest an alive replacement model from the same or higher tier."""
    tiers = get_model_tiers()
    failed_tier = _classify_tier(failed_model)
    alive_models = {
        str(it["model"])
        for it in current_status_items
        if it.get("severity") == "OK" and it.get("model")
    }
    tier_idx = TIER_ORDER.index(failed_tier)
    # same tier first, then one tier up
    for idx in (tier_idx, max(0, tier_idx - 1)):
        for model in tiers[TIER_ORDER[idx]]:
            if model in alive_models and model != failed_model:
                return model
    return None


# --------------- single-item probe ---------------


def ping_single(name: str, item_type: str, model: str) -> dict[str, object]:
    """Probe a single agent/category and return its status dict.

    Currently simulated (random, no seed). Will be replaced with real
    HTTP probes when the API endpoints are configured.
    """
    item_id = f"{item_type}:{name}"
    http_status = random.choice(WEIGHTED_HTTP_STATUSES)
    latency_ms = random.randint(50, 3000)
    status, severity = STATUS_MAP[http_status]
    error_type = None if http_status == 200 else status
    error_message = None if http_status == 200 else f"Simulated {status.lower()}"
    return {
        "id": item_id,
        "name": name,
        "type": item_type,
        "model": model,
        "status": status,
        "severity": severity,
        "http_status": http_status,
        "error_type": error_type,
        "error_message": error_message,
        "latency_ms": latency_ms,
    }


def simulate_ping(items: list[dict[str, str | None]]) -> list[dict[str, object]]:
    random.seed(42)
    results: list[dict[str, object]] = []
    for item in items:
        name = item.get("name") or "unknown"
        item_type = item.get("type") or "unknown"
        model = item.get("model")
        item_id = f"{item_type}:{name}"

        if not model:
            results.append(
                {
                    "id": item_id,
                    "name": name,
                    "type": item_type,
                    "model": model,
                    "status": "INVALID_CONFIG",
                    "severity": "ERROR",
                    "http_status": 0,
                    "error_type": "INVALID_CONFIG",
                    "error_message": "Missing model",
                    "latency_ms": 0,
                }
            )
            continue

        http_status = random.choice(WEIGHTED_HTTP_STATUSES)
        latency_ms = random.randint(50, 3000)
        status, severity = STATUS_MAP[http_status]
        error_type = None if http_status == 200 else status
        error_message = None if http_status == 200 else f"Simulated {status.lower()}"

        results.append(
            {
                "id": item_id,
                "name": name,
                "type": item_type,
                "model": model,
                "status": status,
                "severity": severity,
                "http_status": http_status,
                "error_type": error_type,
                "error_message": error_message,
                "latency_ms": latency_ms,
            }
        )

    return results


def probe_model(model: str, timeout: int = 60) -> dict[str, object]:
    start = time.monotonic()
    try:
        completed = subprocess.run(
            ["opencode", "run", "--format", "json", "-m", model, "Reply PONG"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        latency_ms = int((time.monotonic() - start) * 1000)
        status, severity = STATUS_MAP[408]
        return {
            "http_status": 408,
            "status": status,
            "severity": severity,
            "error_type": status,
            "error_message": "Timeout",
            "latency_ms": latency_ms,
        }

    latency_ms = int((time.monotonic() - start) * 1000)

    def classify_error(message: str | None) -> int:
        if not message:
            return 500
        low = message.lower()
        if "model not found" in low:
            return 404
        if "unauthorized" in low or "401" in low or "403" in low:
            return 401
        if "rate limit" in low or "429" in low:
            return 429
        if "timeout" in low or "408" in low:
            return 408
        if (
            "500" in low
            or "502" in low
            or "503" in low
            or "504" in low
            or "server error" in low
        ):
            return 500
        if "400" in low or "bad request" in low:
            return 400
        return 500

    error_message: str | None = None
    for line in completed.stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = cast(dict[str, object], json.loads(stripped))
        except json.JSONDecodeError:
            continue
        payload_map = payload
        event_type = payload_map.get("type")
        if event_type == "text":
            status, severity = STATUS_MAP[200]
            return {
                "http_status": 200,
                "status": status,
                "severity": severity,
                "error_type": None,
                "error_message": None,
                "latency_ms": latency_ms,
            }
        if event_type == "error":
            error_value = payload_map.get("error")
            message_value: object | None = None
            if isinstance(error_value, dict):
                error_map = cast(dict[str, object], error_value)
                data_value = error_map.get("data")
                if isinstance(data_value, dict):
                    data_map = cast(dict[str, object], data_value)
                    message_value = data_map.get("message")
                else:
                    message_value = error_map.get("message")
            if isinstance(message_value, str):
                error_message = message_value
            else:
                error_message = None
            break

    if not error_message and completed.stderr:
        error_message = completed.stderr.strip() or None

    http_status = classify_error(error_message)
    status, severity = STATUS_MAP[http_status]
    return {
        "http_status": http_status,
        "status": status,
        "severity": severity,
        "error_type": status,
        "error_message": error_message,
        "latency_ms": latency_ms,
    }


def real_ping(
    items: list[dict[str, str | None]], max_workers: int = 3
) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    models: set[str] = set()
    for item in items:
        model = item.get("model")
        if model:
            models.add(model)
    model_results: dict[str, dict[str, object]] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(probe_model, model): model for model in models}
        for future in as_completed(future_map):
            model = future_map[future]
            model_results[model] = future.result()

    for item in items:
        name = item.get("name") or "unknown"
        item_type = item.get("type") or "unknown"
        model = item.get("model")
        item_id = f"{item_type}:{name}"

        if not model:
            results.append(
                {
                    "id": item_id,
                    "name": name,
                    "type": item_type,
                    "model": model,
                    "status": "INVALID_CONFIG",
                    "severity": "ERROR",
                    "http_status": 0,
                    "error_type": "INVALID_CONFIG",
                    "error_message": "Missing model",
                    "latency_ms": 0,
                }
            )
            continue

        probe = model_results.get(model)
        if probe is None:
            status, severity = STATUS_MAP[500]
            probe = {
                "http_status": 500,
                "status": status,
                "severity": severity,
                "error_type": status,
                "error_message": "Probe failed",
                "latency_ms": 0,
            }

        results.append(
            {
                "id": item_id,
                "name": name,
                "type": item_type,
                "model": model,
                "status": probe["status"],
                "severity": probe["severity"],
                "http_status": probe["http_status"],
                "error_type": probe["error_type"],
                "error_message": probe["error_message"],
                "latency_ms": probe["latency_ms"],
            }
        )
    return results


def write_outputs(items: list[dict[str, object]], root: Path) -> None:
    data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    status_path = data_dir / "graveyard_status.json"
    history_path = data_dir / "graveyard_history.jsonl"
    payload = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "schema_version": 1,
        "items": items,
    }

    _ = status_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    with history_path.open("a", encoding="utf-8") as handle:
        _ = handle.write(json.dumps(payload, ensure_ascii=False) + "\n")

    severities: dict[str, int] = {"OK": 0, "WARN": 0, "ERROR": 0, "CRITICAL": 0}
    invalid_count = 0
    for entry in items:
        if entry.get("status") == "INVALID_CONFIG":
            invalid_count += 1
        severity = entry.get("severity")
        if isinstance(severity, str) and severity in severities:
            severities[severity] += 1

    print(
        "Generated {total} items -> {path} | OK={ok} WARN={warn} ERROR={error} CRITICAL={critical} INVALID_CONFIG={invalid}".format(
            total=len(items),
            path=status_path,
            ok=severities["OK"],
            warn=severities["WARN"],
            error=severities["ERROR"],
            critical=severities["CRITICAL"],
            invalid=invalid_count,
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe models for graveyard status")
    _ = parser.add_argument(
        "--simulate", action="store_true", help="Use simulated probes"
    )
    args = parser.parse_args()
    simulate = bool(getattr(args, "simulate", False))
    root = Path(__file__).resolve().parents[1]
    ensure_roster()
    roster_items = load_roster()
    if simulate:
        print("Using simulated probes")
        items = simulate_ping(roster_items)
    else:
        print("Using real probes")
        items = real_ping(roster_items)
    write_outputs(items, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
