# Cyber Graveyard Dashboard
Isometric pixel art monitoring dashboard for LLM subagent health

## Overview
This monitoring dashboard visualizes the health of LLM subagents and categories as a cyber graveyard. Alive agents appear as robot sprites with an ice-blue glow, while dead agents appear as tombstones with a red glow. A central orchestration tower pulses at the grid center to represent system activity.

## Features
- Isometric grid rendering with proper z-index sorting
- Viewport-responsive dual scaling (sprite size and grid spread)
- Cross-browser pixel-perfect rendering for Safari and Chrome
- HUD display with severity counts (OK, WARN, ERROR, CRITICAL)
- Hover tooltips showing agent details, latency, and status
- Dynamic status glow effects: ice-blue (OK), amber (WARN), purple (ERROR), red (CRITICAL)
- CSS animations including sprite breathe effects and tower pulse
- Dynamic roster parsing without hardcoded names

## Architecture
The project follows a clean separation of concerns between backend and frontend.

- **Backend (Python)**: Probes LLM APIs and writes the results to a structured JSON file. Currently, this uses simulated data for status reporting.
- **Frontend (Vanilla HTML/CSS/JS)**: A lightweight renderer that reads the JSON data and updates the isometric visualization. There are no frameworks or build steps required.

## Project Structure
```
Graveyard_Dashboard/
├── backend/
│   └── daily_ping.py        # API probe script — reads roster, writes JSON
├── frontend/
│   ├── index.html            # HTML shell
│   ├── style.css             # Isometric layout, glow animations
│   └── app.js                # Data binding, dual-scale rendering
├── data/
│   ├── graveyard_status.json # Probe output (14 items)
│   └── graveyard_history.jsonl # Daily append log
└── images/
    ├── agent.png             # Alive robot sprite
    ├── background.png        # Isometric tech floor
    ├── tombstone.png         # Dead agent tombstone
    └── tower.png             # Central orchestration tower
```

## Quick Start
1. Generate status data:
   ```bash
   cd backend && python daily_ping.py
   ```
2. Start the development server from the project root:
   ```bash
   python3 -m http.server 8080
   ```
3. Open the dashboard in your browser:
   `http://localhost:8080/frontend/index.html`

## Data Contract
The frontend expects a JSON file at `data/graveyard_status.json` with the following structure:

```json
{
  "generated_at": "ISO8601 timestamp",
  "schema_version": 1,
  "items": [
    {
      "id": "type:name",
      "name": "string",
      "type": "agent | category",
      "model": "string",
      "status": "ALIVE | RATE_LIMIT | TIMEOUT | PROVIDER_ERROR | UNAUTHORIZED | MODEL_NOT_FOUND | BAD_REQUEST",
      "severity": "OK | WARN | ERROR | CRITICAL",
      "http_status": 200,
      "error_type": "string | null",
      "error_message": "string | null",
      "latency_ms": 123
    }
  ]
}
```

## Status Mapping
| HTTP Status | Agent Status | Severity |
| :--- | :--- | :--- |
| 200 | ALIVE | OK |
| 429 | RATE_LIMIT | WARN |
| 408 / Timeout | TIMEOUT | ERROR |
| 5xx | PROVIDER_ERROR | ERROR |
| 401 / 403 | UNAUTHORIZED | CRITICAL |
| 404 | MODEL_NOT_FOUND | CRITICAL |
| Other 4xx | BAD_REQUEST | ERROR |

## License
MIT
