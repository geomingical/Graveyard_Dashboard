(() => {
  var TILE_HALF_W = 64;
  var TILE_HALF_H = 32;
  var GRID_CENTER = { x: 5, y: 5 };

  var DISPLAY_NAMES = {
    'sisyphus': 'Gondwana',
    'ultrabrain': 'Cambrian',
    'deep': 'Jurassic'
  };

  var SPRITE_IMAGES = {
    'sisyphus': '../images/Gondwana.png',
    'ultrabrain': '../images/Cambrian.png',
    'deep': '../images/Jurassic.png'
  };

  function displayName(name) {
    return DISPLAY_NAMES[name] || name;
  }

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
  var replaceDialog = document.getElementById('replace-dialog');
  var replaceDialogBody = document.getElementById('replace-dialog-body');
  var replaceConfirmBtn = document.getElementById('replace-confirm');
  var replaceCancelBtn = document.getElementById('replace-cancel');
  var refreshBtn = document.getElementById('hud-refresh');

  var currentData = null;
  var pendingReplacement = null;
  var tooltipLocked = false;
  var hideTooltipTimer = null;
  var tooltipHasButton = false;
  var activeSprite = null;
  var tooltipHovered = false;

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

  function getSpriteImg(status, name) {
    if (TOMBSTONE_STATUSES.has(status)) {
      return '../images/tombstone.png';
    }
    return SPRITE_IMAGES[name] || '../images/agent.png';
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
      INVALID_CONFIG: 'Fix roster config entry',
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
    img.src = getSpriteImg(item.status, item.name);
    img.alt = item.name || 'sprite';
    img.width = Math.round(140 * spriteScale);
    img.height = Math.round(210 * spriteScale);
    div.appendChild(img);

    return div;
  }

  function showTooltip(el, event) {
    if (!tooltip || tooltipLocked) {
      return;
    }
    // If interactive tooltip is active, don't let other sprites steal it
    if (tooltipHasButton && el !== activeSprite) {
      return;
    }
    activeSprite = el;
    var d = el.dataset;
    var severityClass = ({
      OK: 'tooltip-status-ok',
      WARN: 'tooltip-status-warn',
      ERROR: 'tooltip-status-error',
      CRITICAL: 'tooltip-status-critical',
    })[d.severity] || 'tooltip-value';

    var action = getActionSuggestion(d.status);
    var isInteractive = d.severity !== 'OK' && d.model && d.model !== 'N/A';

    var html =
      '<div class="tooltip-name">' + displayName(d.name) + '</div>' +
      '<div><span class="tooltip-label">type: </span><span class="tooltip-value">' + d.type + '</span></div>' +
      '<div><span class="tooltip-label">model: </span><span class="tooltip-value">' + d.model + '</span></div>' +
      '<div><span class="tooltip-label">status: </span><span class="' + severityClass + '">' + d.status + '</span></div>' +
      '<div><span class="tooltip-label">severity: </span><span class="' + severityClass + '">' + d.severity + '</span></div>' +
      '<div><span class="tooltip-label">latency: </span><span class="tooltip-value">' + d.latency + 'ms</span></div>' +
      (d.errorMessage ? '<div><span class="tooltip-label">error: </span><span class="tooltip-value">' + d.errorMessage + '</span></div>' : '') +
      '<div class="tooltip-action">' + String.fromCharCode(0x21b3) + ' ' + action + '</div>';

    if (isInteractive) {
      html += '<div class="tooltip-suggestion" id="tooltip-suggestion">loading suggestion...</div>';
    }

    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');

    if (isInteractive) {
      // Anchor tooltip to sprite position (right side), not cursor
      positionTooltipAtSprite(el);
      fetchSuggestion(d.id, d.name, d.model);
    } else {
      positionTooltip(event);
    }
  }

  function fetchSuggestion(agentId, agentName, failedModel) {
    fetch('/api/suggest-replacement?model=' + encodeURIComponent(failedModel))
      .then(function(r) { return r.json(); })
      .then(function(result) {
        var container = document.getElementById('tooltip-suggestion');
        if (!container) return;
        if (result.suggestion) {
          var shortModel = result.suggestion.split('/').pop();
          container.innerHTML =
            '\u21b3 \u5efa\u8b70\u66ff\u63db\u70ba <span class="suggestion-model">' + shortModel + '</span>' +
            '<br><button class="btn-accept-replace" data-agent-id="' + agentId +
            '" data-new-model="' + result.suggestion +
            '" data-agent-name="' + agentName +
            '" data-old-model="' + failedModel + '">Accept</button>';
          tooltip.style.pointerEvents = 'auto';
          tooltipHasButton = true;
          // Re-position after suggestion content loaded (tooltip is now taller)
          if (activeSprite) positionTooltipAtSprite(activeSprite);
        } else {
          container.innerHTML = '\u21b3 \u7121\u53ef\u7528\u66ff\u63db\u6a21\u578b';
        }
      })
      .catch(function() {
        var container = document.getElementById('tooltip-suggestion');
        if (container) container.innerHTML = '\u21b3 \u7121\u6cd5\u8b80\u53d6\u5efa\u8b70';
      });
  }

  function positionTooltipAtSprite(el) {
    if (!tooltip) return;
    // Force reflow to get accurate offsetHeight after innerHTML change
    void tooltip.offsetHeight;
    var rect = el.getBoundingClientRect();
    var tooltipW = tooltip.offsetWidth || 300;
    var tooltipH = tooltip.offsetHeight || 200;
    var viewW = window.innerWidth;
    var viewH = window.innerHeight;

    // Try right side of sprite first
    var x = rect.right + 8;

    // If overflows right, place on left side
    if (x + tooltipW > viewW - 10) {
      x = rect.left - tooltipW - 8;
    }
    // Clamp horizontal (safety)
    if (x < 10) x = 10;

    // Vertical: align tooltip bottom to not exceed viewport
    // If sprite is in bottom half, position tooltip ABOVE sprite center
    var spriteCenter = rect.top + rect.height / 2;
    var y;
    if (spriteCenter + tooltipH / 2 > viewH - 10) {
      // Bottom overflow — align tooltip bottom edge to viewport bottom with margin
      y = viewH - tooltipH - 10;
    } else if (spriteCenter - tooltipH / 2 < 10) {
      // Top overflow — align tooltip top edge to viewport top with margin
      y = 10;
    } else {
      // Vertically center on sprite
      y = spriteCenter - tooltipH / 2;
    }

    tooltip.style.left = Math.round(x) + 'px';
    tooltip.style.top = Math.round(y) + 'px';
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

  function resetTooltipState() {
    tooltip.classList.add('hidden');
    tooltip.style.pointerEvents = 'none';
    tooltipHasButton = false;
    activeSprite = null;
    tooltipHovered = false;
    clearTimeout(hideTooltipTimer);
  }

  function hideTooltip() {
    if (!tooltip || tooltipLocked) {
      return;
    }
    if (tooltipHasButton) {
      clearTimeout(hideTooltipTimer);
      hideTooltipTimer = setTimeout(function() {
        if (!tooltipLocked && !tooltipHovered) {
          resetTooltipState();
        }
      }, 400);
      return;
    }
    resetTooltipState();
  }

  function bindTooltip(el) {
    el.addEventListener('mouseenter', function(e) { showTooltip(el, e); });
    el.addEventListener('mousemove', function(e) {
      // Skip cursor-follow when tooltip is anchored to sprite (interactive)
      if (!tooltipLocked && !tooltipHasButton) positionTooltip(e);
    });
    el.addEventListener('mouseleave', hideTooltip);
  }

  function showReplaceDialog(agentId, agentName, oldModel, newModel) {
    if (!replaceDialog || !replaceDialogBody) return;
    tooltipLocked = true;
    hideTooltipForced();

    var shortOld = oldModel.split('/').pop();
    var shortNew = newModel.split('/').pop();
    replaceDialogBody.innerHTML =
      '<div><span class="label">agent: </span><span class="value">' + agentName + '</span></div>' +
      '<div><span class="label">\u73fe\u884c\u6a21\u578b: </span><span class="value">' + shortOld + '</span></div>' +
      '<div><span class="label">\u66ff\u63db\u70ba: </span><span class="value" style="color:#00f5ff;">' + shortNew + '</span></div>';
    pendingReplacement = { agent_id: agentId, new_model: newModel };
    replaceDialog.classList.remove('hidden');
  }

  function hideReplaceDialog() {
    if (!replaceDialog) return;
    replaceDialog.classList.add('hidden');
    pendingReplacement = null;
    tooltipLocked = false;
  }

  function hideTooltipForced() {
    if (!tooltip) return;
    resetTooltipState();
  }

  function executeReplacement() {
    if (!pendingReplacement) return;
    var payload = pendingReplacement;

    if (replaceConfirmBtn) {
      replaceConfirmBtn.textContent = '\u8655\u7406\u4e2d...';
      replaceConfirmBtn.disabled = true;
    }

    fetch('/api/replace-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        hideReplaceDialog();
        if (replaceConfirmBtn) {
          replaceConfirmBtn.textContent = '\u78ba\u8a8d\u66ff\u63db';
          replaceConfirmBtn.disabled = false;
        }
        if (result.ok) {
          refreshData();
        } else {
          console.error('Replacement failed:', result.error);
        }
      })
      .catch(function(err) {
        hideReplaceDialog();
        if (replaceConfirmBtn) {
          replaceConfirmBtn.textContent = '\u78ba\u8a8d\u66ff\u63db';
          replaceConfirmBtn.disabled = false;
        }
        console.error('Replacement request failed:', err);
      });
  }

  function refreshData() {
    fetch('../data/graveyard_status.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        currentData = data;
        render(data);
      })
      .catch(function(err) {
        console.error('Failed to refresh status data:', err);
      });
  }
  function handleRefresh() {
    if (!refreshBtn || refreshBtn.disabled) return;
    refreshBtn.disabled = true;
    refreshBtn.classList.add('refreshing');
    refreshBtn.textContent = '⟳ Probing...';

    fetch('/api/refresh', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('refreshing');
        refreshBtn.textContent = '⟳ Refresh';
        if (result.items) {
          currentData = result;
          render(result);
        } else if (result.error) {
          console.error('Refresh failed:', result.error);
        }
      })
      .catch(function(err) {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('refreshing');
        refreshBtn.textContent = '⟳ Refresh';
        console.error('Refresh request failed:', err);
      });
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
    var spriteScale = refSize / 1000 * 0.9;
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

    // Position swaps: move items between rings for visual layout
    var POSITION_SWAPS = [
      { a: 'sisyphus', b: 'unspecified-high' },
      { a: 'ultrabrain', b: 'unspecified-low' },
      { a: 'deep', b: 'visual-engineering' }
    ];
    
    POSITION_SWAPS.forEach(function(swap) {
      var aIdx = -1, bIdx = -1;
      var aInAgents = true, bInAgents = true;
      
      agents.forEach(function(item, i) {
        if (item.name === swap.a) aIdx = i;
        if (item.name === swap.b) bIdx = i;
      });
      
      if (aIdx === -1) {
        aInAgents = false;
        categories.forEach(function(item, i) {
          if (item.name === swap.a) aIdx = i;
        });
      }
      if (bIdx === -1) {
        bInAgents = false;
        categories.forEach(function(item, i) {
          if (item.name === swap.b) bIdx = i;
        });
      }
      
      if (aIdx === -1 || bIdx === -1) return;
      
      var arrA = aInAgents ? agents : categories;
      var arrB = bInAgents ? agents : categories;
      var temp = arrA[aIdx];
      arrA[aIdx] = arrB[bIdx];
      arrB[bIdx] = temp;
    });

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
        label.textContent = displayName(entry.item.name) || 'unknown';
        labelLayer.appendChild(label);
      });
    }
    updateHUD(data);
  }

  function handleResize() {
    if (currentData) render(currentData);
  }

  function init() {
    fetch('../data/graveyard_status.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        currentData = data;
        render(data);
        window.addEventListener('resize', handleResize);
      })
      .catch(function(err) {
        console.error('Failed to load graveyard_status.json:', err);
        console.info('Run via: python3 backend/server.py');
      });

    if (replaceConfirmBtn) {
      replaceConfirmBtn.addEventListener('click', executeReplacement);
    }
    if (replaceCancelBtn) {
      replaceCancelBtn.addEventListener('click', hideReplaceDialog);
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', handleRefresh);
    }

    if (tooltip) {
      tooltip.addEventListener('mouseenter', function() {
        clearTimeout(hideTooltipTimer);
        tooltipHovered = true;
      });
      tooltip.addEventListener('mouseleave', function() {
        tooltipHovered = false;
        if (!tooltipLocked) {
          clearTimeout(hideTooltipTimer);
          hideTooltipTimer = setTimeout(function() {
            if (!tooltipLocked && !tooltipHovered) {
              resetTooltipState();
            }
          }, 400);
        }
      });
    }

    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.btn-accept-replace');
      if (btn) {
        e.stopPropagation();
        showReplaceDialog(
          btn.dataset.agentId,
          btn.dataset.agentName,
          btn.dataset.oldModel,
          btn.dataset.newModel
        );
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
