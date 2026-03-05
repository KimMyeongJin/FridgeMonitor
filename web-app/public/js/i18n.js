let translations = {};
let currentLang = 'ko';

export async function initI18n() {
  currentLang = localStorage.getItem('fridgeLang') || 'ko';
  try {
    const res = await fetch(`/locales/${currentLang}.json`);
    translations = await res.json();
  } catch {
    translations = {};
  }
  document.documentElement.lang = currentLang;
  applyI18n();
}

export function t(key, params) {
  let str = translations[key] || key;
  if (params) {
    Object.keys(params).forEach(k => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
  }
  return str;
}

export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
}

export function getLang() {
  return currentLang;
}

export function getLocale() {
  return currentLang === 'ko' ? 'ko-KR' : 'en-US';
}

export async function setLang(lang) {
  localStorage.setItem('fridgeLang', lang);
  currentLang = lang;
  try {
    const res = await fetch(`/locales/${lang}.json`);
    translations = await res.json();
  } catch { /* 로케일 로드 실패 시 기존 번역 유지 */ }
  document.documentElement.lang = lang;
  applyI18n();
}
