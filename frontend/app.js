(() => {
  var TILE_HALF_W = 64;
  var TILE_HALF_H = 32;
  var GRID_CENTER = { x: 5, y: 5 };

  var STATUS_CLASS = {
    ALIVE: 'status-alive',
    RATE_LIMIT: 'status-rate-limit',
    TIMEOUT: 'status-timeout',
    PROVIDER_ERROR: 'status-provider-error',
    BAD_REQUEST: 'status-bad-request',
    UNAUTHORIZED: 'status-unauthorized',
    MODEL_NOT_FOUND: 'status-model-not-found',
    INVALID_CONFIG: 'status-invalid',
  };

  var TOMBSTONE_STATUSES = new Set(['UNAUTHORIZED', 'MODEL_NOT_FOUND']);

  var tooltip = document.getElementById('tooltip');

  function isoToScreen(gridX, gridY, spreadScale) {
    var viewW = window.innerWidth;
    var viewH = window.innerHeight;
    var baseX = viewW / 2;
    var baseY = viewH * 0.22;
    return {
      x: Math.round((gridX - gridY) * TILE_HALF_W * spreadScale + baseX),
      y: Math.round((gridX + gridY) * TILE_HALF_H * spreadScale + baseY),
    };
  }

  function getRingPositions(count, radiusX, radiusY, centerGX, centerGY) {
    var positions = [];
    if (count <= 0) {
      return positions;
    }
    for (var i = 0; i < count; i++) {
      var angle = (2 * Math.PI * i) / count - Math.PI / 2;
      var gx = centerGX + radiusX * Math.cos(angle);
      var gy = centerGY + radiusY * Math.sin(angle);
      positions.push({ gx: gx, gy: gy });
    }
    return positions;
  }

  function getSpriteImg(status) {
    return TOMBSTONE_STATUSES.has(status) ? '../images/tombstone.png' : '../images/agent.png';
  }

  function getActionSuggestion(status) {
    var actions = {
      ALIVE: 'No action needed',
      RATE_LIMIT: 'Wait and retry \u2014 quota exhausted',
      TIMEOUT: 'Check provider latency / retry',
      PROVIDER_ERROR: 'Provider outage \u2014 check status page',
      UNAUTHORIZED: 'Rotate API key immediately',
      MODEL_NOT_FOUND: 'Update model ID \u2014 model deprecated',
      BAD_REQUEST: 'Verify request format / model params',
      INVALID_CONFIG: 'Fix oh-my-opencode.json config entry',
    };
    return actions[status] || 'Investigate';
  }

  function createSprite(item, screenX, screenY, isAgent, spriteScale) {
    var div = document.createElement('div');
    var typeClass = isAgent ? 'agent' : 'category';
    var statusClass = STATUS_CLASS[item.status] || 'status-invalid';
    div.className = 'sprite ' + typeClass + ' ' + statusClass;
    var zIndex = Math.floor(screenY);
    var spriteHeight = Math.round(210 * spriteScale);
    div.style.cssText = 'left:' + screenX + 'px; top:' + Math.round(screenY - spriteHeight) + 'px; z-index:' + zIndex + ';';

    div.dataset.id = item.id || '';
    div.dataset.name = item.name || 'unknown';
    div.dataset.type = item.type || 'unknown';
    div.dataset.model = item.model || 'N/A';
    div.dataset.status = item.status || 'INVALID_CONFIG';
    div.dataset.severity = item.severity || 'ERROR';
    div.dataset.latency = item.latency_ms != null ? String(item.latency_ms) : 'N/A';
    div.dataset.errorType = item.error_type || '';
    div.dataset.errorMessage = item.error_message || '';

    var img = document.createElement('img');
    img.src = getSpriteImg(item.status);
    img.alt = item.name || 'sprite';
    img.width = Math.round(140 * spriteScale);
    img.height = Math.round(210 * spriteScale);
    div.appendChild(img);

    return div;
  }

  function showTooltip(el, event) {
    if (!tooltip) {
      return;
    }
    var d = el.dataset;
    var severityClass = ({
      OK: 'tooltip-status-ok',
      WARN: 'tooltip-status-warn',
      ERROR: 'tooltip-status-error',
      CRITICAL: 'tooltip-status-critical',
    })[d.severity] || 'tooltip-value';

    var action = getActionSuggestion(d.status);

    tooltip.innerHTML =
      '<div class="tooltip-name">' + d.name + '</div>' +
      '<div><span class="tooltip-label">type: </span><span class="tooltip-value">' + d.type + '</span></div>' +
      '<div><span class="tooltip-label">model: </span><span class="tooltip-value">' + d.model + '</span></div>' +
      '<div><span class="tooltip-label">status: </span><span class="' + severityClass + '">' + d.status + '</span></div>' +
      '<div><span class="tooltip-label">severity: </span><span class="' + severityClass + '">' + d.severity + '</span></div>' +
      '<div><span class="tooltip-label">latency: </span><span class="tooltip-value">' + d.latency + 'ms</span></div>' +
      (d.errorMessage ? '<div><span class="tooltip-label">error: </span><span class="tooltip-value">' + d.errorMessage + '</span></div>' : '') +
      '<div class="tooltip-action">' + String.fromCharCode(0x21b3) + ' ' + action + '</div>';
    tooltip.classList.remove('hidden');
    positionTooltip(event);
  }

  function positionTooltip(event) {
    if (!tooltip) {
      return;
    }
    var x = event.clientX + 16;
    var y = event.clientY - 10;
    var maxX = window.innerWidth - 320;
    var maxY = window.innerHeight - 200;
    tooltip.style.left = Math.min(x, maxX) + 'px';
    tooltip.style.top = Math.min(y, maxY) + 'px';
  }

  function hideTooltip() {
    if (!tooltip) {
      return;
    }
    tooltip.classList.add('hidden');
  }

  function bindTooltip(el) {
    el.addEventListener('mouseenter', function(e) { showTooltip(el, e); });
    el.addEventListener('mousemove', function(e) { positionTooltip(e); });
    el.addEventListener('mouseleave', hideTooltip);
  }

  function updateHUD(data) {
    var genEl = document.getElementById('hud-generated');
    var statsEl = document.getElementById('hud-stats');
    if (!genEl || !statsEl) {
      return;
    }

    var ts = new Date(data.generated_at).toLocaleString('zh-TW', { hour12: false });
    genEl.textContent = 'generated: ' + ts;

    var counts = { OK: 0, WARN: 0, ERROR: 0, CRITICAL: 0 };
    data.items.forEach(function(item) {
      if (counts[item.severity] !== undefined) {
        counts[item.severity]++;
      }
    });

    statsEl.innerHTML =
      '<span class="hud-ok">' + String.fromCharCode(0x25a0) + ' OK: ' + counts.OK + '</span>  ' +
      '<span class="hud-warn">' + String.fromCharCode(0x25a0) + ' WARN: ' + counts.WARN + '</span>  ' +
      '<span class="hud-error">' + String.fromCharCode(0x25a0) + ' ERR: ' + counts.ERROR + '</span>  ' +
      '<span class="hud-critical">' + String.fromCharCode(0x25a0) + ' CRIT: ' + counts.CRITICAL + '</span>';
  }

  function render(data) {
    var viewW = window.innerWidth;
    var viewH = window.innerHeight;
    var refSize = Math.min(viewW, viewH * 1.6);

    // spriteScale: sprite/tower size (unclamped — bigger viewport = bigger sprites)
    var spriteScale = refSize / 1000;
    // spreadScale: grid spread (clamped so outer ring stays within viewport)
    // Horizontal: Max |gx-gy| for outer ring (rx=7, ry=4.8, 8 items) ~ 8.34 tiles
    var maxSpreadH = (viewW / 2 - 80) / (8.34 * 64);
    // Vertical: Max (gx+gy) for outer ring ~ 18.49, min ~ 1.51
    // Bottom edge: screenY = 18.49 * 32 * spread + viewH*0.22; must leave room for label (~30px)
    var maxSpreadV = (viewH * 0.78 - 30) / (18.49 * 32);
    var spreadScale = Math.min(spriteScale, maxSpreadH, maxSpreadV);

    var grid = document.getElementById('graveyard-grid');
    if (!grid) {
      return;
    }

    var sprites = grid.querySelectorAll('.sprite');
    sprites.forEach(function(s) { s.remove(); });

    var agents = data.items.filter(function(i) { return i.type === 'agent'; });
    var categories = data.items.filter(function(i) { return i.type === 'category'; });

    // Tower
    var towerPos = isoToScreen(GRID_CENTER.x, GRID_CENTER.y, spreadScale);
    var towerDiv = document.createElement('div');
    towerDiv.className = 'sprite tower';
    var towerSize = Math.round(360 * spriteScale);
    towerDiv.style.cssText = 'left:' + towerPos.x + 'px; top:' + Math.round(towerPos.y - towerSize) + 'px; z-index:' + Math.floor(towerPos.y) + ';';
    var towerImg = document.createElement('img');
    towerImg.src = '../images/tower.png';
    towerImg.alt = 'Central Tower';
    towerImg.width = towerSize;
    towerImg.height = towerSize;
    towerDiv.appendChild(towerImg);
    grid.appendChild(towerDiv);

    // Inner ring agents
    var agentPositions = getRingPositions(agents.length, 3.5, 2.5, GRID_CENTER.x, GRID_CENTER.y);
    agents.forEach(function(item, i) {
      var pos = agentPositions[i];
      var screen = isoToScreen(pos.gx, pos.gy, spreadScale);
      var el = createSprite(item, screen.x, screen.y, true, spriteScale);
      bindTooltip(el);
      grid.appendChild(el);
    });

    // Outer ring categories
    var catPositions = getRingPositions(categories.length, 7.0, 4.8, GRID_CENTER.x, GRID_CENTER.y);
    categories.forEach(function(item, i) {
      var pos = catPositions[i];
      var screen = isoToScreen(pos.gx, pos.gy, spreadScale);
      var el = createSprite(item, screen.x, screen.y, false, spriteScale);
      bindTooltip(el);
      grid.appendChild(el);
    });

    // Labels overlay — positioned relative to sprite anchor (foot = screen.y)
    // Sprite image occupies: top = y - 210*spriteScale, bottom = y
    // Default label: just below sprite foot, nudged up slightly so it touches
    // Left label (writing/explore): to the left at sprite midpoint height
    var labelLayer = document.getElementById('label-layer');
    if (labelLayer) {
      labelLayer.innerHTML = '';
      var allItems = [];
      agents.forEach(function(item, i) { allItems.push({ item: item, pos: agentPositions[i] }); });
      categories.forEach(function(item, i) { allItems.push({ item: item, pos: catPositions[i] }); });

      allItems.forEach(function(entry) {
        var screen = isoToScreen(entry.pos.gx, entry.pos.gy, spreadScale);
        var label = document.createElement('div');
        label.className = 'sprite-label';
        var isLeftLabel = entry.item.name === 'writing' || entry.item.name === 'explore' || entry.item.name === 'unspecified-low';
        if (isLeftLabel) {
          label.classList.add('label-left');
          // Left side, vertically at sprite mid-body
          label.style.cssText = 'left:' + Math.round(screen.x - Math.round(72 * spriteScale)) + 'px; top:' + Math.round(screen.y - Math.round(115 * spriteScale)) + 'px;';
        } else {
          // Centered below sprite feet, nudged up 2px so label pill touches the foot
          label.style.cssText = 'left:' + screen.x + 'px; top:' + Math.round(screen.y - Math.round(12 * spriteScale)) + 'px;';
        }
        label.textContent = entry.item.name || 'unknown';
        labelLayer.appendChild(label);
      });
    }
    updateHUD(data);
  }

  function handleResize(data) {
    render(data);
  }

  function init() {
    fetch('../data/graveyard_status.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        render(data);
        window.addEventListener('resize', function() { handleResize(data); });
      })
      .catch(function(err) {
        console.error('Failed to load graveyard_status.json:', err);
        console.info('Run via: python3 -m http.server 8080 in project root');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
