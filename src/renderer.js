const state = {
  frame: 0,
  pet: null,
  petAction: 'idle',
  activityAction: 'idle',
  dragActionUntil: 0,
  refreshMs: 5000,
  refreshTimer: null,
  drag: null,
  controlsHideTimer: null
};

const $ = (id) => document.getElementById(id);
// Original design baseline. Larger default windows intentionally scale up from this size.
const BASE_WINDOW = { width: 364, height: 351, scale: 0.65 };

function on(id, eventName, handler) {
  const element = $(id);
  if (element) element.addEventListener(eventName, handler);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.round(Number(value || 0)));
}

function formatWindow(minutes) {
  if (!minutes) return 'limit';
  if (minutes === 300) return '5h limit';
  if (minutes === 10080) return 'weekly limit';
  if (minutes < 60) return `${minutes}m limit`;
  if (minutes % 1440 === 0) return `${minutes / 1440}d limit`;
  if (minutes % 60 === 0) return `${minutes / 60}h limit`;
  return `${minutes}m limit`;
}

function formatResetTime(limit) {
  if (!limit?.available || limit.resetInMs == null) return '-- left';
  const totalMinutes = Math.max(0, Math.ceil(Number(limit.resetInMs || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

function setBar(id, percent) {
  $(id).style.width = `${clamp(percent || 0, 0, 100)}%`;
}

function setCursor(id, limit) {
  const cursor = $(id);
  const windowMs = Number(limit?.windowMinutes || 0) * 60 * 1000;
  if (!limit?.available || !windowMs || limit.resetInMs == null) {
    cursor.style.opacity = '0';
    return;
  }
  const percent = clamp((Number(limit.resetInMs) / windowMs) * 100, 0, 100);
  cursor.style.left = `${percent}%`;
  cursor.style.opacity = '1';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function updateUiScale() {
  const widthRatio = window.innerWidth / BASE_WINDOW.width;
  const heightRatio = window.innerHeight / BASE_WINDOW.height;
  const scale = clamp(Math.min(widthRatio, heightRatio) * BASE_WINDOW.scale, 0.45, 1.1);
  document.querySelector('.shell')?.style.setProperty('--ui-scale', String(scale));
}

function renderLimit(prefix, limit) {
  if (!limit?.available) {
    $(`${prefix}-title`).textContent = prefix === 'primary' ? '5h limit' : 'weekly limit';
    $(`${prefix}-reset`).textContent = '-- reset';
    $(`${prefix}-left`).textContent = '-- left';
    setBar(`${prefix}-bar`, 0);
    setCursor(`${prefix}-cursor`, limit);
    return;
  }
  $(`${prefix}-title`).textContent = formatWindow(limit.windowMinutes);
  $(`${prefix}-reset`).textContent = formatResetTime(limit);
  $(`${prefix}-left`).textContent = `${Math.round(limit.leftPercent)}% left`;
  setBar(`${prefix}-bar`, limit.leftPercent);
  setCursor(`${prefix}-cursor`, limit);
}

function renderUsage(data) {
  state.pet = data.pet;
  state.refreshMs = data.refreshMs || state.refreshMs;

  $('level').textContent = `Lv. ${data.level.value}`;
  $('xp-text').textContent = `${formatNumber(data.level.currentXp)} / ${formatNumber(data.level.nextXp)} XP`;
  setBar('xp-bar', data.level.percent);

  renderLimit('primary', data.primary);
  renderLimit('secondary', data.secondary);

  $('plan').textContent = `plan: ${data.planType || 'unknown'} · ${formatNumber(data.tokens.lifetime)} tokens`;
  const updated = data.latestEventAt ? new Date(data.latestEventAt).toLocaleTimeString() : 'no token_count found';
  $('updated').textContent = `updated ${updated}`;
  renderActivity(data.activity);

  const pet = $('pet');
  if (data.pet?.atlasUrl) {
    pet.style.backgroundImage = `url("${data.pet.atlasUrl}")`;
    pet.style.width = `${data.pet.cellWidth}px`;
    pet.style.height = `${data.pet.cellHeight}px`;
  }
}

function renderActivity(activity) {
  const bubble = $('task-bubble');
  const text = $('bubble-text');
  const task = cleanBubbleText(activity?.task || '');
  const hasTask = task && task !== 'Current Codex task' && task !== 'No current Codex task found';
  const isComplete = Boolean(activity?.isComplete);
  const isInProgress = Boolean(hasTask && !isComplete);
  const action = getActivityAction(activity);

  bubble.classList.toggle('running', isInProgress);
  bubble.classList.toggle('done', Boolean(hasTask && isComplete));
  state.activityAction = action;
  syncPetAction();

  if (!hasTask) {
    text.innerHTML = 'Coding<br />together!';
    return;
  }
  text.textContent = task;
}

function cleanBubbleText(value) {
  return String(value || '')
    .replace(/^# Files mentioned by the user:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
}

function getActivityAction(activity) {
  const text = `${activity?.status || ''} ${activity?.tool || ''}`.toLowerCase();
  if (activity?.isFailed) return 'failed';
  if (activity?.isComplete) return 'idle';
  if (/(approval|approve|permission|escalat|waiting for user|requires user|等待|审批|批准|授权|确认)/i.test(text)) {
    return 'waiting';
  }
  if (activity?.isToolRunning || activity?.isActive) return 'running';
  return 'idle';
}

function syncPetAction() {
  const next = Date.now() < state.dragActionUntil ? state.petAction : state.activityAction;
  setPetAction(next || 'idle');
}

function setPetAction(action) {
  const normalizedAction = action === 'failed' ? 'idle' : action;
  const next = getAnimation(normalizedAction) ? normalizedAction : 'idle';
  if (state.petAction === next) return;
  state.petAction = next;
  state.frame = 0;
}

function getAnimation(action) {
  const animations = state.pet?.animations || {};
  const fallback = {
    idle: { row: Number(state.pet?.idleRow || 0), frames: Number(state.pet?.idleFrames || 6), frameMs: 420 },
    runningRight: { row: 1, frames: 8, frameMs: 150 },
    runningLeft: { row: 2, frames: 8, frameMs: 150 },
    failed: { row: Number(state.pet?.idleRow || 0), frames: Number(state.pet?.idleFrames || 6), frameMs: 420 },
    waiting: { row: 6, frames: 6, frameMs: 300 },
    running: { row: Number(state.pet?.runningRow ?? 7), frames: 6, frameMs: 240 }
  };
  return animations[action] || fallback[action] || fallback.idle;
}

async function refresh() {
  try {
    const data = await window.codexUsagePet.getUsage();
    renderUsage(data);
  } catch (error) {
    $('updated').textContent = `read failed: ${error.message}`;
  } finally {
    scheduleRefresh();
  }
}

function scheduleRefresh() {
  if (state.refreshTimer) window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(refresh, state.refreshMs);
}

function setControlsVisible(visible) {
  if (state.controlsHideTimer) {
    window.clearTimeout(state.controlsHideTimer);
    state.controlsHideTimer = null;
  }
  if (!visible && (state.drag || resizeStart)) return;
  $('panel')?.classList.toggle('controls-visible', visible);
}

function hideControlsSoon() {
  if (state.controlsHideTimer) window.clearTimeout(state.controlsHideTimer);
  state.controlsHideTimer = window.setTimeout(() => {
    if (!state.drag && !resizeStart) setControlsVisible(false);
  }, 120);
}

function tickPet() {
  const pet = state.pet;
  if (pet) {
    syncPetAction();
    const animation = getAnimation(state.petAction);
    const frameCount = Math.max(1, Number(animation.frames || 1));
    const frame = state.frame % frameCount;
    const x = -(frame * pet.cellWidth);
    const y = -(Number(animation.row || 0) * pet.cellHeight);
    $('pet').style.backgroundPosition = `${x}px ${y}px`;
    $('pet').style.backgroundSize = `${pet.columns * pet.cellWidth}px auto`;
    state.frame = (state.frame + 1) % frameCount;
    window.setTimeout(tickPet, Number(animation.frameMs || 300));
    return;
  }
  window.setTimeout(tickPet, 300);
}

on('refresh', 'click', refresh);
on('close', 'click', () => window.codexUsagePet.close());
on('pin', 'click', async () => {
  const pinned = await window.codexUsagePet.toggleTop();
  $('pin').classList.toggle('active', pinned);
});

let resizeStart = null;
on('resize-grip', 'pointerdown', (event) => {
  setControlsVisible(true);
  resizeStart = { x: event.screenX, y: event.screenY, lastX: event.screenX, lastY: event.screenY };
  $('resize-grip').setPointerCapture(event.pointerId);
});

on('resize-grip', 'pointermove', async (event) => {
  if (!resizeStart) return;
  const dx = event.screenX - resizeStart.lastX;
  const dy = event.screenY - resizeStart.lastY;
  resizeStart.lastX = event.screenX;
  resizeStart.lastY = event.screenY;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const resizeDelta = Math.abs(dx) >= Math.abs(dy)
    ? { x: dx, y: dx / aspect }
    : { x: dy * aspect, y: dy };
  await window.codexUsagePet.resizeBy(resizeDelta);
  updateUiScale();
});

on('resize-grip', 'pointerup', () => {
  resizeStart = null;
});

on('panel', 'pointerdown', (event) => {
  if (event.button !== 0 || isInteractiveTarget(event.target)) return;
  state.drag = { lastX: event.screenX, lastY: event.screenY };
  $('panel')?.classList.toggle('dragging', true);
  $('panel')?.setPointerCapture?.(event.pointerId);
});

on('panel', 'pointermove', async (event) => {
  if (!state.drag) return;
  const dx = event.screenX - state.drag.lastX;
  const dy = event.screenY - state.drag.lastY;
  if (dx === 0 && dy === 0) return;
  state.drag.lastX = event.screenX;
  state.drag.lastY = event.screenY;
  if (Math.abs(dx) >= 1) {
    state.petAction = dx > 0 ? 'runningRight' : 'runningLeft';
    state.dragActionUntil = Date.now() + 260;
  }
  await window.codexUsagePet.moveBy({ x: dx, y: dy });
});

on('panel', 'pointerup', endDrag);
on('panel', 'pointercancel', endDrag);

function endDrag() {
  state.drag = null;
  $('panel')?.classList.toggle('dragging', false);
  state.dragActionUntil = Date.now() + 180;
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.('button, #resize-grip, .window-actions'));
}

document.addEventListener('pointerenter', () => setControlsVisible(true));
document.addEventListener('pointermove', () => setControlsVisible(true));
document.addEventListener('pointerleave', hideControlsSoon);
document.addEventListener('mouseenter', () => setControlsVisible(true));
document.addEventListener('mousemove', () => setControlsVisible(true));
document.addEventListener('mouseleave', hideControlsSoon);
window.addEventListener('blur', () => {
  if (!state.drag && !resizeStart) hideControlsSoon();
});
window.codexUsagePet.onHoverState?.((inside) => {
  if (inside) {
    setControlsVisible(true);
  } else {
    setControlsVisible(false);
  }
});

refresh();
updateUiScale();
window.addEventListener('resize', updateUiScale);
tickPet();
