import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getFirestore, collection, query, orderBy, limit, onSnapshot, where, getDocs, writeBatch, Timestamp, doc, getDoc, setDoc, addDoc, serverTimestamp, deleteDoc }
  from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider }
  from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app-check.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// App Check: Firebase 콘솔에서 reCAPTCHA v3 사이트 키를 발급받아 아래 값을 교체하세요.
// 설정 방법: Firebase 콘솔 → App Check → reCAPTCHA v3 등록 → 사이트 키 복사
const RECAPTCHA_SITE_KEY = 'YOUR_RECAPTCHA_V3_SITE_KEY';
if (RECAPTCHA_SITE_KEY !== 'YOUR_RECAPTCHA_V3_SITE_KEY') {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch { /* App Check 초기화 실패 시 무시 */ }
}

export { db, auth, collection, query, orderBy, limit, onSnapshot, where, getDocs, writeBatch, Timestamp, doc, getDoc, setDoc, signInAnonymously, addDoc, serverTimestamp, onAuthStateChanged, deleteDoc };
