#!/usr/bin/env python3
"""Flask API server for Cyber Graveyard Dashboard.

Replaces `python3 -m http.server` with:
  - Static file serving for frontend/, data/, images/
  - GET  /api/status          — current graveyard_status.json
  - GET  /api/models          — available models grouped by tier
  - POST /api/replace-model   — swap a model in roster config, re-ping, refresh status
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

# ── Paths ────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"
DATA_DIR = ROOT / "data"
IMAGES_DIR = ROOT / "images"
STATUS_PATH = DATA_DIR / "graveyard_status.json"
CONFIG_PATH = DATA_DIR / "roster.json"

# ── Import reusable helpers from daily_ping ──────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily_ping import (  # noqa: E402
    ensure_roster,
    get_model_tiers,
    load_roster,
    ping_single,
    real_ping,
    suggest_replacement,
    write_outputs,
)

app = Flask(__name__)


# ══════════════════════════════════════════════════════════════
#  Static file serving
# ══════════════════════════════════════════════════════════════


@app.route("/")
def index():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.route("/frontend/<path:filename>")
def serve_frontend(filename):
    return send_from_directory(str(FRONTEND_DIR), filename)


@app.route("/data/<path:filename>")
def serve_data(filename):
    return send_from_directory(str(DATA_DIR), filename)


@app.route("/images/<path:filename>")
def serve_images(filename):
    return send_from_directory(str(IMAGES_DIR), filename)


# ══════════════════════════════════════════════════════════════
#  API endpoints
# ══════════════════════════════════════════════════════════════


@app.route("/api/status")
def api_status():
    """Return current graveyard_status.json contents."""
    if not STATUS_PATH.exists():
        return jsonify(
            {"error": "Status file not found. Run daily_ping.py first."}
        ), 404
    data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    return jsonify(data)


@app.route("/api/models")
def api_models():
    """Return available models grouped by ability tier."""
    tiers = get_model_tiers()


    alive_models: set[str] = set()
    if STATUS_PATH.exists():
        status_data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
        for item in status_data.get("items", []):
            if item.get("severity") == "OK" and item.get("model"):
                alive_models.add(item["model"])

    result: dict[str, list[dict[str, object]]] = {}
    for tier, models in tiers.items():
        result[tier] = [{"model": m, "alive": m in alive_models} for m in models]

    return jsonify({"tiers": result})


@app.route("/api/suggest-replacement")
def api_suggest_replacement():
    """Suggest a replacement model for a failed model.

    Query params:
      model (required) — the failed model name
    """
    failed_model = request.args.get("model")
    if not failed_model:
        return jsonify({"error": "Missing 'model' query parameter"}), 400


    if not STATUS_PATH.exists():
        return jsonify({"error": "Status file not found"}), 404
    status_data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    items = status_data.get("items", [])

    suggestion = suggest_replacement(failed_model, items)
    return jsonify({"failed_model": failed_model, "suggestion": suggestion})


@app.route("/api/replace-model", methods=["POST"])
def api_replace_model():
    """Replace a model in roster config, re-ping, and update status.

    JSON body:
      {
        "agent_id": "type:name" (e.g. "agent:gondwana" or "category:writing"),
        "new_model": "provider/model-name"
      }

    Response:
      { "ok": true, "agent_id": "...", "old_model": "...", "new_model": "...", "new_status": {...} }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Invalid JSON body"}), 400

    agent_id = body.get("agent_id", "")
    new_model = body.get("new_model", "")

    if not agent_id or not new_model:
        return jsonify({"error": "Missing 'agent_id' or 'new_model'"}), 400

    # Parse agent_id → section + name
    parts = agent_id.split(":", 1)
    if len(parts) != 2 or parts[0] not in ("agent", "category"):
        return jsonify({"error": f"Invalid agent_id format: {agent_id}"}), 400
    item_type, name = parts
    section_key = "agents" if item_type == "agent" else "categories"

    # ── Read config ──────────────────────────────────────────
    if not CONFIG_PATH.exists():
        return jsonify({"error": f"Config not found: {CONFIG_PATH}"}), 404
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        return jsonify({"error": f"Failed to read config: {exc}"}), 500

    section = config.get(section_key)
    if not isinstance(section, dict) or name not in section:
        return jsonify({"error": f"'{name}' not found in config[{section_key}]"}), 404

    entry = section[name]
    if not isinstance(entry, dict):
        return jsonify({"error": f"Invalid config entry for '{name}'"}), 500

    old_model = entry.get("model", "")

    # ── Backup config before modifying ───────────────────────
    backup_path = CONFIG_PATH.with_suffix(".json.bak")
    shutil.copy2(CONFIG_PATH, backup_path)

    # ── Modify model field only ──────────────────────────────
    entry["model"] = new_model
    try:
        CONFIG_PATH.write_text(
            json.dumps(config, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    except Exception as exc:

        shutil.copy2(backup_path, CONFIG_PATH)
        return jsonify({"error": f"Failed to write config: {exc}"}), 500

    # ── Re-ping the new model ────────────────────────────────
    new_status = ping_single(name, item_type, new_model)

    # ── Update graveyard_status.json ─────────────────────────
    try:
        status_data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
        items = status_data.get("items", [])

        for i, it in enumerate(items):
            if it.get("id") == agent_id:
                items[i] = new_status
                break
        status_data["generated_at"] = (
            datetime.now().astimezone().isoformat(timespec="seconds")
        )
        STATUS_PATH.write_text(
            json.dumps(status_data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as exc:
        return jsonify(
            {
                "error": f"Model replaced but status update failed: {exc}",
                "ok": False,
                "agent_id": agent_id,
                "old_model": old_model,
                "new_model": new_model,
            }
        ), 500

    return jsonify(
        {
            "ok": True,
            "agent_id": agent_id,
            "old_model": old_model,
            "new_model": new_model,
            "new_status": new_status,
        }
    )


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    """Re-probe all agents using real opencode CLI probes and update status."""
    try:
        roster = load_roster()
        items = real_ping(roster, max_workers=3)
        write_outputs(items, ROOT)

        if STATUS_PATH.exists():
            data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
            return jsonify(data)
        else:
            return jsonify({"error": "Failed to generate status data"}), 500
    except Exception as exc:
        return jsonify({"error": f"Refresh failed: {exc}"}), 500


# ══════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    ensure_roster()
    # Generate initial status if missing
    if not STATUS_PATH.exists():
        print("Generating initial status data...")
        from daily_ping import simulate_ping

        roster = load_roster()
        simulated = simulate_ping(roster)
        write_outputs(simulated, ROOT)

    print(f"Serving dashboard at http://localhost:8080")
    print(f"  Frontend: {FRONTEND_DIR}")
    print(f"  Data:     {DATA_DIR}")
    print(f"  Roster:   {CONFIG_PATH}")
    app.run(host="0.0.0.0", port=8080, debug=False)
