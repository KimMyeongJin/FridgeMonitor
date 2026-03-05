import { db, auth, collection, query, orderBy, limit, onSnapshot, where, Timestamp, doc, getDoc, setDoc, signInAnonymously, getDocs } from './firebase-init.js';
import { loadSettings, initSettingsPanel, getThresholdsForDevice, toDisplayTemp, tempUnitLabel } from './settings.js';
import { initTheme, applyTheme } from './theme.js';
import { getSelectedDevice, addKnownDevice, updateDeviceTabs } from './devices.js';
import { drawChart } from './chart.js';
import { runCleanupIfNeeded } from './cleanup.js';
import { initI18n, t, getLocale, setLang } from './i18n.js';
import { renderBottomTabBar, renderSettingsPanel } from './shared-ui.js';
import { initChat } from './chat.js';

// ===== 토스트 알림 시스템 =====
let toastContainer = null;

export function showToast(msg, type = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ===== PWA 설치 프롬프트 =====
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (document.getElementById('pwa-install-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.innerHTML = `
    <span>${t('app.pwa.installMsg') || '홈 화면에 앱을 추가하세요!'}</span>
    <button id="pwa-install-btn" class="pwa-install-btn">${t('app.pwa.install') || '설치'}</button>
    <button id="pwa-dismiss-btn" class="pwa-dismiss-btn">&times;</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('pwa-install-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    banner.remove();
  });
  document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('pwaDismissed', Date.now().toString());
  });
}

// ===== 상태 =====
let allData = [];
let currentPeriod = 24;
let previousTemp = null;
let unsubscribe = null;
let isConnected = true;
let lastAlertTime = 0;
let isOfflineMode = false;
let historyLimit = 10;

// ===== 오프라인 캐시 =====
const DATA_CACHE_KEY = 'fridgeDataCache';

function cacheData(data) {
  try {
    const toCache = data.slice(0, 200).map(d => ({
      temperature: d.temperature,
      time: d.time.getTime(),
      alert: d.alert,
      device_id: d.device_id
    }));
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: toCache }));
  } catch { /* 캐시 저장 실패 무시 */ }
}

function loadCachedData() {
  try {
    const raw = JSON.parse(localStorage.getItem(DATA_CACHE_KEY));
    if (!raw || !raw.data) return null;
    return {
      ts: raw.ts,
      data: raw.data.map(d => ({ ...d, time: new Date(d.time) }))
    };
  } catch { return null; }
}

// ===== 인증 재시도 =====
function tryAuth(attempt) {
  signInAnonymously(auth).then(() => {
    startRealtimeListener();
    discoverDevices();
    runCleanupIfNeeded(30);
  }).catch(err => {
    const delay = Math.min(2 ** attempt, 30);
    const app = document.getElementById('app');
    app.innerHTML = `<div class="loading">
      <div>${t('app.authFail', { msg: esc(err.message) })}</div>
      <button class="retry-btn" id="retryAuth">${t('app.authRetry', { sec: delay })}</button>
    </div>`;
    let remaining = delay;
    const btn = document.getElementById('retryAuth');
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        tryAuth(attempt + 1);
      } else {
        btn.textContent = t('app.authRetry', { sec: remaining });
      }
    }, 1000);
    btn.addEventListener('click', () => {
      clearInterval(timer);
      app.innerHTML = getSkeletonHTML();
      tryAuth(1);
    });
  });
}

// ===== 스켈레톤 로딩 HTML =====
function getSkeletonHTML() {
  return `
    <div class="skeleton skeleton-temp-card"></div>
    <div class="skeleton-stats">
      <div class="skeleton skeleton-stat"></div>
      <div class="skeleton skeleton-stat"></div>
      <div class="skeleton skeleton-stat"></div>
    </div>
    <div class="skeleton skeleton-chart"></div>
    <div class="skeleton skeleton-history"></div>
  `;
}

// ===== 초기화 =====
async function init() {
  await initI18n();
  initTheme();
  renderSettingsPanel({ fullSettings: true });
  renderBottomTabBar('monitoring');
  renderConnectionBanner();
  initChat();
  initSettingsPanel({
    onClose: () => {
      render();
      showToast(t('toast.settingsSaved'), 'success');
    },
    onThemeChange: (theme) => applyTheme(theme),
    onLangChange: async (lang) => { await setLang(lang); render(); }
  });

  // 초기 스켈레톤 표시
  document.getElementById('app').innerHTML = getSkeletonHTML();

  tryAuth(1);
}

init();

// ===== 유틸 =====
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function getRelativeTime(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 10) return t('app.time.justNow');
  if (diff < 60) return t('app.time.secAgo', { n: diff });
  if (diff < 3600) return t('app.time.minAgo', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('app.time.hourAgo', { n: Math.floor(diff / 3600) });
  return t('app.time.dayAgo', { n: Math.floor(diff / 86400) });
}

function getFilteredData(hours) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return allData.filter(d => d.time >= cutoff);
}

// ===== 알림 이력 =====
const ALERT_LOG_KEY = 'fridgeAlertLog';
const ALERT_LOG_MAX = 50;

function saveAlertLog(entry) {
  try {
    const logs = JSON.parse(localStorage.getItem(ALERT_LOG_KEY) || '[]');
    logs.unshift(entry);
    if (logs.length > ALERT_LOG_MAX) logs.length = ALERT_LOG_MAX;
    localStorage.setItem(ALERT_LOG_KEY, JSON.stringify(logs));
  } catch { /* ignore */ }
}

function getAlertLogs() {
  try { return JSON.parse(localStorage.getItem(ALERT_LOG_KEY) || '[]'); }
  catch { return []; }
}

function clearAlertLogs() {
  localStorage.removeItem(ALERT_LOG_KEY);
  render();
  showToast(t('toast.alertsCleared'), 'info');
}

// ===== 알림 =====
let alertAudioCtx = null;

function playAlertSound() {
  try {
    if (!alertAudioCtx || alertAudioCtx.state === 'closed') {
      alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = alertAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'square';
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0, ctx.currentTime + 0.40);
    gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.50);
    gain.gain.setValueAtTime(0, ctx.currentTime + 0.65);
    osc.stop(ctx.currentTime + 0.7);
  } catch { /* 소리 재생 실패 무시 */ }
}

function checkAndAlert(temp, deviceId) {
  const settings = loadSettings();
  if (!settings.alertEnabled) return;
  const now = Date.now();
  if (now - lastAlertTime < 60000) return;

  const thresholds = getThresholdsForDevice(settings, deviceId);
  const isHigh = temp > thresholds.alertHigh;
  const isLow = temp < thresholds.alertLow;

  if (isHigh || isLow) {
    lastAlertTime = now;
    const msg = isHigh
      ? t('app.alert.highExceed', { temp: temp.toFixed(1), limit: thresholds.alertHigh })
      : t('app.alert.lowBelow', { temp: temp.toFixed(1), limit: thresholds.alertLow });

    saveAlertLog({ time: now, temp, deviceId, type: isHigh ? 'high' : 'low', msg });

    if (settings.soundEnabled) playAlertSound();
    if (settings.notifEnabled && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(t('app.notification.title'), { body: msg, icon: '/favicon.svg' });
    }
  }
}

// ===== 오프라인 캐시 로드 =====
function loadFromCache() {
  const cached = loadCachedData();
  if (!cached) return;
  isOfflineMode = true;
  allData = cached.data;
  render();
}

// ===== 연결 상태 배너 =====
function renderConnectionBanner() {
  const banner = document.createElement('div');
  banner.className = 'connection-banner';
  banner.id = 'connection-banner';
  const deviceTabs = document.getElementById('deviceTabs');
  const header = document.querySelector('.header');
  const ref = deviceTabs || header;
  if (ref && ref.nextSibling) {
    ref.parentNode.insertBefore(banner, ref.nextSibling);
  } else if (ref) {
    ref.parentNode.appendChild(banner);
  }
}

function updateConnectionUI() {
  const banner = document.getElementById('connection-banner');
  if (!banner) return;
  const online = navigator.onLine && isConnected;

  if (isOfflineMode) {
    const cached = loadCachedData();
    const timeStr = cached ? new Date(cached.ts).toLocaleTimeString() : '';
    banner.innerHTML = `<span class="dot dot-off"></span>${t('app.connection.offline', { time: timeStr })}`;
    banner.classList.add('visible');
  } else if (!online) {
    banner.innerHTML = `<span class="dot dot-off"></span>${t('app.connection.off')}`;
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

window.addEventListener('online', () => { isConnected = true; updateConnectionUI(); });
window.addEventListener('offline', () => { isConnected = false; updateConnectionUI(); });
setInterval(() => { if (allData.length > 0) render(); }, 60000);

// ===== Firebase 리스너 =====
async function discoverDevices() {
  const q = query(collection(db, "temperatures"), orderBy("recorded_at", "desc"), limit(500));
  const snapshot = await getDocs(q);
  snapshot.forEach(d => addKnownDevice(d.data().device_id));
  updateDeviceTabs(startRealtimeListener);
}

function getLimitForPeriod(hours) {
  if (hours <= 6) return 400;
  if (hours <= 24) return 1500;
  if (hours <= 72) return 3000;
  return 5000;
}

function startRealtimeListener() {
  if (unsubscribe) unsubscribe();

  const docLimit = getLimitForPeriod(currentPeriod);
  const cutoff = Timestamp.fromDate(new Date(Date.now() - currentPeriod * 60 * 60 * 1000));

  const constraints = [
    collection(db, "temperatures"),
    where("recorded_at", ">", cutoff),
    orderBy("recorded_at", "desc"),
    limit(docLimit)
  ];

  const device = getSelectedDevice();
  if (device !== 'all') {
    constraints.splice(1, 0, where("device_id", "==", device));
  }

  const q = query(...constraints);

  unsubscribe = onSnapshot(q, (snapshot) => {
    isConnected = true;
    isOfflineMode = false;
    updateConnectionUI();
    allData = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      allData.push({
        temperature: d.temperature,
        time: d.recorded_at.toDate(),
        alert: d.alert || false,
        device_id: d.device_id
      });
    });
    console.log('[App] onSnapshot received:', allData.length, 'docs');
    cacheData(allData);
    try { render(); } catch (e) { console.error('[App] render() error:', e); }
  }, (err) => {
    console.error('[App] onSnapshot error:', err);
    isConnected = false;
    updateConnectionUI();
    if (allData.length === 0) loadFromCache();
  });
}

// ===== SVG 반원 게이지 헬퍼 =====
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 180) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}


// ===== 숫자 카운트업 =====
function animateValue(el, from, to, duration) {
  if (from === to) return;
  const start = performance.now();
  const diff = to - from;
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = from + diff * eased;
    el.textContent = current.toFixed(1) + '°';
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ===== 데이터 스토리텔링 =====
function generateStorySummary(filtered, settings) {
  if (filtered.length < 4) return '';
  const temps = filtered.map(d => d.temperature);
  const n = temps.length;
  const mean = temps.reduce((a, b) => a + b, 0) / n;
  const variance = temps.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  // 전반 vs 후반 비교 (filtered는 desc 순서)
  const half = Math.floor(n / 2);
  const recentAvg = temps.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const olderAvg = temps.slice(half).reduce((a, b) => a + b, 0) / (n - half);
  const delta = recentAvg - olderAvg;

  let trend;
  if (stdDev < 0.3) trend = 'stable';
  else if (delta > 0.5) trend = 'rising';
  else if (delta < -0.5) trend = 'falling';
  else trend = 'volatile';

  const trendText = t(`app.story.${trend}`) || trend;
  const deltaSign = delta > 0 ? '+' : '';
  const deltaText = t('app.story.delta', { val: deltaSign + toDisplayTemp(Math.abs(delta), settings).toFixed(1) }) || `${deltaSign}${delta.toFixed(1)}°`;

  // 알림 빈도
  const alertCount = filtered.filter(d => d.alert).length;
  let alertText = '';
  if (alertCount > 0) {
    alertText = ' ' + (t('app.story.alertFreq', { n: alertCount }) || `${alertCount} alerts`);
  }

  const summary = (t('app.story.summary') || '{trend}. {delta}{alert}')
    .replace('{trend}', trendText)
    .replace('{delta}', deltaText)
    .replace('{alert}', alertText);

  return summary;
}

// ===== 렌더링 =====
let domInitialized = false;

function ensureDOM() {
  if (domInitialized) return;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="temp-card" id="r-temp-card">
      <div class="temp-label" id="r-temp-label"></div>
      <div class="temp-value" id="r-temp-value"></div>
      <span class="temp-trend" id="r-temp-trend"></span>
      <div class="radial-gauge" id="r-radial-gauge">
        <svg viewBox="0 0 200 120">
          <path class="gauge-arc-track" id="r-gauge-track"></path>
          <path class="gauge-arc-fill" id="r-gauge-fill-arc"></path>
          <circle class="gauge-dot" id="r-gauge-dot" r="6" fill="#fff"></circle>
          <text class="gauge-label" id="r-gauge-low-label" x="20" y="115" text-anchor="start"></text>
          <text class="gauge-label" id="r-gauge-high-label" x="180" y="115" text-anchor="end"></text>
          <text class="gauge-value-text" id="r-gauge-value-text" x="100" y="105" text-anchor="middle"></text>
        </svg>
      </div>
      <div class="temp-time" id="r-temp-time"></div>
      <div class="status-badge" id="r-status-badge" role="status"></div>
    </div>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-icon" id="r-stat-min-icon"></div>
        <div class="stat-label" id="r-stat-min-label"></div>
        <div class="stat-value stat-min" id="r-stat-min"></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" id="r-stat-avg-icon"></div>
        <div class="stat-label" id="r-stat-avg-label"></div>
        <div class="stat-value stat-avg" id="r-stat-avg"></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" id="r-stat-max-icon"></div>
        <div class="stat-label" id="r-stat-max-label"></div>
        <div class="stat-value stat-max" id="r-stat-max"></div>
      </div>
    </div>
    <div class="chart-section">
      <div class="chart-header">
        <div class="chart-title" id="r-chart-title"></div>
        <div class="chart-period" id="r-chart-period"></div>
      </div>
      <div class="chart-summary" id="r-chart-summary" style="display:none"></div>
      <div class="chart-canvas">
        <canvas id="chart"></canvas>
        <div class="chart-tooltip" id="chartTooltip"></div>
      </div>
    </div>
    <div class="history-section">
      <div class="history-header">
        <div class="history-title" id="r-history-title"></div>
        <button class="export-btn" id="r-export-btn"></button>
      </div>
      <div id="r-history-list"></div>
      <button class="more-btn" id="r-history-more" style="display:none"></button>
    </div>
    <div class="alert-log-section" id="r-alert-log-section" style="display:none">
      <div class="history-header">
        <div class="history-title" id="r-alert-log-title"></div>
        <button class="alert-clear-btn" id="r-alert-clear">${t('app.alertLog.clear')}</button>
      </div>
      <div id="r-alert-log-list"></div>
    </div>
  `;

  // 이벤트 위임: 기간 버튼 + CSV 내보내기
  document.getElementById('r-chart-period').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (btn) {
      currentPeriod = parseInt(btn.dataset.period);
      historyLimit = 10;
      startRealtimeListener();
    }
  });
  document.getElementById('r-export-btn').addEventListener('click', exportCSV);
  document.getElementById('r-history-more').addEventListener('click', () => {
    historyLimit += 20;
    render();
  });
  document.getElementById('r-alert-clear').addEventListener('click', clearAlertLogs);

  domInitialized = true;
}

// ===== 추세 화살표 =====
function getTrendArrow(current, previous) {
  if (previous === null) return { symbol: '', cls: '' };
  const diff = current - previous;
  if (diff > 0.1) return { symbol: '\u2191', cls: 'trend-up' };
  if (diff < -0.1) return { symbol: '\u2193', cls: 'trend-down' };
  return { symbol: '\u2192', cls: 'trend-stable' };
}

// ===== 디바이스 도트 클래스 =====
function getDeviceDotClass(deviceId) {
  if (!deviceId) return 'device-dot-default';
  if (deviceId.includes('fridge')) return 'device-dot-fridge';
  if (deviceId.includes('freezer')) return 'device-dot-freezer';
  return 'device-dot-default';
}

// ===== 기간 pill 인디케이터 =====
function updatePeriodIndicator() {
  const container = document.getElementById('r-chart-period');
  if (!container) return;
  const activeBtn = container.querySelector('.period-btn.active');
  if (!activeBtn) return;

  let indicator = container.querySelector('.period-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'period-indicator';
    container.appendChild(indicator);
  }

  requestAnimationFrame(() => {
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    indicator.style.left = (btnRect.left - containerRect.left) + 'px';
    indicator.style.width = btnRect.width + 'px';
  });
}

function render() {
  const settings = loadSettings();
  const filtered = getFilteredData(currentPeriod);
  if (filtered.length === 0) {
    domInitialized = false;
    document.getElementById('app').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="24" y="8" width="32" height="64" rx="4" stroke-width="2"/>
            <line x1="24" y1="18" x2="56" y2="18" stroke-width="1.5"/>
            <circle cx="40" cy="56" r="3" fill="currentColor" opacity="0.5"/>
            <line x1="40" y1="30" x2="40" y2="50" stroke-width="2"/>
            <circle cx="40" cy="28" r="2" fill="currentColor" opacity="0.3"/>
            <path d="M12 40 Q16 36 20 40 Q24 44 28 40" stroke-width="1" opacity="0.3"/>
            <path d="M52 40 Q56 36 60 40 Q64 44 68 40" stroke-width="1" opacity="0.3"/>
            <path d="M14 24 l2 -4 l2 4 M14 22 l2 -4 l2 4" stroke-width="0.8" opacity="0.2"/>
            <path d="M62 24 l2 -4 l2 4 M62 22 l2 -4 l2 4" stroke-width="0.8" opacity="0.2"/>
          </svg>
        </div>
        <div class="empty-state-text">${t('app.noData')}</div>
        <div class="empty-state-sub">${t('app.noDataSub')}</div>
      </div>`;
    return;
  }

  ensureDOM();

  const latest = filtered[0];
  let minTemp = Infinity, maxTemp = -Infinity, sum = 0;
  for (const d of filtered) {
    if (d.temperature < minTemp) minTemp = d.temperature;
    if (d.temperature > maxTemp) maxTemp = d.temperature;
    sum += d.temperature;
  }
  const avgTemp = sum / filtered.length;

  const device = getSelectedDevice();
  const latestThresholds = getThresholdsForDevice(settings, device === 'all' ? latest.device_id : device);
  const isThresholdAlert = settings.alertEnabled &&
    (latest.temperature > latestThresholds.alertHigh || latest.temperature < latestThresholds.alertLow);
  const isAlert = latest.alert || isThresholdAlert;

  if (previousTemp !== null && previousTemp !== latest.temperature) {
    checkAndAlert(latest.temperature, latest.device_id);
  }
  const tempChanged = previousTemp !== null && previousTemp !== latest.temperature;
  const trend = getTrendArrow(latest.temperature, previousTemp);
  previousTemp = latest.temperature;

  const locale = getLocale();
  const timeStr = latest.time.toLocaleString(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const agoStr = getRelativeTime(latest.time);
  const isStale = (Date.now() - latest.time.getTime()) > 10 * 60 * 1000;
  const deviceLabel = device === 'all' ? '' : ` (${esc(device)})`;

  // 동적 온도 색상
  const tempCard = document.getElementById('r-temp-card');
  const low = latestThresholds.alertLow;
  const high = latestThresholds.alertHigh;
  const range = high - low;

  if (range > 0) {
    const proximity = Math.min(
      Math.abs(latest.temperature - high),
      Math.abs(latest.temperature - low)
    );
    const threshold20 = range * 0.2;

    if (latest.temperature > high || latest.temperature < low) {
      // 위험: 빨강-주황
      tempCard.style.background = 'linear-gradient(135deg, #dc2626, #ea580c)';
    } else if (proximity < threshold20) {
      // 경고: 파랑-노랑
      tempCard.style.background = 'linear-gradient(135deg, #1e3a5f, #ca8a04)';
    } else {
      // 정상: 초록-청록
      tempCard.style.background = 'linear-gradient(135deg, #065f46, #0e7490)';
    }
  }

  // 부분 업데이트
  document.getElementById('r-temp-label').textContent = t('app.temp.label') + deviceLabel;

  const unit = tempUnitLabel(settings);
  const tempValEl = document.getElementById('r-temp-value');
  const newTempDisplay = toDisplayTemp(latest.temperature, settings);

  // 숫자 카운트업 애니메이션
  const prevDisplayTemp = parseFloat(tempValEl.dataset.prevTemp || newTempDisplay);
  tempValEl.innerHTML = `${newTempDisplay.toFixed(1)}<span class="unit"> ${unit}</span>`;
  tempValEl.className = 'temp-value' + (tempChanged ? ' changing' : '');
  tempValEl.dataset.prevTemp = newTempDisplay;

  if (tempChanged && Math.abs(prevDisplayTemp - newTempDisplay) > 0.01) {
    // 직접 카운트업 (unit span 제외)
    const from = prevDisplayTemp;
    const to = newTempDisplay;
    const start = performance.now();
    const duration = 600;
    const diff = to - from;
    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + diff * eased;
      tempValEl.innerHTML = `${current.toFixed(1)}<span class="unit"> ${unit}</span>`;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // 추세 화살표
  const trendEl = document.getElementById('r-temp-trend');
  if (trend.symbol) {
    trendEl.textContent = trend.symbol;
    trendEl.className = `temp-trend ${trend.cls}`;
  } else {
    trendEl.textContent = '';
  }

  // 반원형 게이지
  const cx = 100, cy = 100, r = 80;
  const trackPath = describeArc(cx, cy, r, 0, 180);
  document.getElementById('r-gauge-track').setAttribute('d', trackPath);

  const pct = range > 0 ? Math.max(0, Math.min(1, (latest.temperature - low) / range)) : 0.5;
  const fillAngle = pct * 180;
  const fillPath = describeArc(cx, cy, r, 0, Math.max(0.1, fillAngle));
  const fillArc = document.getElementById('r-gauge-fill-arc');
  fillArc.setAttribute('d', fillPath);
  const isInRange = latest.temperature >= low && latest.temperature <= high;
  const gaugeColor = getComputedStyle(document.documentElement).getPropertyValue(isInRange ? '--gauge-fill' : '--gauge-warn').trim();
  fillArc.style.stroke = gaugeColor;

  // 인디케이터 도트
  const dotPos = polarToCartesian(cx, cy, r, fillAngle);
  const gaugeDot = document.getElementById('r-gauge-dot');
  gaugeDot.setAttribute('cx', dotPos.x);
  gaugeDot.setAttribute('cy', dotPos.y);
  gaugeDot.style.fill = gaugeColor;

  document.getElementById('r-gauge-low-label').textContent = toDisplayTemp(low, settings).toFixed(0) + '°';
  document.getElementById('r-gauge-high-label').textContent = toDisplayTemp(high, settings).toFixed(0) + '°';
  document.getElementById('r-gauge-value-text').textContent = toDisplayTemp(latest.temperature, settings).toFixed(1) + '°';

  // 측정 시간
  const timeEl = document.getElementById('r-temp-time');
  if (isStale) {
    timeEl.innerHTML = `${agoStr} · ${timeStr} · <span class="temp-time-stale">${t('app.stale')}</span>`;
  } else {
    timeEl.textContent = agoStr + ' · ' + timeStr;
    timeEl.style.color = '';
  }

  const badgeEl = document.getElementById('r-status-badge');
  badgeEl.textContent = isAlert ? t('app.temp.alert') : t('app.temp.normal');
  badgeEl.className = 'status-badge ' + (isAlert ? 'status-alert' : 'status-normal');
  badgeEl.setAttribute('role', isAlert ? 'alert' : 'status');

  // 통계 카드 아이콘 (최초 1회만 설정)
  const minIcon = document.getElementById('r-stat-min-icon');
  if (minIcon && !minIcon.hasChildNodes()) {
    minIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/></svg>`;
    document.getElementById('r-stat-avg-icon').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 12 12"/><circle cx="12" cy="12" r="1" fill="#a78bfa"/></svg>`;
    document.getElementById('r-stat-max-icon').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/></svg>`;
  }

  document.getElementById('r-stat-min-label').textContent = t('app.stat.min');
  document.getElementById('r-stat-min').textContent = toDisplayTemp(minTemp, settings).toFixed(1) + '°';
  document.getElementById('r-stat-avg-label').textContent = t('app.stat.avg');
  document.getElementById('r-stat-avg').textContent = toDisplayTemp(avgTemp, settings).toFixed(1) + '°';
  document.getElementById('r-stat-max-label').textContent = t('app.stat.max');
  document.getElementById('r-stat-max').textContent = toDisplayTemp(maxTemp, settings).toFixed(1) + '°';

  document.getElementById('r-chart-title').textContent = t('app.chart.title');

  const periods = [
    { hours: 6, label: '6H' },
    { hours: 24, label: '24H' },
    { hours: 72, label: '3D' },
    { hours: 168, label: '7D' }
  ];
  document.getElementById('r-chart-period').innerHTML = periods.map(p =>
    `<button class="period-btn ${currentPeriod === p.hours ? 'active' : ''}" data-period="${p.hours}">${p.label}</button>`
  ).join('');

  // 기간 pill 인디케이터
  updatePeriodIndicator();

  // 데이터 스토리텔링
  const summaryEl = document.getElementById('r-chart-summary');
  const summaryText = generateStorySummary(filtered, settings);
  if (summaryText) {
    summaryEl.textContent = summaryText;
    summaryEl.style.display = '';
  } else {
    summaryEl.style.display = 'none';
  }

  document.getElementById('r-history-title').textContent = t('app.history.title');
  document.getElementById('r-export-btn').textContent = t('app.chart.export');

  // 이력 목록 (날짜 구분선 + 디바이스 도트 + 알림 항목 배경)
  const historyList = document.getElementById('r-history-list');
  const historySlice = filtered.slice(0, historyLimit);
  const showDateSeparator = currentPeriod >= 72;
  let lastDateStr = '';
  let historyHTML = '';
  let itemIndex = 0;

  for (const d of historySlice) {
    const dt = getThresholdsForDevice(settings, d.device_id);
    const isItemAlert = d.alert || (settings.alertEnabled && (d.temperature > dt.alertHigh || d.temperature < dt.alertLow));

    if (showDateSeparator) {
      const dateStr = d.time.toLocaleDateString(locale, { month: 'short', day: 'numeric', weekday: 'short' });
      if (dateStr !== lastDateStr) {
        lastDateStr = dateStr;
        historyHTML += `<div class="history-date-separator">${dateStr}</div>`;
      }
    }

    const timeText = d.time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dotClass = getDeviceDotClass(d.device_id);
    const deviceText = d.device_id ? esc(d.device_id) : '';
    const alertClass = isItemAlert ? ' history-item-alert' : '';
    const staggerStyle = itemIndex < 10 ? ` stagger-in" style="animation-delay:${itemIndex * 30}ms` : '';

    historyHTML += `<div class="history-item${alertClass}${staggerStyle}">
      <span class="history-time"><span class="device-dot ${dotClass}"></span>${timeText}${deviceText ? ' · ' + deviceText : ''}</span>
      <span class="history-temp" style="color: ${isItemAlert ? '#f87171' : 'var(--text-primary)'}">${toDisplayTemp(d.temperature, settings).toFixed(2)} ${unit}</span>
    </div>`;
    itemIndex++;
  }
  historyList.innerHTML = historyHTML;

  const moreBtn = document.getElementById('r-history-more');
  if (filtered.length > historyLimit) {
    moreBtn.style.display = '';
    moreBtn.textContent = t('app.history.more', { n: filtered.length - historyLimit });
  } else {
    moreBtn.style.display = 'none';
  }

  // 알림 이력
  const alertLogs = getAlertLogs();
  const alertSection = document.getElementById('r-alert-log-section');
  if (alertLogs.length > 0) {
    alertSection.style.display = '';
    document.getElementById('r-alert-log-title').textContent = t('app.alertLog.title');
    document.getElementById('r-alert-log-list').innerHTML = alertLogs.slice(0, 10).map(log => {
      const timeText = new Date(log.time).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const dotColor = log.type === 'high' ? '#f87171' : '#38bdf8';
      return `<div class="history-item">
        <span class="history-time"><span class="device-dot" style="background:${dotColor}"></span>${timeText}${log.deviceId ? ' · ' + esc(log.deviceId) : ''}</span>
        <span class="history-temp" style="color: ${log.type === 'high' ? '#f87171' : '#38bdf8'}">${toDisplayTemp(log.temp, settings).toFixed(1)} ${unit}</span>
      </div>`;
    }).join('');
  } else {
    alertSection.style.display = 'none';
  }

  updateConnectionUI();
  drawChart(filtered, currentPeriod);
}

// ===== CSV 내보내기 =====
function exportCSV() {
  const filtered = getFilteredData(currentPeriod);
  if (filtered.length === 0) return;
  const header = t('csv.header');
  const rows = filtered.map(d =>
    `${d.time.toISOString()},${d.temperature.toFixed(2)},${d.device_id || ''},${d.alert}`
  );
  const csv = '\uFEFF' + header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fridge_data_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(t('toast.csvExported'), 'success');
}
