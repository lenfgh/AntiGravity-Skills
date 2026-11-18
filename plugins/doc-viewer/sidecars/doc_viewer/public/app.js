(() => {
  let pdfjsLibPromise = null;
  function loadPdfJs() {
    if (!pdfjsLibPromise) {
      pdfjsLibPromise = (async () => {
        try {
          const mod = await import('/vendor/pdfjs/pdf.min.mjs');
          mod.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
          return mod;
        } catch {
          const [libRes, wrkRes] = await Promise.all([
            fetch('/vendor/pdfjs/pdf.min.mjs'),
            fetch('/vendor/pdfjs/pdf.worker.min.mjs'),
          ]);
          const [libCode, wrkCode] = await Promise.all([libRes.text(), wrkRes.text()]);
          const libUrl = URL.createObjectURL(new Blob([libCode], { type: 'application/javascript' }));
          const wrkUrl = URL.createObjectURL(new Blob([wrkCode], { type: 'application/javascript' }));
          const mod = await import(libUrl);
          mod.GlobalWorkerOptions.workerSrc = wrkUrl;
          return mod;
        }
      })();
    }
    return pdfjsLibPromise;
  }

  const $ = (id) => document.getElementById(id);
  const el = {
    btnDrawer: $('btn-drawer'),
    btnDrawerClose: $('btn-drawer-close'),
    btnTreeRefresh: $('btn-tree-refresh'),
    drawer: $('drawer'),
    treeSearch: $('tree-search'),
    treeFilters: $('tree-filters'),
    treeMeta: $('tree-meta'),
    treeCrumbs: $('tree-crumbs'),
    treeList: $('tree-list'),
    filePill: $('file-pill'),
    kindBadge: $('kind-badge'),
    fileTitle: $('file-title'),
    btnPathToggle: $('btn-path-toggle'),
    pathBar: $('path-bar'),
    pathInput: $('path-input'),
    btnPathGo: $('btn-path-go'),
    btnPickFile: $('btn-pick-file'),
    nativeFileInput: $('native-file-input'),
    btnReveal: $('btn-reveal'),
    btnRefresh: $('btn-refresh'),
    btnSnip: $('btn-snip'),
    subbar: $('subbar'),
    stage: $('stage'),
    welcome: $('welcome'),
    viewer: $('viewer'),
    btnWelcomeBrowse: $('btn-welcome-browse'),
    btnWelcomePick: $('btn-welcome-pick'),
    dropOverlay: $('drop-overlay'),
    selectionBar: $('selection-bar'),
    selectionPreview: $('selection-preview'),
    btnSelQueue: $('btn-sel-queue'),
    btnSelSend: $('btn-sel-send'),
    btnSelCopy: $('btn-sel-copy'),
    snipLayer: $('snip-layer'),
    snipRect: $('snip-rect'),
    snipDim: $('snip-dim'),
    reqModal: $('req-modal'),
    reqModalTitle: $('req-modal-title'),
    reqModalLoc: $('req-modal-loc'),
    reqThumbWrap: $('req-thumb-wrap'),
    reqThumb: $('req-thumb'),
    reqQuoteDetails: $('req-quote-details'),
    reqQuoteInput: $('req-quote-input'),
    reqNoteInput: $('req-note-input'),
    reqKeepSnip: $('req-keep-snip'),
    btnReqAdd: $('btn-req-add'),
    btnReqSendNow: $('btn-req-send-now'),
    btnReqCancel: $('btn-req-cancel'),
    reqDock: $('req-dock'),
    reqQueuePanel: $('req-queue-panel'),
    reqQueueList: $('req-queue-list'),
    btnReqToggle: $('btn-req-toggle'),
    btnReqCollapse: $('btn-req-collapse'),
    reqCount: $('req-count'),
    reqChevron: $('req-chevron'),
    btnReqClear: $('btn-req-clear'),
    btnReqCopyAll: $('btn-req-copy-all'),
    btnReqSendAll: $('btn-req-send-all'),
    toast: $('toast'),
  };

  const DOC_KINDS = new Set(['pdf', 'docx', 'odt', 'rtf', 'doc_legacy', 'epub', 'markdown']);
  const DATA_KINDS = new Set(['ipynb', 'structured', 'sqlite']);
  const MEDIA_KINDS = new Set(['image', 'audio', 'video', 'font', 'svg']);

  const state = {
    convId: window.sidecar?.conversationId || new URLSearchParams(location.search).get('conversationId') || '',
    workspaceUris: [],
    treeEntries: [],
    treeRoots: [],
    currentDir: null,
    currentRoot: null,
    parentDir: null,
    searchMode: false,
    treeTruncated: false,
    treeCategory: 'all',
    currentPath: '',
    currentData: null,
    droppedFile: null,
    droppedBuffer: null,
    activeObjectUrls: [],
    lastTargetSeq: 0,
    pdfDoc: null,
    pdfObserver: null,
    pdfZoom: 'fit',
    docxMode: 'layout',
    docxZoom: 'fit',
    docxResizeObserver: null,
    showSource: false,
    codeWrap: false,
    epubFontSize: 14,
    archiveEntry: null,
    snipMode: false,
    requests: [],
    nextReqSeq: 1,
    queueExpanded: false,
    pendingSelection: null,
    pendingComposer: null,
  };

  // ---------- Theme sync ----------
  function syncTheme() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background,#f7f7f8)';
    document.documentElement.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const nums = (c.match(/[\d.]+/g) || []).map(Number);
    if (nums.length >= 3) {
      const scale = c.startsWith('color(') ? 1 : 255;
      const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      document.documentElement.dataset.theme = lum < 0.5 ? 'dark' : 'light';
    }
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  // ---------- Helpers ----------
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function fmtSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function apiFetch(url, bodyObj) {
    const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
    return f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.convId,
        workspaceUris: state.workspaceUris,
        ...bodyObj,
      }),
    });
  }

  async function apiJson(url, bodyObj = {}) {
    const res = await apiFetch(url, bodyObj);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function apiRawBuffer(path, archiveEntry = null) {
    if (state.droppedBuffer && !archiveEntry) {
      return state.droppedBuffer.slice(0);
    }
    const res = await apiFetch('/api/raw', { path, archiveEntry });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.arrayBuffer();
  }

  function cleanupActiveResources() {
    for (const u of state.activeObjectUrls) {
      try { URL.revokeObjectURL(u); } catch {}
    }
    state.activeObjectUrls = [];
    if (state.pdfObserver) {
      state.pdfObserver.disconnect();
      state.pdfObserver = null;
    }
    if (state.pdfDoc) {
      try { state.pdfDoc.destroy(); } catch {}
      state.pdfDoc = null;
    }
    if (state.docxResizeObserver) {
      state.docxResizeObserver.disconnect();
      state.docxResizeObserver = null;
    }
    el.selectionBar.classList.add('hidden');
  }

  function setHeader(fileName, kind, pathStr) {
    const badgeMap = {
      pdf: 'PDF', docx: 'DOCX', odt: 'ODT', rtf: 'RTF', doc_legacy: 'DOC',
      spreadsheet: 'SHEET', pptx: 'PPTX', odp: 'ODP', epub: 'EPUB',
      markdown: 'MD', html: 'HTML', svg: 'SVG', ipynb: 'IPYNB',
      structured: 'DATA', sqlite: 'SQLITE', archive: 'ZIP',
      image: 'IMG', audio: 'AUDIO', video: 'VIDEO', font: 'FONT',
      code: 'CODE', binary: 'BIN', too_large: 'LARGE',
    };
    el.kindBadge.className = `badge badge-${kind || 'empty'}`;
    el.kindBadge.textContent = badgeMap[kind] || 'FILE';
    el.fileTitle.textContent = fileName || '未打开文件';
    el.filePill.title = pathStr || fileName || '';
    const isDiskFile = Boolean(pathStr && !pathStr.startsWith('dropped://'));
    el.btnReveal.classList.toggle('hidden', !isDiskFile);
    el.btnRefresh.classList.toggle('hidden', !pathStr);
    el.btnSnip.classList.toggle('hidden', !pathStr);
    if (!pathStr && state.snipMode) setSnipMode(false);
  }

  function showLoading(msg = '正在解析文件...') {
    el.welcome.classList.add('hidden');
    el.viewer.classList.remove('hidden');
    el.subbar.classList.add('hidden');
    el.subbar.innerHTML = '';
    el.viewer.innerHTML = `<div class="status-box">${esc(msg)}</div>`;
  }

  function showError(msg) {
    el.welcome.classList.add('hidden');
    el.viewer.classList.remove('hidden');
    el.viewer.innerHTML = `<div class="error-box">${esc(msg)}</div>`;
  }

  // ---------- Workspace Directory & Search Drawer ----------
  function renderCrumbs() {
    if (state.searchMode) {
      el.treeCrumbs.innerHTML = '<button type="button" class="crumb-btn" id="btn-back-browse">← 返回目录浏览</button>';
      $('btn-back-browse').onclick = () => {
        el.treeSearch.value = '';
        state.treeCategory = 'all';
        el.treeFilters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === 'all'));
        loadDir(state.currentDir);
      };
      return;
    }

    const parts = [];
    if (state.treeRoots.length > 1) {
      for (const r of state.treeRoots) {
        const active = state.currentRoot?.path === r.path;
        parts.push(`<button type="button" class="crumb-btn" data-dir="${esc(r.path)}" style="${active ? 'font-weight:700;text-decoration:underline' : ''}">${esc(r.label)}</button>`);
      }
      parts.push('<span class="crumb-sep">|</span>');
    }
    if (state.parentDir) {
      parts.push(`<button type="button" class="crumb-btn" data-dir="${esc(state.parentDir)}">↑ 上一级</button><span class="crumb-sep">·</span>`);
    }
    if (state.currentDir && state.currentRoot) {
      const rootPath = state.currentRoot.path;
      let rel = '';
      if (state.currentDir.toLowerCase().startsWith(rootPath.toLowerCase())) {
        rel = state.currentDir.slice(rootPath.length).replace(/^[/\\]+/, '');
      }
      parts.push(`<button type="button" class="crumb-btn" data-dir="${esc(rootPath)}">${esc(state.currentRoot.label)}</button>`);
      if (rel) {
        let acc = rootPath;
        const sep = rootPath.includes('\\') ? '\\' : '/';
        for (const seg of rel.split(/[/\\]+/).filter(Boolean)) {
          acc = acc.endsWith(sep) ? acc + seg : acc + sep + seg;
          parts.push(`<span class="crumb-sep">›</span><button type="button" class="crumb-btn" data-dir="${esc(acc)}">${esc(seg)}</button>`);
        }
      }
    }
    el.treeCrumbs.innerHTML = parts.join('');
    el.treeCrumbs.querySelectorAll('button[data-dir]').forEach((b) => {
      b.onclick = () => loadDir(b.dataset.dir);
    });
  }

  function renderTree() {
    renderCrumbs();
    const entries = state.treeEntries || [];
    if (state.searchMode) {
      el.treeMeta.textContent = `全工作区搜索结果：找到 ${entries.length} 项${state.treeTruncated ? '（结果已截断，可输入更精确关键词）' : ''}`;
    } else {
      el.treeMeta.textContent = `${state.currentDir || '无活动工作区'} — 共 ${entries.length} 项`;
    }

    if (entries.length === 0) {
      el.treeList.innerHTML = '<div class="status-box">当前无匹配项，可切换目录、调整关键词，或在上方直接粘贴路径 / 拖拽文件。</div>';
      return;
    }

    el.treeList.innerHTML = entries.map((f) => {
      if (f.isDir) {
        const sub = f.relPath ? `<div class="tree-item-path">${esc(f.rootLabel)} / ${esc(f.relPath)}</div>` : '';
        return `<button type="button" class="tree-item" data-dir="${esc(f.path)}">
          <span class="badge badge-dir">DIR</span>
          <span class="tree-item-main">
            <div class="tree-item-name">📁 ${esc(f.name)}</div>
            ${sub}
          </span>
        </button>`;
      }
      const active = f.path === state.currentPath ? ' active' : '';
      const sub = f.relPath ? `<div class="tree-item-path">${esc(f.rootLabel)} / ${esc(f.relPath)}</div>` : '';
      return `<button type="button" class="tree-item${active}" data-path="${esc(f.path)}">
        <span class="badge badge-${esc(f.kind)}">${esc(f.ext.slice(1) || f.kind)}</span>
        <span class="tree-item-main">
          <div class="tree-item-name">${esc(f.name)}</div>
          ${sub}
        </span>
        <span class="tree-item-size">${esc(fmtSize(f.size))}</span>
      </button>`;
    }).join('');
  }

  async function loadDir(dirPath = null) {
    state.searchMode = false;
    el.treeMeta.textContent = '正在读取目录...';
    try {
      const res = await apiJson('/api/dir', { dirPath });
      state.treeRoots = res.roots || [];
      state.currentDir = res.currentDir || null;
      state.currentRoot = res.currentRoot || null;
      state.parentDir = res.parentDir || null;
      state.treeEntries = res.entries || [];
      state.treeTruncated = false;
      renderTree();
    } catch (err) {
      el.treeMeta.textContent = `读取失败: ${err.message}`;
    }
  }

  async function runSearch() {
    const q = el.treeSearch.value.trim();
    const cat = state.treeCategory;
    if (!q && cat === 'all') {
      return loadDir(state.currentDir);
    }
    state.searchMode = true;
    el.treeMeta.textContent = '正在跨目录搜索工作区...';
    try {
      const res = await apiJson('/api/search', { query: q, category: cat });
      state.treeRoots = res.roots || [];
      state.treeEntries = res.entries || [];
      state.treeTruncated = Boolean(res.truncated);
      renderTree();
    } catch (err) {
      el.treeMeta.textContent = `搜索失败: ${err.message}`;
    }
  }

  function refreshTree() {
    if (el.treeSearch.value.trim() || state.treeCategory !== 'all') return runSearch();
    return loadDir(state.currentDir);
  }

  function toggleDrawer(open) {
    const next = open ?? el.drawer.classList.contains('hidden');
    el.drawer.classList.toggle('hidden', !next);
    if (next) {
      el.stage.scrollTop = 0;
      el.stage.style.overflow = 'hidden';
      if (state.treeEntries.length === 0) refreshTree();
    } else {
      el.stage.style.overflow = 'auto';
    }
  }

  // ---------- Open & Render Dispatcher ----------
  async function openPath(filePath, opts = {}) {
    if (!filePath) return;
    state.droppedFile = null;
    state.droppedBuffer = null;
    if (!opts.keepArchive) state.archiveEntry = null;
    state.showSource = opts.mode === 'raw';
    if (opts.mode === 'layout' || opts.mode === 'reader') state.docxMode = opts.mode;

    toggleDrawer(false);
    cleanupActiveResources();
    state.currentPath = filePath;
    el.pathInput.value = filePath;
    showLoading(`正在加载 ${filePath.split(/[/\\]/).pop()} ...`);

    try {
      const data = await apiJson('/api/preview', {
        path: filePath,
        archiveEntry: state.archiveEntry,
        sheetIndex: opts.sheetIndex,
        page: opts.page,
        filter: opts.filter,
        chapterIndex: opts.chapterIndex,
        table: opts.table,
      });
      state.currentData = data;
      renderLoadedPayload(data);
    } catch (err) {
      setHeader(filePath.split(/[/\\]/).pop(), 'empty', filePath);
      showError(err.message);
    }
  }

  async function openLocalDroppedFile(file, opts = {}) {
    if (!file) return;
    cleanupActiveResources();
    toggleDrawer(false);
    state.droppedFile = file;
    const buf = await file.arrayBuffer();
    state.droppedBuffer = buf;
    state.currentPath = `dropped://${file.name}`;
    state.archiveEntry = opts.archiveEntry || null;
    el.pathInput.value = '';
    showLoading(`正在解析 ${file.name} ...`);

    const lower = file.name.toLowerCase();
    const ext = lower.includes('.') ? '.' + lower.split('.').pop() : '';

    try {
      if (['.sqlite', '.sqlite3', '.db'].includes(ext)) {
        throw new Error('SQLite 数据库文件需要从磁盘直接打开：请把文件完整路径粘贴到上方路径栏中打开。');
      }
      if (['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.avif', '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus', '.mp4', '.webm', '.mov', '.m4v', '.mkv', '.ttf', '.otf', '.woff', '.woff2'].includes(ext) && !state.archiveEntry) {
        const kind = ext === '.pdf' ? 'pdf'
          : ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus'].includes(ext) ? 'audio'
          : ['.mp4', '.webm', '.mov', '.m4v', '.mkv'].includes(ext) ? 'video'
          : ['.ttf', '.otf', '.woff', '.woff2'].includes(ext) ? 'font'
          : 'image';
        const data = { kind, ext, fileName: file.name, path: state.currentPath, size: file.size, binary: true, dropped: true };
        state.currentData = data;
        renderLoadedPayload(data);
        return;
      }

      if (buf.byteLength > 40 * 1024 * 1024) {
        throw new Error('拖拽文件超过 40 MB 上限，请改用上方路径栏直接打开本地路径。');
      }
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const data = await apiJson('/api/upload-preview', {
        fileName: file.name,
        base64: btoa(binary),
        archiveEntry: state.archiveEntry,
        sheetIndex: opts.sheetIndex,
        page: opts.page,
        filter: opts.filter,
        chapterIndex: opts.chapterIndex,
      });
      state.currentData = data;
      renderLoadedPayload(data);
    } catch (err) {
      setHeader(file.name, 'empty', state.currentPath);
      showError(err.message);
    }
  }

  function renderLoadedPayload(data) {
    el.welcome.classList.add('hidden');
    el.viewer.classList.remove('hidden');
    el.viewer.style.position = 'relative';
    el.subbar.classList.add('hidden');
    el.subbar.innerHTML = '';

    if (data.nested) {
      setHeader(`${data.archiveParent} → ${data.archiveEntry}`, data.nested.kind, state.currentPath);
      renderNestedHeader(data.archiveParent, data.archiveEntry);
      renderByKind({ ...data.nested, path: state.currentPath, archiveEntry: data.archiveEntry }, true);
      renderPins();
      return;
    }

    setHeader(data.fileName, data.kind, data.path || state.currentPath);
    renderByKind(data, false);
    renderPins();
  }

  function renderNestedHeader(parentName, entryName) {
    el.subbar.classList.remove('hidden');
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn btn-sm';
    backBtn.textContent = `← 返回 ${parentName}`;
    backBtn.onclick = () => {
      state.archiveEntry = null;
      if (state.droppedFile) openLocalDroppedFile(state.droppedFile);
      else openPath(state.currentPath);
    };
    const label = document.createElement('span');
    label.className = 'muted';
    label.textContent = entryName;
    el.subbar.append(backBtn, label);
  }

  function renderByKind(data, insideArchive) {
    const k = data.kind;
    if (k === 'pdf') return renderPdf(data, insideArchive);
    if (k === 'docx') return renderDocx(data, insideArchive);
    if (k === 'spreadsheet') return renderSpreadsheet(data);
    if (k === 'pptx') return renderPptx(data);
    if (k === 'odp') return renderOdp(data);
    if (k === 'epub') return renderEpub(data);
    if (k === 'odt' || k === 'rtf') return renderProseHtml(data.html);
    if (k === 'doc_legacy') return renderLegacyDoc(data);
    if (k === 'markdown') return renderMarkdown(data);
    if (k === 'html') return renderHtml(data);
    if (k === 'svg') return renderSvg(data);
    if (k === 'ipynb') return renderNotebook(data);
    if (k === 'structured') return renderStructured(data);
    if (k === 'sqlite') return renderSqlite(data);
    if (k === 'archive') return renderArchive(data);
    if (k === 'image') return renderImage(data, insideArchive);
    if (k === 'audio') return renderAudio(data, insideArchive);
    if (k === 'video') return renderVideo(data, insideArchive);
    if (k === 'font') return renderFont(data, insideArchive);
    if (k === 'binary' || k === 'too_large') {
      el.viewer.innerHTML = `<div class="status-box">${esc(data.error || data.note || '暂不支持预览此文件')}</div>`;
      return;
    }
    return renderCode(data);
  }

  // ---------- PDF Renderer ----------
  async function renderPdf(data, insideArchive) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <button id="pdf-prev" class="btn btn-sm" type="button">上一页</button>
      <input id="pdf-page-num" type="number" min="1" value="1" style="flex:0 0 54px;text-align:center">
      <span id="pdf-page-total" class="muted">/ ?</span>
      <button id="pdf-next" class="btn btn-sm" type="button">下一页</button>
      <span class="seg">
        <button id="pdf-z-out" type="button">-</button>
        <button id="pdf-z-fit" type="button" class="${state.pdfZoom === 'fit' ? 'active' : ''}">适应宽</button>
        <button id="pdf-z-in" type="button">+</button>
      </span>
      <button id="pdf-outline-btn" class="btn btn-sm hidden" type="button">目录</button>
      <input id="pdf-search" type="search" placeholder="PDF内搜索..." style="flex:1 1 110px;max-width:170px">
      <span id="pdf-search-status" class="muted"></span>
    `;

    el.viewer.innerHTML = '<div id="pdf-outline" class="pdf-outline hidden"></div><div id="pdf-container" class="pdf-container"><div class="status-box">正在渲染 PDF...</div></div>';
    const container = $('pdf-container');

    try {
      const pdfjsLib = await loadPdfJs();
      const buf = await apiRawBuffer(data.path, insideArchive ? data.archiveEntry : null);
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buf),
        cMapUrl: '/vendor/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
        iccUrl: '/vendor/pdfjs/iccs/',
        wasmUrl: '/vendor/pdfjs/wasm/',
      });
      const pdfDoc = await loadingTask.promise;
      state.pdfDoc = pdfDoc;
      $('pdf-page-total').textContent = `/ ${pdfDoc.numPages}`;
      $('pdf-page-num').max = String(pdfDoc.numPages);

      const outline = await pdfDoc.getOutline().catch(() => null);
      if (outline && outline.length > 0) {
        const outlineBtn = $('pdf-outline-btn');
        const outlineEl = $('pdf-outline');
        outlineBtn.classList.remove('hidden');
        outlineBtn.onclick = () => outlineEl.classList.toggle('hidden');
        const flat = [];
        const walk = (items, depth) => {
          for (const it of items) {
            flat.push({ title: it.title, dest: it.dest, depth });
            if (it.items?.length) walk(it.items, depth + 1);
          }
        };
        walk(outline, 0);
        outlineEl.innerHTML = flat.slice(0, 200).map((it, i) =>
          `<button type="button" data-idx="${i}" style="padding-left:${8 + it.depth * 14}px">${esc(it.title)}</button>`
        ).join('');
        outlineEl.onclick = async (e) => {
          const b = e.target.closest('button[data-idx]');
          if (!b) return;
          const item = flat[Number(b.dataset.idx)];
          if (!item?.dest) return;
          const destArr = typeof item.dest === 'string' ? await pdfDoc.getDestination(item.dest) : item.dest;
          if (Array.isArray(destArr) && destArr[0]) {
            const pIdx = await pdfDoc.getPageIndex(destArr[0]);
            jumpToPdfPage(pIdx + 1);
          }
        };
      }

      const firstPage = await pdfDoc.getPage(1);
      const baseVp = firstPage.getViewport({ scale: 1 });
      const computeScale = () => {
        if (state.pdfZoom === 'fit') {
          const avail = Math.max(240, el.stage.clientWidth - 32);
          return Math.max(0.4, Math.min(2.5, avail / baseVp.width));
        }
        return state.pdfZoom;
      };

      const renderAllPages = async () => {
        if (state.pdfObserver) state.pdfObserver.disconnect();
        const scale = computeScale();
        container.innerHTML = '';
        const wraps = [];
        for (let p = 1; p <= pdfDoc.numPages; p++) {
          const page = p === 1 ? firstPage : await pdfDoc.getPage(p);
          const vp = page.getViewport({ scale });
          const wrap = document.createElement('div');
          wrap.className = 'pdf-page-wrap';
          wrap.dataset.page = String(p);
          wrap.style.width = `${Math.floor(vp.width)}px`;
          wrap.style.height = `${Math.floor(vp.height)}px`;
          wrap.style.setProperty('--scale-factor', String(vp.scale));
          container.appendChild(wrap);
          wraps.push({ wrap, pageNum: p });
        }

        const rendered = new Set();
        const renderPage = async (wrap, pageNum) => {
          if (rendered.has(pageNum) || state.pdfDoc !== pdfDoc) return;
          rendered.add(pageNum);
          const page = await pdfDoc.getPage(pageNum);
          const vp = page.getViewport({ scale });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width * dpr);
          canvas.height = Math.floor(vp.height * dpr);
          canvas.style.width = `${Math.floor(vp.width)}px`;
          canvas.style.height = `${Math.floor(vp.height)}px`;
          const ctx = canvas.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          wrap.appendChild(canvas);

          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          if (state.pdfDoc !== pdfDoc) return;

          const textDiv = document.createElement('div');
          textDiv.className = 'textLayer';
          pdfjsLib.setLayerDimensions?.(textDiv, vp);
          wrap.appendChild(textDiv);
          const textContent = await page.getTextContent();
          const tl = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textDiv,
            viewport: vp,
          });
          await tl.render();
        };

        state.pdfObserver = new IntersectionObserver((entries) => {
          for (const ent of entries) {
            if (ent.isIntersecting) {
              const pNum = Number(ent.target.dataset.page);
              renderPage(ent.target, pNum);
              $('pdf-page-num').value = String(pNum);
            }
          }
        }, { root: el.stage, rootMargin: '400px 0px' });

        for (const item of wraps) state.pdfObserver.observe(item.wrap);
        renderPins();
      };

      const jumpToPdfPage = (p) => {
        const clamped = Math.max(1, Math.min(pdfDoc.numPages, Number(p) || 1));
        const target = container.querySelector(`.pdf-page-wrap[data-page="${clamped}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          $('pdf-page-num').value = String(clamped);
        }
      };

      $('pdf-prev').onclick = () => jumpToPdfPage(Number($('pdf-page-num').value) - 1);
      $('pdf-next').onclick = () => jumpToPdfPage(Number($('pdf-page-num').value) + 1);
      $('pdf-page-num').onchange = () => jumpToPdfPage($('pdf-page-num').value);
      $('pdf-z-fit').onclick = () => { state.pdfZoom = 'fit'; $('pdf-z-fit').classList.add('active'); renderAllPages(); };
      $('pdf-z-in').onclick = () => {
        const cur = state.pdfZoom === 'fit' ? computeScale() : state.pdfZoom;
        state.pdfZoom = Math.min(3.5, cur * 1.2);
        $('pdf-z-fit').classList.remove('active');
        renderAllPages();
      };
      $('pdf-z-out').onclick = () => {
        const cur = state.pdfZoom === 'fit' ? computeScale() : state.pdfZoom;
        state.pdfZoom = Math.max(0.35, cur / 1.2);
        $('pdf-z-fit').classList.remove('active');
        renderAllPages();
      };

      let searchMatches = [];
      let searchIdx = -1;
      const searchInput = $('pdf-search');
      const searchStatus = $('pdf-search-status');
      searchInput.onkeydown = async (e) => {
        if (e.key !== 'Enter') return;
        const q = searchInput.value.trim().toLowerCase();
        if (!q) { searchStatus.textContent = ''; return; }
        if (searchInput.dataset.lastQ === q && searchMatches.length > 0) {
          searchIdx = (searchIdx + 1) % searchMatches.length;
          jumpToPdfPage(searchMatches[searchIdx]);
          searchStatus.textContent = `${searchIdx + 1}/${searchMatches.length}`;
          return;
        }
        searchInput.dataset.lastQ = q;
        searchMatches = [];
        searchStatus.textContent = '搜索中...';
        for (let p = 1; p <= pdfDoc.numPages; p++) {
          const page = await pdfDoc.getPage(p);
          const tc = await page.getTextContent();
          const txt = tc.items.map((it) => it.str).join(' ').toLowerCase();
          if (txt.includes(q)) searchMatches.push(p);
        }
        if (searchMatches.length === 0) {
          searchStatus.textContent = '无匹配';
        } else {
          searchIdx = 0;
          jumpToPdfPage(searchMatches[0]);
          searchStatus.textContent = `1/${searchMatches.length} (回车下一个)`;
        }
      };

      await renderAllPages();
    } catch (err) {
      showError(`PDF 渲染失败: ${err.message}`);
    }
  }

  // ---------- DOCX Dual-Mode Renderer ----------
  async function renderDocx(data, insideArchive) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <div class="seg">
        <button id="docx-mode-layout" type="button" class="${state.docxMode === 'layout' ? 'active' : ''}">版式视图</button>
        <button id="docx-mode-reader" type="button" class="${state.docxMode === 'reader' ? 'active' : ''}">阅读视图</button>
      </div>
      <span id="docx-zoom-ctrl" class="seg ${state.docxMode === 'reader' ? 'hidden' : ''}">
        <button id="docx-z-out" type="button">-</button>
        <button id="docx-z-fit" type="button" class="${state.docxZoom === 'fit' ? 'active' : ''}">适应宽</button>
        <button id="docx-z-in" type="button">+</button>
      </span>
      <span class="spacer"></span>
      <span class="muted" style="font-size:11px">${esc(fmtSize(data.size))}</span>
    `;

    const drawReader = () => {
      if (state.docxResizeObserver) {
        state.docxResizeObserver.disconnect();
        state.docxResizeObserver = null;
      }
      el.viewer.innerHTML = `<article class="prose-body">${data.readerHtml || ''}</article>`;
      renderPins();
    };

    const drawLayout = async () => {
      if (!window.docx?.renderAsync) {
        drawReader();
        return;
      }
      el.viewer.innerHTML = `<div class="docx-layout-stage"><div id="docx-spacer" style="position:relative;margin:0 auto;"><div id="docx-host" class="docx-scale-outer"></div></div></div>`;
      const host = $('docx-host');
      const spacer = $('docx-spacer');
      try {
        const buf = await apiRawBuffer(data.path, insideArchive ? data.archiveEntry : null);
        await window.docx.renderAsync(buf, host, null, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          useBase64URL: true,
        });

        const applyScale = () => {
          host.style.transform = 'none';
          const pageEl = host.querySelector('section.docx') || host;
          const naturalW = Math.max(pageEl.scrollWidth, host.scrollWidth, 600);
          const naturalH = host.scrollHeight;
          const avail = Math.max(240, el.stage.clientWidth - 24);
          const scale = state.docxZoom === 'fit' ? Math.min(1, avail / naturalW) : state.docxZoom;
          host.style.width = `${naturalW}px`;
          host.style.transform = `scale(${scale})`;
          spacer.style.width = `${Math.floor(naturalW * scale)}px`;
          spacer.style.height = `${Math.floor(naturalH * scale)}px`;
        };
        applyScale();
        state.docxResizeObserver = new ResizeObserver(applyScale);
        state.docxResizeObserver.observe(el.stage);
        renderPins();
      } catch (err) {
        drawReader();
        const banner = document.createElement('div');
        banner.className = 'info-banner';
        banner.textContent = `版式渲染回退至阅读视图 (${err.message})`;
        el.viewer.prepend(banner);
      }
    };

    $('docx-mode-layout').onclick = () => {
      state.docxMode = 'layout';
      $('docx-mode-layout').classList.add('active');
      $('docx-mode-reader').classList.remove('active');
      $('docx-zoom-ctrl').classList.remove('hidden');
      drawLayout();
    };
    $('docx-mode-reader').onclick = () => {
      state.docxMode = 'reader';
      $('docx-mode-reader').classList.add('active');
      $('docx-mode-layout').classList.remove('active');
      $('docx-zoom-ctrl').classList.add('hidden');
      drawReader();
    };
    $('docx-z-fit').onclick = () => { state.docxZoom = 'fit'; $('docx-z-fit').classList.add('active'); drawLayout(); };
    $('docx-z-in').onclick = () => {
      state.docxZoom = state.docxZoom === 'fit' ? 1 : Math.min(2.5, state.docxZoom * 1.15);
      $('docx-z-fit').classList.remove('active');
      drawLayout();
    };
    $('docx-z-out').onclick = () => {
      state.docxZoom = state.docxZoom === 'fit' ? 0.7 : Math.max(0.35, state.docxZoom / 1.15);
      $('docx-z-fit').classList.remove('active');
      drawLayout();
    };

    if (state.docxMode === 'layout') await drawLayout();
    else drawReader();
  }

  // ---------- Spreadsheet Renderer ----------
  function colLabel(idx) {
    let s = '';
    let n = idx;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  }

  function renderSpreadsheet(data) {
    const totalPages = Math.max(1, Math.ceil((data.filteredRows || 0) / (data.pageSize || 200)));
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <input id="sheet-filter" type="search" placeholder="筛选行内容..." value="${esc(data.filter || '')}" style="max-width:180px">
      <button id="sheet-prev" class="btn btn-sm" type="button">‹</button>
      <span class="muted">第 ${(data.page || 0) + 1}/${totalPages} 页 (${data.filteredRows} 行 × ${data.totalCols} 列)</span>
      <button id="sheet-next" class="btn btn-sm" type="button">›</button>
    `;

    const headers = Array.from({ length: data.totalCols }, (_, i) => `<th>${colLabel(i)}</th>`).join('');
    const rowsHtml = (data.rows || []).map((row) => {
      const tds = row.cells.map((cell, ci) => {
        const val = typeof cell === 'object' && cell !== null ? cell.v : cell;
        const f = typeof cell === 'object' && cell !== null ? cell.f : '';
        return `<td data-addr="${colLabel(ci)}${row.rowNum}" data-val="${esc(val)}" data-f="${esc(f)}" title="${esc(f ? `${f}\n${val}` : val)}">${esc(val)}</td>`;
      }).join('');
      return `<tr><td class="row-num">${row.rowNum}</td>${tds}</tr>`;
    }).join('');

    const tabsHtml = (data.sheetNames || []).length > 1
      ? `<div class="sheet-tabs">${data.sheetNames.map((n, i) => `<button type="button" class="sheet-tab${i === data.sheetIndex ? ' active' : ''}" data-sheet="${i}">${esc(n)}</button>`).join('')}</div>`
      : '';

    el.viewer.innerHTML = `
      <div class="sheet-wrap">
        <div id="formula-bar" class="formula-bar muted">点击任意单元格可在此查看完整内容或公式</div>
        <div class="grid-scroll">
          <table class="data-grid">
            <thead><tr><th class="row-num">#</th>${headers}</tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="99" class="status-box">工作表为空或无匹配行</td></tr>'}</tbody>
          </table>
        </div>
        ${tabsHtml}
      </div>
    `;

    const reloadSheet = (opts) => {
      if (state.droppedFile) openLocalDroppedFile(state.droppedFile, opts);
      else openPath(state.currentPath, { ...opts, keepArchive: Boolean(state.archiveEntry) });
    };

    $('sheet-filter').onkeydown = (e) => {
      if (e.key === 'Enter') reloadSheet({ sheetIndex: data.sheetIndex, page: 0, filter: e.target.value });
    };
    $('sheet-prev').onclick = () => {
      if (data.page > 0) reloadSheet({ sheetIndex: data.sheetIndex, page: data.page - 1, filter: $('sheet-filter').value });
    };
    $('sheet-next').onclick = () => {
      if (data.page + 1 < totalPages) reloadSheet({ sheetIndex: data.sheetIndex, page: data.page + 1, filter: $('sheet-filter').value });
    };
    el.viewer.querySelectorAll('.sheet-tab').forEach((btn) => {
      btn.onclick = () => reloadSheet({ sheetIndex: Number(btn.dataset.sheet), page: 0, filter: '' });
    });
    el.viewer.querySelector('tbody').onclick = (e) => {
      const td = e.target.closest('td[data-addr]');
      if (!td) return;
      el.viewer.querySelectorAll('td.cell-selected').forEach((n) => n.classList.remove('cell-selected'));
      td.classList.add('cell-selected');
      const f = td.dataset.f ? `公式: ${td.dataset.f} | 值: ` : '';
      $('formula-bar').textContent = `[${td.dataset.addr}] ${f}${td.dataset.val}`;
      $('formula-bar').classList.remove('muted');
    };
  }

  // ---------- PPTX / ODP Renderer ----------
  function renderPptx(data) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `<span class="muted">共 ${data.slideCount} 页幻灯片</span>`;

    const slidesHtml = (data.slides || []).map((s) => {
      const els = s.elements.map((item) => {
        const style = `left:${item.xPct.toFixed(2)}%;top:${item.yPct.toFixed(2)}%;width:${Math.max(4, item.wPct).toFixed(2)}%;height:${Math.max(4, item.hPct).toFixed(2)}%;`;
        if (item.kind === 'image') {
          return `<div class="slide-el" style="${style}"><img src="${item.dataUri}" alt=""></div>`;
        }
        if (item.kind === 'table') {
          const trs = item.rows.map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #cbd5e1;padding:2px 4px">${esc(c)}</td>`).join('')}</tr>`).join('');
          return `<div class="slide-el" style="${style}overflow:auto;font-size:1.8cqw"><table style="width:100%;border-collapse:collapse">${trs}</table></div>`;
        }
        const bgStyle = item.fill ? `background:${item.fill};border-radius:4px;` : '';
        const paras = item.paragraphs.map((p) => {
          const alignCss = p.align === 'ctr' ? 'text-align:center;' : p.align === 'r' ? 'text-align:right;' : '';
          const padCss = p.lvl > 0 ? `padding-left:${p.lvl * 1.6}cqw;` : '';
          const runsHtml = p.runs.map((r) => {
            const pt = r.sz || 16;
            const cqw = (pt * 0.14).toFixed(2);
            const fw = r.bold ? 'font-weight:700;' : '';
            const fs = r.italic ? 'font-style:italic;' : '';
            const cl = r.color ? `color:${r.color};` : '';
            return `<span style="font-size:${cqw}cqw;line-height:1.25;${fw}${fs}${cl}">${esc(r.text)}</span>`;
          }).join('');
          return `<div style="${alignCss}${padCss}margin-bottom:0.4cqw">${p.hasBullet ? '• ' : ''}${runsHtml}</div>`;
        }).join('');
        return `<div class="slide-el" style="${style}${bgStyle}">${paras}</div>`;
      }).join('');

      const bg = s.bg ? `background:${s.bg};` : '';
      const notes = s.notes ? `<div class="slide-notes"><b>备注：</b>${esc(s.notes)}</div>` : '';
      return `<div class="slide-card">
        <div class="slide-head"><span>第 ${s.index} 页</span></div>
        <div class="slide-canvas" style="aspect-ratio:${s.aspectRatio || 1.777};container-type:inline-size;${bg}">${els}</div>
        ${notes}
      </div>`;
    }).join('');

    el.viewer.innerHTML = `<div class="slides-wrap">${slidesHtml || '<div class="status-box">未检测到幻灯片页</div>'}</div>`;
  }

  function renderOdp(data) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `<span class="muted">共 ${data.slideCount} 页 ODP 幻灯片</span>`;
    el.viewer.innerHTML = `<div class="slides-wrap">${(data.slides || []).map((s) => `
      <div class="slide-card">
        <div class="slide-head"><span>第 ${s.index} 页</span></div>
        <div class="prose-body" style="min-height:140px">${s.html}</div>
      </div>`).join('')}</div>`;
  }

  // ---------- EPUB Renderer ----------
  function renderEpub(data) {
    const chaps = data.chapters || [];
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <button id="epub-prev" class="btn btn-sm" type="button">上一章</button>
      <select id="epub-chap">${chaps.map((c) => `<option value="${c.index}" ${c.index === data.chapterIndex ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
      <button id="epub-next" class="btn btn-sm" type="button">下一章</button>
      <span class="seg">
        <button id="epub-font-dec" type="button">A-</button>
        <button id="epub-font-inc" type="button">A+</button>
      </span>
    `;
    const meta = `<div class="info-banner"><b>${esc(data.title)}</b>${data.author ? ` — ${esc(data.author)}` : ''}</div>`;
    el.viewer.innerHTML = `${meta}<article id="epub-body" class="prose-body" style="font-size:${state.epubFontSize}px">${data.html}</article>`;

    const loadChap = (idx) => {
      const clamped = Math.max(0, Math.min(chaps.length - 1, idx));
      if (state.droppedFile) openLocalDroppedFile(state.droppedFile, { chapterIndex: clamped });
      else openPath(state.currentPath, { chapterIndex: clamped, keepArchive: Boolean(state.archiveEntry) });
    };
    $('epub-chap').onchange = (e) => loadChap(Number(e.target.value));
    $('epub-prev').onclick = () => loadChap(data.chapterIndex - 1);
    $('epub-next').onclick = () => loadChap(data.chapterIndex + 1);
    $('epub-font-dec').onclick = () => { state.epubFontSize = Math.max(11, state.epubFontSize - 1); $('epub-body').style.fontSize = `${state.epubFontSize}px`; };
    $('epub-font-inc').onclick = () => { state.epubFontSize = Math.min(24, state.epubFontSize + 1); $('epub-body').style.fontSize = `${state.epubFontSize}px`; };
  }

  function renderProseHtml(html) {
    el.viewer.innerHTML = `<article class="prose-body">${html || ''}</article>`;
  }

  function renderLegacyDoc(data) {
    el.viewer.innerHTML = `
      <div class="info-banner">旧版二进制 .doc 格式：已自动提取可读文本，完整复杂版式建议另存为 .docx 或在本地 Office 打开。</div>
      <div class="prose-body"><pre style="white-space:pre-wrap;font-family:var(--dv-font);margin:0">${esc(data.text)}</pre></div>
    `;
  }

  // ---------- Markdown / HTML / SVG / Notebook / Structured / Code ----------
  function renderMarkdown(data) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <div class="seg">
        <button id="md-view" type="button" class="${!state.showSource ? 'active' : ''}">预览</button>
        <button id="md-src" type="button" class="${state.showSource ? 'active' : ''}">源码</button>
      </div>
      ${data.toc?.length ? '<button id="md-toc-btn" class="btn btn-sm" type="button">目录大纲</button>' : ''}
      <span class="spacer"></span>
      <span class="muted">${esc(data.encoding || 'UTF-8')}</span>
    `;
    const draw = () => {
      if (state.showSource) {
        renderCodeBody(data.rawText, data.encoding);
      } else {
        const tocHtml = data.toc?.length
          ? `<div id="md-toc" class="pdf-outline hidden">${data.toc.map((h) => `<button type="button" data-id="${esc(h.id)}" style="padding-left:${(h.level - 1) * 12 + 6}px">${esc(h.text)}</button>`).join('')}</div>`
          : '';
        el.viewer.innerHTML = `${tocHtml}<article class="prose-body">${data.html}</article>`;
        if (data.toc?.length) {
          $('md-toc-btn').onclick = () => $('md-toc').classList.toggle('hidden');
          $('md-toc').onclick = (e) => {
            const b = e.target.closest('button[data-id]');
            if (b) el.viewer.querySelector(`#${CSS.escape(b.dataset.id)}`)?.scrollIntoView({ behavior: 'smooth' });
          };
        }
      }
    };
    $('md-view').onclick = () => { state.showSource = false; $('md-view').classList.add('active'); $('md-src').classList.remove('active'); draw(); };
    $('md-src').onclick = () => { state.showSource = true; $('md-src').classList.add('active'); $('md-view').classList.remove('active'); draw(); };
    draw();
  }

  function renderHtml(data) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <div class="seg">
        <button id="html-view" type="button" class="${!state.showSource ? 'active' : ''}">安全预览</button>
        <button id="html-src" type="button" class="${state.showSource ? 'active' : ''}">源码</button>
      </div>
    `;
    const draw = () => {
      if (state.showSource) {
        renderHighlightedHtml(data.code.html, data.code.lines);
      } else {
        el.viewer.innerHTML = `<iframe class="html-frame" sandbox="allow-scripts" srcdoc="${esc(data.htmlContent)}"></iframe>`;
      }
    };
    $('html-view').onclick = () => { state.showSource = false; $('html-view').classList.add('active'); $('html-src').classList.remove('active'); draw(); };
    $('html-src').onclick = () => { state.showSource = true; $('html-src').classList.add('active'); $('html-view').classList.remove('active'); draw(); };
    draw();
  }

  function renderSvg(data) {
    el.subbar.classList.remove('hidden');
    let checker = true;
    el.subbar.innerHTML = `
      <div class="seg">
        <button id="svg-view" type="button" class="${!state.showSource ? 'active' : ''}">图形</button>
        <button id="svg-src" type="button" class="${state.showSource ? 'active' : ''}">源码</button>
      </div>
      <button id="svg-bg" class="btn btn-sm" type="button">切换棋盘底</button>
    `;
    const draw = () => {
      if (state.showSource) {
        renderHighlightedHtml(data.code.html, data.code.lines);
      } else {
        const blob = new Blob([data.svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        state.activeObjectUrls.push(url);
        el.viewer.innerHTML = `<div id="svg-stage" class="media-stage ${checker ? 'checker' : ''}"><img src="${url}" alt="SVG"></div>`;
      }
    };
    $('svg-view').onclick = () => { state.showSource = false; $('svg-view').classList.add('active'); $('svg-src').classList.remove('active'); draw(); };
    $('svg-src').onclick = () => { state.showSource = true; $('svg-src').classList.add('active'); $('svg-view').classList.remove('active'); draw(); };
    $('svg-bg').onclick = () => { checker = !checker; $('svg-stage')?.classList.toggle('checker', checker); };
    draw();
  }

  function renderNotebook(data) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `<span class="muted">Jupyter Notebook · 语言: ${esc(data.lang)} · ${data.cells?.length || 0} 个单元格</span>`;
    const cellsHtml = (data.cells || []).map((c) => {
      if (c.cellType === 'markdown') {
        return `<div class="nb-cell"><div class="prose-body" style="padding:10px 14px">${c.html}</div></div>`;
      }
      if (c.cellType === 'code') {
        const outs = (c.outputs || []).map((o) => {
          if (o.kind === 'image') return `<div class="nb-output"><img src="${o.dataUri}" alt=""></div>`;
          if (o.kind === 'html') return `<div class="nb-output prose-body" style="padding:8px 12px">${o.html}</div>`;
          if (o.kind === 'error') return `<div class="nb-output nb-err"><pre>${esc(o.text)}</pre></div>`;
          return `<div class="nb-output"><pre>${esc(o.text)}</pre></div>`;
        }).join('');
        return `<div class="nb-cell">
          <div class="nb-cell-head">In [${c.executionCount ?? ' '}]:</div>
          <pre><code class="hljs">${c.codeHtml}</code></pre>
          ${outs}
        </div>`;
      }
      return `<div class="nb-cell"><div class="nb-cell-head">${esc(c.cellType)}</div><pre>${esc(c.text)}</pre></div>`;
    }).join('');
    el.viewer.innerHTML = `<div class="nb-wrap">${cellsHtml}</div>`;
  }

  function buildJsonTreeHtml(val, keyName = null, depth = 0) {
    const kHtml = keyName !== null ? `<span class="jt-key">${esc(JSON.stringify(String(keyName)))}</span>: ` : '';
    if (val === null) return `<div>${kHtml}<span class="jt-null">null</span></div>`;
    if (typeof val === 'boolean') return `<div>${kHtml}<span class="jt-bool">${val}</span></div>`;
    if (typeof val === 'number') return `<div>${kHtml}<span class="jt-num">${val}</span></div>`;
    if (typeof val === 'string') return `<div>${kHtml}<span class="jt-str">${esc(JSON.stringify(val))}</span></div>`;

    const isArr = Array.isArray(val);
    const entries = isArr ? val.map((v, i) => [i, v]) : Object.entries(val);
    if (entries.length === 0) {
      return `<div>${kHtml}<span class="muted">${isArr ? '[]' : '{}'}</span></div>`;
    }
    const open = depth < 2;
    const shown = entries.slice(0, 200);
    const more = entries.length > 200 ? `<div class="muted">... 还有 ${entries.length - 200} 项（请切换源码查看全部）</div>` : '';
    return `<details ${open ? 'open' : ''}>
      <summary class="jt-toggle">${kHtml}<span class="muted">${isArr ? `Array(${entries.length})` : `Object(${entries.length})`}</span></summary>
      <div class="jt-node">${shown.map(([k, v]) => buildJsonTreeHtml(v, isArr ? `[${k}]` : k, depth + 1)).join('')}${more}</div>
    </details>`;
  }

  function renderStructured(data) {
    let viewMode = data.parseError ? 'src' : 'tree';
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <div class="seg">
        ${data.data !== null && !data.parseError ? `<button id="st-tree" type="button" class="active">树形视图</button>` : ''}
        <button id="st-src" type="button" class="${viewMode === 'src' ? 'active' : ''}">格式化源码</button>
      </div>
      <span class="spacer"></span>
      <span class="muted">${esc(data.format)} · ${esc(data.encoding || 'UTF-8')}</span>
    `;
    const draw = () => {
      const warn = data.parseError ? `<div class="error-box">结构解析警告: ${esc(data.parseError)}</div>` : '';
      if (viewMode === 'tree' && !data.parseError) {
        el.viewer.innerHTML = `<div class="tree-root">${buildJsonTreeHtml(data.data)}</div>`;
      } else {
        el.viewer.innerHTML = warn;
        renderHighlightedHtml(data.code.html, data.code.lines, Boolean(warn));
      }
    };
    const btnTree = $('st-tree');
    if (btnTree) btnTree.onclick = () => { viewMode = 'tree'; btnTree.classList.add('active'); $('st-src').classList.remove('active'); draw(); };
    $('st-src').onclick = () => { viewMode = 'src'; $('st-src').classList.add('active'); btnTree?.classList.remove('active'); draw(); };
    draw();
  }

  // ---------- SQLite Renderer ----------
  function renderSqlite(data) {
    const tables = data.tables || [];
    const td = data.tableData;
    const totalPages = td ? Math.max(1, Math.ceil(td.total / td.pageSize)) : 1;
    let showSql = false;

    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <select id="db-table">${tables.map((t) => `<option value="${esc(t.name)}" ${td?.tableName === t.name ? 'selected' : ''}>${esc(t.name)} (${t.count >= 0 ? t.count : '?'})</option>`).join('')}</select>
      ${td ? `<button id="db-prev" class="btn btn-sm" type="button">‹</button>
      <span class="muted">${td.page + 1}/${totalPages} (${td.total} 行)</span>
      <button id="db-next" class="btn btn-sm" type="button">›</button>` : ''}
      <button id="db-ddl" class="btn btn-sm" type="button">Schema</button>
    `;

    const draw = () => {
      if (showSql) {
        const cur = tables.find((t) => t.name === td?.tableName) || tables[0];
        el.viewer.innerHTML = `<div class="code-wrap"><pre style="padding:12px 16px;margin:0;white-space:pre-wrap">${esc(cur?.sql || '无建表语句')}</pre></div>`;
        return;
      }
      if (!td) {
        el.viewer.innerHTML = '<div class="status-box">该 SQLite 数据库中未找到表或视图。</div>';
        return;
      }
      const ths = td.cols.map((c) => `<th>${esc(c)}</th>`).join('');
      const trs = td.rows.map((r, i) => `<tr><td class="row-num">${td.page * td.pageSize + i + 1}</td>${r.map((v) => v === null ? '<td class="muted">NULL</td>' : `<td title="${esc(v)}">${esc(v)}</td>`).join('')}</tr>`).join('');
      el.viewer.innerHTML = `<div class="sheet-wrap"><div class="grid-scroll"><table class="data-grid"><thead><tr><th class="row-num">#</th>${ths}</tr></thead><tbody>${trs}</tbody></table></div></div>`;
    };

    $('db-table').onchange = (e) => openPath(state.currentPath, { table: e.target.value, page: 0 });
    $('db-ddl').onclick = () => { showSql = !showSql; draw(); };
    if (td) {
      $('db-prev').onclick = () => { if (td.page > 0) openPath(state.currentPath, { table: td.tableName, page: td.page - 1 }); };
      $('db-next').onclick = () => { if (td.page + 1 < totalPages) openPath(state.currentPath, { table: td.tableName, page: td.page + 1 }); };
    }
    draw();
  }

  // ---------- ZIP Archive Renderer ----------
  function renderArchive(data) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <input id="zip-filter" type="search" placeholder="筛选压缩包内文件..." style="max-width:220px">
      <span class="muted">共 ${data.totalEntries} 项</span>
    `;
    const draw = (q = '') => {
      const ql = q.trim().toLowerCase();
      const items = (data.entries || []).filter((e) => !e.dir && (!ql || e.path.toLowerCase().includes(ql)));
      el.viewer.innerHTML = `<div class="tree-list" style="padding:8px">${items.slice(0, 500).map((it) => `
        <button type="button" class="tree-item" data-entry="${esc(it.path)}">
          <span class="badge">${esc(it.path.includes('.') ? it.path.split('.').pop() : 'FILE')}</span>
          <span class="tree-item-main"><div class="tree-item-name">${esc(it.path)}</div></span>
          <span class="tree-item-size">${esc(fmtSize(it.size))}</span>
        </button>`).join('') || '<div class="status-box">压缩包内无匹配文件</div>'}</div>`;
      el.viewer.querySelectorAll('button[data-entry]').forEach((b) => {
        b.onclick = () => {
          state.archiveEntry = b.dataset.entry;
          if (state.droppedFile) openLocalDroppedFile(state.droppedFile, { archiveEntry: b.dataset.entry });
          else openPath(state.currentPath, { keepArchive: true });
        };
      });
    };
    $('zip-filter').oninput = (e) => draw(e.target.value);
    draw();
  }

  // ---------- Media & Font Renderers ----------
  async function renderImage(data, insideArchive) {
    el.subbar.classList.remove('hidden');
    let checker = true;
    let zoom = 1;
    let fit = true;
    el.subbar.innerHTML = `
      <span class="seg">
        <button id="img-out" type="button">-</button>
        <button id="img-fit" type="button" class="active">适应</button>
        <button id="img-1x" type="button">1:1</button>
        <button id="img-in" type="button">+</button>
      </span>
      <button id="img-bg" class="btn btn-sm" type="button">棋盘底</button>
      <span id="img-dim" class="muted"></span>
    `;
    const buf = await apiRawBuffer(data.path, insideArchive ? data.archiveEntry : null);
    const url = URL.createObjectURL(new Blob([buf]));
    state.activeObjectUrls.push(url);
    el.viewer.innerHTML = `<div id="img-stage" class="media-stage checker"><img id="img-el" src="${url}" alt="${esc(data.fileName)}"></div>`;
    const img = $('img-el');
    const apply = () => {
      if (fit) {
        img.style.maxWidth = '100%';
        img.style.width = '';
      } else {
        img.style.maxWidth = 'none';
        img.style.width = `${Math.round(img.naturalWidth * zoom)}px`;
      }
    };
    img.onload = () => {
      $('img-dim').textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${fmtSize(data.size)}`;
      apply();
    };
    $('img-fit').onclick = () => { fit = true; $('img-fit').classList.add('active'); $('img-1x').classList.remove('active'); apply(); };
    $('img-1x').onclick = () => { fit = false; zoom = 1; $('img-1x').classList.add('active'); $('img-fit').classList.remove('active'); apply(); };
    $('img-in').onclick = () => { fit = false; zoom = Math.min(8, zoom * 1.25); $('img-fit').classList.remove('active'); apply(); };
    $('img-out').onclick = () => { fit = false; zoom = Math.max(0.1, zoom / 1.25); $('img-fit').classList.remove('active'); apply(); };
    $('img-bg').onclick = () => { checker = !checker; $('img-stage').classList.toggle('checker', checker); };
  }

  async function renderAudio(data, insideArchive) {
    const buf = await apiRawBuffer(data.path, insideArchive ? data.archiveEntry : null);
    const url = URL.createObjectURL(new Blob([buf]));
    state.activeObjectUrls.push(url);
    el.viewer.innerHTML = `<div class="media-stage"><div style="margin-bottom:10px;font-weight:500">${esc(data.fileName)}</div><audio controls src="${url}"></audio><div class="muted" style="margin-top:8px">${fmtSize(data.size)}</div></div>`;
  }

  async function renderVideo(data, insideArchive) {
    const buf = await apiRawBuffer(data.path, insideArchive ? data.archiveEntry : null);
    const url = URL.createObjectURL(new Blob([buf]));
    state.activeObjectUrls.push(url);
    el.viewer.innerHTML = `<div class="media-stage"><video controls src="${url}"></video><div class="muted" style="margin-top:8px">${esc(data.fileName)} · ${fmtSize(data.size)}</div></div>`;
  }

  async function renderFont(data, insideArchive) {
    const buf = await apiRawBuffer(data.path, insideArchive ? data.archiveEntry : null);
    const fontName = `PreviewFont_${Date.now()}`;
    const ff = new FontFace(fontName, buf);
    await ff.load();
    document.fonts.add(ff);
    el.viewer.innerHTML = `
      <div class="font-preview">
        <div style="display:flex;align-items:center;gap:10px">
          <label class="muted">字号 <input id="font-sz" type="range" min="12" max="64" value="28"></label>
          <span id="font-sz-val" class="muted">28px</span>
        </div>
        <input id="font-custom" type="text" value="敏捷的棕色狐狸跃过懒狗 · The quick brown fox jumps over the lazy dog 0123456789" style="width:100%;margin-top:10px;height:32px;padding:0 10px;border-radius:6px;border:1px solid var(--dv-border);background:var(--dv-card);color:var(--dv-fg)">
        <div id="font-sample" class="font-sample" style="font-family:'${fontName}',sans-serif;font-size:28px;line-height:1.4">
          敏捷的棕色狐狸跃过懒狗<br>The quick brown fox jumps over the lazy dog<br>ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !@#$%&amp;*()
        </div>
      </div>
    `;
    $('font-sz').oninput = (e) => {
      $('font-sz-val').textContent = `${e.target.value}px`;
      $('font-sample').style.fontSize = `${e.target.value}px`;
    };
    $('font-custom').oninput = (e) => {
      $('font-sample').textContent = e.target.value;
    };
  }

  // ---------- Code / Plain Text Renderer ----------
  function renderHighlightedHtml(htmlStr, linesArr, append = false) {
    const lines = linesArr || String(htmlStr ?? '').split('\n');
    const body = `<div id="code-wrap" class="code-wrap ${state.codeWrap ? 'wrap' : ''}">${lines.map((ln, idx) =>
      `<div class="code-line"><span class="ln">${idx + 1}</span><span class="lc">${ln}</span></div>`
    ).join('')}</div>`;
    if (append) el.viewer.insertAdjacentHTML('beforeend', body);
    else el.viewer.innerHTML = body;
  }

  function renderCodeBody(rawText, encoding) {
    const lines = String(rawText ?? '').split(/\r?\n/).map(esc);
    renderHighlightedHtml(null, lines);
  }

  function renderCode(data) {
    el.subbar.classList.remove('hidden');
    el.subbar.innerHTML = `
      <input id="code-find" type="search" placeholder="文内搜索..." style="max-width:180px">
      <button id="code-wrap-btn" class="btn btn-sm" type="button">${state.codeWrap ? '取消换行' : '自动换行'}</button>
      <span class="spacer"></span>
      <span class="muted">${esc(data.lang || '')} · ${esc(data.encoding || 'UTF-8')}${data.truncated ? ' (已截取前 4 MB)' : ''}</span>
    `;
    renderHighlightedHtml(data.html, data.lines);
    $('code-wrap-btn').onclick = () => {
      state.codeWrap = !state.codeWrap;
      $('code-wrap')?.classList.toggle('wrap', state.codeWrap);
      $('code-wrap-btn').textContent = state.codeWrap ? '取消换行' : '自动换行';
    };
    $('code-find').oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      let firstMatch = null;
      el.viewer.querySelectorAll('.code-line').forEach((row) => {
        const hit = q && row.textContent.toLowerCase().includes(q);
        row.classList.toggle('match', Boolean(hit));
        if (hit && !firstMatch) firstMatch = row;
      });
      firstMatch?.scrollIntoView({ block: 'center' });
    };
  }

  // ---------- Toast, Snip Capture & Multi-Request Queue ----------
  let toastTimer = null;
  function showToast(msg, ms = 3200) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms);
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function computeAnchor(selRect) {
    const groups = [
      ['.pdf-page-wrap', '.pdf-page-wrap'],
      ['section.docx', 'section.docx'],
      ['.slide-card', '.slide-card'],
      ['.nb-cell', '.nb-cell'],
    ];
    for (const [sel] of groups) {
      const nodes = [...el.viewer.querySelectorAll(sel)];
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect();
        if (rectsOverlap(selRect, r)) {
          return {
            selector: sel,
            index: i,
            relX: Math.max(0, (selRect.left - r.left) / Math.max(1, r.width)),
            relY: Math.max(0, (selRect.top - r.top) / Math.max(1, r.height)),
            relW: Math.min(1, selRect.width / Math.max(1, r.width)),
            relH: Math.min(1, selRect.height / Math.max(1, r.height)),
          };
        }
      }
    }
    const vr = el.viewer.getBoundingClientRect();
    return {
      selector: null,
      index: 0,
      relX: Math.max(0, (selRect.left - vr.left) / Math.max(1, vr.width)),
      relY: Math.max(0, (selRect.top - vr.top) / Math.max(1, vr.height)),
      relW: Math.min(1, selRect.width / Math.max(1, vr.width)),
      relH: Math.min(1, selRect.height / Math.max(1, vr.height)),
    };
  }

  function renderPins() {
    el.viewer.querySelectorAll('.doc-pin-box').forEach((n) => n.remove());
    const cur = state.currentPath;
    if (!cur) return;
    const matching = state.requests.filter((r) => r.filePath === cur && r.anchor);
    for (const req of matching) {
      const a = req.anchor;
      const host = a.selector ? el.viewer.querySelectorAll(a.selector)[a.index] : el.viewer;
      if (!host) continue;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const box = document.createElement('div');
      box.className = 'doc-pin-box';
      box.dataset.dvIgnore = '1';
      box.style.left = `${(a.relX * 100).toFixed(3)}%`;
      box.style.top = `${(a.relY * 100).toFixed(3)}%`;
      box.style.width = `${Math.max(1, a.relW * 100).toFixed(3)}%`;
      box.style.height = `${Math.max(1, a.relH * 100).toFixed(3)}%`;
      const tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'doc-pin-tag';
      tag.textContent = `#${req.seq}`;
      tag.title = req.note || `Request #${req.seq}`;
      tag.onclick = (e) => {
        e.stopPropagation();
        state.queueExpanded = true;
        renderQueueDock();
      };
      box.appendChild(tag);
      host.appendChild(box);
    }
  }

  function detectLocationLabel(selRect) {
    const pdfPages = [...el.viewer.querySelectorAll('.pdf-page-wrap[data-page]')]
      .filter((p) => rectsOverlap(selRect, p.getBoundingClientRect()))
      .map((p) => p.dataset.page);
    if (pdfPages.length) {
      return pdfPages.length === 1 ? `第 ${pdfPages[0]} 页` : `第 ${pdfPages[0]}-${pdfPages[pdfPages.length - 1]} 页`;
    }

    const docxSections = [...el.viewer.querySelectorAll('section.docx')];
    if (docxSections.length) {
      const hits = [];
      docxSections.forEach((s, i) => { if (rectsOverlap(selRect, s.getBoundingClientRect())) hits.push(i + 1); });
      if (hits.length) return hits.length === 1 ? `第 ${hits[0]} 页` : `第 ${hits[0]}-${hits[hits.length - 1]} 页`;
    }

    const slideCards = [...el.viewer.querySelectorAll('.slide-card')];
    if (slideCards.length) {
      const hits = [];
      slideCards.forEach((s, i) => { if (rectsOverlap(selRect, s.getBoundingClientRect())) hits.push(i + 1); });
      if (hits.length) return `幻灯片第 ${hits.join(',')} 页`;
    }

    const codeLines = [...el.viewer.querySelectorAll('.code-line')];
    if (codeLines.length) {
      const nums = [];
      codeLines.forEach((row, i) => { if (rectsOverlap(selRect, row.getBoundingClientRect())) nums.push(i + 1); });
      if (nums.length) return nums.length === 1 ? `L${nums[0]}` : `L${nums[0]}-L${nums[nums.length - 1]}`;
    }

    const cells = [...el.viewer.querySelectorAll('table.data-grid td[data-addr]')]
      .filter((td) => rectsOverlap(selRect, td.getBoundingClientRect()))
      .map((td) => td.dataset.addr);
    if (cells.length) {
      const sheetName = state.currentData?.sheetName ? `${state.currentData.sheetName} ` : '';
      return cells.length === 1 ? `${sheetName}${cells[0]}` : `${sheetName}${cells[0]}:${cells[cells.length - 1]}`;
    }

    return el.fileTitle.textContent || '文档选区';
  }

  function extractRegionText(selRect) {
    const walker = document.createTreeWalker(el.viewer, NodeFilter.SHOW_TEXT);
    const parts = [];
    let lastBlock = null;
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parentEl = node.parentElement;
      if (!parentEl || parentEl.closest('[data-dv-ignore], style, script, .ln')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (!rectsOverlap(selRect, r)) continue;
      const blk = parentEl.closest('p, li, h1, h2, h3, h4, h5, h6, tr, .code-line, div.textLayer, .slide-el');
      const txt = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (txt) {
        if (blk && blk !== lastBlock && parts.length > 0) parts.push('\n');
        parts.push(txt);
        lastBlock = blk;
      }
      if (parts.join(' ').length > 2600) break;
    }
    return parts.join(' ').replace(/ *\n */g, '\n').trim().slice(0, 2500);
  }

  function cropDirectMedia(selRect) {
    const pdfCanvases = [...el.viewer.querySelectorAll('.pdf-page-wrap canvas')]
      .filter((c) => rectsOverlap(selRect, c.getBoundingClientRect()));
    const imgEl = $('img-el');
    const targets = pdfCanvases.length ? pdfCanvases
      : (imgEl && rectsOverlap(selRect, imgEl.getBoundingClientRect()) ? [imgEl] : []);
    if (!targets.length) return null;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const outW = Math.max(1, Math.min(1800, Math.round(selRect.width * dpr)));
    const outH = Math.max(1, Math.min(1800, Math.round(selRect.height * dpr)));
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);

    for (const src of targets) {
      const r = src.getBoundingClientRect();
      const ix1 = Math.max(selRect.left, r.left);
      const iy1 = Math.max(selRect.top, r.top);
      const ix2 = Math.min(selRect.right, r.right);
      const iy2 = Math.min(selRect.bottom, r.bottom);
      if (ix2 <= ix1 || iy2 <= iy1) continue;
      const srcW = src.tagName === 'IMG' ? src.naturalWidth : src.width;
      const srcH = src.tagName === 'IMG' ? src.naturalHeight : src.height;
      const sx = ((ix1 - r.left) / Math.max(1, r.width)) * srcW;
      const sy = ((iy1 - r.top) / Math.max(1, r.height)) * srcH;
      const sw = ((ix2 - ix1) / Math.max(1, r.width)) * srcW;
      const sh = ((iy2 - iy1) / Math.max(1, r.height)) * srcH;
      const dx = ((ix1 - selRect.left) / selRect.width) * outW;
      const dy = ((iy1 - selRect.top) / selRect.height) * outH;
      const dw = ((ix2 - ix1) / selRect.width) * outW;
      const dh = ((iy2 - iy1) / selRect.height) * outH;
      ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    return out.toDataURL('image/png');
  }

  async function captureRegionPng(selRect) {
    try {
      const direct = cropDirectMedia(selRect);
      if (direct) return direct;
      if (!window.modernScreenshot?.domToCanvas) return null;

      let targetEl = null;
      for (const sel of ['section.docx', '.slide-card', '.nb-cell', '.prose-body', '.font-preview']) {
        const hits = [...el.viewer.querySelectorAll(sel)].filter((n) => rectsOverlap(selRect, n.getBoundingClientRect()));
        if (hits.length === 1 && hits[0].scrollHeight <= 3600) {
          targetEl = hits[0];
          break;
        }
      }
      if (!targetEl && el.viewer.scrollHeight <= 3600) {
        targetEl = el.viewer;
      }

      if (targetEl) {
        const tRect = targetEl.getBoundingClientRect();
        const bg = getComputedStyle(targetEl).backgroundColor;
        const fullCanvas = await window.modernScreenshot.domToCanvas(targetEl, {
          scale: 1.5,
          backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : getComputedStyle(document.body).backgroundColor,
          filter: (n) => !(n?.dataset?.dvIgnore),
        });
        const rx = Math.max(0, (selRect.left - tRect.left) / Math.max(1, tRect.width));
        const ry = Math.max(0, (selRect.top - tRect.top) / Math.max(1, tRect.height));
        const rw = Math.min(1 - rx, selRect.width / Math.max(1, tRect.width));
        const rh = Math.min(1 - ry, selRect.height / Math.max(1, tRect.height));
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(rw * fullCanvas.width));
        out.height = Math.max(1, Math.round(rh * fullCanvas.height));
        out.getContext('2d').drawImage(
          fullCanvas,
          rx * fullCanvas.width, ry * fullCanvas.height, rw * fullCanvas.width, rh * fullCanvas.height,
          0, 0, out.width, out.height
        );
        return out.toDataURL('image/png');
      }

      // Fallback for very tall documents/tables/code: clone intersecting visible rows/blocks
      const blockSelectors = '.code-line, tr, section.docx, .slide-card, .nb-cell, p, h1, h2, h3, h4, h5, h6, pre, blockquote, ul, ol';
      const blocks = [...el.viewer.querySelectorAll(blockSelectors)]
        .filter((n) => !n.parentElement?.closest(blockSelectors) && rectsOverlap(selRect, n.getBoundingClientRect()));
      if (blocks.length === 0) return null;

      const wrap = document.createElement('div');
      wrap.style.cssText = `position:fixed;left:-20000px;top:0;width:${Math.ceil(selRect.width + 24)}px;padding:10px;background:${getComputedStyle(document.body).backgroundColor};color:${getComputedStyle(document.body).color};font-family:${getComputedStyle(document.body).fontFamily};font-size:13px;`;
      const isTable = blocks[0].tagName === 'TR';
      const holder = isTable ? document.createElement('table') : document.createElement('div');
      if (isTable) holder.className = 'data-grid';
      else if (blocks[0].classList.contains('code-line')) holder.className = 'code-wrap';
      else holder.className = 'prose-body';
      for (const b of blocks.slice(0, 80)) holder.appendChild(b.cloneNode(true));
      wrap.appendChild(holder);
      document.body.appendChild(wrap);
      try {
        const c = await window.modernScreenshot.domToCanvas(wrap, { scale: 1.5 });
        return c.toDataURL('image/png');
      } finally {
        wrap.remove();
      }
    } catch {
      return null;
    }
  }

  function syncSnipLayerBounds() {
    const r = el.stage.getBoundingClientRect();
    el.snipLayer.style.left = `${r.left}px`;
    el.snipLayer.style.top = `${r.top}px`;
    el.snipLayer.style.width = `${r.width}px`;
    el.snipLayer.style.height = `${r.height}px`;
  }

  function setSnipMode(on) {
    state.snipMode = Boolean(on);
    el.btnSnip.classList.toggle('btn-snip-active', state.snipMode);
    el.snipLayer.classList.toggle('hidden', !state.snipMode);
    el.snipRect.classList.add('hidden');
    if (state.snipMode) {
      el.selectionBar.classList.add('hidden');
      syncSnipLayerBounds();
    }
  }

  function openRequestComposer({ locationLabel, text, dataUrl, anchor }) {
    state.pendingComposer = {
      filePath: state.currentPath,
      fileName: el.fileTitle.textContent,
      location: locationLabel || el.fileTitle.textContent,
      quote: text || '',
      dataUrl: dataUrl || null,
      anchor: anchor || null,
    };
    el.reqModalTitle.textContent = `添加 Request (#${state.nextReqSeq})`;
    el.reqModalLoc.textContent = state.pendingComposer.location;
    if (dataUrl) {
      el.reqThumb.src = dataUrl;
      el.reqThumbWrap.classList.remove('hidden');
    } else {
      el.reqThumbWrap.classList.add('hidden');
    }
    if (text) {
      el.reqQuoteInput.value = text;
      el.reqQuoteDetails.classList.remove('hidden');
      el.reqQuoteDetails.open = !dataUrl;
    } else {
      el.reqQuoteInput.value = '';
      el.reqQuoteDetails.classList.add('hidden');
    }
    el.reqNoteInput.value = '';
    el.reqModal.classList.remove('hidden');
    setTimeout(() => el.reqNoteInput.focus(), 20);
  }

  function commitComposerToQueue() {
    if (!state.pendingComposer) return null;
    const note = el.reqNoteInput.value.trim();
    const quote = el.reqQuoteInput.value.trim();
    if (!note && !quote && !state.pendingComposer.dataUrl) {
      showToast('请输入修改要求');
      return null;
    }
    const item = {
      id: `r_${Date.now()}_${state.nextReqSeq}`,
      seq: state.nextReqSeq++,
      ...state.pendingComposer,
      quote,
      note: note || '请结合此处选区内容进行处理/修改。',
    };
    state.requests.push(item);
    state.pendingComposer = null;
    el.reqModal.classList.add('hidden');
    renderPins();
    renderQueueDock();
    if (!el.reqKeepSnip.checked && state.snipMode) setSnipMode(false);
    return item;
  }

  function renderQueueDock() {
    const count = state.requests.length;
    el.reqDock.classList.toggle('hidden', count === 0);
    el.reqCount.textContent = String(count);
    el.btnReqSendAll.textContent = `🚀 一次性发送 (${count})`;
    el.reqQueuePanel.classList.toggle('hidden', !state.queueExpanded || count === 0);
    el.reqChevron.textContent = state.queueExpanded ? '▾' : '▴';
    if (!state.queueExpanded || count === 0) return;

    el.reqQueueList.innerHTML = state.requests.map((r, idx) => `
      <div class="req-item" data-id="${esc(r.id)}">
        <button type="button" class="req-item-num" data-jump="${idx}" title="定位到文档标注位置">#${r.seq}</button>
        ${r.dataUrl ? `<img class="req-item-thumb" src="${r.dataUrl}" alt="截图" data-zoom="${idx}">` : ''}
        <div class="req-item-body">
          <div class="req-item-meta" title="${esc(r.filePath)}">${esc(r.fileName)} · ${esc(r.location)}${r.quote ? ` · “${esc(r.quote.slice(0, 40))}”` : ''}</div>
          <textarea class="req-item-note" rows="2" data-edit="${idx}">${esc(r.note)}</textarea>
        </div>
        <button type="button" class="icon-btn" data-del="${idx}" title="删除此条">✕</button>
      </div>
    `).join('');

    el.reqQueueList.querySelectorAll('textarea[data-edit]').forEach((ta) => {
      ta.oninput = () => {
        const idx = Number(ta.dataset.edit);
        if (state.requests[idx]) state.requests[idx].note = ta.value;
      };
    });
    el.reqQueueList.querySelectorAll('button[data-del]').forEach((b) => {
      b.onclick = () => {
        state.requests.splice(Number(b.dataset.del), 1);
        renderPins();
        renderQueueDock();
      };
    });
    el.reqQueueList.querySelectorAll('button[data-jump]').forEach((b) => {
      b.onclick = async () => {
        const req = state.requests[Number(b.dataset.jump)];
        if (!req) return;
        if (req.filePath && req.filePath !== state.currentPath && !req.filePath.startsWith('dropped://')) {
          await openPath(req.filePath);
        }
        const pin = [...el.viewer.querySelectorAll('.doc-pin-tag')].find((t) => t.textContent === `#${req.seq}`);
        pin?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
  }

  async function formatBatchPrompt(items) {
    let savedPaths = [];
    const hasClips = items.some((r) => Boolean(r.dataUrl));
    if (hasClips) {
      try {
        const res = await apiJson('/api/save-clips', {
          clips: items.map((r) => ({ id: r.seq, dataUrl: r.dataUrl || '' })),
        });
        savedPaths = res.paths || [];
      } catch {}
    }

    const lines = [`请按以下文档中标注的 **${items.length} 处选区 Request** 逐一处理：`];
    items.forEach((r, i) => {
      lines.push(`\n### Request #${i + 1}（\`${r.fileName}\` · ${r.location}）`);
      if (r.filePath && !r.filePath.startsWith('dropped://')) {
        lines.push(`- **文件路径**: \`${r.filePath}\``);
      }
      if (savedPaths[i]) {
        lines.push(`- **选区截图**: \`${savedPaths[i]}\`（请用 \`read_file\` 查看截图细节）`);
      }
      if (r.quote) {
        const qLines = r.quote.split(/\r?\n/).map((l) => `  > ${l}`).join('\n');
        lines.push(`- **选区原文**:\n${qLines}`);
      }
      lines.push(`- **修改/处理要求**: ${r.note}`);
    });
    return lines.join('\n');
  }

  async function deliverRequests(items, clearQueueAfter = true) {
    if (!items.length) return;
    el.btnReqSendAll.disabled = true;
    el.btnReqSendAll.textContent = '发送中...';
    let prompt = '';
    try {
      prompt = await formatBatchPrompt(items);
      if (window.sidecar?.agent?.sendMessage) {
        await window.sidecar.agent.sendMessage(prompt, state.convId || undefined);
        if (clearQueueAfter) {
          state.requests = [];
          state.queueExpanded = false;
          renderPins();
          renderQueueDock();
        }
        setSnipMode(false);
        showToast(`已成功发送 ${items.length} 条 Request 给当前对话 Agent！`);
      } else {
        throw new Error('当前非侧边栏宿主环境');
      }
    } catch (err) {
      if (prompt && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(prompt);
          showToast(`直接发送失败 (${err.message})，已自动复制全部 ${items.length} 条 Request 到剪贴板，请直接粘贴发送`, 5000);
          return;
        } catch {}
      }
      showToast(`发送失败: ${err.message}`, 4500);
    } finally {
      el.btnReqSendAll.disabled = false;
      renderQueueDock();
    }
  }

  // Snip Layer Mouse Events
  let snipStart = null;
  el.snipLayer.addEventListener('wheel', (e) => {
    el.stage.scrollBy(e.deltaX, e.deltaY);
  }, { passive: true });

  el.snipLayer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const lr = el.snipLayer.getBoundingClientRect();
    snipStart = { x: e.clientX - lr.left, y: e.clientY - lr.top, cx: e.clientX, cy: e.clientY };
    el.snipRect.style.left = `${snipStart.x}px`;
    el.snipRect.style.top = `${snipStart.y}px`;
    el.snipRect.style.width = '0px';
    el.snipRect.style.height = '0px';
    el.snipRect.classList.remove('hidden');
  });

  window.addEventListener('mousemove', (e) => {
    if (!snipStart) return;
    const lr = el.snipLayer.getBoundingClientRect();
    const curX = Math.max(0, Math.min(lr.width, e.clientX - lr.left));
    const curY = Math.max(0, Math.min(lr.height, e.clientY - lr.top));
    const left = Math.min(snipStart.x, curX);
    const top = Math.min(snipStart.y, curY);
    const width = Math.abs(curX - snipStart.x);
    const height = Math.abs(curY - snipStart.y);
    el.snipRect.style.left = `${left}px`;
    el.snipRect.style.top = `${top}px`;
    el.snipRect.style.width = `${width}px`;
    el.snipRect.style.height = `${height}px`;
    el.snipDim.textContent = `${Math.round(width)} × ${Math.round(height)}`;
  });

  window.addEventListener('mouseup', async (e) => {
    if (snipStart) {
      const box = el.snipRect.getBoundingClientRect();
      el.snipRect.classList.add('hidden');
      snipStart = null;
      if (box.width >= 10 && box.height >= 10) {
        const locationLabel = detectLocationLabel(box);
        const text = extractRegionText(box);
        const anchor = computeAnchor(box);
        const dataUrl = await captureRegionPng(box);
        openRequestComposer({ locationLabel, text, dataUrl, anchor });
      }
      return;
    }

    if (state.snipMode || !state.currentPath) return;
    if (e.target.closest('#selection-bar, #req-modal, #req-dock, #drawer, .topbar')) return;
    const selObj = window.getSelection();
    const sel = selObj?.toString().trim() || '';
    if (!sel || selObj.rangeCount === 0) {
      el.selectionBar.classList.add('hidden');
      state.pendingSelection = null;
      return;
    }
    const range = selObj.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    state.pendingSelection = {
      text: sel.slice(0, 2500),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      location: detectLocationLabel(rect),
      anchor: rect.width > 2 && rect.height > 2 ? computeAnchor(rect) : null,
    };
    el.selectionPreview.textContent = `已选 (${state.pendingSelection.location})：${sel.slice(0, 60)}${sel.length > 60 ? '…' : ''}`;
    el.selectionBar.classList.remove('hidden');
  });

  el.btnSnip.onclick = () => setSnipMode(!state.snipMode);
  window.addEventListener('resize', () => { if (state.snipMode) syncSnipLayerBounds(); });

  el.btnSelQueue.onclick = async () => {
    const ps = state.pendingSelection;
    if (!ps) return;
    el.selectionBar.classList.add('hidden');
    let dataUrl = null;
    if (ps.rect.width >= 12 && ps.rect.height >= 12) {
      dataUrl = await captureRegionPng(ps.rect);
    }
    el.reqKeepSnip.checked = false;
    openRequestComposer({ locationLabel: ps.location, text: ps.text, dataUrl, anchor: ps.anchor });
  };

  el.btnSelSend.onclick = async () => {
    const ps = state.pendingSelection;
    if (!ps) return;
    el.selectionBar.classList.add('hidden');
    let dataUrl = null;
    if (ps.rect.width >= 12 && ps.rect.height >= 12) {
      dataUrl = await captureRegionPng(ps.rect);
    }
    el.reqKeepSnip.checked = false;
    openRequestComposer({ locationLabel: ps.location, text: ps.text, dataUrl, anchor: ps.anchor });
  };

  el.btnSelCopy.onclick = async () => {
    const ps = state.pendingSelection;
    if (!ps) return;
    const quote = `\`${el.fileTitle.textContent}\` (${ps.location}):\n> ${ps.text.replace(/\n/g, '\n> ')}`;
    try {
      await navigator.clipboard.writeText(quote);
      showToast('已复制选区引用内容');
    } catch {}
    el.selectionBar.classList.add('hidden');
  };

  el.btnReqCancel.onclick = () => {
    state.pendingComposer = null;
    el.reqModal.classList.add('hidden');
  };
  el.btnReqAdd.onclick = () => commitComposerToQueue();
  el.btnReqSendNow.onclick = () => {
    const item = commitComposerToQueue();
    if (item) {
      state.requests.pop();
      renderPins();
      renderQueueDock();
      deliverRequests([item], false);
    }
  };
  el.reqNoteInput.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      commitComposerToQueue();
    }
  };

  el.btnReqToggle.onclick = () => { state.queueExpanded = !state.queueExpanded; renderQueueDock(); };
  el.btnReqCollapse.onclick = () => { state.queueExpanded = false; renderQueueDock(); };
  el.btnReqClear.onclick = () => {
    state.requests = [];
    state.queueExpanded = false;
    renderPins();
    renderQueueDock();
  };
  el.btnReqCopyAll.onclick = async () => {
    if (!state.requests.length) return;
    const prompt = await formatBatchPrompt(state.requests);
    try {
      await navigator.clipboard.writeText(prompt);
      showToast(`已复制全部 ${state.requests.length} 条 Request 到剪贴板`);
    } catch (err) {
      showToast(`复制失败: ${err.message}`);
    }
  };
  el.btnReqSendAll.onclick = () => deliverRequests([...state.requests], true);

  // ---------- Target polling (from MCP open_document tool) ----------
  async function checkTarget() {
    try {
      const res = await apiJson('/api/target');
      const t = res.target;
      if (t?.path && t.seq && t.seq > state.lastTargetSeq) {
        state.lastTargetSeq = t.seq;
        await openPath(t.path, { mode: t.mode });
      }
    } catch {}
  }

  // ---------- UI Bindings ----------
  el.btnDrawer.onclick = () => toggleDrawer();
  el.btnDrawerClose.onclick = () => toggleDrawer(false);
  el.btnTreeRefresh.onclick = refreshTree;
  el.btnWelcomeBrowse.onclick = () => toggleDrawer(true);
  el.btnWelcomePick.onclick = () => el.nativeFileInput.click();
  el.btnPickFile.onclick = () => el.nativeFileInput.click();

  el.nativeFileInput.onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) openLocalDroppedFile(file);
    e.target.value = '';
  };

  let searchTimer = null;
  el.treeSearch.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 240);
  };
  el.treeFilters.onclick = (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    state.treeCategory = btn.dataset.cat;
    el.treeFilters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn));
    runSearch();
  };
  el.treeList.onclick = (e) => {
    const dirItem = e.target.closest('button[data-dir]');
    if (dirItem) {
      loadDir(dirItem.dataset.dir);
      return;
    }
    const item = e.target.closest('button[data-path]');
    if (item) openPath(item.dataset.path);
  };

  const togglePathBar = (show) => {
    const next = show ?? el.pathBar.classList.contains('hidden');
    el.pathBar.classList.toggle('hidden', !next);
    if (next) el.pathInput.focus();
  };
  el.btnPathToggle.onclick = () => togglePathBar();
  el.filePill.onclick = () => togglePathBar();
  el.btnPathGo.onclick = () => {
    const v = el.pathInput.value.trim().replace(/^["']|["']$/g, '');
    if (v) openPath(v);
  };
  el.pathInput.onkeydown = (e) => {
    if (e.key === 'Enter') el.btnPathGo.click();
  };

  el.btnRefresh.onclick = () => {
    if (state.droppedFile) openLocalDroppedFile(state.droppedFile);
    else if (state.currentPath) openPath(state.currentPath, { keepArchive: Boolean(state.archiveEntry) });
  };
  el.btnReveal.onclick = () => {
    if (state.currentPath && !state.currentPath.startsWith('dropped://')) {
      apiJson('/api/reveal', { path: state.currentPath }).catch(() => {});
    }
  };

  // Drag & Drop anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    el.dropOverlay.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) el.dropOverlay.classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.dropOverlay.classList.add('hidden');
    const file = e.dataTransfer?.files?.[0];
    if (file) openLocalDroppedFile(file);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!el.reqModal.classList.contains('hidden')) {
        state.pendingComposer = null;
        el.reqModal.classList.add('hidden');
        return;
      }
      if (state.snipMode) {
        setSnipMode(false);
        return;
      }
    }
    if (e.altKey && e.key.toLowerCase() === 's' && state.currentPath) {
      e.preventDefault();
      setSnipMode(!state.snipMode);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      toggleDrawer(true);
    }
  });

  // ---------- Host File-Open Messages & Boot ----------
  function extractFileArg(obj) {
    if (!obj || typeof obj !== 'object') return '';
    for (const k of ['file', 'path', 'filepath', 'filePath', 'uri', 'fileUri', 'file_uri', 'file_path', 'target']) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    if (obj.payload && typeof obj.payload === 'object') return extractFileArg(obj.payload);
    if (obj.data && typeof obj.data === 'object') return extractFileArg(obj.data);
    return '';
  }

  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'theme-change' || d.type === 'workspace-change' || d.type === 'sidecar-key-event') return;
    const p = extractFileArg(d);
    if (p) openPath(p);
  });

  window.addEventListener('error', (e) => {
    if (e?.message) showError(`页面脚本异常: ${e.message}`);
  });

  async function boot() {
    if (window.sidecar?.getWorkspaceUris) {
      state.workspaceUris = await window.sidecar.getWorkspaceUris();
      window.sidecar.onWorkspaceChange?.((uris) => {
        state.workspaceUris = uris;
        state.currentDir = null;
        loadDir(null);
      });
    }
    const sp = new URLSearchParams(location.search);
    let qFile = sp.get('file') || sp.get('path') || sp.get('filepath') || sp.get('filePath') || sp.get('uri') || sp.get('fileUri') || sp.get('target');
    if (!qFile) {
      for (const [k, v] of sp.entries()) {
        if (['token', '_sidecar_token', 'conversationId', 'conversation_id', 'tab', 'sid'].includes(k)) continue;
        if (v && (v.includes('/') || v.includes('\\') || v.startsWith('file:'))) {
          qFile = v;
          break;
        }
      }
    }
    if (qFile) {
      await openPath(qFile);
    } else {
      await checkTarget();
    }
    await loadDir(null);
    setInterval(() => {
      if (!document.hidden) checkTarget();
    }, 1500);
  }
  boot();
})();
