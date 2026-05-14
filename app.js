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
      colors: ['#00ff00'],
      opacity: 0.3,
      defaultSize: 12,
    },
  };

  // Public OAuth client — no client_secret on the token exchange.
  const OAUTH = {
    clientId: 'EZTV_9hbbrlVWIdHuE_wiub8vtkXJCKiay1V0HfXzpQ',
    redirectUri: window.location.origin + window.location.pathname,
    authorizeUrl: 'https://panoptes.zooniverse.org/oauth/authorize',
    tokenUrl: 'https://panoptes.zooniverse.org/oauth/token',
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
    production: 'https://panoptes.zooniverse.org/api',
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

  function getImageUrl(subject) {
    if (!subject || !subject.locations) return null;
    for (const loc of subject.locations) {
      for (const [mime, url] of Object.entries(loc)) {
        if (mime.startsWith('image/')) return url;
      }
    }
    return null;
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

  const brush = {
    el: null,
    ctx: null,
    image: null,
    lines: [],
    activeLine: null,
    pointerDown: false,
    color: CONFIG.brushTool.colors[0] || '#00ff00',
    size: CONFIG.brushTool.defaultSize,
    opacity: CONFIG.brushTool.opacity,

    init() {
      this.el = document.getElementById('brush-canvas');
      this.ctx = this.el.getContext('2d');

      const onDown = (e) => this.startStroke(e);
      const onMove = (e) => this.continueStroke(e);
      const onUp   = ()  => this.endStroke();

      this.el.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

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

    setColor(hex) {
      this.color = hex;
      $('#brush-colors .brush-color-btn').removeClass('active');
      $(`#brush-colors .brush-color-btn[data-color="${hex}"]`).addClass('active');
    },

    setSize(n) {
      this.size = n;
      $('#brush-size').val(String(n));
      $('#brush-size-label').text(String(n));
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
      this.activeLine = {
        points: [p],
        brushColor: hexToRgba(this.color, this.opacity),
        brushRadius: this.size,
      };
      this.lines.push(this.activeLine);
      this.redraw();
    },

    continueStroke(e) {
      if (!this.pointerDown || !this.activeLine) return;
      const p = this.pointFromEvent(e);
      this.activeLine.points.push(p);
      const pts = this.activeLine.points;
      if (pts.length < 2) return;
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      this.ctx.save();
      this.ctx.strokeStyle = this.activeLine.brushColor;
      this.ctx.lineWidth = this.activeLine.brushRadius * 2;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(a.x, a.y);
      this.ctx.lineTo(b.x, b.y);
      this.ctx.stroke();
      this.ctx.restore();
    },

    endStroke() {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      const finished = this.activeLine;
      this.activeLine = null;
      if (finished) state.brushAnnotation = this.getSaveData();
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

    paintSubject(subject) {
      this.lines = [];
      this.activeLine = null;
      state.brushAnnotation = null;

      const url = getImageUrl(subject);
      if (!url) {
        this.image = null;
        this.redraw();
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { this.image = img; this.redraw(); resolve(img); };
        img.onerror = () => {
          this.image = null;
          this.redraw();
          resolve(null);
        };
        img.src = url;
      });
    },

    redraw() {
      const { ctx, el, image } = this;
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

      for (const line of this.lines) {
        if (!line.points.length) continue;
        ctx.save();
        ctx.strokeStyle = line.brushColor;
        ctx.lineWidth = line.brushRadius * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(line.points[0].x, line.points[0].y);
        for (let i = 1; i < line.points.length; i++) ctx.lineTo(line.points[i].x, line.points[i].y);
        ctx.stroke();
        ctx.restore();
      }
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
            this.refreshToken = t.refreshToken || null;
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

      const codeParams = new URLSearchParams(window.location.search);
      const code = codeParams.get('code');
      if (code) await this.handleCallback(code);

      if (this.token && !state.authUser) await this.fetchUser();
    },

    async handleCallback(code) {
      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: OAUTH.clientId,
          redirect_uri: OAUTH.redirectUri,
        });
        const res = await fetch(OAUTH.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
        const data = await res.json();
        this.setTokens(data);
        await this.fetchUser();
      } catch (err) {
        console.error('OAuth callback failed', err);
      } finally {
        // Strip ?code so reloads don't re-exchange.
        const url = new URL(window.location.href);
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        history.replaceState(null, '', url.toString());
      }
    },

    setTokens(data) {
      this.token = data.access_token;
      this.refreshToken = data.refresh_token || null;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60_000;
      state.authToken = this.token;
      this.persist();
    },

    persist() {
      sessionStorage.setItem(OAUTH.storageKey, JSON.stringify({
        token: this.token,
        refreshToken: this.refreshToken,
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
        if (!res.ok) return null;
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
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', OAUTH.clientId);
      url.searchParams.set('redirect_uri', OAUTH.redirectUri);
      url.searchParams.set('scope', OAUTH.scope);
      window.location.href = url.toString();
    },

    signOut() {
      this.token = null;
      this.refreshToken = null;
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
    getSaveData: () => brush.getSaveData(),
  };

  $(async function () {
    brush.init();

    $('#submit-button').on('click', submit);
    $('#skip-button').on('click', advanceSubject);

    $('#brush-size').on('input change', function () {
      brush.setSize(Number(this.value));
    });
    $('#brush-undo').on('click', () => brush.undo());
    $('#brush-clear').on('click', () => brush.clear());
    $('#brush-colors').on('click', '.brush-color-btn', function () {
      brush.setColor($(this).data('color'));
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

    // Resolve auth before initialize so first API calls carry the bearer.
    await auth.init();
    view.setAuthButton(!!auth.token);

    initialize();
  });
})();
