const state = {
  frame: 0,
  pet: null,
  availablePets: [],
  characterIndex: 0,
  petAction: 'idle',
  activityAction: 'idle',
  dragActionUntil: 0,
  skin: 'classic',
  levelPercent: 0,
  xpTooltipText: '',
  refreshMs: 5000,
  refreshTimer: null,
  drag: null,
  controlsHideTimer: null
};

const $ = (id) => document.getElementById(id);
// Original design baseline. Larger default windows intentionally scale up from this size.
const BASE_WINDOWS = {
  classic: { width: 364, height: 250, scale: 0.65 },
  rift: { width: 700, height: 188, scale: 1 }
};
const WINDOW_TARGETS = {
  classic: { width: 437, height: 310, minWidth: 328, minHeight: 250 },
  rift: { width: 700, height: 188, minWidth: 420, minHeight: 160 }
};
const SKINS = ['classic', 'rift'];

function on(id, eventName, handler) {
  const element = $(id);
  if (element) element.addEventListener(eventName, handler);
}

function setButtonTooltip(button, label) {
  if (!button) return;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = label;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.round(Number(value || 0)));
}

function formatMillions(value) {
  const millions = Number(value || 0) / 1000000;
  const rounded = Math.round(millions * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}M`;
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

function formatCompactResetTime(limit) {
  if (!limit?.available || limit.resetInMs == null) return '--';
  const totalMinutes = Math.max(0, Math.ceil(Number(limit.resetInMs || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (Number(limit.windowMinutes) === 10080) return `${days}d${hours}h`;
  if (days > 0) return `${days}d${hours}h${minutes}min`;
  if (hours > 0) return `${hours}h${minutes}min`;
  return `${minutes}min`;
}

function setBar(id, percent) {
  $(id).style.width = `${clamp(percent || 0, 0, 100)}%`;
}

function setPanelPercent(name, percent) {
  $('panel')?.style.setProperty(name, String(clamp(percent || 0, 0, 100) / 100));
}

function setPanelAngle(name, percent, totalDeg) {
  $('panel')?.style.setProperty(name, `${clamp(percent || 0, 0, 100) / 100 * totalDeg}deg`);
}

function setXpFill(percent) {
  const xpLine = $('xp-line');
  if (!xpLine) return;
  const style = getComputedStyle(xpLine);
  const start = Number.parseFloat(style.getPropertyValue('--xp-start')) || 0;
  const end = Number.parseFloat(style.getPropertyValue('--xp-end')) || start;
  const ratio = clamp(percent || 0, 0, 100) / 100;
  xpLine.style.setProperty('--xp-fill-start', `${end - (end - start) * ratio}deg`);
}

function moveXpTooltip(event) {
  const tooltip = $('xp-tooltip');
  if (!tooltip) return;
  const offsetX = 12;
  const offsetY = -34;
  tooltip.style.left = `${event.clientX + offsetX}px`;
  tooltip.style.top = `${event.clientY + offsetY}px`;
}

function showXpTooltip(event) {
  if (state.skin !== 'rift' || !state.xpTooltipText) return;
  const tooltip = $('xp-tooltip');
  if (!tooltip) return;
  tooltip.textContent = state.xpTooltipText;
  moveXpTooltip(event);
  tooltip.classList.add('visible');
}

function hideXpTooltip() {
  $('xp-tooltip')?.classList.remove('visible');
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
  const base = BASE_WINDOWS[state.skin] || BASE_WINDOWS.classic;
  const widthRatio = window.innerWidth / base.width;
  const heightRatio = window.innerHeight / base.height;
  const scale = clamp(Math.min(widthRatio, heightRatio) * base.scale, 0.45, 1.1);
  document.querySelector('.shell')?.style.setProperty('--ui-scale', String(scale));
}

function initSkin() {
  const saved = window.localStorage?.getItem('codexUsagePet.skin');
  applySkin(SKINS.includes(saved) ? saved : 'classic');
}

function applySkin(skin) {
  state.skin = SKINS.includes(skin) ? skin : 'classic';
  document.body.classList.toggle('skin-rift-active', state.skin === 'rift');
  const panel = $('panel');
  panel?.classList.toggle('skin-rift', state.skin === 'rift');
  const button = $('skin-toggle');
  if (button) {
    button.classList.toggle('active', state.skin === 'rift');
    button.textContent = state.skin === 'rift' ? '◆' : '◇';
    setButtonTooltip(button, state.skin === 'rift' ? '切换到经典皮肤' : '切换到 LOL 皮肤');
  }
  window.localStorage?.setItem('codexUsagePet.skin', state.skin);
  updateUiScale();
  if (state.skin === 'rift') {
    window.requestAnimationFrame(() => setXpFill(state.levelPercent));
  } else {
    hideXpTooltip();
  }
  window.codexUsagePet.resizeTo?.(WINDOW_TARGETS[state.skin]);
}

function toggleSkin() {
  const currentIndex = SKINS.indexOf(state.skin);
  applySkin(SKINS[(currentIndex + 1) % SKINS.length]);
}

function getPetVariants(pet) {
  if (!pet) return [];
  const variants = Array.isArray(pet.variants) ? pet.variants : [];
  return [pet, ...variants.map((variant) => ({ ...pet, ...variant }))]
    .filter((variant) => variant?.atlasUrl);
}

function applyCharacter(index) {
  if (!state.availablePets.length) return;
  state.characterIndex = ((index % state.availablePets.length) + state.availablePets.length) % state.availablePets.length;
  state.pet = state.availablePets[state.characterIndex];
  window.localStorage?.setItem('codexUsagePet.characterIndex', String(state.characterIndex));

  const button = $('character-toggle');
  if (button) {
    const name = state.pet?.name || `character ${state.characterIndex + 1}`;
    setButtonTooltip(button, state.availablePets.length > 1
      ? `切换角色：${name}`
      : `当前角色：${name}`);
    button.classList.toggle('active', state.availablePets.length > 1 && state.characterIndex > 0);
  }

  const pet = $('pet');
  if (state.pet?.atlasUrl) {
    pet.style.backgroundImage = `url("${state.pet.atlasUrl}")`;
    pet.style.width = `${state.pet.cellWidth}px`;
    pet.style.height = `${state.pet.cellHeight}px`;
  }
}

function toggleCharacter() {
  if (state.availablePets.length <= 1) {
    applyCharacter(0);
    return;
  }
  applyCharacter(state.characterIndex + 1);
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
  $(`${prefix}-left`).textContent = `${Math.round(limit.leftPercent)}% ${formatCompactResetTime(limit)}`;
  setBar(`${prefix}-bar`, limit.leftPercent);
  setCursor(`${prefix}-cursor`, limit);
}

function renderUsage(data) {
  state.availablePets = getPetVariants(data.pet);
  const savedCharacterIndex = Number(window.localStorage?.getItem('codexUsagePet.characterIndex') || 0);
  const nextCharacterIndex = state.pet ? state.characterIndex : savedCharacterIndex;
  applyCharacter(nextCharacterIndex);
  state.refreshMs = data.refreshMs || state.refreshMs;

  $('level-number').textContent = data.level.value;
  $('rift-level').textContent = data.level.value;
  $('xp-text').textContent = `${formatNumber(data.level.totalXp)} / ${formatNumber(data.level.levelCap)} XP`;
  state.xpTooltipText = `个人总token ${formatMillions(data.level.totalXp)} / ${formatMillions(data.level.levelCap)}`;
  setButtonTooltip($('xp-line'), state.xpTooltipText);
  state.levelPercent = data.level.percent;
  setBar('xp-bar', data.level.percent);
  setPanelPercent('--xp-ratio', data.level.percent);
  setXpFill(state.levelPercent);

  renderLimit('primary', data.primary);
  renderLimit('secondary', data.secondary);

  $('plan').textContent = `plan: ${data.planType || 'unknown'} · ${formatNumber(data.tokens.lifetime)} tokens`;
  const updated = data.latestEventAt ? new Date(data.latestEventAt).toLocaleTimeString() : 'no token_count found';
  $('updated').textContent = `updated ${updated}`;
  renderActivity(data.activity);

  applyCharacter(state.characterIndex);
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
on('character-toggle', 'click', toggleCharacter);
on('skin-toggle', 'click', toggleSkin);
on('xp-line', 'pointerenter', showXpTooltip);
on('xp-line', 'pointermove', moveXpTooltip);
on('xp-line', 'pointerleave', hideXpTooltip);
on('close', 'click', () => window.codexUsagePet.close());
on('pin', 'click', async () => {
  const pinned = await window.codexUsagePet.toggleTop();
  const button = $('pin');
  button.classList.toggle('active', pinned);
  setButtonTooltip(button, pinned ? '取消置顶' : '置顶窗口');
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
window.addEventListener('keydown', (event) => {
  const key = String(event.key || '').toLowerCase();
  if (!((event.metaKey || event.ctrlKey) && key === 'r') && key !== 'f5') return;
  event.preventDefault();
  window.codexUsagePet.reload?.();
});
window.codexUsagePet.onHoverState?.((inside) => {
  if (inside) {
    setControlsVisible(true);
  } else {
    setControlsVisible(false);
  }
});

initSkin();
refresh();
updateUiScale();
window.addEventListener('resize', updateUiScale);
tickPet();
