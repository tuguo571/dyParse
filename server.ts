import { buildCliSummary, parseByHellotik } from './index.mjs';

const PANEL_TITLE = 'Dy Parse Panel';

const panelHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${PANEL_TITLE}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top, rgba(56, 189, 248, 0.2), transparent 28%),
        linear-gradient(180deg, #020617, #0f172a 45%, #111827);
    }

    main {
      width: min(960px, calc(100vw - 32px));
      margin: 32px auto;
      padding: 28px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 24px;
      background: rgba(15, 23, 42, 0.72);
      backdrop-filter: blur(14px);
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.42);
    }

    h1 {
      margin: 0 0 12px;
      font-size: clamp(28px, 4vw, 40px);
    }

    p {
      margin: 0 0 18px;
      color: #cbd5e1;
      line-height: 1.6;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 18px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(14, 165, 233, 0.14);
      color: #7dd3fc;
      font-size: 13px;
    }

    form {
      display: grid;
      gap: 14px;
      margin-bottom: 20px;
    }

    label {
      display: grid;
      gap: 8px;
      font-weight: 600;
      color: #e2e8f0;
    }

    input[type="text"] {
      width: 100%;
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(15, 23, 42, 0.8);
      color: #f8fafc;
      outline: none;
    }

    input[type="text"]:focus {
      border-color: rgba(56, 189, 248, 0.8);
      box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.14);
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
    }

    .checkbox {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 500;
      color: #cbd5e1;
    }

    button {
      cursor: pointer;
      border: 0;
      border-radius: 14px;
      padding: 12px 18px;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      font-size: 15px;
      font-weight: 700;
    }

    button:hover {
      filter: brightness(1.08);
    }

    pre {
      margin: 0;
      padding: 18px;
      min-height: 280px;
      overflow: auto;
      border-radius: 18px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2, 6, 23, 0.92);
      color: #a7f3d0;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .hint {
      margin-top: 14px;
      font-size: 13px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <main>
    <div class="badge">Deno Deploy / Dynamic App</div>
    <h1>${PANEL_TITLE}</h1>
    <p>粘贴抖音链接后，由服务端代为请求并解析，避免在浏览器暴露签名与解密逻辑。</p>

    <form id="parse-form">
      <label>
        抖音链接
        <input id="request-url" type="text" placeholder="https://www.douyin.com/..." autocomplete="off" />
      </label>

      <div class="toolbar">
        <label class="checkbox">
          <input id="full-result" type="checkbox" />
          返回完整结果
        </label>
        <button type="submit">开始解析</button>
      </div>
    </form>

    <pre id="output">等待输入...</pre>
    <div class="hint">接口路径：POST /api/parse ｜ 健康检查：GET /healthz</div>
  </main>

  <script>
    const form = document.getElementById('parse-form');
    const output = document.getElementById('output');
    const requestURLInput = document.getElementById('request-url');
    const fullResultInput = document.getElementById('full-result');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const requestURL = requestURLInput.value.trim();
      const full = fullResultInput.checked;

      if (!requestURL) {
        output.textContent = '请先输入需要解析的链接';
        return;
      }

      output.textContent = '解析中，请稍候...';

      try {
        const response = await fetch('/api/parse', {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({ requestURL, full })
        });

        const payload = await response.json();
        output.textContent = JSON.stringify(payload, null, 2);
      } catch (error) {
        output.textContent = JSON.stringify(
          {
            success: false,
            message: error instanceof Error ? error.message : String(error)
          },
          null,
          2
        );
      }
    });
  </script>
</body>
</html>`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

Deno.serve(async (request) => {
  const { pathname } = new URL(request.url);

  if (request.method === 'GET' && pathname === '/') {
    return new Response(panelHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8'
      }
    });
  }

  if (request.method === 'GET' && pathname === '/healthz') {
    return jsonResponse({
      success: true,
      service: 'dy-parse-panel',
      timestamp: new Date().toISOString()
    });
  }

  if (pathname === '/api/parse') {
    if (request.method !== 'POST') {
      return jsonResponse(
        {
          success: false,
          message: 'Method not allowed'
        },
        405
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          message: `Invalid JSON body: ${getErrorMessage(error)}`
        },
        400
      );
    }

    const requestURL =
      typeof payload?.requestURL === 'string' ? payload.requestURL.trim() : '';
    const full = Boolean(payload?.full);

    if (!requestURL) {
      return jsonResponse(
        {
          success: false,
          message: 'requestURL is required'
        },
        400
      );
    }

    try {
      const result = await parseByHellotik(requestURL);
      return jsonResponse({
        success: true,
        data: full ? result : buildCliSummary(result)
      });
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          message: getErrorMessage(error)
        },
        500
      );
    }
  }

  return new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  });
});
