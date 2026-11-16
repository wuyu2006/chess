/* ==========================================================================
   GAMBIT · opponent gateway
   One compact request per AI turn. If a provider is unavailable, the game
   continues seamlessly with the local engine.
   ========================================================================== */

import { Chess } from '../vendor/chess.js';
import { chooseLocalMove } from './engine.js';

const KEY_PREFIX = 'gambit.key.';

export const FALLBACK_CONFIG = {
  defaultProvider: 'deepseek',
  defaultModel: 'deepseek-flash',
  providers: {
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek',
      short: 'DeepSeek',
      defaultModel: 'deepseek-flash',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      supportsThinking: true,
      recommended: true,
      note: 'V4.1 Flash · 官方推荐',
      hasServerKey: false,
    },
  },
};

const MODEL_NAMES = {
  'deepseek-flash': 'DeepSeek V4.1 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek/deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
  'gpt-5.2': 'GPT-5.2',
  'gpt-5.1': 'GPT-5.1',
  'gpt-5-mini': 'GPT-5 Mini',
  'o4-mini': 'o4-mini',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'anthropic/claude-opus-4.5': 'Claude Opus 4.5',
  'gemini-3-pro-preview': 'Gemini 3 Pro',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'google/gemini-3-pro-preview': 'Gemini 3 Pro',
  'kimi-k2.5': 'Kimi K2.5',
  'kimi-k2-turbo-preview': 'Kimi K2 Turbo',
  'moonshot-v1-128k': 'Moonshot 128K',
  'qwen3-max': 'Qwen3 Max',
  'qwen3.5-plus': 'Qwen3.5 Plus',
  'qwen-plus': 'Qwen Plus',
  'glm-5': 'GLM-5',
  'glm-4.7': 'GLM-4.7',
  'glm-4.6': 'GLM-4.6',
  'grok-4.1': 'Grok 4.1',
  'grok-4': 'Grok 4',
  'grok-3-mini': 'Grok 3 Mini',
  'openai/gpt-5.2': 'GPT-5.2',
  offline: '本地引擎',
};

export function modelDisplayName(model) {
  if (!model) return '未知模型';
  if (MODEL_NAMES[model]) return MODEL_NAMES[model];
  return model
    .replace(/^.*\//, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function providerDisplayName(providerId, config) {
  if (providerId === 'offline') return '本地引擎';
  return config?.providers?.[providerId]?.short || config?.providers?.[providerId]?.label || providerId;
}

export function getApiKey(providerId) {
  try {
    return localStorage.getItem(KEY_PREFIX + providerId) || '';
  } catch {
    return '';
  }
}

export function setApiKey(providerId, value) {
  try {
    if (value) localStorage.setItem(KEY_PREFIX + providerId, value);
    else localStorage.removeItem(KEY_PREFIX + providerId);
  } catch {
    // Private browsing may block localStorage; the session still works.
  }
}

export async function loadServerConfig() {
  const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`配置服务不可用（${response.status}）`);
  const config = await response.json();
  if (!config?.providers) throw new Error('配置格式无效。');
  return config;
}

/* --------------------------------------------------------------------------
   Local engine worker
   -------------------------------------------------------------------------- */

let worker = null;
let workerBroken = false;
let requestCounter = 0;
const pending = new Map();

function getWorker() {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, result, error } = event.data || {};
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      clearTimeout(item.timer);
      if (error) item.reject(new Error(error));
      else item.resolve(result);
    };
    worker.onerror = (event) => {
      workerBroken = true;
      const error = new Error(event?.message || '本地引擎线程异常。');
      for (const [id, item] of pending) {
        clearTimeout(item.timer);
        item.reject(error);
        pending.delete(id);
      }
      try {
        worker.terminate();
      } catch {
        // Ignore.
      }
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

export function localEngineMove(fen, options = {}) {
  const instance = getWorker();
  if (!instance) {
    try {
      return Promise.resolve(chooseLocalMove(fen, options));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  const id = ++requestCounter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('本地引擎超时。'));
    }, 9000);
    pending.set(id, { resolve, reject, timer });
    try {
      instance.postMessage({ id, fen, options });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

/* --------------------------------------------------------------------------
   Provider request with a safe local fallback
   -------------------------------------------------------------------------- */

function validateMove(fen, payload) {
  if (!payload) return null;
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;
  const wantedSan = typeof payload.san === 'string' ? payload.san.toLowerCase() : '';
  const wantedFrom = typeof payload.from === 'string' ? payload.from.toLowerCase() : '';
  const wantedTo = typeof payload.to === 'string' ? payload.to.toLowerCase() : '';
  const wantedPromotion = typeof payload.promotion === 'string' ? payload.promotion.toLowerCase() : '';

  let move = null;
  if (wantedSan) move = legal.find((m) => m.san.toLowerCase() === wantedSan) || null;
  if (!move && wantedFrom && wantedTo) {
    move = legal.find((m) => {
      if (m.from !== wantedFrom || m.to !== wantedTo) return false;
      if (wantedPromotion) return (m.promotion || '').toLowerCase() === wantedPromotion;
      return !m.promotion || m.promotion === 'q';
    }) || null;
  }
  if (!move) return null;
  return {
    san: move.san,
    from: move.from,
    to: move.to,
    promotion: move.promotion || null,
  };
}

function withLocalFallback(fen, reason, started, localOptions) {
  return localEngineMove(fen, localOptions).then((local) => {
    if (!local?.move) throw new Error(reason || '本地引擎无可用着法。');
    return {
      ...local.move,
      comment: local.comment,
      usage: null,
      provider: 'offline',
      providerLabel: '本地引擎',
      model: 'gambit-local',
      thinking: false,
      elapsedMs: Math.round(performance.now() - started),
      fallback: true,
      fallbackReason: reason || '',
      localDepth: local.depth,
      localNodes: local.nodes,
    };
  });
}

/**
 * Ask the configured provider for a move. The response is validated on the
 * client again, and a local move is produced if the provider fails.
 */
export async function requestAIMove({
  fen,
  lastMove = '',
  provider = 'deepseek',
  model = 'deepseek-flash',
  thinking = false,
  baseUrl = '',
  localOptions = {},
}) {
  const started = performance.now();
  if (provider === 'offline') {
    const local = await localEngineMove(fen, localOptions);
    if (!local?.move) throw new Error('当前局面没有可用着法。');
    return {
      ...local.move,
      comment: local.comment,
      usage: null,
      provider: 'offline',
      providerLabel: '本地引擎',
      model: 'gambit-local',
      thinking: false,
      elapsedMs: Math.round(performance.now() - started),
      fallback: false,
      localDepth: local.depth,
      localNodes: local.nodes,
    };
  }

  const apiKey = getApiKey(provider);
  let reason = '';
  try {
    const response = await fetch('/api/ai-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        fen,
        lastMove,
        provider,
        model,
        thinking: Boolean(thinking),
        apiKey,
        baseUrl: baseUrl || undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || `模型服务返回 ${response.status}`);
      error.code = data?.code || 'provider_error';
      throw error;
    }
    const move = validateMove(fen, data);
    if (!move) {
      const error = new Error('模型返回了非法着法。');
      error.code = 'invalid_move';
      throw error;
    }
    return {
      ...move,
      comment: typeof data.comment === 'string' ? data.comment.slice(0, 90) : '',
      usage: data.usage || null,
      provider: data.provider || provider,
      providerLabel: data.providerLabel || provider,
      model: data.model || model,
      thinking: Boolean(data.thinking),
      elapsedMs: data.elapsedMs || Math.round(performance.now() - started),
      fallback: false,
    };
  } catch (error) {
    reason = error?.message || '模型请求失败。';
    // Keep the player moving. The UI surfaces the fallback in a toast and in
    // the game feed instead of interrupting play with a blocking error.
    return withLocalFallback(fen, reason, started, localOptions);
  }
}

export function formatUsage(result) {
  if (!result) return '';
  if (result.provider === 'offline') {
    const depth = result.localDepth ? `深度 ${result.localDepth}` : '';
    const nodes = result.localNodes ? `${(result.localNodes / 1000).toFixed(1)}k 节点` : '';
    return [ '本地搜索', depth, nodes, `${result.elapsedMs ?? 0}ms` ].filter(Boolean).join(' · ');
  }
  const parts = [];
  if (result.usage?.input) parts.push(`${result.usage.input} in`);
  if (result.usage?.output) parts.push(`${result.usage.output} out`);
  if (result.usage?.reasoning) parts.push(`${result.usage.reasoning} reason`);
  if (!parts.length && result.elapsedMs) parts.push(`${(result.elapsedMs / 1000).toFixed(1)}s`);
  return parts.join(' · ');
}

export function stopLocalEngine() {
  if (worker) {
    try {
      worker.terminate();
    } catch {
      // Ignore.
    }
  }
  worker = null;
  for (const [id, item] of pending) {
    clearTimeout(item.timer);
    item.reject(new Error('本地引擎已停止。'));
    pending.delete(id);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', stopLocalEngine, { once: true });
}
