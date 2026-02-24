# PROJECT KNOWLEDGE BASE
**Generated:** 2026-02-25

## OVERVIEW
Isometric pixel art monitoring dashboard visualizing LLM subagent health as a cyber graveyard. Alive agents appear as robot sprites with ice-blue glow, while dead agents appear as tombstones with red glow. Central orchestration tower pulses at grid center.

## STATUS
**Implementation complete (V12).** Frontend renders all 14 agents/categories in two concentric rings around a central tower. Backend generates mock status data with `simulate_ping()` (seed 42). Cross-browser Safari/Chrome consistency verified. Responsive layout tested at 830×700, 1200×750, 1200×900, 1440×900 viewports. Awaiting user visual review.

### What Works
- Full isometric grid rendering with proper z-index sorting
- Viewport-responsive dual scaling (spriteScale + spreadScale)
- Cross-browser pixel-perfect rendering (Safari + Chrome)
- Vertical + horizontal spreadScale clamping
- Name labels positioned at sprite feet (default) or left-side (writing/explore)
- Separate label overlay layer (z-index 500) prevents sprite occlusion
- HUD with severity counts (OK/WARN/ERR/CRIT)
- Tooltips on hover with name, model, status, latency, action suggestion
- Tower pulse animation via drop-shadow intensity
- Agent breathe animation (translateY max 2px)
- Status glow: ice-blue (OK), amber (WARN), purple (ERROR), red (CRITICAL)

### What's Not Done Yet
- No git repository initialized
- Backend uses `simulate_ping()` mock — real API probe not wired
- No favicon.ico (minor 404 in console)
- `graveyard_history.jsonl` append logic not implemented
- No auto-refresh / polling of status data

## STRUCTURE
```
Graveyard_Dashboard/
├── AGENTS.md                  # This file — authoritative project knowledge base
├── Graveyard_Dashboard.md     # Original design spec (Traditional Chinese)
├── images/
│   ├── agent.png              # Alive robot sprite (ice-blue neon, transparent)
│   ├── background.png         # Isometric tech floor 1536×1024 (dark gray + ice-blue grid)
│   ├── tombstone.png          # Dead agent tombstone (red warning, transparent)
│   ├── tower.png              # Central tower (ice-blue, transparent — white bg removed)
│   └── tower_original.png     # Backup of tower before bg removal
├── backend/
│   ├── daily_ping.py          # API probe script (Python) — reads roster, writes JSON
│   └── venv/                  # Python venv (has Pillow, playwright installed)
├── frontend/
│   ├── index.html             # HTML shell with #graveyard-grid, #label-layer, #tooltip, #hud
│   ├── style.css              # Isometric layout, glow animations, label styles (233 lines)
│   └── app.js                 # Data binding, dual-scale rendering logic (282 lines)
├── data/
│   ├── graveyard_status.json  # Probe output — 14 items (6 agents, 8 categories)
│   ├── graveyard_history.jsonl # Daily status append log (placeholder)
│   └── (oh-my-opencode.json)  # Source roster at ~/.config/opencode/oh-my-opencode.json
├── remove_bg.py               # One-off script that removed tower.png white background
├── test.js                    # (unused test file)
└── screenshot_v12_*.png       # Latest verified screenshots (900w, 1200w, 1440w)
```

## DATA CONTRACT
The frontend reads `data/graveyard_status.json`:
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

Current data: 14 items — 6 agents (inner ring), 8 categories (outer ring). Simulated with seed 42. Status distribution: OK=8, WARN=0, ERROR=4, CRITICAL=2.

## CONVENTIONS
- **Architecture**: Backend probes APIs → writes JSON. Frontend is a dumb renderer (reads JSON only).
- **Roster Parsing**: Dynamic lookup from `~/.config/opencode/oh-my-opencode.json`. No hardcoding names.
- **Error Mapping**: 200→ALIVE(OK), 429→RATE_LIMIT(WARN), 408/Timeout→TIMEOUT(ERROR), 500-504→PROVIDER_ERROR(ERROR), 401/403→UNAUTHORIZED(CRITICAL), 404→MODEL_NOT_FOUND(CRITICAL), Other 4xx→BAD_REQUEST(ERROR).
- **Visuals**: 2D Isometric only. `image-rendering: pixelated` on all sprites.
- **Glow**: CSS `filter: drop-shadow()` only. NEVER use borders on sprites. NEVER use `filter: brightness()`.
- **Sprite Mapping**: UNAUTHORIZED, MODEL_NOT_FOUND → tombstone.png. All others → agent.png.
- **Sprite Anchor**: Bottom-center via `transform: translateX(-50%)`.
- **Animation**: Agent breathe max `translateY(-2px)`. Tower pulse via drop-shadow intensity only.

## LAYOUT ARCHITECTURE (V12 — Current)

### Dual-Scale System
```
refSize = Math.min(viewW, viewH * 1.6)
spriteScale = refSize / 1000              // Unclamped — bigger viewport = bigger sprites
maxSpreadH = (viewW/2 - 80) / (8.34 * 64)           // Horizontal: outer ring within viewport width
maxSpreadV = (viewH * 0.78 - 30) / (18.49 * 32)     // Vertical: outer ring within viewport height
spreadScale = Math.min(spriteScale, maxSpreadH, maxSpreadV)
```
- `spriteScale` controls: sprite img size (140×210 base), tower size (360 base), label offsets
- `spreadScale` controls: isometric grid tile spread only

### Isometric Grid
```
screenX = Math.round((gridX - gridY) * TILE_HALF_W * spreadScale + viewW/2)
screenY = Math.round((gridX + gridY) * TILE_HALF_H * spreadScale + viewH * 0.22)
```
- TILE_HALF_W=64, TILE_HALF_H=32
- GRID_CENTER = {x:5, y:5}
- z-index = Math.floor(screenY)

### Ring Layout
- Inner ring (6 agents): radiusX=3.5, radiusY=2.5
- Outer ring (8 categories): radiusX=7.0, radiusY=4.8
- Angular positions: `angle = (2π * i / count) - π/2` (starts at top)
- Max |gx-gy| for outer ring ≈ 8.34 tiles (used for spreadScale clamp)

### Label Positioning
- Labels render in `#label-layer` (z-index: 500, pointer-events: none) — separate from sprites
- Default labels: centered below sprite feet → `left: screenX, top: screenY - 12*spriteScale`
- Left-side labels (writing, explore, unspecified-low): `left: screenX - 72*spriteScale, top: screenY - 115*spriteScale` with CSS `transform: translateX(-100%)`
- Label style: 11px Courier, #e0ffff, dark pill background, ice-blue text-shadow

### Scale Values at Common Viewports
| Viewport | spriteScale | spreadScale | Sprite px | Tower px |
|----------|-------------|-------------|-----------|----------|
| 900×900  | 0.900       | 0.693       | 126×189   | 324      |
| 1200×900 | 1.200       | 0.974       | 168×252   | 432      |
| 1440×900 | 1.440       | 1.103       | 202×302   | 518      |

## ANTI-PATTERNS
- Hardcoding agent or category names
- Frontend making direct API calls
- CSS borders on sprites (tooltip borders are OK)
- `filter: brightness()` — blurs pixel art
- `as any`, `@ts-ignore` type suppression
- Floating animations exceeding 2px translateY
- 3D rendering or smooth textures
- Using single scale factor for both spread and sprite size
- Using single-axis viewport clamp (must clamp BOTH horizontal AND vertical)

## LESSONS LEARNED

### 跨瀏覽器一致性（Safari vs Chrome）

**問題根源**：Chrome 工具列（書籤列 + 分頁列）佔 80-100px 垂直空間，導致 `window.innerHeight` 比 Safari 矮。如果佈局只 clamp 水平方向，底部 sprite 會被 `overflow: hidden` 裁掉。

**修正原則**：
1. **spreadScale 必須同時 clamp 水平與垂直** — 只 clamp 一個方向就會在另一個方向溢出
2. **所有 CSS 像素值必須 `Math.round()`** — Safari/Chrome 對小數 px 的 subpixel rounding 不同，浮點座標會造成 sprite 位置飄移
3. **`html, body` 都要明確設定 `width/height/overflow`** — 只設 `body` 不夠，Chrome 的 `html` 元素預設行為不同，底部會露白邊
4. **`image-rendering: pixelated` + `crisp-edges` 雙寫** — Chrome 在 filter + 縮放下可能平滑像素圖

### 佈局調校歷程

| 版本 | 問題 | 根因 | 修法 |
|:---|:---|:---|:---|
| V7 | writing/explore label 被 sprite 遮蓋 | label 在 sprite 同層 | 分離 #label-layer (z-index 500) |
| V8 | 大螢幕 sprite 太小、小螢幕溢出 | 單一 scale factor | 拆成 spriteScale + spreadScale 雙系統 |
| V10 | label 飄太高離 sprite 太遠 | label offset 用絕對值不跟 scale | label offset 乘 spriteScale |
| V11c | 大螢幕 outer ring 超出左右邊界 | spreadScale 沒上限 | clamp spreadScale ≤ (viewW/2-80)/(8.34×64) |
| V12 | Chrome 底部 sprite 被裁切、頂部切齊 | spreadScale 只 clamp 水平沒 clamp 垂直 | 加 maxSpreadV clamp + baseY 0.18→0.22 |
| V12 | Safari/Chrome sprite 位置不同 | screenX/Y 是浮點數 | 所有座標 Math.round() |

## WHERE TO LOOK
| Task | Location | Notes |
|:---|:---|:---|
| Config Source | `~/.config/opencode/oh-my-opencode.json` | Read-only agent roster |
| API Probing | `backend/daily_ping.py` | Python script, uses venv |
| Rendering Logic | `frontend/app.js` | Dual-scale, ring layout, label overlay |
| CSS / Animations | `frontend/style.css` | Glow classes, tower-pulse, agent-breathe |
| HTML Shell | `frontend/index.html` | #graveyard-grid, #label-layer, #tooltip, #hud |
| Status Data | `data/graveyard_status.json` | 14 items, seed 42 |

## COMMANDS
```bash
# Start dev server (from project root)
python3 -m http.server 8080
# Dashboard URL
open http://localhost:8080/frontend/index.html

# Run backend probe (generates graveyard_status.json)
cd backend && source venv/bin/activate && python daily_ping.py

# Take Playwright screenshot
python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1200, 'height': 900})
    page.goto('http://localhost:8080/frontend/index.html')
    page.wait_for_timeout(2000)
    page.screenshot(path='screenshot.png')
    browser.close()
"
```

## NOTES
- **Graceful degradation**: Mark missing model fields as INVALID_CONFIG instead of crashing.
- **ID format**: Always "type:name" (e.g., "agent:sisyphus") for uniqueness.
- **Tower**: Always at grid center. Pulse via drop-shadow intensity variation.
- **tower.png**: White background was removed via PIL. Backup at `tower_original.png`.
- **Probe mock**: `simulate_ping()` uses `random.seed(42)` for reproducible results.
- **HTTP server**: `python3 -m http.server 8080` from project root. PID may vary.
- **Playwright**: Installed in system Python. Use for screenshots — more reliable than delegating to subagents.
- **Delegation lessons**: Only `quick` (Claude Haiku 4.5) reliably works for task delegation. Gemini-based categories (deep, ultrabrain, artistry) frequently fail. For complex multi-part file edits, write directly via bash heredoc rather than delegating. The `write` and `read` tools may hit `RangeError: Maximum call stack size exceeded` — use `cat >` heredoc as fallback.
