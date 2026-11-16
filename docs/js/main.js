/* ==========================================================================
   GAMBIT · application
   ========================================================================== */

import { Chess } from 'chess.js';
import { ChessScene } from './scene.js?v=9';
import { ChessAudio } from './audio.js?v=9';
import { evaluate } from './engine.js?v=9';
import {
  FALLBACK_CONFIG,
  formatUsage,
  getApiKey,
  loadServerConfig,
  modelDisplayName,
  providerDisplayName,
  requestAIMove,
  setApiKey,
} from './ai.js?v=9';

const $ = (id) => document.getElementById(id);

const OFFLINE_PROVIDER = {
  id: 'offline',
  label: '内置离线引擎',
  short: '本地引擎',
  defaultModel: 'gambit-local',
  models: ['gambit-local'],
  supportsThinking: false,
  hasServerKey: true,
  note: '极小化极大搜索 · 无需网络',
};

const MATERIAL_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_GLYPH = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const PIECE_NAME = { p: '兵', n: '马', b: '象', r: '车', q: '后', k: '王' };
const PREFS_KEY = 'gambit.prefs';
const THINKING_LINES = [
  '正在读取 FEN 局面',
  '检查战术与王安全',
  '比较候选着法',
  '收紧走法提示词',
  '决定最佳落子',
];
const OFFLINE_LINES = ['展开候选着法', '计算子力与王安全', '检查吃子序列', '搜索最佳落子'];

const el = {
  app: $('app'),
  canvas: $('scene'),
  livePill: $('livePill'),
  liveText: $('liveText'),
  soundBtn: $('soundBtn'),
  settingsBtn: $('settingsBtn'),
  gameLayout: $('gameLayout'),
  rightPanel: $('rightPanel'),
  feedBtn: $('feedBtn'),
  humanRow: $('humanRow'),
  humanAvatar: $('humanAvatar'),
  humanColorLabel: $('humanColorLabel'),
  aiRow: $('aiRow'),
  aiAvatar: $('aiAvatar'),
  aiName: $('aiName'),
  aiProviderLabel: $('aiProviderLabel'),
  aiColorLabel: $('aiColorLabel'),
  newGameBtn: $('newGameBtn'),
  undoBtn: $('undoBtn'),
  flipBtn: $('flipBtn'),
  resignBtn: $('resignBtn'),
  materialAdvantage: $('materialAdvantage'),
  materialFill: $('materialFill'),
  humanCaptures: $('humanCaptures'),
  aiCaptures: $('aiCaptures'),
  turnPill: $('turnPill'),
  turnText: $('turnText'),
  thinkingCard: $('thinkingCard'),
  thinkingTitle: $('thinkingTitle'),
  thinkingSub: $('thinkingSub'),
  boardHint: $('boardHint'),
  moveCount: $('moveCount'),
  positionLabel: $('positionLabel'),
  evalFill: $('evalFill'),
  moveScroll: $('moveScroll'),
  moveList: $('moveList'),
  commentProvider: $('commentProvider'),
  commentStatus: $('commentStatus'),
  aiComment: $('aiComment'),
  usageLabel: $('usageLabel'),
  setupOverlay: $('setupOverlay'),
  setupProvider: $('setupProvider'),
  setupModel: $('setupModel'),
  modelInfoName: $('modelInfoName'),
  modelInfoSub: $('modelInfoSub'),
  modelStatus: $('modelStatus'),
  thinkingRow: $('thinkingRow'),
  setupThinking: $('setupThinking'),
  startBtn: $('startBtn'),
  openSettingsFromSetup: $('openSettingsFromSetup'),
  offlineBtn: $('offlineBtn'),
  loadingScreen: $('loadingScreen'),
  loaderFill: $('loaderFill'),
  loaderText: $('loaderText'),
  settingsModal: $('settingsModal'),
  settingsProvider: $('settingsProvider'),
  settingsModel: $('settingsModel'),
  modelDatalist: $('modelDatalist'),
  settingsApiKey: $('settingsApiKey'),
  keyStatus: $('keyStatus'),
  keyHint: $('keyHint'),
  settingsBaseUrl: $('settingsBaseUrl'),
  settingsThinkingRow: $('settingsThinkingRow'),
  settingsThinking: $('settingsThinking'),
  clearKeyBtn: $('clearKeyBtn'),
  saveSettingsBtn: $('saveSettingsBtn'),
  promotionModal: $('promotionModal'),
  gameOverModal: $('gameOverModal'),
  gameOverCrown: $('gameOverCrown'),
  gameOverTitle: $('gameOverTitle'),
  gameOverSubtitle: $('gameOverSubtitle'),
  gameOverMoves: $('gameOverMoves'),
  gameOverOpponent: $('gameOverOpponent'),
  gameOverResult: $('gameOverResult'),
  backToSetupBtn: $('backToSetupBtn'),
  rematchBtn: $('rematchBtn'),
  toastStack: $('toastStack'),
};

const state = {
  ready: false,
  scene: null,
  audio: null,
  config: FALLBACK_CONFIG,
  session: 0,
  started: false,
  busy: false,
  gameOver: false,
  game: new Chess(),
  history: [],
  playerColor: 'w',
  aiColor: 'b',
  provider: 'deepseek',
  model: 'deepseek-flash',
  thinking: false,
  selected: null,
  legalMoves: [],
  lastMove: null,
  pendingPromotion: null,
  thinkingTimer: null,
  thinkingIndex: 0,
  loadError: '',
};

let prefs = loadPrefs();

/* --------------------------------------------------------------------------
   Small utilities
   -------------------------------------------------------------------------- */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function otherColor(color) {
  return color === 'w' ? 'b' : 'w';
}

function colorLabel(color) {
  return color === 'w' ? '白方' : '黑方';
}

function loadPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePrefs() {
  prefs = {
    provider: state.provider,
    model: state.model,
    thinking: state.thinking,
    side: state.playerColor,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable in privacy modes.
  }
}

function readStorage(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function baseUrlKey(providerId) {
  return `gambit.baseUrl.${providerId}`;
}

function getBaseUrl(providerId) {
  return readStorage(baseUrlKey(providerId), '');
}

function toast(message, type = 'info', duration = 4200) {
  if (!message) return;
  while (el.toastStack.children.length >= 4) {
    el.toastStack.firstElementChild?.remove();
  }
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  el.toastStack.appendChild(node);
  const remove = () => {
    if (!node.isConnected) return;
    node.classList.add('out');
    setTimeout(() => node.remove(), 360);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

function setLoading(percent, text) {
  const value = clamp(Math.round(percent), 0, 100);
  if (el.loaderFill) el.loaderFill.style.width = `${value}%`;
  if (el.loaderText && text) el.loaderText.textContent = text;
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  if (id === 'promotionModal' && state.pendingPromotion) {
    state.pendingPromotion = null;
    state.selected = null;
    state.legalMoves = [];
    state.scene?.clearSelection();
    updateTurnUI();
  }
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function closeTransientModals() {
  closeModal('settingsModal');
  closeModal('promotionModal');
}

/* --------------------------------------------------------------------------
   Provider / setup helpers
   -------------------------------------------------------------------------- */

function providerList() {
  const list = Object.values(state.config?.providers || {});
  if (!list.some((provider) => provider.id === 'offline')) list.push(OFFLINE_PROVIDER);
  return list;
}

function getProvider(providerId = state.provider) {
  if (providerId === 'offline') return OFFLINE_PROVIDER;
  return state.config?.providers?.[providerId] || null;
}

function providerHasCredentials(providerId) {
  if (providerId === 'offline') return true;
  const provider = getProvider(providerId);
  if (!provider) return false;
  return Boolean(provider.hasServerKey || getApiKey(providerId));
}

function currentProviderLabel(providerId = state.provider) {
  if (providerId === 'offline') return '本地引擎';
  return providerDisplayName(providerId, state.config);
}

function fillProviderSelect(select, selectedId) {
  if (!select) return;
  select.innerHTML = '';
  for (const provider of providerList()) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.id === 'offline' ? provider.label : provider.label;
    if (provider.recommended) option.textContent += ' · 推荐';
    select.appendChild(option);
  }
  if (providerList().some((provider) => provider.id === selectedId)) {
    select.value = selectedId;
  }
}

function setupModelOptions(provider, selectedModel) {
  if (!el.setupModel) return;
  const models = Array.isArray(provider?.models) && provider.models.length ? [...provider.models] : [provider?.defaultModel || 'gambit-local'];
  if (selectedModel && !models.includes(selectedModel)) models.unshift(selectedModel);
  el.setupModel.innerHTML = '';
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = modelDisplayName(model);
    el.setupModel.appendChild(option);
  }
  const value = selectedModel && models.includes(selectedModel) ? selectedModel : models[0];
  el.setupModel.value = value;
  state.model = value;
}

function updateSetupThinking(provider) {
  const supports = Boolean(provider?.supportsThinking);
  if (el.thinkingRow) el.thinkingRow.classList.toggle('disabled', !supports);
  if (el.setupThinking) {
    el.setupThinking.disabled = !supports;
    if (!supports) el.setupThinking.checked = false;
    else el.setupThinking.checked = state.thinking;
  }
  if (!supports) state.thinking = false;
}

function updateSetupInfo() {
  const provider = getProvider(state.provider);
  if (!provider) return;
  if (el.modelInfoName) el.modelInfoName.textContent = modelDisplayName(state.model);
  if (el.modelInfoSub) {
    el.modelInfoSub.textContent =
      provider.id === 'offline'
        ? '极小化极大 + 静态评估 · 无需网络'
        : provider.note || `${provider.label} · 每步一次请求`;
  }
  if (el.modelStatus) {
    el.modelStatus.classList.remove('warn', 'offline');
    if (provider.id === 'offline') {
      el.modelStatus.textContent = '离线可用';
      el.modelStatus.classList.add('offline');
    } else if (provider.hasServerKey) {
      el.modelStatus.textContent = '服务端已接入';
    } else if (getApiKey(provider.id)) {
      el.modelStatus.textContent = 'Key 已保存';
    } else {
      el.modelStatus.textContent = '需配置 Key';
      el.modelStatus.classList.add('warn');
    }
  }
  updateSetupThinking(provider);
}

function initProviderSelectors() {
  const providerIds = providerList().map((provider) => provider.id);
  if (prefs.provider && providerIds.includes(prefs.provider)) {
    state.provider = prefs.provider;
  } else if (!providerIds.includes(state.provider)) {
    state.provider = state.config.defaultProvider || 'deepseek';
  }
  const provider = getProvider(state.provider) || getProvider('deepseek') || providerList()[0];
  state.provider = provider?.id || 'offline';
  const candidateModel = prefs.model;
  state.model =
    candidateModel && (provider?.models?.includes(candidateModel) || candidateModel.startsWith('custom:'))
      ? candidateModel
      : provider?.defaultModel || 'gambit-local';
  state.playerColor = prefs.side === 'b' ? 'b' : 'w';
  state.aiColor = otherColor(state.playerColor);

  fillProviderSelect(el.setupProvider, state.provider);
  fillProviderSelect(el.settingsProvider, state.provider);
  setupModelOptions(provider, state.model);
  if (el.setupProvider) el.setupProvider.value = state.provider;
  if (el.setupThinking) el.setupThinking.checked = Boolean(provider?.supportsThinking && prefs.thinking === true);
  state.thinking = Boolean(provider?.supportsThinking && prefs.thinking === true);
  setSideButtons(state.playerColor);
  updateSetupInfo();
}

function setSideButtons(side) {
  for (const button of document.querySelectorAll('.side-option')) {
    button.classList.toggle('selected', button.dataset.side === side);
    button.setAttribute('aria-pressed', button.dataset.side === side ? 'true' : 'false');
  }
  state.playerColor = side === 'b' ? 'b' : 'w';
  state.aiColor = otherColor(state.playerColor);
}

/* --------------------------------------------------------------------------
   Settings form
   -------------------------------------------------------------------------- */

function refreshKeyStatus(providerId) {
  const provider = getProvider(providerId);
  const localKey = getApiKey(providerId);
  const offline = providerId === 'offline';
  if (el.settingsApiKey) el.settingsApiKey.disabled = offline;
  if (el.settingsBaseUrl) el.settingsBaseUrl.disabled = offline;
  if (el.clearKeyBtn) el.clearKeyBtn.disabled = offline;
  if (el.settingsThinkingRow) el.settingsThinkingRow.style.display = provider?.supportsThinking ? '' : 'none';
  if (el.settingsThinking) {
    el.settingsThinking.disabled = !provider?.supportsThinking;
    el.settingsThinking.checked = Boolean(provider?.supportsThinking && state.thinking);
  }
  if (el.keyStatus) {
    el.keyStatus.textContent = offline
      ? '离线'
      : localKey
        ? '本机已保存'
        : provider?.hasServerKey
          ? '服务端已配置'
          : '未配置';
    el.keyStatus.style.color = offline || localKey || provider?.hasServerKey ? 'var(--jade)' : 'var(--gold)';
  }
  if (el.keyHint) {
    if (offline) {
      el.keyHint.textContent = '本地引擎不需要 API Key，也不会发出任何网络请求。';
    } else if (provider?.hasServerKey) {
      el.keyHint.textContent = '该厂商已在服务端 .env 配置 Key；此处留空即可直接使用。';
    } else {
      el.keyHint.textContent = 'Key 仅保存在本机浏览器，只会发送给本地 Node 代理。';
    }
  }
}

function loadSettingsProvider(providerId, preferredModel = '') {
  const provider = getProvider(providerId) || getProvider('deepseek');
  const actualId = provider?.id || 'offline';
  if (el.settingsProvider) el.settingsProvider.value = actualId;
  if (el.settingsModel) {
    const models = Array.isArray(provider?.models) ? provider.models : [];
    el.settingsModel.value =
      preferredModel && (models.includes(preferredModel) || providerId === state.provider)
        ? preferredModel
        : provider?.defaultModel || 'gambit-local';
    el.modelDatalist.innerHTML = '';
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.label = modelDisplayName(model);
      el.modelDatalist.appendChild(option);
    }
  }
  if (el.settingsApiKey) el.settingsApiKey.value = getApiKey(actualId);
  if (el.settingsBaseUrl) el.settingsBaseUrl.value = getBaseUrl(actualId);
  refreshKeyStatus(actualId);
}

function openSettingsModal() {
  setMobileFeed(false);
  const providerId = getProvider(state.provider) ? state.provider : 'deepseek';
  fillProviderSelect(el.settingsProvider, providerId);
  loadSettingsProvider(providerId, state.model);
  openModal('settingsModal');
}

function setMobileFeed(open) {
  if (!el.rightPanel || !el.feedBtn) return;
  const next = Boolean(open) && window.matchMedia('(max-width: 980px)').matches;
  el.rightPanel.classList.toggle('mobile-open', next);
  el.feedBtn.classList.toggle('active', next);
  el.feedBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
}

function saveSettings() {
  const providerId = el.settingsProvider?.value || state.provider;
  const provider = getProvider(providerId);
  if (!provider) {
    toast('未知的模型厂商。', 'error');
    return;
  }
  const model = el.settingsModel?.value.trim() || provider.defaultModel;
  const key = el.settingsApiKey?.value.trim() || '';
  const baseUrl = el.settingsBaseUrl?.value.trim() || '';
  setApiKey(providerId, key);
  writeStorage(baseUrlKey(providerId), baseUrl);
  state.provider = providerId;
  state.model = model;
  state.thinking = Boolean(provider.supportsThinking && el.settingsThinking?.checked);
  savePrefs();

  if (el.setupProvider) el.setupProvider.value = providerId;
  setupModelOptions(provider, model);
  if (el.setupThinking) {
    el.setupThinking.checked = state.thinking;
    el.setupThinking.disabled = !provider.supportsThinking;
  }
  updateSetupInfo();
  updateMatchLabels();
  updateTurnUI();
  closeModal('settingsModal');
  toast('设置已保存。', 'success');
}

/* --------------------------------------------------------------------------
   Match labels & game UI
   -------------------------------------------------------------------------- */

function updateMatchLabels() {
  const provider = getProvider(state.provider);
  const aiModel = provider?.id === 'offline' ? 'GAMBIT LOCAL' : provider?.short || currentProviderLabel();
  const aiName = provider?.id === 'offline' ? 'Gambit Local Engine' : modelDisplayName(state.model);
  if (el.aiName) el.aiName.textContent = aiName;
  if (el.aiProviderLabel) el.aiProviderLabel.textContent = currentProviderLabel();
  if (el.commentProvider) el.commentProvider.textContent = aiModel.toUpperCase().slice(0, 20);
  if (el.humanColorLabel) el.humanColorLabel.textContent = colorLabel(state.playerColor);
  if (el.aiColorLabel) el.aiColorLabel.textContent = colorLabel(state.aiColor);
  if (el.humanAvatar) el.humanAvatar.textContent = state.playerColor === 'w' ? '♔' : '♚';
  if (el.aiAvatar) el.aiAvatar.innerHTML = '<span>AI</span>';
  if (el.gameOverOpponent) el.gameOverOpponent.textContent = currentProviderLabel();
}

function findKingSquare(color) {
  for (const row of state.game.board()) {
    for (const piece of row) {
      if (piece && piece.type === 'k' && piece.color === color) return piece.square;
    }
  }
  return null;
}

function materialTotals() {
  let white = 0;
  let black = 0;
  for (const row of state.game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      if (piece.color === 'w') white += MATERIAL_VALUE[piece.type] || 0;
      else black += MATERIAL_VALUE[piece.type] || 0;
    }
  }
  return { white, black };
}

function renderMaterial() {
  const { white, black } = materialTotals();
  const diff = white - black;
  if (el.materialAdvantage) {
    if (diff === 0) el.materialAdvantage.textContent = '均势';
    else if (diff > 0) el.materialAdvantage.textContent = `白方 +${diff}`;
    else el.materialAdvantage.textContent = `黑方 +${Math.abs(diff)}`;
  }
  if (el.materialFill) {
    const percent = clamp(50 + diff * 3.4, 8, 92);
    el.materialFill.style.width = `${percent}%`;
  }
  const whiteCaptures = [];
  const blackCaptures = [];
  for (const move of state.history) {
    if (!move.captured) continue;
    const glyph = PIECE_GLYPH[otherColor(move.color)]?.[move.captured];
    if (!glyph) continue;
    if (move.color === 'w') whiteCaptures.push(glyph);
    else blackCaptures.push(glyph);
  }
  const humanCaptures = state.playerColor === 'w' ? whiteCaptures : blackCaptures;
  const aiCaptures = state.aiColor === 'w' ? whiteCaptures : blackCaptures;
  renderCaptured(el.humanCaptures, humanCaptures);
  renderCaptured(el.aiCaptures, aiCaptures);
}

function renderCaptured(container, glyphs) {
  if (!container) return;
  container.innerHTML = '';
  if (!glyphs.length) {
    container.textContent = '—';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const glyph of glyphs) {
    const span = document.createElement('span');
    span.textContent = glyph;
    span.className = glyph === '♙' || glyph === '♘' || glyph === '♗' || glyph === '♖' || glyph === '♕' || glyph === '♔' ? 'cap-white' : 'cap-black';
    fragment.appendChild(span);
  }
  container.appendChild(fragment);
}

function renderMoveList() {
  if (!el.moveList) return;
  el.moveList.innerHTML = '';
  if (!state.history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('span');
    icon.textContent = '♙';
    const text = document.createElement('p');
    text.textContent = '棋谱将在这里展开';
    empty.append(icon, text);
    el.moveList.appendChild(empty);
  } else {
    for (let i = 0; i < state.history.length; i += 2) {
      const whiteMove = state.history[i];
      const blackMove = state.history[i + 1];
      const row = document.createElement('div');
      row.className = 'move-pair';
      const number = document.createElement('span');
      number.className = 'move-number';
      number.textContent = `${Math.floor(i / 2) + 1}.`;
      row.appendChild(number);
      row.appendChild(makeMoveSpan(whiteMove, i === state.history.length - 1));
      row.appendChild(makeMoveSpan(blackMove, i + 1 === state.history.length - 1));
      el.moveList.appendChild(row);
    }
  }
  if (el.moveCount) el.moveCount.textContent = `${Math.ceil(state.history.length / 2)} 手`;
  requestAnimationFrame(() => {
    if (el.moveScroll) el.moveScroll.scrollTop = el.moveScroll.scrollHeight;
  });
}

function makeMoveSpan(move, latest) {
  const span = document.createElement('span');
  span.className = 'move-san';
  if (latest && move) span.classList.add('latest');
  if (move?.captured) span.classList.add('capture');
  span.textContent = move?.san || '·';
  return span;
}

function renderEvaluation() {
  let score = 0;
  try {
    score = evaluate(state.game);
  } catch {
    score = 0;
  }
  const normalized = 50 + 48 * Math.tanh(score / 320);
  if (el.evalFill) el.evalFill.style.width = `${clamp(normalized, 3, 97)}%`;
  if (el.positionLabel) {
    if (state.gameOver) {
      el.positionLabel.textContent = '终局';
    } else if (state.game.inCheck()) {
      el.positionLabel.textContent = '将军';
    } else if (state.game.history().length < 18) {
      el.positionLabel.textContent = '开局';
    } else if (materialTotals().white + materialTotals().black < 30) {
      el.positionLabel.textContent = '残局';
    } else {
      el.positionLabel.textContent = '中局';
    }
  }
}

function updateTurnUI() {
  if (!state.started) {
    if (el.liveText) el.liveText.textContent = state.ready ? '等待开局' : '正在装载棋盘';
    if (el.turnText) el.turnText.textContent = state.ready ? '等待开局' : '正在装载棋盘';
    el.humanRow?.classList.remove('active');
    el.aiRow?.classList.remove('active');
    return;
  }
  if (state.gameOver) {
    el.humanRow?.classList.remove('active');
    el.aiRow?.classList.remove('active');
    el.turnPill?.classList.remove('your-turn', 'ai-turn');
    if (el.turnText) el.turnText.textContent = '对局结束';
    if (el.livePill) el.livePill.className = 'live-pill';
    if (el.liveText) el.liveText.textContent = '对局结束';
    return;
  }
  const playerTurn = state.game.turn() === state.playerColor;
  const aiTurn = state.game.turn() === state.aiColor;
  el.humanRow?.classList.toggle('active', playerTurn && !state.busy);
  el.aiRow?.classList.toggle('active', aiTurn || state.busy);
  if (el.turnPill) {
    el.turnPill.classList.toggle('your-turn', playerTurn && !state.busy);
    el.turnPill.classList.toggle('ai-turn', aiTurn || state.busy);
  }
  if (state.busy) {
    if (el.turnText) el.turnText.textContent = state.provider === 'offline' ? '本地引擎正在计算' : 'AI 正在思考';
    if (el.livePill) el.livePill.className = 'live-pill thinking';
    if (el.liveText) el.liveText.textContent = state.provider === 'offline' ? '本地引擎 · 搜索中' : `${currentProviderLabel()} · 思考中`;
  } else if (playerTurn) {
    if (el.turnText) el.turnText.textContent = `轮到你 · ${colorLabel(state.playerColor)}`;
    if (el.livePill) el.livePill.className = 'live-pill live';
    if (el.liveText) el.liveText.textContent = state.provider === 'offline' ? '本地引擎已就绪' : `${currentProviderLabel()} 已连接`;
  } else {
    if (el.turnText) el.turnText.textContent = `${currentProviderLabel()} 回合`;
    if (el.livePill) el.livePill.className = 'live-pill';
    if (el.liveText) el.liveText.textContent = '等待对手落子';
  }
  if (el.boardHint) {
    el.boardHint.textContent = state.busy ? '拖拽旋转 · 滚轮缩放 · AI 思考中' : '拖拽旋转 · 滚轮缩放 · 点击棋子';
  }
}

function resetMatchUI() {
  state.history = [];
  state.selected = null;
  state.legalMoves = [];
  state.lastMove = null;
  state.pendingPromotion = null;
  state.gameOver = false;
  renderMoveList();
  renderMaterial();
  renderEvaluation();
  if (el.usageLabel) el.usageLabel.textContent = '';
  if (el.commentStatus) {
    el.commentStatus.textContent = '待命';
    el.commentStatus.className = 'comment-status';
  }
  if (el.aiComment) el.aiComment.textContent = '对局开始，等待第一步。';
  if (el.moveCount) el.moveCount.textContent = '0 手';
  updateTurnUI();
}

/* --------------------------------------------------------------------------
   Thinking / commentary
   -------------------------------------------------------------------------- */

function startThinking() {
  stopThinking();
  state.busy = true;
  state.thinkingIndex = 0;
  const offline = state.provider === 'offline';
  const lines = offline ? OFFLINE_LINES : THINKING_LINES;
  if (el.thinkingCard) el.thinkingCard.classList.add('visible');
  if (el.thinkingTitle) el.thinkingTitle.textContent = offline ? '本地引擎正在搜索' : 'AI 正在思考';
  if (el.thinkingSub) el.thinkingSub.textContent = lines[0];
  if (el.commentStatus) {
    el.commentStatus.textContent = '思考中';
    el.commentStatus.className = 'comment-status live';
  }
  state.thinkingTimer = setInterval(() => {
    state.thinkingIndex = (state.thinkingIndex + 1) % lines.length;
    if (el.thinkingSub) el.thinkingSub.textContent = lines[state.thinkingIndex];
  }, offline ? 1100 : 1900);
  updateTurnUI();
}

function stopThinking() {
  if (state.thinkingTimer) {
    clearInterval(state.thinkingTimer);
    state.thinkingTimer = null;
  }
  el.thinkingCard?.classList.remove('visible');
}

function setAIMessage({ comment, status, usage, providerLabel, fallback = false }) {
  if (el.aiComment) el.aiComment.textContent = comment || '继续专注于棋盘。';
  if (el.commentStatus) {
    el.commentStatus.textContent = status || (fallback ? '本地接管' : '已落子');
    el.commentStatus.className = `comment-status ${fallback ? 'fallback' : 'live'}`;
  }
  if (el.commentProvider) {
    el.commentProvider.textContent = (providerLabel || currentProviderLabel()).toUpperCase().replace(/\s+/g, ' ').slice(0, 24);
  }
  if (el.usageLabel) el.usageLabel.textContent = usage || '';
}

function handleImpact(kind, data) {
  if (!state.audio) return;
  if (kind === 'capture') state.audio.capture(data);
  else if (kind === 'promotion') state.audio.promote(data);
  else state.audio.place(data);
}

function handleHover(square) {
  if (!state.scene || !state.started || state.gameOver) return;
  const piece = square ? state.game.get(square) : null;
  const isOwn = piece && piece.color === state.game.turn() && state.game.turn() === state.playerColor;
  const isTarget = square && state.legalMoves.some((move) => move.to === square);
  state.scene.setCursor(isOwn || isTarget ? 'pointer' : 'default');
}

/* --------------------------------------------------------------------------
   Clicking and moving
   -------------------------------------------------------------------------- */

function handleSquareClick(square) {
  if (!state.started || state.busy || state.gameOver || state.pendingPromotion) return;
  if (state.game.turn() !== state.playerColor) {
    return;
  }
  const piece = state.game.get(square);

  if (state.selected) {
    if (square === state.selected) {
      clearSelection();
      return;
    }
    const legal = state.legalMoves.find((move) => move.to === square);
    if (legal) {
      if (legal.promotion) {
        state.pendingPromotion = {
          from: state.selected,
          to: square,
          color: state.playerColor,
        };
        openModal('promotionModal');
        return;
      }
      const from = state.selected;
      clearSelection();
      playHumanMove(from, square);
      return;
    }
    if (piece && piece.color === state.playerColor) {
      selectSquare(square);
      return;
    }
    if (piece && piece.color !== state.playerColor) state.audio?.error();
    clearSelection();
    return;
  }

  if (piece && piece.color === state.playerColor) {
    selectSquare(square);
  } else if (piece) {
    state.audio?.error();
  }
}

function selectSquare(square) {
  const piece = state.game.get(square);
  if (!piece || piece.color !== state.game.turn() || state.game.turn() !== state.playerColor) return;
  const moves = state.game.moves({ square, verbose: true });
  state.selected = square;
  state.legalMoves = moves;
  const targets = moves.map((move) => ({
    square: move.to,
    capture: Boolean(move.captured) || move.flags.includes('e'),
  }));
  state.scene?.setSelection(square, targets);
  if (moves.length) state.audio?.select();
  else state.audio?.error();
}

function clearSelection() {
  state.selected = null;
  state.legalMoves = [];
  state.scene?.clearSelection();
}

function promotionChoice(piece) {
  const pending = state.pendingPromotion;
  if (!pending) return;
  state.pendingPromotion = null;
  state.selected = null;
  state.legalMoves = [];
  state.scene?.clearSelection();
  const modal = el.promotionModal;
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  playHumanMove(pending.from, pending.to, piece);
}

function rookMoveFor(move) {
  if (!move?.flags) return null;
  const rank = move.color === 'w' ? '1' : '8';
  if (move.flags.includes('k')) return { from: `h${rank}`, to: `f${rank}` };
  if (move.flags.includes('q')) return { from: `a${rank}`, to: `d${rank}` };
  return null;
}

function captureInfoFor(move) {
  if (!move?.captured) return null;
  const square = move.flags.includes('e') ? `${move.to[0]}${move.from[1]}` : move.to;
  return {
    square,
    type: move.captured,
    color: otherColor(move.color),
  };
}

async function commitMove({ from, to, promotion = null, source = 'player', aiResult = null }) {
  const game = state.game;
  let move;
  try {
    move = game.move({ from, to, promotion: promotion || undefined });
  } catch (error) {
    throw new Error(error?.message || '这个着法无法执行。');
  }
  if (!move) throw new Error('这个着法不合法。');

  state.history = game.history({ verbose: true });
  state.lastMove = move;
  state.selected = null;
  state.legalMoves = [];
  state.scene?.clearSelection();
  state.scene?.setLastMove(move.from, move.to);
  const checked = game.inCheck();
  state.scene?.setCheck(checked ? findKingSquare(game.turn()) : null);
  renderMoveList();
  renderMaterial();
  renderEvaluation();
  updateTurnUI();

  if (source === 'player' && !game.isGameOver()) {
    if (el.commentStatus) {
      el.commentStatus.textContent = '待命';
      el.commentStatus.className = 'comment-status';
    }
    if (el.aiComment) el.aiComment.textContent = '正在读取你刚刚走出的局面…';
    if (el.usageLabel) el.usageLabel.textContent = '';
  }

  await state.scene?.animateMove({
    from: move.from,
    to: move.to,
    promotion: move.promotion || null,
    captured: captureInfoFor(move),
    rook: rookMoveFor(move),
  });

  if (game.inCheck() && !game.isGameOver()) state.audio?.check();

  if (source === 'ai' && aiResult) {
    const fallback = Boolean(aiResult.fallback);
    const comment = aiResult.comment || `选择 ${move.san}。`;
    const usage = formatUsage(aiResult);
    setAIMessage({
      comment,
      usage,
      providerLabel: fallback ? '本地引擎' : aiResult.providerLabel || currentProviderLabel(),
      fallback,
      status: fallback ? '本地接管' : '已落子',
    });
    if (el.usageLabel && aiResult.thinking) el.usageLabel.textContent += ' · 深度思考';
  }

  const over = maybeShowGameOver(700, state.session);
  if (!over) updateTurnUI();
  return { move, over };
}

async function playHumanMove(from, to, promotion = null) {
  if (!state.started || state.busy || state.gameOver) return;
  if (state.game.turn() !== state.playerColor) return;
  state.busy = true;
  state.pendingPromotion = null;
  state.selected = null;
  state.legalMoves = [];
  state.scene?.clearSelection();
  updateTurnUI();

  let shouldTriggerAI = false;
  try {
    await commitMove({ from, to, promotion, source: 'player' });
    shouldTriggerAI = !state.gameOver && state.game.turn() === state.aiColor;
  } catch (error) {
    toast(`无法走这步棋：${error.message}`, 'error');
    state.audio?.error();
  } finally {
    state.busy = false;
    updateTurnUI();
  }

  if (shouldTriggerAI && state.started && !state.gameOver) {
    aiTurn();
  }
}

/* --------------------------------------------------------------------------
   AI turn
   -------------------------------------------------------------------------- */

async function aiTurn() {
  if (!state.started || state.gameOver || state.busy) return;
  if (state.game.turn() !== state.aiColor) return;
  const session = state.session;
  state.selected = null;
  state.legalMoves = [];
  state.scene?.clearSelection();
  startThinking();

  try {
    await sleep(state.provider === 'offline' ? 260 : 420 + Math.random() * 280);
    if (session !== state.session || !state.started || state.gameOver) return;

    const lastMove = state.history.length ? state.history[state.history.length - 1].san : '';
    const result = await requestAIMove({
      fen: state.game.fen(),
      lastMove,
      provider: state.provider,
      model: state.model,
      thinking: state.thinking,
      baseUrl: getBaseUrl(state.provider),
      localOptions: { timeLimit: 1250, maxDepth: 3 },
    });

    if (session !== state.session || !state.started || state.gameOver) return;

    if (result.fallback) {
      const details = result.fallbackReason ? `：${result.fallbackReason}` : '';
      toast(`模型服务暂不可用，本地引擎已接管${details}`, 'info', 6200);
    }

    const legal = state.game.moves({ verbose: true });
    const match =
      legal.find((move) => move.san === result.san) ||
      legal.find(
        (move) =>
          move.from === result.from &&
          move.to === result.to &&
          (!result.promotion || move.promotion === result.promotion),
      );
    if (!match) throw new Error('AI 返回的着法无法应用。');

    await commitMove({
      from: match.from,
      to: match.to,
      promotion: match.promotion || null,
      source: 'ai',
      aiResult: result,
    });
  } catch (error) {
    if (session !== state.session) return;
    toast(`AI 走棋失败：${error.message}`, 'error', 6500);
    try {
      const legal = state.game.moves({ verbose: true });
      if (!legal.length) return;
      const emergency = legal[Math.floor(Math.random() * legal.length)];
      await commitMove({
        from: emergency.from,
        to: emergency.to,
        promotion: emergency.promotion || null,
        source: 'ai',
        aiResult: {
          comment: '本地应急着法。',
          provider: 'offline',
          providerLabel: '本地引擎',
          fallback: true,
          fallbackReason: error.message,
          usage: null,
          elapsedMs: 0,
        },
      });
    } catch (fallbackError) {
      toast(`本地引擎也无法继续：${fallbackError.message}`, 'error', 6500);
    }
  } finally {
    if (session === state.session) {
      state.busy = false;
      stopThinking();
      updateTurnUI();
    }
  }
}

/* --------------------------------------------------------------------------
   Game completion
   -------------------------------------------------------------------------- */

function buildGameOverInfo() {
  const game = state.game;
  const opponent = currentProviderLabel();
  if (game.isCheckmate()) {
    const winner = otherColor(game.turn());
    const playerWon = winner === state.playerColor;
    return {
      title: playerWon ? '胜利。' : '败北。',
      subtitle: playerWon ? `你将死了 ${opponent}。` : `${opponent} 将死了你。`,
      result: playerWon ? '你胜' : 'AI 胜',
      crown: playerWon ? '♛' : '♟',
      sound: playerWon ? 'win' : 'lose',
    };
  }
  if (game.isStalemate()) {
    return { title: '逼和。', subtitle: '无子可动，棋盘归于平衡。', result: '和棋', crown: '½', sound: 'draw' };
  }
  if (game.isInsufficientMaterial()) {
    return { title: '和棋。', subtitle: '子力不足，无法完成将杀。', result: '和棋', crown: '½', sound: 'draw' };
  }
  if (game.isThreefoldRepetition()) {
    return { title: '和棋。', subtitle: '同一局面出现三次，双方握手言和。', result: '和棋', crown: '½', sound: 'draw' };
  }
  if (game.isDrawByFiftyMoves()) {
    return { title: '和棋。', subtitle: '五十回合内没有吃子或兵的移动。', result: '和棋', crown: '½', sound: 'draw' };
  }
  if (game.isDraw()) {
    return { title: '和棋。', subtitle: '棋盘已经无法产生决定性的结果。', result: '和棋', crown: '½', sound: 'draw' };
  }
  return null;
}

function showGameOver(info) {
  if (!info || !state.started) return;
  if (el.gameOverModal?.classList.contains('open')) return;
  setMobileFeed(false);
  state.gameOver = true;
  state.busy = false;
  state.selected = null;
  state.legalMoves = [];
  state.scene?.clearSelection();
  stopThinking();
  updateTurnUI();
  updateMatchLabels();
  if (el.gameOverCrown) el.gameOverCrown.textContent = info.crown || '♔';
  if (el.gameOverTitle) el.gameOverTitle.textContent = info.title || '对局结束';
  if (el.gameOverSubtitle) el.gameOverSubtitle.textContent = info.subtitle || '';
  if (el.gameOverMoves) el.gameOverMoves.textContent = String(Math.ceil(state.history.length / 2));
  if (el.gameOverOpponent) el.gameOverOpponent.textContent = currentProviderLabel();
  if (el.gameOverResult) el.gameOverResult.textContent = info.result || '—';
  openModal('gameOverModal');
  if (info.sound === 'win') state.audio?.win();
  else if (info.sound === 'lose') state.audio?.lose();
  else if (info.sound === 'draw') state.audio?.draw();
}

function maybeShowGameOver(delay, session) {
  if (!state.game.isGameOver()) return false;
  const info = buildGameOverInfo();
  if (!info) return false;
  state.gameOver = true;
  updateTurnUI();
  setTimeout(() => {
    if (session !== state.session || !state.started || !state.gameOver) return;
    showGameOver(info);
  }, delay);
  return true;
}

function resignGame() {
  if (!state.started || state.gameOver) return;
  if (state.busy) {
    toast('AI 正在落子，请稍候。', 'info');
    return;
  }
  if (!window.confirm('确定要认输吗？本局将立即结束。')) return;
  state.gameOver = true;
  state.busy = false;
  state.selected = null;
  state.legalMoves = [];
  state.scene?.clearSelection();
  setMobileFeed(false);
  showGameOver({
    title: '你认输了。',
    subtitle: '局面已封存。下一次，继续。',
    result: 'AI 胜',
    crown: '♟',
    sound: 'lose',
  });
}

/* --------------------------------------------------------------------------
   Start / restart / undo
   -------------------------------------------------------------------------- */

function startGame() {
  if (!state.ready) {
    toast('棋盘仍在装载，请稍等。', 'info');
    return;
  }
  if (state.provider !== 'offline' && !providerHasCredentials(state.provider)) {
    openSettingsModal();
    toast('还没有可用的 API Key。请在设置中填写，或选择离线引擎。', 'error', 6000);
    return;
  }
  const provider = getProvider(state.provider);
  if (!provider) {
    toast('未找到所选模型厂商。', 'error');
    return;
  }
  state.session += 1;
  state.game = new Chess();
  state.history = [];
  state.gameOver = false;
  state.busy = false;
  state.selected = null;
  state.legalMoves = [];
  state.lastMove = null;
  state.pendingPromotion = null;
  state.aiColor = otherColor(state.playerColor);
  state.thinking = Boolean(provider.supportsThinking && el.setupThinking?.checked);
  savePrefs();
  stopThinking();
  setMobileFeed(false);
  closeTransientModals();
  closeModal('gameOverModal');

  state.scene?.setFen(state.game.fen());
  state.scene?.clearHighlights();
  state.scene?.setView(state.playerColor, { instant: false, duration: 900 });
  state.started = true;
  el.setupOverlay?.classList.add('hidden');
  updateMatchLabels();
  resetMatchUI();
  updateSetupInfo();
  updateTurnUI();
  state.audio?.place();

  const session = state.session;
  if (state.aiColor === 'w') {
    setTimeout(() => {
      if (session === state.session && state.started && !state.gameOver) aiTurn();
    }, 1050);
  }
}

function undoMove() {
  if (!state.started) return;
  if (state.busy) {
    toast('AI 正在思考，暂时不能悔棋。', 'info');
    return;
  }
  if (state.gameOver) {
    toast('本局已经结束，请开始新对局。', 'info');
    return;
  }
  const historyLength = state.game.history().length;
  if (!historyLength) {
    toast('还没有可以撤销的着法。', 'info');
    return;
  }
  if (state.playerColor === 'b' && historyLength === 1) {
    toast('你还没有走出自己的第一步。', 'info');
    return;
  }

  state.game.undo();
  if (state.game.turn() !== state.playerColor && state.game.history().length > 0) {
    state.game.undo();
  }
  if (state.game.turn() !== state.playerColor) {
    toast('暂时无法回到你的回合。', 'info');
    return;
  }

  state.history = state.game.history({ verbose: true });
  state.lastMove = state.history[state.history.length - 1] || null;
  state.selected = null;
  state.legalMoves = [];
  state.busy = false;
  state.gameOver = false;
  stopThinking();
  if (state.scene) {
    state.scene.setFen(state.game.fen());
    const last = state.lastMove;
    state.scene.setLastMove(last?.from, last?.to);
    state.scene.setCheck(state.game.inCheck() ? findKingSquare(state.game.turn()) : null);
    state.scene.clearSelection();
  }
  renderMoveList();
  renderMaterial();
  renderEvaluation();
  updateTurnUI();
  state.audio?.move();
  toast('已悔棋。', 'success');
}

function newGame() {
  if (!state.started) return;
  if (state.busy && !window.confirm('AI 仍在思考。仍要以当前设置开始新对局吗？')) return;
  if (!state.busy && !state.gameOver && !window.confirm('开始新对局？当前进度将丢失。')) return;
  startGame();
}

function backToSetup() {
  state.session += 1;
  state.started = false;
  state.gameOver = false;
  state.busy = false;
  state.selected = null;
  state.legalMoves = [];
  state.pendingPromotion = null;
  state.history = [];
  state.game = new Chess();
  state.lastMove = null;
  stopThinking();
  setMobileFeed(false);
  closeModal('gameOverModal');
  closeTransientModals();
  state.scene?.setFen(state.game.fen());
  state.scene?.clearHighlights();
  state.scene?.setView(state.playerColor, { instant: false, duration: 700 });
  state.scene?.setLastMove(null, null);
  state.scene?.setCheck(null);
  resetMatchUI();
  updateMatchLabels();
  updateSetupInfo();
  updateTurnUI();
  el.setupOverlay?.classList.remove('hidden');
  el.moveCount && (el.moveCount.textContent = '0 手');
}

/* --------------------------------------------------------------------------
   Bindings
   -------------------------------------------------------------------------- */

function bindEvents() {
  for (const button of document.querySelectorAll('.side-option')) {
    button.addEventListener('click', () => {
      setSideButtons(button.dataset.side);
      savePrefs();
    });
  }

  el.setupProvider?.addEventListener('change', () => {
    const provider = getProvider(el.setupProvider.value);
    if (!provider) return;
    state.provider = provider.id;
    state.model = provider.defaultModel;
    setupModelOptions(provider, state.model);
    if (provider.supportsThinking) {
      state.thinking = Boolean(el.setupThinking?.checked);
    } else {
      state.thinking = false;
    }
    updateSetupInfo();
    savePrefs();
  });

  el.setupModel?.addEventListener('change', () => {
    state.model = el.setupModel.value;
    updateSetupInfo();
    savePrefs();
  });

  el.setupThinking?.addEventListener('change', () => {
    state.thinking = Boolean(el.setupThinking.checked);
    savePrefs();
  });

  el.offlineBtn?.addEventListener('click', () => {
    state.provider = 'offline';
    state.model = 'gambit-local';
    state.thinking = false;
    if (el.setupProvider) el.setupProvider.value = 'offline';
    setupModelOptions(OFFLINE_PROVIDER, 'gambit-local');
    updateSetupInfo();
    savePrefs();
    toast('已切换到内置离线引擎。', 'success');
  });

  el.startBtn?.addEventListener('click', startGame);
  el.newGameBtn?.addEventListener('click', newGame);
  el.undoBtn?.addEventListener('click', undoMove);
  el.flipBtn?.addEventListener('click', () => {
    if (!state.started) return;
    state.scene?.toggleView();
  });
  el.feedBtn?.addEventListener('click', () => {
    setMobileFeed(!el.rightPanel?.classList.contains('mobile-open'));
  });
  el.resignBtn?.addEventListener('click', resignGame);
  el.backToSetupBtn?.addEventListener('click', backToSetup);
  el.rematchBtn?.addEventListener('click', () => {
    closeModal('gameOverModal');
    startGame();
  });

  el.settingsBtn?.addEventListener('click', openSettingsModal);
  el.openSettingsFromSetup?.addEventListener('click', openSettingsModal);
  el.saveSettingsBtn?.addEventListener('click', saveSettings);
  el.clearKeyBtn?.addEventListener('click', () => {
    const providerId = el.settingsProvider?.value || state.provider;
    setApiKey(providerId, '');
    if (el.settingsApiKey) el.settingsApiKey.value = '';
    refreshKeyStatus(providerId);
    toast('已清除当前厂商的本地 Key。', 'success');
  });

  el.settingsProvider?.addEventListener('change', () => {
    const provider = getProvider(el.settingsProvider.value);
    if (!provider) return;
    loadSettingsProvider(provider.id, provider.defaultModel);
  });

  el.settingsModel?.addEventListener('input', () => {
    // Custom model ids are allowed; the text input is the source of truth.
  });

  el.soundBtn?.addEventListener('click', () => {
    state.audio?.setEnabled(!state.audio.enabled);
    syncSoundButton();
    if (state.audio?.enabled) state.audio.select();
  });

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => closeModal(button.dataset.close));
  }

  for (const button of document.querySelectorAll('[data-promotion]')) {
    button.addEventListener('click', () => promotionChoice(button.dataset.promotion));
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (el.settingsModal?.classList.contains('open')) closeModal('settingsModal');
      else if (el.promotionModal?.classList.contains('open')) closeModal('promotionModal');
      else setMobileFeed(false);
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (!state.started || state.pendingPromotion) return;
    if (event.key.toLowerCase() === 'f') state.scene?.toggleView();
    if (event.key.toLowerCase() === 'u') undoMove();
  });

  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width: 980px)').matches) setMobileFeed(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.scene?.setHoverSquare(null);
  });

  el.canvas?.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    toast('3D 渲染上下文已丢失，请刷新页面。', 'error', 8000);
  });
}

function syncSoundButton() {
  if (!el.soundBtn || !state.audio) return;
  el.soundBtn.classList.toggle('muted', !state.audio.enabled);
  el.soundBtn.setAttribute('aria-pressed', state.audio.enabled ? 'true' : 'false');
  el.soundBtn.title = state.audio.enabled ? '关闭音效' : '开启音效';
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function init() {
  if (el.startBtn) el.startBtn.disabled = true;
  state.audio = new ChessAudio();
  syncSoundButton();
  bindEvents();

  try {
    state.scene = new ChessScene(el.canvas, {
      onSquare: handleSquareClick,
      onHover: handleHover,
      onImpact: handleImpact,
    });
  } catch (error) {
    state.loadError = error?.message || '无法初始化 3D 渲染。';
    setLoading(0, '无法初始化 3D 渲染');
    if (el.loaderText) el.loaderText.textContent = `${state.loadError} · 请确认浏览器支持 WebGL2`;
    console.error(error);
    return;
  }

  setLoading(3, '正在读取本地配置');
  try {
    const config = await loadServerConfig();
    state.config = config;
  } catch (error) {
    state.config = FALLBACK_CONFIG;
    toast(`读取配置失败：${error.message}。已使用备用设置。`, 'error', 6200);
  }
  initProviderSelectors();
  updateMatchLabels();

  try {
    await state.scene.load((percent, text) => setLoading(percent, text));
    state.ready = true;
    state.scene.setFen(new Chess().fen());
    state.scene.setView(state.playerColor, { instant: true });
    state.scene.start();
    state.scene.setLastMove(null, null);
    state.scene.setCheck(null);
    setLoading(100, '准备就绪');
    if (el.startBtn) el.startBtn.disabled = false;
    updateMatchLabels();
    updateSetupInfo();
    updateTurnUI();
    setTimeout(() => el.loadingScreen?.classList.add('hidden'), 520);
    setTimeout(() => {
      if (state.ready && !state.started) el.liveText && (el.liveText.textContent = '等待开局');
    }, 850);
  } catch (error) {
    state.loadError = error?.message || '棋盘载入失败。';
    console.error(error);
    setLoading(100, '棋盘载入失败');
    if (el.loaderText) el.loaderText.textContent = `资源载入失败 · ${state.loadError}`;
    if (el.startBtn) el.startBtn.disabled = true;
    toast(`棋盘载入失败：${state.loadError}`, 'error', 10000);
  }
}

window.addEventListener('beforeunload', () => {
  state.scene?.dispose();
  state.audio?.destroy();
});

// Expose a small read-only-ish surface for local debugging and visual tests.
window.gambit = {
  state,
  get scene() {
    return state.scene;
  },
  startGame,
  undoMove,
};

init();

