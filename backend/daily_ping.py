#!/usr/bin/env python3
"""Generate simulated graveyard status data."""

from __future__ import annotations

import json
import random
import sys
from datetime import datetime
from pathlib import Path
from typing import cast

ROSTER_PATH = Path("/Users/ming/.config/opencode/oh-my-opencode.json")
WEIGHTED_HTTP_STATUSES = [200, 200, 200, 200, 200, 429, 408, 500, 401, 404, 400]
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
    root = Path(__file__).resolve().parents[1]
    roster_items = load_roster()
    simulated = simulate_ping(roster_items)
    write_outputs(simulated, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
