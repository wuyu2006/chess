import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from './docs/vendor/chess.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'docs');

// ---------------------------------------------------------------------------
// Tiny .env loader (keeps the project dependency-free)
// ---------------------------------------------------------------------------
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // The project-local .env is authoritative. A machine-level variable with
    // the same name can belong to an unrelated tool and would silently point
    // the app at the wrong account.
    process.env[key] = value;
  }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 3000);

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    short: 'DeepSeek',
    style: 'openai',
    baseUrl: 'https://api.deepseek.com',
    env: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    supportsThinking: true,
    recommended: true,
    note: 'V4.1 Flash · 官方推荐',
  },
  openai: {
    label: 'OpenAI',
    short: 'OpenAI',
    style: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    env: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.2',
    models: ['gpt-5.2', 'gpt-5.1', 'gpt-5-mini', 'o4-mini'],
    supportsThinking: false,
  },
  anthropic: {
    label: 'Anthropic',
    short: 'Claude',
    style: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    env: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    supportsThinking: false,
  },
  gemini: {
    label: 'Google Gemini',
    short: 'Gemini',
    style: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    env: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3-pro-preview',
    models: ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    supportsThinking: false,
  },
  moonshot: {
    label: 'Moonshot / Kimi',
    short: 'Kimi',
    style: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    env: 'MOONSHOT_API_KEY',
    defaultModel: 'kimi-k2.5',
    models: ['kimi-k2.5', 'kimi-k2-turbo-preview', 'moonshot-v1-128k'],
    supportsThinking: false,
  },
  dashscope: {
    label: 'Alibaba / Qwen',
    short: 'Qwen',
    style: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    env: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen3-max',
    models: ['qwen3-max', 'qwen3.5-plus', 'qwen-plus'],
    supportsThinking: false,
  },
  zhipu: {
    label: 'Zhipu / GLM',
    short: 'GLM',
    style: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    env: 'ZHIPU_API_KEY',
    defaultModel: 'glm-5',
    models: ['glm-5', 'glm-4.7', 'glm-4.6'],
    supportsThinking: false,
  },
  xai: {
    label: 'xAI / Grok',
    short: 'Grok',
    style: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    env: 'XAI_API_KEY',
    defaultModel: 'grok-4.1',
    models: ['grok-4.1', 'grok-4', 'grok-3-mini'],
    supportsThinking: false,
  },
  openrouter: {
    label: 'OpenRouter',
    short: 'OpenRouter',
    style: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    env: 'OPENROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-v4.1-flash',
    models: [
      'deepseek/deepseek-v4.1-flash',
      'anthropic/claude-opus-4.5',
      'openai/gpt-5.2',
      'google/gemini-3-pro-preview',
    ],
    supportsThinking: false,
  },
};

const SYSTEM_PROMPT = `You are a world-class chess grandmaster and calculation engine. Choose the single strongest legal move. Prioritise tactics, checks, captures, king safety, material and pawn structure. Do not play a weaker move to be nice. Reply with JSON only, exactly in this shape: {"move":"Nf3","comment":"short Chinese comment"}. The comment must be Chinese and no longer than 18 characters. No markdown and no extra keys.`;

function buildPrompt({ fen, chess, lastMove }) {
  const legal = chess.moves({ verbose: true });
  const legalSan = legal.map((m) => m.san).join(' ');
  const side = chess.turn() === 'w' ? 'White' : 'Black';
  return [
    `FEN: ${fen}`,
    `Side to move: ${side}`,
    `Move number: ${chess.moveNumber()}`,
    `Last move: ${lastMove || 'none'}`,
    `Legal moves (SAN): ${legalSan}`,
    'Pick exactly one move from the legal moves. Reply with the required JSON only.',
  ].join('\n');
}

function providerPublicConfig() {
  const providers = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    providers[id] = {
      id,
      label: p.label,
      short: p.short,
      defaultModel: p.defaultModel,
      models: p.models,
      supportsThinking: p.supportsThinking,
      recommended: !!p.recommended,
      note: p.note || '',
      baseUrl: p.baseUrl,
      hasServerKey: Boolean(process.env[p.env]),
    };
  }
  return {
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-flash',
    providers,
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function safeString(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validateHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('Base URL must be a valid http(s) URL.');
  }
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // Fall through to a permissive regex extraction.
    }
  }
  const moveMatch = cleaned.match(/"(?:move|best_move|bestMove|uci|san)"\s*:\s*"([^"]+)"/i);
  const commentMatch = cleaned.match(/"(?:comment|reason|explanation)"\s*:\s*"([^"]*)"/i);
  if (moveMatch) return { move: moveMatch[1], comment: commentMatch?.[1] || '' };
  return null;
}

function normaliseMove(text, chess) {
  const legal = chess.moves({ verbose: true });
  const bySan = new Map();
  const byUci = new Map();
  for (const m of legal) {
    bySan.set(m.san.toLowerCase(), m);
    byUci.set((m.from + m.to + (m.promotion || '')).toLowerCase(), m);
  }
  const candidates = [];
  const parsed = extractJson(text);
  if (parsed) {
    for (const key of ['move', 'best_move', 'bestMove', 'uci', 'san']) {
      if (typeof parsed[key] === 'string') candidates.push(parsed[key]);
    }
  }
  const cleaned = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/[{}[\],"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned) {
    candidates.push(cleaned);
    const legalTokens = [...bySan.keys()].sort((a, b) => b.length - a.length);
    for (const token of legalTokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(cleaned)) {
        candidates.push(token);
      }
    }
    for (const token of [...byUci.keys()].sort((a, b) => b.length - a.length)) {
      if (new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'i').test(cleaned)) {
        candidates.push(token);
      }
    }
  }
  for (const raw of candidates) {
    const candidate = String(raw).trim().replace(/^['"`]+|['"`]+$/g, '');
    const lower = candidate.toLowerCase();
    const found = bySan.get(lower) || byUci.get(lower);
    if (found) {
      return {
        san: found.san,
        from: found.from,
        to: found.to,
        promotion: found.promotion || null,
      };
    }
  }
  return null;
}

function extractComment(text, parsed) {
  let comment = parsed?.comment || parsed?.reason || parsed?.explanation || '';
  if (!comment) {
    const match = String(text || '').match(/"(?:comment|reason|explanation)"\s*:\s*"([^"]*)"/i);
    comment = match?.[1] || '';
  }
  return safeString(comment.replace(/[\r\n]+/g, ' '), 90);
}

function normaliseUsage(provider, data) {
  if (!data) return null;
  if (provider.style === 'anthropic') {
    return {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
      total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  }
  if (provider.style === 'gemini') {
    return {
      input: data.usageMetadata?.promptTokenCount || 0,
      output: data.usageMetadata?.candidatesTokenCount || 0,
      total: data.usageMetadata?.totalTokenCount || 0,
    };
  }
  const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens || 0;
  return {
    input: data.usage?.prompt_tokens || 0,
    output: data.usage?.completion_tokens || 0,
    reasoning,
    total: data.usage?.total_tokens || (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0),
  };
}

function providerError(data, fallback) {
  return (
    data?.error?.message ||
    data?.error?.type ||
    data?.message ||
    data?.msg ||
    fallback ||
    'The provider rejected the request.'
  );
}

function responseText(provider, data) {
  if (provider.style === 'openai') {
    return data?.choices?.[0]?.message?.content || '';
  }
  if (provider.style === 'anthropic') {
    return (data?.content || [])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('\n');
  }
  if (provider.style === 'gemini') {
    return (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || '')
      .join('\n');
  }
  return '';
}

async function callProvider({ provider, apiKey, baseUrl, model, prompt, thinking }) {
  const headers = { 'Content-Type': 'application/json' };
  let url = '';
  let body;
  const maxTokens = thinking ? 5000 : 180;

  if (provider.style === 'openai') {
    url = `${baseUrl}/chat/completions`;
    headers.Authorization = `Bearer ${apiKey}`;
    body = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt.text },
      ],
      stream: false,
    };
    if (provider.id === 'openai') {
      // Newer OpenAI reasoning models reject temperature and need a larger
      // completion budget for hidden reasoning tokens.
      body.max_completion_tokens = thinking ? 5000 : 4000;
    } else {
      body.temperature = 0.2;
      body.max_tokens = maxTokens;
    }
    if (provider.id === 'deepseek') {
      body.thinking = { type: thinking ? 'enabled' : 'disabled' };
      if (thinking) body.reasoning_effort = 'high';
      body.response_format = { type: 'json_object' };
    }
    if (provider.id === 'openrouter') {
      headers['HTTP-Referer'] = 'http://localhost:3000';
      headers['X-Title'] = 'GAMBIT Neural Chess';
    }
  } else if (provider.style === 'anthropic') {
    url = `${baseUrl}/v1/messages`;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt.text }],
    };
  } else if (provider.style === 'gemini') {
    url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt.text }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    };
  } else {
    throw new Error('Unsupported provider style.');
  }

  async function performRequest(payload) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(95000),
      });
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'AI 请求超时。' : '无法连接到模型服务。';
      throw new Error(message);
    }

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      // Keep raw text for the error path.
    }
    return { response, rawText, data };
  }

  let attempt = await performRequest(body);
  if (!attempt.response.ok) {
    const detail = safeString(providerError(attempt.data, attempt.rawText), 300);
    throw new Error(`模型服务返回 ${attempt.response.status}：${detail || '请求失败'}`);
  }

  let text = responseText(provider, attempt.data);
  if (!text.trim()) {
    const choice = attempt.data?.choices?.[0];
    const message = choice?.message;
    const reasoningLength = typeof message?.reasoning_content === 'string' ? message.reasoning_content.length : 0;
    console.warn(
      `Empty model response (${provider.id}, ${model}, finish=${choice?.finish_reason || 'unknown'}, reasoning=${reasoningLength}); retrying once`,
    );

    // A reasoning model can spend the whole completion budget thinking and
    // emit no final JSON. Retry once with a small, non-thinking request.
    if (provider.id === 'openai') {
      body.max_completion_tokens = Math.max(body.max_completion_tokens || 0, 4000);
    } else if (provider.style === 'openai') {
      body.max_tokens = Math.max(body.max_tokens || 0, 400);
      body.temperature = 0.1;
      if (provider.id === 'deepseek' && thinking) {
        body.thinking = { type: 'disabled' };
        delete body.reasoning_effort;
      }
    } else if (provider.style === 'anthropic') {
      body.max_tokens = Math.max(body.max_tokens || 0, 400);
    } else if (provider.style === 'gemini' && body.generationConfig) {
      body.generationConfig.maxOutputTokens = Math.max(body.generationConfig.maxOutputTokens || 0, 400);
    }

    attempt = await performRequest(body);
    if (!attempt.response.ok) {
      const detail = safeString(providerError(attempt.data, attempt.rawText), 300);
      throw new Error(`模型服务返回 ${attempt.response.status}：${detail || '请求失败'}`);
    }
    text = responseText(provider, attempt.data);
  }

  if (!text.trim()) {
    throw new Error('模型返回了空内容，请重试或切换模型。');
  }

  const data = attempt.data;
  const chess = new Chess(prompt.fen);
  const move = normaliseMove(text, chess);
  if (!move) {
    throw new Error('模型没有给出合法着法，已切换本地引擎。');
  }
  const parsed = extractJson(text);
  return {
    ...move,
    comment: extractComment(text, parsed),
    usage: normaliseUsage(provider, data),
    raw: text.slice(0, 800),
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gltf': 'model/gltf+json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const isHtml = ext === '.html';
    const cache = isHtml || ext === '.js' || ext === '.css'
      ? 'no-cache'
      : pathname.startsWith('/assets/') || pathname.startsWith('/vendor/')
        ? 'public, max-age=86400'
        : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');

  if (requestUrl.pathname === '/api/health') {
    json(res, 200, { ok: true, service: 'gambit-neural-chess' });
    return;
  }

  if (requestUrl.pathname === '/api/config') {
    json(res, 200, providerPublicConfig());
    return;
  }

  if (requestUrl.pathname === '/api/ai-move' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const provider = PROVIDERS[body.provider]
        ? { ...PROVIDERS[body.provider], id: body.provider }
        : null;
      if (!provider) {
        json(res, 400, { error: '未知的模型厂商。' });
        return;
      }
      const fen = safeString(body.fen, 120);
      let chess;
      try {
        chess = new Chess(fen);
      } catch {
        json(res, 400, { error: 'FEN 无效。' });
        return;
      }
      if (chess.isGameOver()) {
        json(res, 400, { error: '棋局已经结束。' });
        return;
      }
      const model = safeString(body.model, 160) || provider.defaultModel;
      const apiKey = safeString(body.apiKey, 512) || process.env[provider.env] || '';
      if (!apiKey) {
        json(res, 400, {
          error: `${provider.label} 尚未配置 API Key，请在设置中填写，或使用内置离线引擎。`,
          code: 'missing_key',
        });
        return;
      }
      const baseUrl = validateHttpUrl(safeString(body.baseUrl, 400) || provider.baseUrl);
      const thinking = Boolean(body.thinking) && provider.supportsThinking;
      const prompt = {
        fen,
        chess,
        lastMove: safeString(body.lastMove, 16),
      };
      const userPrompt = buildPrompt(prompt);
      const started = Date.now();
      const result = await callProvider({
        provider,
        apiKey,
        baseUrl,
        model,
        prompt: { ...prompt, text: userPrompt },
        thinking,
      });
      json(res, 200, {
        ...result,
        provider: provider.id,
        providerLabel: provider.label,
        model,
        thinking,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      const status = /超时/.test(error.message) ? 504 : /合法着法/.test(error.message) ? 422 : 502;
      json(res, status, {
        error: safeString(error.message, 400) || 'AI 请求失败。',
        code: status === 422 ? 'invalid_move' : status === 504 ? 'timeout' : 'provider_error',
      });
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method not allowed');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`GAMBIT running at http://localhost:${PORT}`);
  console.log('Offline assets ready. API keys are read from .env / the local settings panel.');
});
