import { loadSettings, getThresholdsForDevice, toDisplayTemp } from './settings.js';
import { getSelectedDevice } from './devices.js';
import { t, getLocale } from './i18n.js';

const MAX_CHART_POINTS = 500;

let chartMeta = null;
let lastChartData = null;
let lastPeriodHours = 24;
let resizeObserverInitialized = false;
let touchStartX = 0;
let touchStartY = 0;
let isDraggingChart = false;

// 대량 데이터 다운샘플링 (LTTB 간소화)
function downsample(data, maxPoints) {
  if (data.length <= maxPoints) return data;
  const result = [data[0]];
  const bucketSize = (data.length - 2) / (maxPoints - 2);
  for (let i = 1; i < maxPoints - 1; i++) {
    const start = Math.floor((i - 1) * bucketSize) + 1;
    const end = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1);
    let maxArea = -1;
    let pick = start;
    const prev = result[result.length - 1];
    for (let j = start; j < end; j++) {
      const area = Math.abs(
        (prev.time.getTime() - data[j].time.getTime()) * (data[end]?.temperature || 0) -
        (prev.time.getTime() - (data[end]?.time.getTime() || 0)) * data[j].temperature
      );
      if (area > maxArea) { maxArea = area; pick = j; }
    }
    result.push(data[pick]);
  }
  result.push(data[data.length - 1]);
  return result;
}

// ===== 스무스 커브 헬퍼 =====
function drawSmoothLine(ctx, points, close) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const cur = points[i];
    const next = points[i + 1];
    const mx = (cur.x + next.x) / 2;
    const my = (cur.y + next.y) / 2;
    ctx.quadraticCurveTo(cur.x, cur.y, mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  if (close) {
    ctx.lineTo(close.x, close.y);
    ctx.lineTo(close.x2, close.y);
    ctx.closePath();
  }
}

export function drawChart(data, periodHours = 24) {
  const canvas = document.getElementById('chart');
  if (!canvas) return;

  lastChartData = data;
  lastPeriodHours = periodHours;

  if (!resizeObserverInitialized && typeof ResizeObserver !== 'undefined') {
    resizeObserverInitialized = true;
    new ResizeObserver(() => {
      if (lastChartData) drawChart(lastChartData, lastPeriodHours);
    }).observe(canvas.parentElement);
  }

  const settings = loadSettings();
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padding = { top: 10, right: 10, bottom: 30, left: 40 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  // ARIA 접근성
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${t('app.chart.title') || 'Temperature chart'}, ${periodHours}h`);

  const rawSorted = [...data].reverse();
  const sorted = downsample(rawSorted, MAX_CHART_POINTS);
  const temps = sorted.map(d => toDisplayTemp(d.temperature, settings));

  const selectedDevice = getSelectedDevice();
  const thresholds = getThresholdsForDevice(settings, selectedDevice);
  const dispHigh = toDisplayTemp(thresholds.alertHigh, settings);
  const dispLow = toDisplayTemp(thresholds.alertLow, settings);

  let minVal = Infinity, maxVal = -Infinity;
  for (const v of temps) {
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  if (settings.alertEnabled && settings.showThresholdLines) {
    minVal = Math.min(minVal, dispLow);
    maxVal = Math.max(maxVal, dispHigh);
  }
  const minT = Math.floor(minVal - 1);
  const maxT = Math.ceil(maxVal + 1);
  const rangeT = maxT - minT || 1;

  ctx.clearRect(0, 0, w, h);
  const isDark = settings.theme === 'dark';

  // 알림 구간 빨간 배경 하이라이트
  if (settings.alertEnabled && settings.showThresholdLines) {
    const highY = padding.top + chartH - ((dispHigh - minT) / rangeT) * chartH;
    const lowY = padding.top + chartH - ((dispLow - minT) / rangeT) * chartH;

    if (highY > padding.top) {
      ctx.fillStyle = 'rgba(239,68,68,0.06)';
      ctx.fillRect(padding.left, padding.top, chartW, Math.max(0, highY - padding.top));
    }
    if (lowY < padding.top + chartH) {
      ctx.fillStyle = 'rgba(59,130,246,0.06)';
      ctx.fillRect(padding.left, lowY, chartW, Math.max(0, padding.top + chartH - lowY));
    }
  }

  // Y축 그리드 + 라벨
  ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
  ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const val = minT + (rangeT * i / ySteps);
    const y = padding.top + chartH - (chartH * i / ySteps);
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(val.toFixed(1) + '°', padding.left - 6, y + 4);
  }

  // 임계값 점선 라인
  if (settings.alertEnabled && settings.showThresholdLines) {
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;

    const highY = padding.top + chartH - ((dispHigh - minT) / rangeT) * chartH;
    if (highY >= padding.top && highY <= padding.top + chartH) {
      ctx.strokeStyle = '#f87171';
      ctx.beginPath();
      ctx.moveTo(padding.left, highY);
      ctx.lineTo(w - padding.right, highY);
      ctx.stroke();
      ctx.fillStyle = '#f87171';
      ctx.textAlign = 'left';
      ctx.fillText(`${t('chart.high')} ${dispHigh.toFixed(1)}°`, padding.left + 4, highY - 4);
    }

    const lowY = padding.top + chartH - ((dispLow - minT) / rangeT) * chartH;
    if (lowY >= padding.top && lowY <= padding.top + chartH) {
      ctx.strokeStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(padding.left, lowY);
      ctx.lineTo(w - padding.right, lowY);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.textAlign = 'left';
      ctx.fillText(`${t('chart.low')} ${dispLow.toFixed(1)}°`, padding.left + 4, lowY - 4);
    }

    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
  }

  // X축 시간 라벨
  const locale = getLocale();
  ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
  ctx.textAlign = 'center';
  const xLabelCount = Math.min(5, sorted.length);
  const showDate = periodHours > 24;
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.floor(i * (sorted.length - 1) / (xLabelCount - 1));
    const x = padding.left + (idx / (sorted.length - 1)) * chartW;
    const time = sorted[idx].time;
    const label = showDate
      ? time.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) + ' ' + time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(label, x, h - 6);
  }

  if (sorted.length < 2) return;

  // 포인트 좌표 계산
  const points = temps.map((temp, i) => ({
    x: padding.left + (i / (sorted.length - 1)) * chartW,
    y: padding.top + chartH - ((temp - minT) / rangeT) * chartH
  }));

  // 그래프 그라데이션 영역 (스무스 커브)
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, isDark ? 'rgba(56, 189, 248, 0.3)' : 'rgba(56, 189, 248, 0.2)');
  gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');

  drawSmoothLine(ctx, points, { x: padding.left + chartW, x2: padding.left, y: padding.top + chartH });
  ctx.fillStyle = gradient;
  ctx.fill();

  // 라인 (스무스 커브 + 글로우)
  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(56, 189, 248, 0.5)' : 'rgba(56, 189, 248, 0.3)';
  ctx.shadowBlur = isDark ? 12 : 6;
  drawSmoothLine(ctx, points);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // 최신 포인트
  const lastPt = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(lastPt.x, lastPt.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.strokeStyle = isDark ? '#0f172a' : '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 호버용 이미지 데이터 저장
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // 터치/마우스 인터랙션
  chartMeta = { sorted, temps, padding, chartW, chartH, minT, rangeT, w, h, settings, points, isDark, imageData };
  canvas.onmousemove = handleChartHover;
  canvas.onmouseleave = () => {
    // 원본 차트 복원
    if (chartMeta && chartMeta.imageData) {
      const c = document.getElementById('chart');
      if (c) c.getContext('2d').putImageData(chartMeta.imageData, 0, 0);
    }
    const tip = document.getElementById('chartTooltip');
    if (tip) tip.classList.remove('visible');
  };

  canvas.ontouchstart = (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isDraggingChart = false;
  };
  canvas.ontouchmove = (e) => {
    if (!chartMeta || e.touches.length !== 1) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX);
    const dy = Math.abs(e.touches[0].clientY - touchStartY);
    if (!isDraggingChart && dx > 10 && dx > dy * 1.5) {
      isDraggingChart = true;
    }
    if (isDraggingChart) {
      e.preventDefault();
      handleChartHoverFromEvent(e);
    }
  };
  canvas.ontouchend = () => {
    isDraggingChart = false;
    if (chartMeta && chartMeta.imageData) {
      const c = document.getElementById('chart');
      if (c) c.getContext('2d').putImageData(chartMeta.imageData, 0, 0);
    }
    const tip = document.getElementById('chartTooltip');
    if (tip) tip.classList.remove('visible');
  };
}

function handleChartHover(e) {
  if (!chartMeta) return;
  handleChartHoverFromEvent(e);
}

function handleChartHoverFromEvent(e) {
  const canvas = document.getElementById('chart');
  const tip = document.getElementById('chartTooltip');
  if (!canvas || !tip) return;

  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const x = clientX - rect.left;
  const { sorted, temps, padding, chartW, chartH, minT, rangeT, settings, points, isDark, imageData } = chartMeta;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  const ratio = (x - padding.left) / chartW;
  const idx = Math.round(ratio * (sorted.length - 1));
  if (idx < 0 || idx >= sorted.length) { tip.classList.remove('visible'); return; }

  // 원본 복원
  if (imageData) {
    ctx.putImageData(imageData, 0, 0);
  }

  const pt = points[idx];
  const d = sorted[idx];
  const dispTemp = temps[idx];

  // 수직 커서라인
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.4)' : 'rgba(100,116,139,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pt.x * 1, padding.top);
  ctx.lineTo(pt.x * 1, padding.top + chartH);
  ctx.stroke();
  ctx.setLineDash([]);

  // 확대 포인트
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? 'rgba(56,189,248,0.2)' : 'rgba(56,189,248,0.15)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.strokeStyle = isDark ? '#0f172a' : '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 툴팁
  const unitStr = settings.tempUnit === 'F' ? '°F' : '°C';
  const locale = getLocale();
  const timeStr = d.time.toLocaleTimeString(locale, { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  tip.innerHTML = `<strong>${dispTemp.toFixed(2)}${unitStr}</strong><br>${timeStr}`;
  tip.classList.add('visible');

  const tipX = Math.min(Math.max(x - 40, 0), rect.width - 100);
  const tipY = pt.y - 40;
  tip.style.left = tipX + 'px';
  tip.style.top = Math.max(0, tipY) + 'px';
}
