import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { AppError, MODEL, fail, generation, parseOutput, readJson, validate } from './gemini-service.mjs';
import { createLocalMockApi } from './local-mock-api.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILES = new Set([
  'index.html', 'style.css', 'app.js', 'scenarios.js', 'roleplay-data.js',
  'curriculum-data.js', 'flashcards-data.js', 'progress.js', 'ai-roleplay.js',
  'ai-roleplay-core.js', 'ai-roleplay-connection.js', 'ai-roleplay-speech.js',
  'ai-roleplay-reviews.js', 'cloud-client.js', 'auth-ui.js', 'rewards-ui.js', 'admin-ui.js', 'migration-ui.js',
  'promo-popup.js', 'icon.svg', 'manifest.json',
]);
const ERRORS = {
  INVALID_REQUEST: [400, '요청 내용을 확인해 주세요.'],
  NOT_CONFIGURED: [409, 'AI 연습을 준비하지 못했습니다. 기본 연습으로 계속해 주세요.'],
  QUOTA_EXCEEDED: [429, 'AI 사용 한도에 도달했습니다. 기본 연습으로 계속해 주세요.'],
  INVALID_KEY: [403, 'API 키와 프로젝트 권한을 확인해 주세요.'],
  MODEL_UNAVAILABLE: [503, '현재 모델을 사용할 수 없습니다. 나중에 다시 시도해 주세요.'],
  UPSTREAM_ERROR: [502, 'AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.'],
  TIMEOUT: [504, 'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.'],
  BUSY: [409, '이전 AI 응답을 기다려 주세요.'],
};
export function createApp({
  fetchImpl = globalThis.fetch,
  timeoutMs = 25000,
  geminiApiKey = process.env.GEMINI_API_KEY,
} = {}) {
  const config = { key: geminiApiKey || '', quotaBlocked: false };
  const mockApi = createLocalMockApi();
  let activeController = null;
  const status = () => ({
    configured: !!config.key,
    ai: config.key
      ? { status: config.quotaBlocked ? 'limited' : 'available', reason: config.quotaBlocked ? 'quota_exceeded' : null }
      : { status: 'limited', reason: 'not_configured' },
    model: MODEL,
    quotaBlocked: config.quotaBlocked,
    maxTurns: 6,
  });

  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (code, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };

    try {
      const port = req.socket.localPort;
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
      if (port === 80) {
        for (const host of ['127.0.0.1', 'localhost', '[::1]']) hosts.add(host);
      }
      if (!hosts.has(req.headers.host)) fail('INVALID_REQUEST');
      const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

      if (pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.headers.origin !== `http://${req.headers.host}`) {
          fail('INVALID_REQUEST');
        }
        const mockResult = await mockApi.handle(pathname, req, readJson);
        if (mockResult) return json(mockResult.status, mockResult.body);
        if (pathname === '/api/status' && req.method === 'GET') return json(200, status());
        if (pathname === '/api/roleplay' && req.method === 'POST') {
          const data = await readJson(req);
          const turns = validate(data);
          if (!config.key) fail('NOT_CONFIGURED');
          if (config.quotaBlocked) fail('QUOTA_EXCEEDED');
          if (activeController) fail('BUSY');

          const current = config;
          const controller = new AbortController();
          activeController = controller;
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
          const disconnect = () => {
            if (!res.writableEnded) controller.abort();
          };
          res.once('close', disconnect);

          try {
            const response = await fetchImpl(
              `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': current.key },
                body: JSON.stringify(generation(data, turns)),
                signal: controller.signal,
              },
            );
            if (config !== current || controller.signal.aborted) fail('UPSTREAM_ERROR');
            if (response.status === 429) {
              current.quotaBlocked = true;
              fail('QUOTA_EXCEEDED');
            }
            if ([401, 403].includes(response.status)) fail('INVALID_KEY');
            if ([404, 503].includes(response.status)) fail('MODEL_UNAVAILABLE');
            if (!response.ok) fail('UPSTREAM_ERROR');
            const payload = await response.json();
            if (config !== current || controller.signal.aborted) fail('UPSTREAM_ERROR');
            return json(200, parseOutput(payload, data, turns));
          } catch (error) {
            if (timedOut) fail('TIMEOUT');
            if (error instanceof AppError) throw error;
            fail('UPSTREAM_ERROR');
          } finally {
            clearTimeout(timer);
            res.off('close', disconnect);
            if (activeController === controller) activeController = null;
          }
        }
        return json(404, { error: { code: 'INVALID_REQUEST', message: '요청한 경로를 찾을 수 없습니다.' } });
      }

      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      const notFound = () => json(404, {
        error: { code: 'INVALID_REQUEST', message: '요청한 파일을 찾을 수 없습니다.' },
      });
      if (req.method !== 'GET' || !FILES.has(file)) return notFound();
      let content;
      try {
        content = await readFile(path.join(ROOT, file));
      } catch {
        return notFound();
      }
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:", "connect-src 'self'", "object-src 'none'",
        "base-uri 'none'", "frame-ancestors 'none'",
      ].join('; '));
      const contentType = file.endsWith('.html') ? 'text/html'
        : file.endsWith('.css') ? 'text/css'
        : file.endsWith('.svg') ? 'image/svg+xml'
        : file.endsWith('.json') ? 'application/json' : 'text/javascript';
      res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
      res.end(content);
    } catch (error) {
      const errorCode = error instanceof AppError ? error.code : 'UPSTREAM_ERROR';
      const [code, message] = ERRORS[errorCode];
      json(code, { error: { code: errorCode, message } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`English conversation: http://127.0.0.1:${port}`);
  });
}
