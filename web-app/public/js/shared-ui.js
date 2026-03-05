import { t } from './i18n.js';

export function renderBottomTabBar(activePage = 'monitoring') {
  const nav = document.createElement('nav');
  nav.className = 'bottom-tab-bar';
  nav.innerHTML = `
    <a href="/" class="bottom-tab ${activePage === 'monitoring' ? 'active' : ''}">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="18" rx="2"/>
        <line x1="2" y1="9" x2="22" y2="9"/>
        <line x1="12" y1="9" x2="12" y2="21"/>
      </svg>
      <span data-i18n="nav.monitoring">${t('nav.monitoring')}</span>
    </a>
    <a href="/docs.html" class="bottom-tab ${activePage === 'docs' ? 'active' : ''}">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      <span data-i18n="nav.docs">${t('nav.docs')}</span>
    </a>
    <button class="bottom-tab" id="bottomTabSettings">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      <span data-i18n="nav.settings">${t('nav.settings')}</span>
    </button>
  `;
  document.body.appendChild(nav);
}

export function renderSettingsPanel({ fullSettings = true } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.id = 'settingsOverlay';

  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.id = 'settingsPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Settings');

  let alertGroupHTML = '';
  if (fullSettings) {
    alertGroupHTML = `
      <div class="setting-group">
        <div class="setting-group-title" data-i18n="settings.alertGroup">${t('settings.alertGroup')}</div>
        <div id="globalThresholdInputs">
          <div class="setting-row">
            <span class="setting-label" data-i18n="settings.alertHigh">${t('settings.alertHigh')}</span>
            <input type="number" class="setting-input" id="alertHigh" step="0.5" value="8">
          </div>
          <div class="setting-row">
            <span class="setting-label" data-i18n="settings.alertLow">${t('settings.alertLow')}</span>
            <input type="number" class="setting-input" id="alertLow" step="0.5" value="-25">
          </div>
        </div>
        <div id="deviceThresholdContainer"></div>
        <div class="setting-row">
          <span class="setting-label" data-i18n="settings.alertEnabled">${t('settings.alertEnabled')}</span>
          <button class="toggle-switch" id="alertEnabled" type="button" role="switch" aria-checked="false"></button>
        </div>
        <div class="setting-row">
          <span class="setting-label" data-i18n="settings.notifEnabled">${t('settings.notifEnabled')}</span>
          <button class="toggle-switch" id="notifEnabled" type="button" role="switch" aria-checked="false"></button>
        </div>
        <div class="setting-row">
          <span class="setting-label" data-i18n="settings.soundEnabled">${t('settings.soundEnabled')}</span>
          <button class="toggle-switch" id="soundEnabled" type="button" role="switch" aria-checked="false"></button>
        </div>
      </div>
      <div class="setting-group">
        <div class="setting-group-title" data-i18n="settings.chartGroup">${t('settings.chartGroup')}</div>
        <div class="setting-row">
          <span class="setting-label" data-i18n="settings.showThresholdLines">${t('settings.showThresholdLines')}</span>
          <button class="toggle-switch on" id="showThresholdLines" type="button" role="switch" aria-checked="true"></button>
        </div>
        <div class="setting-row">
          <span class="setting-label" data-i18n="settings.tempUnit">${t('settings.tempUnit')}</span>
          <button class="toggle-switch" id="tempUnitSwitch" type="button" role="switch" aria-checked="false"></button>
        </div>
      </div>`;
  }

  panel.innerHTML = `
    <div class="settings-header">
      <h2 data-i18n="settings.title">${t('settings.title')}</h2>
      <button class="settings-close" id="settingsClose" aria-label="Close settings">&times;</button>
    </div>
    <div class="settings-body">
      ${alertGroupHTML}
      <div class="setting-group">
        <div class="setting-group-title" data-i18n="settings.themeGroup">${t('settings.themeGroup')}</div>
        <div class="setting-row">
          <span class="setting-label" data-i18n="settings.darkMode">${t('settings.darkMode')}</span>
          <button class="toggle-switch" id="themeSwitch" type="button" role="switch" aria-checked="false"></button>
        </div>
      </div>
      <div class="setting-group">
        <div class="setting-group-title" data-i18n="settings.langGroup">${t('settings.langGroup')}</div>
        <div class="setting-row lang-row">
          <span class="lang-flag" id="flagKo">\u{1F1F0}\u{1F1F7}</span>
          <button class="toggle-switch" id="langSwitch" type="button" role="switch" aria-checked="false"></button>
          <span class="lang-flag" id="flagEn">\u{1F1FA}\u{1F1F8}</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(panel);
}
