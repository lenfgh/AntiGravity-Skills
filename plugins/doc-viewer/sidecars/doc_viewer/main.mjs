import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import {
  classifyExtension,
  decodeTextBuffer,
  highlightCode,
  listArchiveEntries,
  mimeForExt,
  parseDocxReader,
  parseEpub,
  parseIpynb,
  parseLegacyDoc,
  parseOdp,
  parseOdt,
  parsePptx,
  parseRtf,
  parseSqliteMeta,
  parseStructured,
  parseWorkbook,
  querySqliteTable,
  readArchiveEntry,
  renderMarkdownHtml,
} from './parsers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const NM_DIR = join(__dirname, 'node_modules');

const MAX_PREVIEW_BYTES = 80 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.venv', 'venv', '.next', '.nuxt',
  'dist', 'build', 'target', '.cache', '.tmp', '_tmp', '$RECYCLE.BIN', 'System Volume Information',
]);

const DOC_KINDS = new Set(['pdf', 'docx', 'odt', 'rtf', 'doc_legacy', 'epub', 'markdown']);
const DATA_KINDS = new Set(['ipynb', 'structured', 'sqlite']);
const MEDIA_KINDS = new Set(['image', 'audio', 'video', 'font', 'svg']);

const app = new SidecarApp();

function resolveAppDataDir() {
  return process.env.ANTIGRAVITY_APP_DATA_DIR?.trim() || join(homedir(), '.gemini', 'antigravity');
}

function getStateDir() {
  const dir = join(resolveAppDataDir(), 'sidecar_data', 'doc-viewer_doc_viewer');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeConvId(id) {
  if (typeof id !== 'string') return '';
  const clean = id.trim();
  return /^[a-zA-Z0-9_-]{4,128}$/.test(clean) ? clean : '';
}

function uriToFsPath(uri) {
  if (typeof uri !== 'string' || !uri.trim()) return '';
  let s = uri.trim();
  if (s.startsWith('file://')) {
    try { return fileURLToPath(s); } catch {}
    s = s.replace(/^file:\/+/i, '');
  }
  if (/%[0-9A-Fa-f]{2}/.test(s) && !existsSync(s)) {
    try { s = decodeURIComponent(s); } catch {}
  }
  if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1);
  return s;
}

const metaCache = new Map();
function resolveWorkspaceRoots(convId, clientUris) {
  const roots = [];
  const seen = new Set();
  const addRoot = (p, label) => {
    if (!p) return;
    const norm = resolve(p);
    const key = norm.toLowerCase();
    if (seen.has(key)) return;
    if (existsSync(norm)) {
      seen.add(key);
      roots.push({ path: norm, label: label || basename(norm) || norm });
    }
  };

  if (Array.isArray(clientUris)) {
    for (const u of clientUris) addRoot(uriToFsPath(u));
  }

  const cid = sanitizeConvId(convId || app.config.conversationId);
  if (roots.length === 0 && cid) {
    let cached = metaCache.get(cid);
    if (!cached || Date.now() - cached.ts > 10000) {
      try {
        const md = app.getConversationMetadata(cid);
        const uris = md?.response?.conversationMetadata?.metadata?.workspaceUris
          || md?.conversationMetadata?.metadata?.workspaceUris
          || [];
        cached = { ts: Date.now(), uris };
        metaCache.set(cid, cached);
      } catch {
        cached = { ts: Date.now(), uris: [] };
      }
    }
    for (const u of cached.uris) addRoot(uriToFsPath(u));
  }

  if (cid) {
    const brainDir = join(resolveAppDataDir(), 'brain', cid);
    addRoot(brainDir, '对话 Artifacts / 上传文件');
  }

  return roots;
}

function resolveFilePath(rawPath, convId, clientUris) {
  const input = String(rawPath || '').trim();
  if (!input) return null;
  const cleaned = uriToFsPath(input) || input;
  if (isAbsolute(cleaned)) {
    const abs = resolve(cleaned);
    return existsSync(abs) ? abs : null;
  }
  const roots = resolveWorkspaceRoots(convId, clientUris);
  for (const r of roots) {
    const candidate = resolve(r.path, cleaned);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function listImmediateDirectory(roots, dirPath) {
  if (!dirPath) {
    // If there is exactly 1 primary workspace root (+ optional brain root), auto-enter the primary workspace root
    // while also exposing roots list so user can switch between workspace and artifacts.
    if (roots.length === 0) {
      return { roots, currentDir: null, parentDir: null, entries: [] };
    }
    const targetDir = roots[0].path;
    return listImmediateDirectory(roots, targetDir);
  }

  const absDir = resolve(dirPath);
  if (!existsSync(absDir)) {
    throw new Error(`目录不存在: ${absDir}`);
  }
  const rawEntries = readdirSync(absDir, { withFileTypes: true });
  const dirs = [];
  const files = [];
  for (const ent of rawEntries) {
    if (ent.name.startsWith('.system_generated')) continue;
    const full = join(absDir, ent.name);
    if (ent.isDirectory()) {
      dirs.push({
        isDir: true,
        name: ent.name,
        path: full,
        kind: 'dir',
        ext: '',
        size: 0,
      });
    } else if (ent.isFile()) {
      let size = 0;
      try { size = statSync(full).size; } catch {}
      files.push({
        isDir: false,
        name: ent.name,
        path: full,
        kind: classifyExtension(ent.name),
        ext: extname(ent.name).toLowerCase(),
        size,
      });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const matchedRoot = roots.find((r) => absDir.toLowerCase() === r.path.toLowerCase()
    || absDir.toLowerCase().startsWith(r.path.toLowerCase() + '\\')
    || absDir.toLowerCase().startsWith(r.path.toLowerCase() + '/'));
  const atRoot = Boolean(matchedRoot && absDir.toLowerCase() === matchedRoot.path.toLowerCase());
  const parentDir = atRoot ? null : dirname(absDir);

  return {
    roots,
    currentDir: absDir,
    currentRoot: matchedRoot || null,
    parentDir: parentDir && parentDir !== absDir ? parentDir : null,
    entries: [...dirs, ...files],
  };
}

function matchesCategory(kind, cat) {
  if (!cat || cat === 'all') return true;
  if (cat === 'docs') return DOC_KINDS.has(kind);
  if (cat === 'sheet') return kind === 'spreadsheet';
  if (cat === 'slide') return kind === 'pptx' || kind === 'odp';
  if (cat === 'data') return DATA_KINDS.has(kind);
  if (cat === 'media') return MEDIA_KINDS.has(kind);
  if (cat === 'code') return kind === 'code' || kind === 'html';
  return true;
}

function searchWorkspaceTree(roots, query, category = 'all', maxResults = 300) {
  const q = String(query || '').trim().toLowerCase();
  const results = [];
  const deadline = Date.now() + 2500;
  let scanned = 0;
  let truncated = false;

  for (const root of roots) {
    const queue = [root.path];
    while (queue.length > 0) {
      if (results.length >= maxResults || Date.now() > deadline || scanned > 200000) {
        truncated = true;
        break;
      }
      const dir = queue.shift();
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        scanned++;
        if (ent.name.startsWith('.system_generated')) continue;
        const full = join(dir, ent.name);
        const rel = relative(root.path, full).replace(/\\/g, '/');
        if (ent.isDirectory()) {
          if (SKIP_DIRS.has(ent.name)) continue;
          if (q && (category === 'all') && (ent.name.toLowerCase().includes(q) || rel.toLowerCase().includes(q))) {
            results.push({
              isDir: true,
              name: ent.name,
              path: full,
              relPath: rel,
              rootLabel: root.label,
              kind: 'dir',
              ext: '',
              size: 0,
            });
          }
          queue.push(full);
        } else if (ent.isFile()) {
          const kind = classifyExtension(ent.name);
          if (!matchesCategory(kind, category)) continue;
          if (q && !ent.name.toLowerCase().includes(q) && !rel.toLowerCase().includes(q)) continue;
          let size = 0;
          try { size = statSync(full).size; } catch {}
          results.push({
            isDir: false,
            name: ent.name,
            path: full,
            relPath: rel,
            rootLabel: root.label,
            kind,
            ext: extname(ent.name).toLowerCase(),
            size,
          });
        }
        if (results.length >= maxResults) {
          truncated = true;
          break;
        }
      }
    }
  }
  return { roots, entries: results, truncated, scanned };
}

function registerStaticAssets() {
  app.page('/', () => readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf-8'));
  app.api('/styles.css', () => new Response(readFileSync(join(PUBLIC_DIR, 'styles.css'), 'utf-8'), {
    contentType: 'text/css; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' },
  }), 'GET');
  app.api('/app.js', () => new Response(readFileSync(join(PUBLIC_DIR, 'app.js'), 'utf-8'), {
    contentType: 'application/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' },
  }), 'GET');

  const serveFile = (route, filePath, contentType) => {
    if (!existsSync(filePath)) return;
    app.api(route, () => new Response(readFileSync(filePath), {
      contentType,
      headers: {
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    }), 'GET');
  };

  serveFile('/vendor/jszip.min.js', join(NM_DIR, 'jszip', 'dist', 'jszip.min.js'), 'application/javascript; charset=utf-8');
  serveFile('/vendor/docx-preview.min.js', join(NM_DIR, 'docx-preview', 'dist', 'docx-preview.min.js'), 'application/javascript; charset=utf-8');
  serveFile('/vendor/modern-screenshot.js', join(NM_DIR, 'modern-screenshot', 'dist', 'index.js'), 'application/javascript; charset=utf-8');
  serveFile('/vendor/pdfjs/pdf.min.mjs', join(NM_DIR, 'pdfjs-dist', 'legacy', 'build', 'pdf.min.mjs'), 'application/javascript; charset=utf-8');
  serveFile('/vendor/pdfjs/pdf.worker.min.mjs', join(NM_DIR, 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs'), 'application/javascript; charset=utf-8');
  serveFile('/vendor/pdfjs/pdf_viewer.css', join(NM_DIR, 'pdfjs-dist', 'web', 'pdf_viewer.css'), 'text/css; charset=utf-8');

  const walkVendorDir = (diskDir, routePrefix) => {
    if (!existsSync(diskDir)) return;
    for (const ent of readdirSync(diskDir, { withFileTypes: true })) {
      const full = join(diskDir, ent.name);
      const nextRoute = `${routePrefix}/${ent.name}`;
      if (ent.isDirectory()) {
        walkVendorDir(full, nextRoute);
      } else if (ent.isFile()) {
        const ext = extname(ent.name).toLowerCase();
        const ct = ext === '.js' || ext === '.mjs' ? 'application/javascript; charset=utf-8'
          : ext === '.css' ? 'text/css; charset=utf-8'
          : ext === '.wasm' ? 'application/wasm'
          : ext === '.svg' ? 'image/svg+xml'
          : ext === '.png' ? 'image/png'
          : 'application/octet-stream';
        serveFile(nextRoute, full, ct);
      }
    }
  };

  walkVendorDir(join(NM_DIR, 'pdfjs-dist', 'cmaps'), '/vendor/pdfjs/cmaps');
  walkVendorDir(join(NM_DIR, 'pdfjs-dist', 'standard_fonts'), '/vendor/pdfjs/standard_fonts');
  walkVendorDir(join(NM_DIR, 'pdfjs-dist', 'iccs'), '/vendor/pdfjs/iccs');
  walkVendorDir(join(NM_DIR, 'pdfjs-dist', 'wasm'), '/vendor/pdfjs/wasm');
  walkVendorDir(join(NM_DIR, 'pdfjs-dist', 'web', 'images'), '/vendor/pdfjs/images');
}

async function renderBufferPreview(buf, fileName, opts = {}) {
  const ext = extname(fileName).toLowerCase();
  const kind = classifyExtension(fileName);
  const size = buf.length;

  if (kind === 'pdf' || kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'font') {
    return { kind, ext, fileName, size, binary: true };
  }

  if (kind === 'docx') {
    const reader = await parseDocxReader(buf);
    return { kind, ext, fileName, size, readerHtml: reader.html, messages: reader.messages };
  }

  if (kind === 'odt') {
    const res = await parseOdt(buf);
    return { kind, ext, fileName, size, html: res.html };
  }

  if (kind === 'rtf') {
    const res = parseRtf(buf);
    return { kind, ext, fileName, size, html: res.html };
  }

  if (kind === 'doc_legacy') {
    const res = parseLegacyDoc(buf);
    return { kind, ext, fileName, size, text: res.text };
  }

  if (kind === 'spreadsheet') {
    return { kind, ext, fileName, size, ...parseWorkbook(buf, ext, opts) };
  }

  if (kind === 'pptx') {
    return { kind, ext, fileName, size, ...(await parsePptx(buf)) };
  }

  if (kind === 'odp') {
    return { kind, ext, fileName, size, ...(await parseOdp(buf)) };
  }

  if (kind === 'epub') {
    return { kind, ext, fileName, size, ...(await parseEpub(buf, opts)) };
  }

  if (kind === 'archive') {
    if (opts.archiveEntry) {
      const entryBuf = await readArchiveEntry(buf, opts.archiveEntry);
      if (entryBuf.length > 25 * 1024 * 1024) {
        throw new Error('压缩包内单个文件超过 25 MB，暂不支持直接展开预览');
      }
      return {
        archiveParent: fileName,
        archiveEntry: opts.archiveEntry,
        nested: await renderBufferPreview(entryBuf, basename(opts.archiveEntry), {
          ...opts,
          archiveEntry: undefined,
        }),
      };
    }
    return { kind, ext, fileName, size, ...(await listArchiveEntries(buf)) };
  }

  if (kind === 'binary') {
    return { kind, ext, fileName, size, note: '二进制可执行文件或专有压缩格式，不支持文本预览。' };
  }

  const sliced = buf.length > MAX_TEXT_BYTES ? buf.subarray(0, MAX_TEXT_BYTES) : buf;
  const truncated = buf.length > MAX_TEXT_BYTES;
  const { text, encoding } = decodeTextBuffer(sliced);

  if (kind === 'markdown') {
    const md = renderMarkdownHtml(text);
    return { kind, ext, fileName, size, encoding, truncated, html: md.html, toc: md.toc, rawText: text };
  }

  if (kind === 'html') {
    const code = highlightCode(text, ext, fileName);
    return { kind, ext, fileName, size, encoding, truncated, htmlContent: text, code };
  }

  if (kind === 'svg') {
    const code = highlightCode(text, ext, fileName);
    return { kind, ext, fileName, size, encoding, truncated, svgContent: text, code };
  }

  if (kind === 'ipynb') {
    return { kind, ext, fileName, size, encoding, truncated, ...parseIpynb(text) };
  }

  if (kind === 'structured') {
    return { kind, ext, fileName, size, encoding, truncated, ...parseStructured(text, ext) };
  }

  const code = highlightCode(text, ext, fileName);
  return { kind: 'code', ext, fileName, size, encoding, truncated, rawText: text, ...code };
}

registerStaticAssets();

app.api('/api/dir', (data) => {
  const convId = sanitizeConvId(data.conversationId || app.config.conversationId);
  const roots = resolveWorkspaceRoots(convId, data.workspaceUris);
  return listImmediateDirectory(roots, data.dirPath || null);
}, 'POST');

app.api('/api/search', (data) => {
  const convId = sanitizeConvId(data.conversationId || app.config.conversationId);
  const roots = resolveWorkspaceRoots(convId, data.workspaceUris);
  return searchWorkspaceTree(roots, data.query || '', data.category || 'all');
}, 'POST');

app.api('/api/tree', (data) => {
  const convId = sanitizeConvId(data.conversationId || app.config.conversationId);
  const roots = resolveWorkspaceRoots(convId, data.workspaceUris);
  return searchWorkspaceTree(roots, '', 'all', 500);
}, 'POST');

app.api('/api/target', (data) => {
  const convId = sanitizeConvId(data.conversationId || app.config.conversationId);
  const stateDir = getStateDir();
  const candidates = [];
  if (convId) candidates.push(join(stateDir, `${convId}.json`));
  candidates.push(join(stateDir, 'latest.json'));

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const target = JSON.parse(readFileSync(file, 'utf-8'));
      if (target?.path && existsSync(target.path)) {
        return { target };
      }
    } catch {}
  }
  return { target: null };
}, 'POST');

app.api('/api/preview', async (data) => {
  const convId = sanitizeConvId(data.conversationId || app.config.conversationId);
  const resolved = resolveFilePath(data.path, convId, data.workspaceUris);
  if (!resolved) {
    return new Response(JSON.stringify({ error: `找不到文件: ${data.path || ''}` }), {
      contentType: 'application/json',
      status: 404,
    });
  }
  const st = statSync(resolved);
  if (!st.isFile()) {
    return new Response(JSON.stringify({ error: '目标路径不是文件' }), {
      contentType: 'application/json',
      status: 400,
    });
  }

  const fileName = basename(resolved);
  const ext = extname(fileName).toLowerCase();
  const kind = classifyExtension(fileName);

  if (kind === 'sqlite') {
    const meta = parseSqliteMeta(resolved);
    const activeTable = data.table || meta.tables[0]?.name || '';
    const tableData = activeTable ? querySqliteTable(resolved, activeTable, {
      page: data.page,
      pageSize: data.pageSize,
    }) : null;
    return {
      kind,
      ext,
      fileName,
      path: resolved,
      size: st.size,
      mtime: st.mtimeMs,
      ...meta,
      tableData,
    };
  }

  if (st.size > MAX_PREVIEW_BYTES) {
    return {
      kind: 'too_large',
      ext,
      fileName,
      path: resolved,
      size: st.size,
      error: `文件过大 (${(st.size / 1024 / 1024).toFixed(1)} MB)，超过单次 80 MB 预览上限`,
    };
  }

  if (kind === 'pdf' || kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'font') {
    return {
      kind,
      ext,
      fileName,
      path: resolved,
      size: st.size,
      mtime: st.mtimeMs,
      binary: true,
    };
  }

  const buf = readFileSync(resolved);
  const payload = await renderBufferPreview(buf, fileName, data);
  return { path: resolved, mtime: st.mtimeMs, ...payload };
}, 'POST');

app.api('/api/raw', async (data) => {
  const convId = sanitizeConvId(data.conversationId || app.config.conversationId);
  const resolved = resolveFilePath(data.path, convId, data.workspaceUris);
  if (!resolved) {
    return new Response(JSON.stringify({ error: 'File not found' }), {
      contentType: 'application/json',
      status: 404,
    });
  }
  const st = statSync(resolved);
  if (!st.isFile() || st.size > MAX_PREVIEW_BYTES) {
    return new Response(JSON.stringify({ error: 'Invalid or oversized file' }), {
      contentType: 'application/json',
      status: 400,
    });
  }
  let buf = readFileSync(resolved);
  let targetName = resolved;
  if (data.archiveEntry) {
    buf = await readArchiveEntry(buf, data.archiveEntry);
    targetName = data.archiveEntry;
  }
  return new Response(buf, {
    contentType: mimeForExt(extname(targetName)),
    headers: { 'Cache-Control': 'no-store' },
  });
}, 'POST');

app.api('/api/upload-preview', async (data) => {
  const fileName = String(data.fileName || 'uploaded');
  const b64 = String(data.base64 || '');
  if (!b64) {
    return new Response(JSON.stringify({ error: 'Missing file payload' }), {
      contentType: 'application/json',
      status: 400,
    });
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > 40 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: '拖拽文件超过 40 MB 上限' }), {
      contentType: 'application/json',
      status: 413,
    });
  }
  const payload = await renderBufferPreview(buf, fileName, data);
  return { path: `dropped://${fileName}`, dropped: true, ...payload };
}, 'POST');

app.api('/api/reveal', (data) => {
  const convId = sanitizeConvId(data.conversationId || app.config.conversationId);
  const resolved = resolveFilePath(data.path, convId, data.workspaceUris);
  if (!resolved) {
    return new Response(JSON.stringify({ error: 'File not found' }), {
      contentType: 'application/json',
      status: 404,
    });
  }
  if (process.platform === 'win32') {
    execFile('explorer.exe', [`/select,${resolved}`], () => {});
  }
  return { ok: true };
}, 'POST');

app.api('/api/save-clips', (data) => {
  const convId = sanitizeConvId(data.conversationId || app.config.conversationId);
  const clips = Array.isArray(data.clips) ? data.clips.slice(0, 30) : [];
  const baseDir = convId
    ? join(resolveAppDataDir(), 'brain', convId, 'scratch', 'doc_viewer_clips')
    : join(getStateDir(), 'clips');
  mkdirSync(baseDir, { recursive: true });
  const stamp = Date.now();
  const saved = [];
  for (let i = 0; i < clips.length; i++) {
    const item = clips[i];
    const raw = typeof item?.dataUrl === 'string' ? item.dataUrl : '';
    const m = raw.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!m) {
      saved.push(null);
      continue;
    }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 10 * 1024 * 1024) {
      saved.push(null);
      continue;
    }
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const safeTag = String(item?.id || i + 1).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || String(i + 1);
    const outPath = join(baseDir, `clip_${stamp}_${safeTag}.${ext}`);
    writeFileSync(outPath, buf);
    saved.push(outPath);
  }
  return { paths: saved };
}, 'POST');

app.run();
