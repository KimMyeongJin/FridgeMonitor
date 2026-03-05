import { loadSettings, saveSettings } from './settings.js';

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const metaColor = document.getElementById('metaThemeColor');
  if (metaColor) metaColor.content = theme === 'dark' ? '#1e293b' : '#3b82f6';
}

export function initTheme() {
  const settings = loadSettings();

  // 사용자가 수동으로 테마를 설정한 적이 없으면 시스템 설정 따르기
  if (!settings.themeManual && window.matchMedia) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const systemTheme = prefersDark ? 'dark' : 'light';
    settings.theme = systemTheme;
    saveSettings(settings);
    applyTheme(systemTheme);
  } else {
    applyTheme(settings.theme);
  }

  // 시스템 테마 변경 리스너 (사용자가 수동 설정하지 않은 경우에만 반응)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const currentSettings = loadSettings();
      // 사용자가 themeManual 플래그를 설정한 경우 시스템 변경 무시
      if (currentSettings.themeManual) return;
      const newTheme = e.matches ? 'dark' : 'light';
      currentSettings.theme = newTheme;
      saveSettings(currentSettings);
      applyTheme(newTheme);
    });
  }
}
