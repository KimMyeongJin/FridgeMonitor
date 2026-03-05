# FridgeMonitor - 냉장고 온도 실시간 모니터링

PT100 온도 센서 + ESP32 + Firebase 기반의 냉장고/냉동고 온도 실시간 모니터링 IoT 시스템입니다.

## 시스템 구성

```
[PT100 센서] → [MAX31865] →(SPI)→ [ESP32] →(Wi-Fi)→ [Firebase Firestore] → [웹앱 PWA]
```

## 프로젝트 구조

```
FridgeMonitor/
├── FridgeMonitor/          # ESP32 펌웨어 (Arduino)
│   └── FridgeMonitor.ino
├── test-firebase/          # Firebase 테스트 유틸
├── web-app/                # 웹 애플리케이션
│   ├── firebase.json       # Firebase Hosting + Firestore 설정
│   ├── firestore.rules     # Firestore 보안 규칙
│   └── public/
│       ├── index.html
│       ├── sw.js           # Service Worker (자동 버전 관리)
│       ├── icons/          # PWA PNG 아이콘
│       ├── css/
│       │   ├── theme.css   # 테마 시스템 (다크/라이트)
│       │   └── app.css     # 앱 스타일
│       ├── js/
│       │   ├── app.js          # 메인 앱 로직
│       │   ├── firebase-init.js # Firebase 초기화
│       │   ├── settings.js     # 설정 (디바이스별 임계값 포함)
│       │   ├── devices.js      # 디바이스 탭 관리
│       │   ├── chart.js        # Canvas 차트
│       │   ├── cleanup.js      # 데이터 자동 정리
│       │   ├── theme.js        # 테마 전환
│       │   └── i18n.js         # 다국어 지원
│       └── locales/
│           ├── ko.json     # 한국어
│           └── en.json     # 영어
└── README.md
```

## 주요 기능

- 현재 온도 실시간 표시 (Firebase 리스너)
- 온도 변화 차트 (6H / 24H / 3D / 7D)
- 최저 / 평균 / 최고 통계
- 다중 디바이스 지원 (냉장실/냉동실 탭 전환)
- 디바이스별 알림 임계값 설정
- 차트 임계값 라인 표시
- 라이트/다크 모드 전환
- 한국어/영어 다국어 지원
- CSV 데이터 내보내기
- PWA (홈 화면에 앱처럼 추가)
- 오프라인 캐싱 (Service Worker)
- Firestore 보안 규칙 적용
- 30일 이상 오래된 데이터 자동 정리

## 기술 스택

| 항목 | 기술 |
|---|---|
| 프론트엔드 | 순수 HTML / CSS / JavaScript (프레임워크 없음) |
| DB | Firebase Firestore (실시간 리스너) |
| 인증 | Firebase Anonymous Auth |
| 호스팅 | Firebase Hosting |
| 차트 | Canvas API (순수 구현) |
| 설정 저장 | localStorage |

---

## 최근 업데이트 내역

### 1. 알림 소리 추가

온도 이상 시 브라우저 Notification 외에 경고 비프음(3회)을 재생하여, 화면을 보고 있지 않을 때도 즉각 인지할 수 있도록 개선했습니다.

**변경 파일:**
- `web-app/public/js/app.js` - `playAlertSound()` 함수 추가, `checkAndAlert()`에서 소리 재생
- `web-app/public/js/settings.js` - `soundEnabled` 설정 추가
- `web-app/public/index.html` - 설정 패널에 "알림 소리" 토글 추가
- `web-app/public/locales/ko.json` - i18n 키 추가
- `web-app/public/locales/en.json` - i18n 키 추가

**동작 방식:**
- Web Audio API로 880Hz 스퀘어파 비프음 3회 생성 (외부 파일 불필요)
- 설정 패널에서 "알림 소리" 토글로 ON/OFF
- 기본값: OFF

### 2. Firestore 보안 규칙 적용

기존 테스트 모드에서 보안 규칙으로 전환했습니다.

**변경 파일:**
- `web-app/firestore.rules` (신규)
- `web-app/firebase.json`

**규칙 요약:**

| 작업 | 조건 |
|---|---|
| 읽기 (read) | 인증 필요 (익명 인증 포함) |
| 생성 (create) | 인증 + 필드 검증 (`temperature`, `recorded_at`, `device_id`, `alert` 정확히 4개) |
| 삭제 (delete) | 인증 + 30일 이상 오래된 데이터만 |
| 수정 (update) | 거부 (센서 데이터 불변) |
| 기타 컬렉션 | 전부 거부 |

### 3. 디바이스별 알림 임계값

기존에는 냉장실/냉동실 구분 없이 동일한 상한/하한을 사용했으나, 디바이스별로 별도 임계값을 설정할 수 있도록 변경했습니다.

**변경 파일:**
- `web-app/public/js/settings.js` - 데이터 구조 + 마이그레이션 + `getThresholdsForDevice()` 헬퍼 + 동적 UI
- `web-app/public/index.html` - 임계값 입력 영역 래핑 + 디바이스별 컨테이너 추가
- `web-app/public/js/app.js` - `checkAndAlert()` + `render()` 디바이스별 임계값 적용
- `web-app/public/js/chart.js` - 차트 임계값 라인 디바이스별 적용
- `web-app/public/css/theme.css` - `.device-threshold-section`, `.setting-device-label` 스타일 추가
- `web-app/public/locales/ko.json` - i18n 키 추가
- `web-app/public/locales/en.json` - i18n 키 추가

**기본 임계값:**

| 디바이스 | 상한 (°C) | 하한 (°C) |
|---|---|---|
| 냉장실 (fridge_01) | 8 | 0 |
| 냉동실 (freezer_01) | -15 | -25 |

**동작 방식:**
- 디바이스가 2개 이상이면 설정 패널에 디바이스별 입력 필드가 표시됨
- 디바이스가 1개이면 기존 글로벌 입력을 그대로 사용
- 기존 설정에서 자동 마이그레이션 (기존 글로벌 값으로 양쪽 디바이스 초기화)

### 4. 데이터 자동 정리 (클라이언트 사이드)

30일 이상 오래된 Firestore 문서를 클라이언트 측에서 자동 삭제합니다.

**변경 파일:**
- `web-app/public/js/cleanup.js` (신규) - `runCleanupIfNeeded()` 함수
- `web-app/public/js/firebase-init.js` - `getDocs`, `writeBatch`, `Timestamp` export 추가
- `web-app/public/js/app.js` - `init()`에서 `runCleanupIfNeeded(30)` 호출
- `web-app/public/sw.js` - `cleanup.js` 캐시 추가, 버전 v5 → v6

**동작 방식:**
- 앱 로드 시 24시간 간격으로 실행 (localStorage로 간격 관리)
- 30일 이전 문서를 `writeBatch`로 100개씩 삭제
- 에러 발생 시 `console.warn`만 출력 (fire-and-forget)
- Firestore 보안 규칙에서 30일 이상 오래된 데이터만 삭제 허용

---

## 개선사항 목록

우선순위별로 정리한 프로젝트 개선사항입니다.

### HIGH 우선순위 (완료)

| # | 제목 | 카테고리 | 상태 |
|---|---|---|---|
| 1 | XSS 방지 + 보안 헤더 추가 | 보안 | ✅ 완료 |
| 2 | Firestore 쿼리 기간별 동적 제한 | 기능 | ✅ 완료 |
| 3 | 오프라인 데이터 캐싱 | PWA | ✅ 완료 |
| 4 | 접근성(ARIA) 개선 | 접근성 | ✅ 완료 |
| 5 | DOM 전체 재렌더링 → 부분 업데이트 | 성능 | ✅ 완료 |
| 6 | Firebase App Check 적용 | 보안 | ✅ 완료 |

### MEDIUM 우선순위 (완료)

| # | 제목 | 카테고리 | 상태 |
|---|---|---|---|
| 7 | 언어 전환 시 새로고침 제거 | UX | ✅ 완료 |
| 8 | 차트 리사이즈 대응 | UX/성능 | ✅ 완료 |
| 9 | 차트 DPI 처리 수정 | UX | ✅ 완료 |
| 10 | 인증 실패 시 재시도 UI | UX | ✅ 완료 |
| 11 | 알림 히스토리 로그 | 기능 | ✅ 완료 |
| 12 | 클린업 클라이언트 간 조율 | 기능 | ✅ 완료 |
| 13 | PWA 매니페스트 보완 | PWA | ✅ 완료 |
| 14 | Service Worker 캐시 버전 자동화 | 코드 품질 | ✅ 완료 |
| 15 | inline onclick → 이벤트 위임 | 코드 품질 | ✅ 완료 |

### LOW 우선순위 (완료)

| # | 제목 | 카테고리 | 상태 |
|---|---|---|---|
| 16 | 히스토리 목록 페이지네이션 | UX | ✅ 완료 |
| 17 | 화씨(°F) 단위 지원 | 기능 | ✅ 완료 |
| 18 | Math.min/max 스프레드 안전성 | 성능 | ✅ 완료 (MEDIUM #9에서 해결) |
| 19 | SPA 리라이트 규칙 제거 | 코드 품질 | ✅ 완료 |
| 20 | 설정 패널/하단 네비 HTML 중복 제거 | 코드 품질 | ✅ 완료 |

---

## 로컬 테스트

```bash
cd web-app
firebase serve --port 5000
```

## 배포

```bash
cd web-app
firebase deploy
```

Hosting + Firestore 규칙이 함께 배포됩니다.

## 테스트 데이터

```bash
cd test-firebase
npm run send       # 24시간치 가짜 데이터 전송
npm run simulate   # ESP32 흉내 실시간 전송
npm run read       # 저장된 데이터 조회 + 통계
```

https://fridge-monitor-9a844.web.app