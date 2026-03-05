import { db, auth, collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, onAuthStateChanged, signInAnonymously, doc, getDoc, setDoc, Timestamp, getDocs, writeBatch, where, deleteDoc }
  from './firebase-init.js';
import { t, getLocale } from './i18n.js';

const NICKNAME_KEY = 'fridgeChatNickname';
const MSG_LIMIT = 50;
const SCROLL_THRESHOLD = 60;
const PRESENCE_INTERVAL = 60000;
const PRESENCE_STALE = 120000;
const TYPING_DEBOUNCE = 3000;
const TYPING_EXPIRE = 4000;

const ADJECTIVES = ['행복한', '용감한', '빠른', '조용한', '귀여운', '씩씩한', '느긋한', '밝은', '재빠른', '든든한'];
const ANIMALS = ['펭귄', '고래', '토끼', '부엉이', '다람쥐', '돌고래', '판다', '수달', '여우', '코알라'];

let chatOpen = false;
let unsubChat = null;
let currentUid = null;
let nickname = localStorage.getItem(NICKNAME_KEY) || '';
let unreadCount = 0;
let lastSeenMessageCount = 0;
let isSending = false;
let presenceInterval = null;
let unsubPresence = null;
let typingTimeout = null;
let lastTypingWrite = 0;
let unsubTyping = null;

// ===== 닉네임 자동 생성 =====
function generateNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

function ensureNickname() {
  if (!nickname) {
    nickname = generateNickname();
    localStorage.setItem(NICKNAME_KEY, nickname);
  }
}

// ===== Auth =====
function waitForAuth() {
  return new Promise((resolve) => {
    if (auth.currentUser) {
      resolve(auth.currentUser);
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) { unsub(); resolve(user); }
    });
    setTimeout(() => {
      if (!auth.currentUser) {
        signInAnonymously(auth).catch(err => {
          console.warn('[Chat] Auth failed:', err);
        });
      }
    }, 2000);
  });
}

// ===== 스마트 스크롤 =====
function isNearBottom(container) {
  return (container.scrollHeight - container.scrollTop - container.clientHeight) < SCROLL_THRESHOLD;
}

// ===== 읽지 않은 메시지 배지 =====
function updateBadge() {
  let badge = document.getElementById('chatBadge');
  if (unreadCount <= 0) {
    if (badge) badge.style.display = 'none';
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'chatBadge';
    badge.className = 'chat-fab-badge';
    document.getElementById('chatFab').appendChild(badge);
  }
  badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
  badge.style.display = '';
}

// ===== 전송 실패 피드백 =====
function showSendError() {
  const existing = document.getElementById('chatSendError');
  if (existing) existing.remove();

  const errorDiv = document.createElement('div');
  errorDiv.id = 'chatSendError';
  errorDiv.className = 'chat-send-error';
  errorDiv.textContent = t('chat.sendFailed');

  const inputArea = document.querySelector('.chat-input-area');
  inputArea.parentNode.insertBefore(errorDiv, inputArea);

  setTimeout(() => {
    errorDiv.classList.add('chat-send-error-hide');
    setTimeout(() => errorDiv.remove(), 300);
  }, 3000);
}

// ===== 날짜 구분선 =====
function formatDateSeparator(date) {
  const locale = getLocale();
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

function createDateSeparator(dateStr) {
  const sep = document.createElement('div');
  sep.className = 'chat-date-separator';
  sep.textContent = dateStr;
  return sep;
}

// ===== FAB 렌더링 =====
function renderChatFAB() {
  const fab = document.createElement('button');
  fab.className = 'chat-fab';
  fab.id = 'chatFab';
  fab.setAttribute('aria-label', t('chat.title') || 'Chat');
  fab.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>`;
  fab.addEventListener('click', toggleChat);
  document.body.appendChild(fab);
}

// ===== 채팅 패널 렌더링 =====
function renderChatPanel() {
  const panel = document.createElement('div');
  panel.className = 'chat-panel';
  panel.id = 'chatPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('chat.title') || 'Chat');

  panel.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-left">
        <h2 data-i18n="chat.title">${t('chat.title') || '채팅'}</h2>
        <span class="chat-online-count" id="chatOnlineCount"></span>
      </div>
      <button class="chat-close" id="chatClose" aria-label="Close">&times;</button>
    </div>
    <div class="chat-messages" id="chatMessages">
      <div class="chat-empty" data-i18n="chat.noMessages">${t('chat.noMessages') || ''}</div>
    </div>
    <div class="chat-typing-indicator" id="chatTypingIndicator" style="display:none"></div>
    <div class="chat-input-area">
      <input type="text" class="chat-input" id="chatInput"
             placeholder="${t('chat.placeholder') || ''}"
             maxlength="500" autocomplete="off">
      <button class="chat-send" id="chatSend" data-i18n="chat.send">${t('chat.send') || '전송'}</button>
    </div>`;

  document.body.appendChild(panel);

  document.getElementById('chatClose').addEventListener('click', closeChat);
  document.getElementById('chatSend').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) sendMessage();
  });
  document.getElementById('chatInput').addEventListener('input', handleTypingInput);
}

// ===== 열기 / 닫기 =====
function toggleChat() {
  if (chatOpen) closeChat();
  else openChat();
}

function openChat() {
  chatOpen = true;
  unreadCount = 0;
  updateBadge();
  document.getElementById('chatPanel').classList.add('open');
  document.getElementById('chatFab').classList.add('hidden');
  document.getElementById('chatInput').focus();

  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function closeChat() {
  chatOpen = false;
  document.getElementById('chatPanel').classList.remove('open');
  document.getElementById('chatFab').classList.remove('hidden');
}

// ===== Firestore 리스너 =====
function startChatListener() {
  if (unsubChat) return;

  const q = query(
    collection(db, 'messages'),
    orderBy('created_at', 'asc'),
    limit(MSG_LIMIT)
  );

  unsubChat = onSnapshot(q, (snapshot) => {
    const container = document.getElementById('chatMessages');

    if (snapshot.empty) {
      container.innerHTML = `<div class="chat-empty">${t('chat.noMessages') || ''}</div>`;
      lastSeenMessageCount = 0;
      return;
    }

    const wasNearBottom = isNearBottom(container);

    container.innerHTML = '';
    let lastDateStr = '';
    snapshot.forEach((docSnap) => {
      const msg = docSnap.data();
      if (msg.created_at) {
        const msgDate = msg.created_at.toDate();
        const dateStr = formatDateSeparator(msgDate);
        if (dateStr !== lastDateStr) {
          container.appendChild(createDateSeparator(dateStr));
          lastDateStr = dateStr;
        }
      }
      container.appendChild(createMessageBubble(msg));
    });

    if (!chatOpen) {
      const addedCount = snapshot.docChanges().filter(c => c.type === 'added').length;
      if (lastSeenMessageCount > 0 && addedCount > 0) {
        unreadCount += addedCount;
        updateBadge();
      }
    }
    lastSeenMessageCount = snapshot.size;

    if (chatOpen && wasNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, (err) => {
    console.warn('[Chat] Listener error:', err);
  });
}

// ===== 메시지 버블 =====
function createMessageBubble(msg) {
  const isOwn = msg.uid === currentUid;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isOwn ? 'chat-bubble-own' : 'chat-bubble-other'}`;

  const timeStr = msg.created_at
    ? msg.created_at.toDate().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '';

  const meta = document.createElement('div');
  meta.className = 'chat-bubble-meta';
  meta.textContent = `${msg.nickname} · ${timeStr}`;

  const text = document.createElement('div');
  text.className = 'chat-bubble-text';
  text.textContent = msg.text;

  bubble.appendChild(meta);
  bubble.appendChild(text);
  return bubble;
}

// ===== 메시지 전송 =====
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const text = input.value.trim();
  if (!text || text.length > 500 || isSending) return;

  if (!currentUid) {
    console.warn('[Chat] Not authenticated');
    return;
  }

  isSending = true;
  sendBtn.disabled = true;
  sendBtn.classList.add('chat-send-disabled');
  input.value = '';
  input.focus();

  // 타이핑 인디케이터 정리
  if (typingTimeout) clearTimeout(typingTimeout);
  deleteDoc(doc(db, 'typing', currentUid)).catch(() => {});

  try {
    await addDoc(collection(db, 'messages'), {
      text,
      uid: currentUid,
      nickname,
      created_at: serverTimestamp()
    });
  } catch (err) {
    console.error('[Chat] Send failed:', err);
    input.value = text;
    showSendError();
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove('chat-send-disabled');
  }
}

// ===== 접속자 수 (Presence) =====
function startPresence() {
  if (!currentUid) return;

  const presenceRef = doc(db, 'presence', currentUid);

  setDoc(presenceRef, { last_seen: serverTimestamp(), uid: currentUid }).catch(() => {});

  presenceInterval = setInterval(() => {
    setDoc(presenceRef, { last_seen: serverTimestamp(), uid: currentUid }).catch(() => {});
  }, PRESENCE_INTERVAL);

  const q = query(collection(db, 'presence'));
  unsubPresence = onSnapshot(q, (snapshot) => {
    const now = Date.now();
    let onlineCount = 0;
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.last_seen) {
        const lastSeen = data.last_seen.toDate().getTime();
        if (now - lastSeen < PRESENCE_STALE) {
          onlineCount++;
        }
      }
    });
    const el = document.getElementById('chatOnlineCount');
    if (el) {
      el.textContent = t('chat.onlineCount', { n: onlineCount });
    }
  });

  window.addEventListener('beforeunload', () => {
    deleteDoc(presenceRef).catch(() => {});
    if (currentUid) {
      deleteDoc(doc(db, 'typing', currentUid)).catch(() => {});
    }
  });
}

// ===== 타이핑 인디케이터 =====
function handleTypingInput() {
  const now = Date.now();
  if (now - lastTypingWrite < TYPING_DEBOUNCE) return;
  if (!currentUid) return;

  lastTypingWrite = now;
  const typingRef = doc(db, 'typing', currentUid);
  setDoc(typingRef, { last_typed: serverTimestamp(), uid: currentUid }).catch(() => {});

  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    deleteDoc(typingRef).catch(() => {});
  }, TYPING_EXPIRE);
}

function startTypingListener() {
  const q = query(collection(db, 'typing'));
  unsubTyping = onSnapshot(q, (snapshot) => {
    const now = Date.now();
    let someoneTyping = false;
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.uid !== currentUid && data.last_typed) {
        const lastTyped = data.last_typed.toDate().getTime();
        if (now - lastTyped < TYPING_EXPIRE) {
          someoneTyping = true;
        }
      }
    });
    const indicator = document.getElementById('chatTypingIndicator');
    if (indicator) {
      indicator.textContent = someoneTyping ? t('chat.typing') : '';
      indicator.style.display = someoneTyping ? '' : 'none';
    }
  });
}

// ===== 채팅 메시지 클린업 =====
async function runChatCleanup() {
  try {
    const metaRef = doc(db, 'metadata', 'chat_cleanup_last');
    const metaSnap = await getDoc(metaRef);
    const lastRun = metaSnap.exists() ? metaSnap.data().timestamp?.toMillis() || 0 : 0;
    if (Date.now() - lastRun < 24 * 60 * 60 * 1000) return;

    await setDoc(metaRef, { timestamp: Timestamp.now() });

    const cutoff = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const q = query(
      collection(db, 'messages'),
      where('created_at', '<', cutoff),
      orderBy('created_at', 'asc'),
      limit(100)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return;

    const batch = writeBatch(db);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    console.warn('[Chat] Cleanup error:', err);
  }
}

// ===== 오래된 Presence 정리 =====
async function cleanupStalePresence() {
  try {
    const q = query(collection(db, 'presence'));
    const snapshot = await getDocs(q);
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10분
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.last_seen) {
        const lastSeen = data.last_seen.toDate().getTime();
        if (now - lastSeen > staleThreshold) {
          deleteDoc(docSnap.ref).catch(() => {});
        }
      }
    });
  } catch { /* ignore */ }
}

// ===== 초기화 =====
export async function initChat() {
  ensureNickname();
  renderChatFAB();
  renderChatPanel();

  // ESC 키로 채팅 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && chatOpen) closeChat();
  });

  const user = await waitForAuth();
  currentUid = user.uid;

  startChatListener();
  startPresence();
  startTypingListener();
  runChatCleanup();
  cleanupStalePresence();
}
