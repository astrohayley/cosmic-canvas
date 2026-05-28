(function () {
  'use strict';

  const CONFIG = {
    projectId: '32203',
    workflowId: '31480',
    environment: 'production',
    subjectBatchSize: 10,
    title: 'Cosmic Canvas',
    links: {
      privacyPolicy: 'https://www.zooniverse.org/privacy',
      termsOfUse: 'https://www.zooniverse.org/privacy#terms',
      dataRetention: null,
      talkBoard: null,
    },
    brushTool: {
      colors: ['#00bfff'],
      opacity: 0.3,
      defaultSize: 12,
      machineMask: {
        enabled: true,
        threshold: 128,
        invert: false,
        rowStep: 2,
        colStep: 2,
        minRunLength: 2,
        maxLines: 8000,
        opacity: 0.28,
        brushRadius: 1,
      },
    },
  };

  const TUTORIAL_CARDS_URL = 'tutorial_info/tutorial.json';
  let TUTORIAL_CARDS = [];

  const PANOPTES_ORIGIN = 'https://panoptes.zooniverse.org';

  // OAuth Implicit grant — token comes back in the URL fragment via the authorize
  // redirect, so the static page never has to POST /oauth/token (which Doorkeeper
  // does not CORS-permit from arbitrary origins like GitHub Pages or localhost).
  const OAUTH = {
    clientId: 'EZTV_9hbbrlVWIdHuE_wiub8vtkXJCKiay1V0HfXzpQ',
    redirectUri: window.location.origin + window.location.pathname,
    authorizeUrl: PANOPTES_ORIGIN + '/oauth/authorize',
    scope: 'public classification',
    storageKey: 'cosmic_canvas_token',
  };

  const params = new URLSearchParams(window.location.search);
  const settings = {
    projectId: params.get('project') || CONFIG.projectId,
    workflowId: params.get('workflow') || CONFIG.workflowId,
    environment: params.get('env') || CONFIG.environment,
  };

  const API_BASE = {
    production: PANOPTES_ORIGIN + '/api',
    staging: 'https://panoptes-staging.zooniverse.org/api',
  };
  const PANOPTES_HEADERS = { 'Accept': 'application/vnd.api+json; version=1' };
  const apiBase = () => API_BASE[settings.environment] || API_BASE.production;
  const authHeaders = () =>
    state.authToken ? { ...PANOPTES_HEADERS, Authorization: `Bearer ${state.authToken}` } : PANOPTES_HEADERS;

  const state = {
    project: null,
    workflow: null,
    subjects: [],
    subjectIndex: 0,
    brushAnnotation: null,
    classifiedCount: 0,
    classificationStartedAt: null,
    authToken: null,
    authUser: null,
  };

  const api = {
    getProject(id) {
      return $.ajax({ url: `${apiBase()}/projects/${id}`, headers: authHeaders(), method: 'GET' })
        .then(data => data.projects[0]);
    },
    getWorkflow(id) {
      return $.ajax({ url: `${apiBase()}/workflows/${id}`, headers: authHeaders(), method: 'GET' })
        .then(data => data.workflows[0]);
    },
    getQueuedSubjects(workflowId, pageSize) {
      return $.ajax({
        url: `${apiBase()}/subjects/queued`,
        data: { workflow_id: workflowId, page_size: pageSize, http_cache: true },
        headers: authHeaders(),
        method: 'GET',
      }).then(data => data.subjects || []);
    },
    postClassification(payload) {
      return $.ajax({
        url: `${apiBase()}/classifications`,
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        data: JSON.stringify({ classifications: payload }),
        dataType: 'json',
      });
    },
  };

  function getImageEntries(subject) {
    if (!subject || !subject.locations) return [];
    const entries = [];
    subject.locations.forEach((loc, locationIndex) => {
      for (const [mime, url] of Object.entries(loc)) {
        if (mime.startsWith('image/')) entries.push({ mimeType: mime, url, locationIndex });
      }
    });
    return entries;
  }

  function currentSubject() {
    return state.subjects[state.subjectIndex] || null;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Image load failed: ${src}`));
      img.src = src;
    });
  }

  // Port of main's buildThresholdMaskSaveData — luminance-threshold to horizontal scan lines.
  async function buildThresholdMaskSaveData(seedUrl, options) {
    const image = await loadImage(seedUrl);
    const canvas = document.createElement('canvas');
    canvas.width = options.canvasWidth || 500;
    canvas.height = options.canvasHeight || 500;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const lines = [];
    const lineColor = hexToRgba(options.color, options.opacity);

    outer: for (let y = 0; y < canvas.height; y += options.rowStep) {
      let startX = -1;
      for (let x = 0; x <= canvas.width; x += options.colStep) {
        const inBounds = x < canvas.width;
        let isMaskPixel = false;
        if (inBounds) {
          const i = (y * canvas.width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
          const thresholdHit = options.invert
            ? luminance <= options.threshold
            : luminance >= options.threshold;
          isMaskPixel = a > 8 && thresholdHit;
        }
        if (isMaskPixel) {
          if (startX < 0) startX = x;
        } else if (startX >= 0) {
          const endX = Math.min(canvas.width - 1, x - options.colStep);
          if (endX - startX + 1 >= options.minRunLength) {
            lines.push({
              points: [{ x: startX, y }, { x: endX, y }],
              brushColor: lineColor,
              brushRadius: options.brushRadius,
              isEraser: false,
            });
            if (lines.length >= options.maxLines) break outer;
          }
          startX = -1;
        }
      }
    }
    if (lines.length === 0) return null;
    return JSON.stringify({ lines, width: canvas.width, height: canvas.height });
  }

  const brush = {
    el: null,
    ctx: null,
    cursorEl: null,
    cursorCtx: null,
    cursorPos: null,     // {x,y} or null when pointer is off canvas
    image: null,         // currently displayed subject image
    images: [],          // all decoded image entries for the subject {url, img}
    activeImageIndex: 0,
    lines: [],
    activeLine: null,
    pointerDown: false,
    initialMaskSaveData: null,
    toolMode: 'brush',   // 'brush' | 'eraser'
    color: CONFIG.brushTool.colors[0] || '#00bfff',
    size: CONFIG.brushTool.defaultSize,
    opacity: CONFIG.brushTool.opacity,

    init() {
      this.el = document.getElementById('brush-canvas');
      this.ctx = this.el.getContext('2d');
      this.cursorEl = document.getElementById('brush-cursor-overlay');
      this.cursorCtx = this.cursorEl.getContext('2d');
      // Offscreen strokes layer: eraser uses destination-out to punch only prior strokes, never the subject.
      this.strokesEl = document.createElement('canvas');
      this.strokesEl.width = this.el.width;
      this.strokesEl.height = this.el.height;
      this.strokesCtx = this.strokesEl.getContext('2d');

      const onDown = (e) => this.startStroke(e);
      const onMove = (e) => this.continueStroke(e);
      const onUp   = ()  => this.endStroke();

      this.el.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      // Track the pointer over the canvas so the cursor preview follows even when not drawing.
      this.el.addEventListener('mousemove', (e) => {
        this.cursorPos = this.pointFromEvent(e);
        this.drawCursor();
      });
      this.el.addEventListener('mouseleave', () => {
        this.cursorPos = null;
        this.drawCursor();
      });

      this.el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
          e.preventDefault();
          onDown(e);
        }
      });
      this.el.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
          e.preventDefault();
          onMove(e);
        }
      });
      window.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') onUp(e);
      });

      this.el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 2 : -2;
        this.setSize(Math.max(1, Math.min(80, this.size + delta)));
      }, { passive: false });
    },

    // Mirrors main's react-canvas-draw drawInterface: filled brush-color circle + 4px + 2px center dots.
    drawCursor() {
      const ctx = this.cursorCtx;
      const el = this.cursorEl;
      ctx.clearRect(0, 0, el.width, el.height);
      if (!this.cursorPos) return;
      const { x, y } = this.cursorPos;
      const eraser = this.toolMode === 'eraser';
      const displayHex = eraser ? '#ffffff' : this.color;
      // Big brush preview (matches main: brushColor fill, full radius).
      ctx.beginPath();
      ctx.fillStyle = hexToRgba(displayHex, this.opacity);
      ctx.arc(x, y, this.size, 0, Math.PI * 2, true);
      ctx.fill();
      // 4px catenary-color dot at the cursor.
      ctx.beginPath();
      ctx.fillStyle = hexToRgba(displayHex, 0.9);
      ctx.arc(x, y, 4, 0, Math.PI * 2, true);
      ctx.fill();
      // 2px center crosshair (same color, smaller).
      ctx.beginPath();
      ctx.fillStyle = hexToRgba(displayHex, 0.9);
      ctx.arc(x, y, 2, 0, Math.PI * 2, true);
      ctx.fill();
    },

    setColor(hex) {
      this.color = hex;
      $('#brush-colors .brush-color-btn').removeClass('active');
      $(`#brush-colors .brush-color-btn[data-color="${hex}"]`).addClass('active');
      this.drawCursor();
    },

    setSize(n) {
      this.size = n;
      $('#brush-size').val(String(n));
      $('#brush-size-label').text(String(n));
      this.drawCursor();
    },

    setMode(mode) {
      this.toolMode = mode === 'eraser' ? 'eraser' : 'brush';
      const eraser = this.toolMode === 'eraser';
      $('#brush-mode-brush').toggleClass('active', !eraser).attr('aria-pressed', String(!eraser));
      $('#brush-mode-eraser').toggleClass('active', eraser).attr('aria-pressed', String(eraser));
      $('#brush-mode-indicator')
        .text(`Mode: ${eraser ? 'Eraser' : 'Brush'}`)
        .toggleClass('eraser', eraser)
        .toggleClass('brush', !eraser);
      $('#brush-colors .brush-color-btn').prop('disabled', eraser);
      this.drawCursor();
    },

    pointFromEvent(e) {
      const rect = this.el.getBoundingClientRect();
      const scaleX = this.el.width / rect.width;
      const scaleY = this.el.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },

    startStroke(e) {
      if (e.button !== undefined && e.button !== 0) return;
      this.pointerDown = true;
      try { this.el.setPointerCapture?.(e.pointerId); } catch (_) {}
      const p = this.pointFromEvent(e);
      const eraser = this.toolMode === 'eraser';
      this.activeLine = {
        points: [p],
        brushColor: hexToRgba(this.color, this.opacity),
        brushRadius: this.size,
        isEraser: eraser,
      };
      this.lines.push(this.activeLine);
      this.redraw();
    },

    continueStroke(e) {
      if (!this.pointerDown || !this.activeLine) return;
      const p = this.pointFromEvent(e);
      const last = this.activeLine.points[this.activeLine.points.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return;
      this.activeLine.points.push(p);
      // Full redraw so live curve uses the same quadratic-Bézier smoothing as the post-mouseup replay.
      this.redraw();
    },

    endStroke() {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      const finished = this.activeLine;
      this.activeLine = null;
      if (finished) {
        this.redraw();
        state.brushAnnotation = this.getSaveData();
      }
    },

    undo() {
      if (!this.lines.length) return;
      this.lines.pop();
      this.redraw();
      state.brushAnnotation = this.lines.length ? this.getSaveData() : null;
    },

    clear() {
      this.lines = [];
      this.activeLine = null;
      this.redraw();
      state.brushAnnotation = null;
    },

    // Drop user strokes, reload the seeded threshold mask, flip back to brush mode.
    resetMask() {
      if (!this.initialMaskSaveData) return;
      this.setMode('brush');
      try {
        const data = JSON.parse(this.initialMaskSaveData);
        this.lines = data.lines.map((l) => ({ ...l }));
      } catch (_) {
        this.lines = [];
      }
      this.activeLine = null;
      this.redraw();
      state.brushAnnotation = this.lines.length ? this.getSaveData() : null;
    },

    setActiveImage(index) {
      if (!this.images.length) return;
      const safe = Math.max(0, Math.min(index, this.images.length - 1));
      this.activeImageIndex = safe;
      this.image = this.images[safe]?.img || null;
      $('#image-thumbnails .thumbnail-btn').each(function (i) {
        $(this).toggleClass('active', i === safe).attr('aria-selected', String(i === safe));
      });
      this.redraw();
    },

    // Load every image entry, render thumbnails, seed a machine mask from the last entry, paint the first.
    async paintSubject(subject) {
      this.lines = [];
      this.activeLine = null;
      this.initialMaskSaveData = null;
      this.setMode('brush');
      state.brushAnnotation = null;

      const entries = getImageEntries(subject);
      this.images = entries.map((e) => ({ ...e, img: null }));
      this.activeImageIndex = 0;
      // Render thumbnails synchronously from URLs; let <img> tags decode independently.
      view.renderImageThumbnails(entries);

      if (!entries.length) {
        this.image = null;
        view.setMaskInfo({ source: 'none', status: 'none' });
        view.setResetMaskEnabled(false);
        this.redraw();
        return null;
      }

      // Decode all images in parallel; failed loads keep img:null so the thumbnail stays usable.
      const decoded = await Promise.all(
        entries.map((e) =>
          loadImage(e.url).then(
            (img) => ({ ...e, img }),
            () => ({ ...e, img: null })
          )
        )
      );
      this.images = decoded;
      this.image = decoded[0]?.img || null;

      // Seed from the last image entry (matches main's seedImageIndex = entries.length - 1).
      const seed = decoded[decoded.length - 1];
      const cfg = CONFIG.brushTool.machineMask || {};
      let info = { source: 'none', status: 'none' };
      if (cfg.enabled && seed?.img) {
        try {
          const saveData = await buildThresholdMaskSaveData(seed.url, {
            ...cfg,
            color: this.color,
            opacity: CONFIG.brushTool.opacity ?? cfg.opacity,
            canvasWidth: this.el.width,
            canvasHeight: this.el.height,
          });
          if (saveData) {
            const parsed = JSON.parse(saveData);
            this.lines = parsed.lines.map((l) => ({ ...l }));
            this.initialMaskSaveData = saveData;
            info = { source: 'threshold', status: 'loaded' };
          } else {
            info = { source: 'threshold', status: 'empty' };
          }
        } catch (err) {
          info = { source: 'threshold', status: 'error', error: err.message };
        }
      }
      view.setMaskInfo(info);
      view.setResetMaskEnabled(!!this.initialMaskSaveData);
      this.redraw();
      state.brushAnnotation = this.lines.length ? this.getSaveData() : null;
      return this.image;
    },

    redraw() {
      const { ctx, el, image, strokesCtx, strokesEl } = this;
      // Pass 1: rebuild the strokes layer (brush as source-over, eraser as destination-out).
      strokesCtx.globalCompositeOperation = 'source-over';
      strokesCtx.clearRect(0, 0, strokesEl.width, strokesEl.height);
      for (const line of this.lines) {
        if (!line.points?.length) continue;
        strokesCtx.save();
        if (line.isEraser) {
          strokesCtx.globalCompositeOperation = 'destination-out';
          strokesCtx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
          strokesCtx.globalCompositeOperation = 'source-over';
          strokesCtx.strokeStyle = line.brushColor;
        }
        strokesCtx.lineWidth = line.brushRadius * 2;
        strokesCtx.lineCap = 'round';
        strokesCtx.lineJoin = 'round';
        const pts = line.points;
        strokesCtx.beginPath();
        if (pts.length < 3) {
          strokesCtx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) strokesCtx.lineTo(pts[i].x, pts[i].y);
        } else {
          strokesCtx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2;
            const my = (pts[i].y + pts[i + 1].y) / 2;
            strokesCtx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
          }
          const last = pts[pts.length - 1];
          strokesCtx.lineTo(last.x, last.y);
        }
        strokesCtx.stroke();
        strokesCtx.restore();
      }

      // Pass 2: black base → subject image → strokes layer on top.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, el.width, el.height);
      if (image) {
        const ar = image.width / image.height;
        const ca = el.width / el.height;
        let w, h;
        if (ar > ca) { w = el.width; h = el.width / ar; }
        else         { h = el.height; w = el.height * ar; }
        const x = (el.width - w) / 2;
        const y = (el.height - h) / 2;
        ctx.drawImage(image, x, y, w, h);
      }
      ctx.drawImage(strokesEl, 0, 0);
    },

    getSaveData() {
      return JSON.stringify({
        lines: this.lines,
        width: this.el.width,
        height: this.el.height,
      });
    },
  };

  const auth = {
    token: null,
    refreshToken: null,
    tokenExpiry: 0,

    async init() {
      try {
        const raw = sessionStorage.getItem(OAUTH.storageKey);
        if (raw) {
          const t = JSON.parse(raw);
          if (t.expiresAt > Date.now() && t.token) {
            this.token = t.token;
            this.tokenExpiry = t.expiresAt;
            state.authToken = t.token;
            state.authUser = t.user || null;
          } else {
            sessionStorage.removeItem(OAUTH.storageKey);
          }
        }
      } catch (_) {
        sessionStorage.removeItem(OAUTH.storageKey);
      }

      // Implicit-grant callback returns the token in the URL fragment.
      if (window.location.hash && window.location.hash.length > 1) {
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = hashParams.get('access_token');
        const error = hashParams.get('error');
        if (accessToken) {
          this.setTokens({
            access_token: accessToken,
            token_type: hashParams.get('token_type') || 'Bearer',
            expires_in: Number(hashParams.get('expires_in')) || 7200,
          });
          await this.fetchUser();
        } else if (error) {
          view.showAuthError(
            `Sign-in failed: ${hashParams.get('error_description') || error}` +
            ' — check that the OAuth app on Panoptes (Doorkeeper) has this page URL registered as a redirect_uri.'
          );
        }
        if (accessToken || error) {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      }

      if (this.token && !state.authUser) await this.fetchUser();
    },

    setTokens(data) {
      this.token = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60_000;
      state.authToken = this.token;
      this.persist();
    },

    persist() {
      sessionStorage.setItem(OAUTH.storageKey, JSON.stringify({
        token: this.token,
        expiresAt: this.tokenExpiry,
        user: state.authUser,
      }));
    },

    async fetchUser() {
      if (!this.token) return null;
      try {
        const res = await fetch(`${apiBase()}/me`, {
          headers: {
            Accept: 'application/vnd.api+json; version=1',
            Authorization: `Bearer ${this.token}`,
          },
        });
        if (!res.ok) {
          let detail = '';
          try { detail = await res.text(); } catch (_) {}
          console.warn(`/api/me ${res.status}: ${detail || res.statusText}`);
          view.showAuthError(
            `Signed in but /api/me failed (${res.status}). Token is good — try refreshing. ` +
            (detail ? `Details: ${detail.slice(0, 200)}` : '')
          );
          return null;
        }
        const data = await res.json();
        const user = data.users?.[0];
        if (user) {
          state.authUser = user.login || user.display_name || null;
          this.persist();
          view.renderHeader();
          view.setAuthButton(true);
        }
        return user || null;
      } catch (_) {
        return null;
      }
    },

    signIn() {
      if (!OAUTH.clientId) return;
      const url = new URL(OAUTH.authorizeUrl);
      url.searchParams.set('response_type', 'token');
      url.searchParams.set('client_id', OAUTH.clientId);
      url.searchParams.set('redirect_uri', OAUTH.redirectUri);
      url.searchParams.set('scope', OAUTH.scope);
      window.location.href = url.toString();
    },

    signOut() {
      this.token = null;
      this.tokenExpiry = 0;
      state.authToken = null;
      state.authUser = null;
      sessionStorage.removeItem(OAUTH.storageKey);
      view.renderHeader();
      view.setAuthButton(false);
    },
  };

  const view = {
    showLoading(message) {
      $('#state-loading').prop('hidden', false).find('p').text(message || 'Loading project from production…');
      $('#state-error').prop('hidden', true);
      $('#tab-classify').prop('hidden', true);
      $('#tab-about').prop('hidden', true);
    },

    showError(message) {
      $('#state-loading').prop('hidden', true);
      $('#tab-classify').prop('hidden', true);
      $('#tab-about').prop('hidden', true);
      $('#state-error').prop('hidden', false);
      $('#error-message').text(message);
    },

    renderHeader() {
      $('#project-title').text(state.project?.display_name || CONFIG.title);
      const status = `${settings.environment} · ${state.classifiedCount} classified · ${state.authUser || 'anonymous'}`;
      $('#header-status').text(status);
    },

    renderBrushColors() {
      const $colors = $('#brush-colors').empty();
      CONFIG.brushTool.colors.forEach((c, i) => {
        $('<button>', {
          type: 'button',
          class: 'brush-color-btn' + (i === 0 ? ' active' : ''),
          'data-color': c,
          title: c,
        }).css('background-color', c).appendTo($colors);
      });
    },

    renderSubject() {
      const subj = currentSubject();
      if (!subj) return;
      $('#subject-id').text(subj.id);
      $('#subject-progress-label').text(`${state.subjectIndex + 1} / ${state.subjects.length}`);
      const talkUrl = state.project
        ? `https://www.zooniverse.org/projects/${state.project.slug}/talk/subjects/${subj.id}`
        : null;
      this.setSubjectTalkLink(talkUrl);
      brush.paintSubject(subj);
    },

    renderTabs() {
      $('button.tab-button[data-tab="about"]').prop('hidden', !state.project);
      if (state.project) {
        $('#about-title').text(state.project.display_name);
        $('#about-description').text(state.project.description || '');
        $('#about-introduction').text(state.project.introduction || '');
        const talkUrl = CONFIG.links.talkBoard ||
          `https://www.zooniverse.org/projects/${state.project.slug}/talk`;
        $('#talk-link').attr('href', talkUrl).prop('hidden', false);
        const $links = $('#about-links').empty();
        $('<a>', { href: `https://www.zooniverse.org/projects/${state.project.slug}`, target: '_blank', rel: 'noopener noreferrer', text: 'View on Zooniverse' }).appendTo($links);
        if (CONFIG.links.privacyPolicy) $('<a>', { href: CONFIG.links.privacyPolicy, target: '_blank', rel: 'noopener noreferrer', text: 'Privacy Policy' }).appendTo($links);
        if (CONFIG.links.termsOfUse) $('<a>', { href: CONFIG.links.termsOfUse, target: '_blank', rel: 'noopener noreferrer', text: 'Terms of Use' }).appendTo($links);
      }
    },

    renderClassify() {
      $('#state-loading').prop('hidden', true);
      $('#state-error').prop('hidden', true);
      $('#tab-classify').prop('hidden', false);
      $('#tab-about').prop('hidden', true);
      $('button.tab-button[data-tab="classify"]').addClass('active');
      $('button.tab-button[data-tab="about"]').removeClass('active');
    },

    switchTab(name) {
      $('button.tab-button[data-tab]').removeClass('active');
      $(`button.tab-button[data-tab="${name}"]`).addClass('active');
      $('#tab-classify').prop('hidden', name !== 'classify');
      $('#tab-about').prop('hidden', name !== 'about');
    },

    showSubmissionResult(success, text) {
      $('#submission-result')
        .removeClass('success error')
        .addClass(success ? 'success' : 'error')
        .empty()
        .append(
          $('<span>', {
            class: success ? 'success-text' : 'error-text',
            style: 'font-size:13px;',
            text,
          })
        )
        .prop('hidden', false);
    },

    hideSubmissionResult() {
      $('#submission-result').prop('hidden', true).removeClass('success error').empty();
    },

    showExportBar() {
      $('#export-bar').prop('hidden', false);
    },

    setAuthButton(signedIn) {
      $('#auth-button').text(signedIn ? 'Sign out' : 'Sign in');
    },

    renderImageThumbnails(entries) {
      const $box = $('#image-thumbnails').empty();
      if (!entries || entries.length < 2) {
        $box.prop('hidden', true);
        return;
      }
      $box.prop('hidden', false);
      entries.forEach((entry, idx) => {
        const $btn = $('<button>', {
          type: 'button',
          class: 'thumbnail-btn' + (idx === 0 ? ' active' : ''),
          'data-image-index': idx,
          'aria-label': `Show image ${idx + 1}`,
          'aria-selected': idx === 0 ? 'true' : 'false',
          title: `Image ${idx + 1}`,
        });
        $('<img>', { src: entry.url, alt: `Thumbnail ${idx + 1}`, class: 'thumbnail-image' }).appendTo($btn);
        $('<span>', { class: 'thumbnail-count', text: String(idx + 1) }).appendTo($btn);
        $btn.appendTo($box);
      });
    },

    setMaskInfo(info) {
      const txt = `Mask: ${info?.source || 'none'} (${info?.status || 'none'})`;
      $('#mask-info-badge')
        .text(txt)
        .toggleClass('loaded', info?.status === 'loaded');
    },

    setResetMaskEnabled(enabled) {
      $('#brush-reset-mask').prop('disabled', !enabled);
    },

    setSubjectTalkLink(url) {
      const $a = $('#subject-talk-link');
      if (url) $a.attr('href', url).prop('hidden', false);
      else $a.removeAttr('href').prop('hidden', true);
    },

    showAuthError(message) {
      const $b = $('#auth-error-banner');
      if (!$b.length) return;
      $b.text(message).prop('hidden', false);
    },

    hideAuthError() {
      $('#auth-error-banner').prop('hidden', true).text('');
    },
  };

  const tutorial = {
    currentIndex: 0,
    visible: false,

    storageKey() {
      return `cosmic-canvas:tutorial-seen:${settings.projectId || 'default'}`;
    },

    async init() {
      $('#tutorial-open-button').on('click', () => this.open());
      $('#tutorial-close, #tutorial-close-x').on('click', () => this.close());
      $('#tutorial-next').on('click', () => this.next());
      $('#tutorial-back').on('click', () => this.back());
      $('#tutorial-steps').on('click', '.tutorial-step-dot', (e) =>
        this.goto(Number($(e.currentTarget).data('index')))
      );
      $(document).on('keydown', (e) => {
        if (e.key === 'Escape' && this.visible) this.close();
      });
      try {
        const res = await fetch(TUTORIAL_CARDS_URL);
        if (res.ok) TUTORIAL_CARDS = await res.json();
      } catch (_) {}
    },

    maybeOpenOnFirstVisit() {
      let seen = false;
      try { seen = localStorage.getItem(this.storageKey()) === 'true'; } catch (_) {}
      if (!seen) this.open();
    },

    open() {
      if (!TUTORIAL_CARDS.length) return;
      this.currentIndex = 0;
      this.visible = true;
      this.render();
      $('#tutorial-popup').prop('hidden', false);
    },

    close() {
      this.visible = false;
      $('#tutorial-popup').prop('hidden', true);
      try { localStorage.setItem(this.storageKey(), 'true'); } catch (_) {}
    },

    next() {
      if (this.currentIndex >= TUTORIAL_CARDS.length - 1) {
        this.close();
        return;
      }
      this.currentIndex += 1;
      this.render();
    },

    back() {
      if (this.currentIndex > 0) {
        this.currentIndex -= 1;
        this.render();
      }
    },

    goto(i) {
      if (i < 0 || i >= TUTORIAL_CARDS.length) return;
      this.currentIndex = i;
      this.render();
    },

    render() {
      const card = TUTORIAL_CARDS[this.currentIndex];
      $('#tutorial-image').attr('src', card.image).attr('alt', card.title);
      $('#tutorial-popup-title').text(card.title);
      $('#tutorial-popup-description').text(card.description || '');
      $('#tutorial-progress').text(`Step ${this.currentIndex + 1} of ${TUTORIAL_CARDS.length}`);
      $('#tutorial-back').prop('disabled', this.currentIndex === 0);
      $('#tutorial-next').text(this.currentIndex === TUTORIAL_CARDS.length - 1 ? 'Finish' : 'Next');
      const $dots = $('#tutorial-steps').empty();
      TUTORIAL_CARDS.forEach((c, i) => {
        $('<button>', {
          type: 'button',
          class: 'tutorial-step-dot' + (i === this.currentIndex ? ' active' : ''),
          'data-index': i,
          'aria-label': `Open step ${i + 1}: ${c.title}`,
        }).appendTo($dots);
      });
    },
  };

  async function initialize() {
    view.showLoading(`Loading project from ${settings.environment}…`);

    try {
      if (!settings.projectId) {
        throw new Error('No project ID. Add ?project=YOUR_PROJECT_ID to the URL.');
      }

      state.project = await api.getProject(settings.projectId);

      if (settings.workflowId) {
        state.workflow = await api.getWorkflow(settings.workflowId);
      } else {
        const active = state.project.links?.active_workflows || [];
        if (!active.length) throw new Error(`Project ${settings.projectId} has no active workflows`);
        state.workflow = await api.getWorkflow(active[0]);
      }

      state.subjects = await api.getQueuedSubjects(state.workflow.id, CONFIG.subjectBatchSize);
      if (!state.subjects.length) throw new Error('No subjects in queue for this workflow');

      state.subjectIndex = 0;
      state.classificationStartedAt = new Date().toISOString();

      view.renderHeader();
      view.renderBrushColors();
      view.renderTabs();
      view.renderClassify();
      view.renderSubject();
      view.showExportBar();
    } catch (err) {
      const msg = err.responseJSON?.errors?.[0]?.message || err.statusText || err.message || String(err);
      view.showError(msg);
    }
  }

  function advanceSubject() {
    state.subjectIndex = (state.subjectIndex + 1) % state.subjects.length;
    state.brushAnnotation = null;
    state.classificationStartedAt = new Date().toISOString();
    view.hideSubmissionResult();
    view.renderSubject();
  }

  async function submit() {
    if (!state.project || !state.workflow || !currentSubject()) return;
    const $btn = $('#submit-button').prop('disabled', true).text('Submitting…');
    const $skip = $('#skip-button').prop('disabled', true);

    try {
      const payload = {
        annotations: [{ task: 'T0', value: state.brushAnnotation || 'No annotation' }],
        metadata: {
          workflow_version: state.workflow.version || '1.0',
          started_at: state.classificationStartedAt,
          finished_at: new Date().toISOString(),
          user_agent: navigator.userAgent,
          user_language: navigator.language,
          utc_offset: String(new Date().getTimezoneOffset() * 60),
          source: 'zoo-playground',
          viewport: { width: window.innerWidth, height: window.innerHeight },
        },
        links: {
          project: state.project.id,
          workflow: state.workflow.id,
          subjects: [currentSubject().id],
        },
        completed: true,
      };

      await api.postClassification(payload);

      state.classifiedCount += 1;
      view.renderHeader();
      view.showSubmissionResult(true, 'Classification submitted!');
      setTimeout(advanceSubject, 800);
    } catch (err) {
      const msg = err.responseJSON?.errors?.[0]?.message || err.statusText || err.message;
      view.showSubmissionResult(false, `Error: ${msg}`);
    } finally {
      $btn.prop('disabled', false).text('Done');
      $skip.prop('disabled', false);
    }
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleExport(type) {
    if (!state.project || !state.workflow) return;
    try {
      let data, filename;
      if (type === 'project') {
        data = await api.getProject(state.project.id);
        filename = `project-${state.project.id}.json`;
      } else if (type === 'workflow') {
        data = await api.getWorkflow(state.workflow.id);
        filename = `workflow-${state.workflow.id}.json`;
      } else if (type === 'subject-sets') {
        const ids = state.workflow.links?.subject_sets || [];
        if (!ids.length) data = [];
        else data = await $.ajax({
          url: `${apiBase()}/subject_sets`,
          data: { id: ids.join(',') },
          headers: authHeaders(),
        }).then(r => r.subject_sets || []);
        filename = `subject-sets-${state.workflow.id}.json`;
      } else if (type === 'subjects') {
        data = await api.getQueuedSubjects(state.workflow.id, CONFIG.subjectBatchSize);
        filename = `subjects-${state.workflow.id}.json`;
      }
      downloadJson(filename, data);
    } catch (_) {}
  }

  window.__cosmicCanvas = {
    OAUTH,
    state,
    brush,
    getSaveData: () => brush.getSaveData(),
  };

  $(async function () {
    brush.init();
    await tutorial.init();

    $('#submit-button').on('click', submit);
    $('#skip-button').on('click', advanceSubject);

    $('#brush-size').on('input change', function () {
      brush.setSize(Number(this.value));
    });
    $('#brush-undo').on('click', () => brush.undo());
    $('#brush-clear').on('click', () => brush.clear());
    $('#brush-reset-mask').on('click', () => brush.resetMask());
    $('#brush-mode-brush').on('click', () => brush.setMode('brush'));
    $('#brush-mode-eraser').on('click', () => brush.setMode('eraser'));
    $('#brush-colors').on('click', '.brush-color-btn', function () {
      if ($(this).prop('disabled')) return;
      brush.setColor($(this).data('color'));
    });
    $('#image-thumbnails').on('click', '.thumbnail-btn', function () {
      brush.setActiveImage(Number($(this).data('image-index')));
    });

    $('button.tab-button[data-tab]').on('click', function () {
      view.switchTab($(this).data('tab'));
    });

    $('#export-bar').on('click', '.export-button', function () {
      handleExport($(this).data('export'));
    });

    $('#auth-button').on('click', () => {
      if (auth.token) auth.signOut();
      else auth.signIn();
    });

    tutorial.maybeOpenOnFirstVisit();

    // Resolve auth before initialize so first API calls carry the bearer.
    await auth.init();

    view.setAuthButton(!!auth.token);

    initialize();
  });
})();
