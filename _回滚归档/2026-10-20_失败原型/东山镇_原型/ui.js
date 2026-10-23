(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var isReady = false;
  var hasFailed = false;
  var toastTimer;
  var lastSourceFocus;
  var mobile = window.matchMedia('(max-width: 640px)');
  var defaults = { relief: 2.4, time: 0.52, buildings: true, roads: true, water: true, trees: true, labels: true };
  var viewNames = { pano: '全景', top: '俯瞰', luxiang: '陆巷' };
  var numberFormat = new Intl.NumberFormat('zh-CN');

  function toast(message) {
    clearTimeout(toastTimer);
    $('ui-toast').textContent = message;
    $('ui-toast').hidden = false;
    toastTimer = window.setTimeout(function () { $('ui-toast').hidden = true; }, 2400);
  }
  function app() { return window.DSApp; }
  function invoke(method) {
    if (!isReady || !app() || typeof app()[method] !== 'function') return undefined;
    var args = Array.prototype.slice.call(arguments, 1);
    try { return app()[method].apply(app(), args); }
    catch (error) { console.error('东山场景操作失败：', method, error); toast('这次操作未能完成，请稍后再试'); return undefined; }
  }
  function setSettings(open, focusToggle) {
    $('scene-controls').hidden = !open;
    $('settings-toggle').setAttribute('aria-expanded', String(open));
    $('settings-toggle').setAttribute('aria-label', open ? '收起场景设置' : '展开场景设置');
    if (focusToggle) $('settings-toggle').focus();
  }
  function setSources(open) {
    if (open) {
      lastSourceFocus = document.activeElement;
      $('pick-card').hidden = true;
      if (mobile.matches) setSettings(false);
    }
    $('sources-drawer').hidden = !open;
    $('sources-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('sources-close').focus();
    else if (lastSourceFocus && typeof lastSourceFocus.focus === 'function') lastSourceFocus.focus();
  }
  function timeName(value) { return value < 0.28 ? '晨' : value > 0.72 ? '暮' : '午'; }
  function updateRangeLabels() {
    $('relief-value').value = Number($('relief-range').value).toFixed(1) + ' ×';
    $('time-value').value = timeName(Number($('time-range').value));
    $('relief-range').setAttribute('aria-valuetext', Number($('relief-range').value).toFixed(1) + '倍');
    $('time-range').setAttribute('aria-valuetext', timeName(Number($('time-range').value)));
  }
  function setTourState(touring) {
    $('tour-button').setAttribute('aria-pressed', String(!!touring));
    $('tour-icon').setAttribute('href', touring ? '#icon-pause' : '#icon-play');
    $('tour-label').textContent = touring ? '暂停环游' : '自动环游';
  }
  function setViewState(name) {
    document.querySelectorAll('[data-view]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.view === name));
    });
  }
  function syncState() {
    var state = invoke('getState');
    if (!state || typeof state !== 'object') return;
    var options = state.options || state;
    document.querySelectorAll('[data-option]').forEach(function (input) {
      var value = options[input.dataset.option];
      if (value === undefined) return;
      if (input.type === 'checkbox') input.checked = !!value;
      else if (Number.isFinite(Number(value))) input.value = value;
    });
    var touring = state.touring !== undefined ? state.touring : state.tour;
    if (touring !== undefined) setTourState(!!touring);
    if (typeof state.view === 'string') setViewState(state.view);
    updateRangeLabels();
  }
  function markReady() {
    if (hasFailed || !app()) return;
    isReady = true;
    document.querySelectorAll('[data-app-control]').forEach(function (control) { control.disabled = false; });
    $('scene-shell').setAttribute('aria-busy', 'false');
    document.body.classList.add('is-ready');
    $('loading-screen').classList.add('is-leaving');
    window.setTimeout(function () { if (!hasFailed) $('loading-screen').hidden = true; }, 650);
    syncState();
  }
  function showError(message) {
    hasFailed = true;
    isReady = false;
    $('scene-shell').setAttribute('aria-busy', 'false');
    document.querySelectorAll('[data-app-control]').forEach(function (control) { control.disabled = true; });
    $('loading-screen').hidden = false;
    $('loading-screen').classList.remove('is-leaving');
    $('loading-screen').setAttribute('role', 'alert');
    $('loading-content').hidden = true;
    $('error-content').hidden = false;
    $('error-message').textContent = message || '当前浏览器未能初始化三维场景。请尝试支持 WebGL 的浏览器，并确认本地文件完整。';
    $('reload-button').focus();
  }
  function safeText(value, fallback) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : (fallback || '');
  }
  function evidenceText(value) {
    if (Array.isArray(value)) return value.map(evidenceText).filter(Boolean).join('\n');
    if (value && typeof value === 'object') return [value.title || value.name || value.source, value.date || value.year].filter(Boolean).map(function (x) { return safeText(x); }).join(' · ');
    return safeText(value);
  }
  function showPick(detail) {
    if (!detail || !detail.title) { $('pick-card').hidden = true; return; }
    if (!$('sources-drawer').hidden) setSources(false);
    setSettings(false);
    $('pick-title').textContent = safeText(detail.title, '东山一隅');
    $('pick-category').textContent = safeText(detail.category, '山居一隅');
    $('pick-description').textContent = safeText(detail.description, '以概括形体保留这一处山居的地理关系与地方特征。');
    $('pick-status').textContent = safeText(detail.status, '概括表达');
    var evidence = evidenceText(detail.evidence);
    $('pick-evidence').textContent = evidence;
    $('pick-evidence-wrap').hidden = !evidence;
    $('pick-evidence-wrap').open = false;
    $('pick-card').hidden = false;
  }
  function updateStats(detail) {
    if (!detail) return;
    var fields = { sourceBuildings: 'stat-source-buildings', renderBuildings: 'stat-render-buildings', roads: 'stat-roads', triangles: 'stat-triangles', fps: 'stat-fps' };
    Object.keys(fields).forEach(function (key) {
      if (detail[key] === undefined || detail[key] === null || !Number.isFinite(Number(detail[key]))) return;
      $(fields[key]).textContent = numberFormat.format(Math.round(Number(detail[key])));
    });
    if (detail.mode !== undefined) $('stat-mode').textContent = viewNames[detail.mode] || ({ tour: '环游', orbit: '自由观景', free: '自由观景' })[detail.mode] || '自由观景';
  }

  $('settings-toggle').addEventListener('click', function () { setSettings($('scene-controls').hidden); });
  $('sources-toggle').addEventListener('click', function () { setSources($('sources-drawer').hidden); });
  $('sources-close').addEventListener('click', function () { setSources(false); });
  $('pick-close').addEventListener('click', function () { $('pick-card').hidden = true; $('world').focus({ preventScroll: true }); });
  $('reload-button').addEventListener('click', function () { window.location.reload(); });

  document.querySelectorAll('[data-view]').forEach(function (button) {
    button.addEventListener('click', function () {
      invoke('setView', button.dataset.view);
      setViewState(button.dataset.view);
      $('pick-card').hidden = true;
      syncState();
    });
  });
  document.querySelectorAll('[data-option]').forEach(function (input) {
    input.addEventListener(input.type === 'range' ? 'input' : 'change', function () {
      var value = input.type === 'checkbox' ? input.checked : Number(input.value);
      invoke('setOption', input.dataset.option, value);
      updateRangeLabels();
    });
  });
  $('tour-button').addEventListener('click', function () {
    var result = invoke('toggleTour');
    setTourState(typeof result === 'boolean' ? result : $('tour-button').getAttribute('aria-pressed') !== 'true');
    syncState();
  });
  $('screenshot-button').addEventListener('click', function () {
    if (!isReady || !app() || typeof app().screenshot !== 'function') return;
    var result;
    try { result = app().screenshot(); }
    catch (error) { console.error('画面保存失败：', error); toast('画面暂未保存，请稍后再试'); return; }
    if (result && typeof result.then === 'function') result.then(function () { toast('已请求保存当前画面'); }).catch(function () { toast('画面暂未保存，请稍后再试'); });
    else toast('已请求保存当前画面');
  });
  $('reset-button').addEventListener('click', function () {
    invoke('reset');
    document.querySelectorAll('[data-option]').forEach(function (input) {
      var value = defaults[input.dataset.option];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    });
    setTourState(false);
    setViewState('pano');
    $('pick-card').hidden = true;
    updateRangeLabels();
    syncState();
    toast('已回到初始山湖');
  });
  window.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!$('sources-drawer').hidden) setSources(false);
    else if (!$('pick-card').hidden) { $('pick-card').hidden = true; $('world').focus({ preventScroll: true }); }
    else if (!$('scene-controls').hidden) setSettings(false, true);
  });
  $('world').addEventListener('webglcontextlost', function () { showError('三维显示暂时中断，请重新载入场景。'); });
  window.addEventListener('ds:ready', markReady);
  window.addEventListener('ds:stats', function (event) { updateStats(event.detail); });
  window.addEventListener('ds:pick', function (event) { showPick(event.detail); });
  window.addEventListener('ds:error', function (event) { showError(safeText(event.detail && (event.detail.message || event.detail))); });
  window.addEventListener('error', function (event) {
    if (event.filename && /(?:scene|scene-data)\.js(?:\?|$)/.test(event.filename)) showError('场景未能正常展开，请重新载入；若仍失败，请确认本地场景与数据文件完整。');
  });
  if (mobile.addEventListener) mobile.addEventListener('change', function (event) { if (event.matches) setSettings(false); });
  setSettings(false);
  updateRangeLabels();
  window.DSUI = { showError: showError, ready: markReady, syncState: syncState, showPick: showPick, toast: toast };
  if (document.documentElement.dataset.assetError) showError('本地渲染组件或地理数据未能载入，请确认 vendor 与 data 文件夹完整。');
  window.setTimeout(function () {
    if (!isReady && !hasFailed) $('loading-description').textContent = '仍在整理山体与聚落，复杂场景可能需要片刻';
  }, 18000);
})();
