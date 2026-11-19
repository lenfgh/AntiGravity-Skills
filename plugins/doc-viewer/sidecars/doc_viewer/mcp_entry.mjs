import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyExtension } from './parsers.mjs';

const CONV_META_KEY = 'antigravity.google/conversation_id';

function resolveAppDataDir() {
  const envDir = process.env.ANTIGRAVITY_APP_DATA_DIR?.trim();
  if (envDir) return envDir;
  return join(homedir(), '.gemini', 'antigravity');
}

function getStateDir() {
  const dir = join(resolveAppDataDir(), 'sidecar_data', 'doc-viewer_doc_viewer');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonAtomic(filePath, obj) {
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  renameSync(tmp, filePath);
}

function sanitizeConvId(id) {
  if (typeof id !== 'string') return '';
  const clean = id.trim();
  return /^[a-zA-Z0-9_-]{4,128}$/.test(clean) ? clean : '';
}

function getConversationWorkspaces(convId) {
  if (!convId) return [];
  try {
    const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE?.trim();
    const cmd = exe || 'agentapi';
    const args = exe ? ['agentapi', 'get-conversation-metadata', convId] : ['get-conversation-metadata', convId];
    const out = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000 });
    const parsed = JSON.parse(out || '{}');
    const uris = parsed?.response?.conversationMetadata?.metadata?.workspaceUris
      || parsed?.conversationMetadata?.metadata?.workspaceUris
      || [];
    return uris.map((u) => {
      if (typeof u !== 'string') return '';
      if (u.startsWith('file://')) {
        try { return fileURLToPath(u); } catch { return ''; }
      }
      return u;
    }).filter((p) => p && existsSync(p));
  } catch {
    return [];
  }
}

function resolveTargetFile(rawPath, convId) {
  const input = String(rawPath || '').trim();
  if (!input) return null;
  const cleaned = input.startsWith('file://') ? (() => {
    try { return fileURLToPath(input); } catch { return input; }
  })() : input;

  if (isAbsolute(cleaned) && existsSync(cleaned)) {
    return resolve(cleaned);
  }
  const candidates = [];
  for (const ws of getConversationWorkspaces(convId)) {
    candidates.push(resolve(ws, cleaned));
  }
  if (convId) {
    const brainDir = join(resolveAppDataDir(), 'brain', convId);
    candidates.push(resolve(brainDir, cleaned));
    candidates.push(resolve(brainDir, 'scratch', cleaned));
    candidates.push(resolve(brainDir, '.user_uploaded', cleaned));
  }
  candidates.push(resolve(process.cwd(), cleaned));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.next', 'dist', 'build', '.cache']);

function walkFiles(rootDir, maxCount = 500) {
  const results = [];
  const queue = [rootDir];
  while (queue.length > 0 && results.length < maxCount) {
    const cur = queue.shift();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (results.length >= maxCount) break;
      const full = join(cur, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) queue.push(full);
      } else if (ent.isFile()) {
        const kind = classifyExtension(ent.name);
        if (kind !== 'binary') {
          results.push({ path: full, name: ent.name, kind });
        }
      }
    }
  }
  return results;
}

const TOOLS = [
  {
    name: 'open_document',
    description:
      'Sets the active document or file to preview in the Antigravity Document Viewer side pane (DOCX, PDF, XLSX/CSV, PPTX, EPUB, ODT/ODP, RTF, Markdown, Jupyter Notebook, SQLite, ZIP, images, audio, video, fonts, or code). After calling this, include `[Preview](sidecar://doc-viewer/doc_viewer/)` in your reply.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path or workspace/artifact-relative path to the file to preview.',
        },
        mode: {
          type: 'string',
          enum: ['layout', 'reader', 'raw'],
          description: 'Optional initial view mode (e.g., layout or reader for DOCX, raw for source).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_documents',
    description: 'Lists previewable documents and files in the active workspace or a specified directory.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Optional directory path to scan. Defaults to the conversation workspace.',
        },
        kind: {
          type: 'string',
          description: 'Optional filter by kind (e.g., docx, pdf, spreadsheet, pptx, epub, markdown, sqlite).',
        },
      },
    },
  },
  {
    name: 'get_viewer_state',
    description: 'Returns the currently targeted document path in the Document Viewer sidecar.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function handleToolCall(name, args, convId) {
  const stateDir = getStateDir();
  const targetFile = convId ? join(stateDir, `${convId}.json`) : join(stateDir, 'latest.json');

  if (name === 'open_document') {
    const resolved = resolveTargetFile(args?.path, convId);
    if (!resolved) {
      return {
        isError: true,
        content: [{ type: 'text', text: `文件不存在或无法解析路径: ${String(args?.path || '')}` }],
      };
    }
    const st = statSync(resolved);
    if (!st.isFile()) {
      return {
        isError: true,
        content: [{ type: 'text', text: `目标不是文件: ${resolved}` }],
      };
    }
    const payload = {
      path: resolved,
      name: basename(resolved),
      kind: classifyExtension(resolved),
      mode: args?.mode || null,
      seq: Date.now(),
      updatedAt: new Date().toISOString(),
      conversationId: convId || null,
    };
    writeJsonAtomic(targetFile, payload);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          path: resolved,
          kind: payload.kind,
          sidecarLink: `[预览 ${payload.name}](sidecar://doc-viewer/doc_viewer/)`,
        }),
      }],
    };
  }

  if (name === 'list_documents') {
    const dirs = args?.directory
      ? [resolve(String(args.directory))]
      : getConversationWorkspaces(convId);
    if (dirs.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ files: [], note: 'No workspace directory resolved' }) }] };
    }
    let files = dirs.flatMap((d) => walkFiles(d, 300));
    if (args?.kind) {
      const want = String(args.kind).toLowerCase();
      files = files.filter((f) => f.kind === want);
    }
    return { content: [{ type: 'text', text: JSON.stringify({ directories: dirs, count: files.length, files: files.slice(0, 100) }) }] };
  }

  if (name === 'get_viewer_state') {
    let state = null;
    if (existsSync(targetFile)) {
      try {
        state = JSON.parse(readFileSync(targetFile, 'utf-8'));
      } catch {}
    }
    return { content: [{ type: 'text', text: JSON.stringify({ state }) }] };
  }

  return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
}

function send(msg) {
  if (msg) process.stdout.write(`${JSON.stringify(msg)}\n`);
}

createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  const id = req.id ?? null;
  const method = req.method || '';
  const params = req.params && typeof req.params === 'object' ? req.params : {};

  if (method === 'notifications/initialized') return;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'doc-viewer-mcp', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    const convId = sanitizeConvId(args.conversationId || args.conversation_id || params?._meta?.[CONV_META_KEY]);
    try {
      const result = handleToolCall(params.name, args, convId);
      send({ jsonrpc: '2.0', id, result });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] },
      });
    }
    return;
  }
  if (id !== null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
