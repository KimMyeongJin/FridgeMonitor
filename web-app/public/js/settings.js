import { t } from './i18n.js';
import { getKnownDevices } from './devices.js';

const defaultSettings = {
  alertHigh: 8,
  alertLow: -25,
  alertEnabled: false,
  notifEnabled: false,
  soundEnabled: false,
  showThresholdLines: true,
  tempUnit: 'C',
  theme: 'dark',
  deviceThresholds: {
    fridge_01:  { alertHigh: 8,   alertLow: 0 },
    freezer_01: { alertHigh: -15, alertLow: -25 }
  }
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('fridgeSettings'));
    const settings = { ...defaultSettings, ...saved };

    // 마이그레이션: 기존 설정에 deviceThresholds가 없으면 글로벌 값으로 초기화
    if (saved && !saved.deviceThresholds) {
      settings.deviceThresholds = {
        fridge_01:  { alertHigh: settings.alertHigh, alertLow: settings.alertLow },
        freezer_01: { alertHigh: settings.alertHigh, alertLow: settings.alertLow }
      };
      saveSettings(settings);
    }

    return settings;
  } catch { return { ...defaultSettings }; }
}

export function saveSettings(settings) {
  localStorage.setItem('fridgeSettings', JSON.stringify(settings));
}

export function toDisplayTemp(celsius, settings) {
  if (settings.tempUnit === 'F') return celsius * 9 / 5 + 32;
  return celsius;
}

export function tempUnitLabel(settings) {
  return settings.tempUnit === 'F' ? '°F' : '°C';
}

export function getThresholdsForDevice(settings, deviceId) {
  if (deviceId && deviceId !== 'all' && settings.deviceThresholds?.[deviceId])
    return settings.deviceThresholds[deviceId];
  return { alertHigh: settings.alertHigh, alertLow: settings.alertLow };
}

function syncLangFlags() {
  const isEn = document.getElementById('langSwitch')?.classList.contains('on');
  document.getElementById('flagKo')?.classList.toggle('dim', !!isEn);
  document.getElementById('flagEn')?.classList.toggle('dim', !isEn);
}

function setToggle(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('on', value);
  el.setAttribute('aria-checked', String(value));
}

export function initSettingsPanel(options = {}) {
  const { onClose, onThemeChange, onLangChange } = options;
  const panel = document.getElementById('settingsPanel');
  const overlay = document.getElementById('settingsOverlay');
  if (!panel || !overlay) return;

  let settingsFocusTrap = null;

  function open() {
    panel.classList.add('open');
    overlay.classList.add('open');
    syncUI();
    const firstInput = panel.querySelector('input, button:not(.settings-close)');
    if (firstInput) firstInput.focus();

    settingsFocusTrap = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = panel.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    panel.addEventListener('keydown', settingsFocusTrap);
  }

  function close() {
    panel.classList.remove('open');
    overlay.classList.remove('open');
    if (settingsFocusTrap) {
      panel.removeEventListener('keydown', settingsFocusTrap);
      settingsFocusTrap = null;
    }
    const s = readFromUI();
    saveSettings(s);
    if (onClose) onClose(s);
  }

  function syncUI() {
    const s = loadSettings();
    const alertHigh = document.getElementById('alertHigh');
    if (alertHigh) alertHigh.value = s.alertHigh;
    const alertLow = document.getElementById('alertLow');
    if (alertLow) alertLow.value = s.alertLow;
    setToggle('alertEnabled', s.alertEnabled);
    setToggle('notifEnabled', s.notifEnabled);
    setToggle('soundEnabled', s.soundEnabled);
    setToggle('showThresholdLines', s.showThresholdLines);
    setToggle('tempUnitSwitch', s.tempUnit === 'F');
    setToggle('themeSwitch', s.theme === 'dark');
    const currentLang = localStorage.getItem('fridgeLang') || 'ko';
    setToggle('langSwitch', currentLang === 'en');
    syncLangFlags();
    renderDeviceThresholds(s);
  }

  function readFromUI() {
    const s = loadSettings();
    const alertHigh = document.getElementById('alertHigh');
    if (alertHigh) s.alertHigh = parseFloat(alertHigh.value) || 8;
    const alertLow = document.getElementById('alertLow');
    if (alertLow) s.alertLow = parseFloat(alertLow.value) || -25;
    const alertEnabled = document.getElementById('alertEnabled');
    if (alertEnabled) s.alertEnabled = alertEnabled.classList.contains('on');
    const notifEnabled = document.getElementById('notifEnabled');
    if (notifEnabled) s.notifEnabled = notifEnabled.classList.contains('on');
    const soundEnabled = document.getElementById('soundEnabled');
    if (soundEnabled) s.soundEnabled = soundEnabled.classList.contains('on');
    const showThresholdLines = document.getElementById('showThresholdLines');
    if (showThresholdLines) s.showThresholdLines = showThresholdLines.classList.contains('on');
    const tempUnitSwitch = document.getElementById('tempUnitSwitch');
    if (tempUnitSwitch) s.tempUnit = tempUnitSwitch.classList.contains('on') ? 'F' : 'C';

    // 디바이스별 임계값 읽기
    const devices = getKnownDevices();
    if (devices.size > 1) {
      if (!s.deviceThresholds) s.deviceThresholds = {};
      devices.forEach(deviceId => {
        const highEl = document.getElementById(`dt-high-${deviceId}`);
        const lowEl = document.getElementById(`dt-low-${deviceId}`);
        if (highEl && lowEl) {
          s.deviceThresholds[deviceId] = {
            alertHigh: parseFloat(highEl.value) || 0,
            alertLow: parseFloat(lowEl.value) || 0
          };
        }
      });
    }

    return s;
  }

  function renderDeviceThresholds(s) {
    const devices = getKnownDevices();
    const globalDiv = document.getElementById('globalThresholdInputs');
    const deviceDiv = document.getElementById('deviceThresholdContainer');
    if (!globalDiv || !deviceDiv) return;

    if (devices.size > 1) {
      globalDiv.style.display = 'none';
      const sorted = Array.from(devices).sort();
      const html = sorted.map(deviceId => {
        const thresholds = getThresholdsForDevice(s, deviceId);
        const label = t(`device.${deviceId}`, {}) !== `device.${deviceId}` ? t(`device.${deviceId}`) : deviceId;
        return `
          <div class="device-threshold-section">
            <div class="setting-device-label">${label}</div>
            <div class="setting-row">
              <label for="dt-high-${deviceId}" class="setting-label">${t('settings.alertHigh')}</label>
              <input type="number" class="setting-input" id="dt-high-${deviceId}" step="0.5" value="${thresholds.alertHigh}">
            </div>
            <div class="setting-row">
              <label for="dt-low-${deviceId}" class="setting-label">${t('settings.alertLow')}</label>
              <input type="number" class="setting-input" id="dt-low-${deviceId}" step="0.5" value="${thresholds.alertLow}">
            </div>
          </div>
        `;
      }).join('');
      deviceDiv.innerHTML = html;
    } else {
      globalDiv.style.display = '';
      deviceDiv.innerHTML = '';
    }
  }

  document.getElementById('settingsClose')?.addEventListener('click', close);
  overlay.addEventListener('click', close);

  const headerSettingsBtn = document.getElementById('settingsBtn');
  if (headerSettingsBtn) headerSettingsBtn.addEventListener('click', open);

  const bottomSettingsBtn = document.getElementById('bottomTabSettings');
  if (bottomSettingsBtn) {
    bottomSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      open();
    });
  }

  document.querySelectorAll('.toggle-switch').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('on');
      btn.setAttribute('aria-checked', String(btn.classList.contains('on')));

      if (btn.id === 'notifEnabled' && btn.classList.contains('on')) {
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }

      if (btn.id === 'themeSwitch') {
        const newTheme = btn.classList.contains('on') ? 'dark' : 'light';
        const s = loadSettings();
        s.theme = newTheme;
        s.themeManual = true;
        saveSettings(s);
        if (onThemeChange) onThemeChange(newTheme);
      }

      if (btn.id === 'langSwitch') {
        syncLangFlags();
        const newLang = btn.classList.contains('on') ? 'en' : 'ko';
        if (onLangChange) onLangChange(newLang);
      }
    });
  });
}
