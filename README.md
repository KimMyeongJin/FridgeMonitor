# FridgeMonitor - 냉장고 온도 실시간 모니터링

PT100 온도 센서 + ESP32 + Firebase 기반의 냉장고/냉동고 온도 실시간 모니터링 IoT 시스템입니다.

## 시스템 구성

```
[PT100 센서] → [MAX31865] →(SPI)→ [ESP32] →(Wi-Fi)→ [Firebase Firestore] → [웹앱 PWA]
```

## 하드웨어 배선 (MAX31865 → ESP32)

| MAX31865 | ESP32 |
|----------|-------|
| VIN | 3V3 |
| GND | GND |
| CLK | GPIO 18 |
| SDO | GPIO 19 |
| SDI | GPIO 23 |
| CS | GPIO 5 |

## 프로젝트 구조

```
FridgeMonitor/
├── FridgeMonitor/                  # ESP32 펌웨어 (Arduino)
│   ├── FridgeMonitor.ino
│   ├── secrets.h.example          # 비밀 설정 템플릿
│   └── secrets.h                  # 실제 비밀 설정 (Git 제외)
├── web-app/                       # 웹 애플리케이션
│   ├── firebase.json
│   ├── firestore.rules
│   └── public/
│       ├── index.html
│       ├── sw.js
│       ├── icons/                 # PWA 아이콘
│       ├── css/
│       │   ├── theme.css
│       │   └── app.css
│       ├── js/
│       │   ├── app.js
│       │   ├── firebase-init.js
│       │   ├── firebase-config.example.js  # Firebase 설정 템플릿
│       │   ├── firebase-config.js          # 실제 Firebase 설정 (Git 제외)
│       │   ├── settings.js
│       │   ├── devices.js
│       │   ├── chart.js
│       │   ├── cleanup.js
│       │   ├── chat.js
│       │   ├── shared-ui.js
│       │   ├── theme.js
│       │   └── i18n.js
│       └── locales/
│           ├── ko.json
│           └── en.json
├── test-firebase/                 # Firebase 테스트 유틸 (Git 제외)
├── .gitignore
└── README.md
```

## 초기 설정

### 1. ESP32 펌웨어

`secrets.h.example`을 복사하여 `secrets.h`를 만들고 본인 환경에 맞게 수정합니다.

```bash
cd FridgeMonitor
cp secrets.h.example secrets.h
```

```c
#define SECRET_WIFI_SSID     "YOUR_WIFI_SSID"
#define SECRET_WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define SECRET_API_KEY       "YOUR_FIREBASE_API_KEY"
#define SECRET_PROJECT_ID    "YOUR_FIREBASE_PROJECT_ID"
```

**Arduino IDE 라이브러리 설치 필요:**
- Adafruit MAX31865
- Firebase ESP Client (by mobizt)

### 2. 웹앱

`firebase-config.example.js`를 복사하여 `firebase-config.js`를 만들고 Firebase 프로젝트 설정값을 입력합니다.

```bash
cd web-app/public/js
cp firebase-config.example.js firebase-config.js
```

```js
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## 주요 기능

- 현재 온도 실시간 표시 (Firebase 리스너)
- 반원형 게이지 + 온도 변화 차트 (6H / 24H / 3D / 7D)
- 최저 / 평균 / 최고 통계
- 다중 디바이스 지원 (냉장실/냉동실 탭 전환)
- 디바이스별 알림 임계값 설정
- 온도 이상 시 알림 (브라우저 Notification + 경고음)
- 라이트/다크 모드 전환
- 한국어/영어 다국어 지원
- CSV 데이터 내보내기
- PWA (홈 화면에 앱처럼 추가)
- 오프라인 캐싱 (Service Worker)
- Firestore 보안 규칙 적용
- 30일 이상 오래된 데이터 자동 정리
- 익명 채팅

## 기술 스택

| 항목 | 기술 |
|---|---|
| MCU | ESP32 |
| 온도 센서 | PT100 + MAX31865 (SPI) |
| 펌웨어 | Arduino C++ |
| 프론트엔드 | 순수 HTML / CSS / JavaScript (프레임워크 없음) |
| DB | Firebase Firestore (실시간 리스너) |
| 인증 | Firebase Anonymous Auth |
| 호스팅 | Firebase Hosting |
| 차트 | Canvas API (순수 구현) |

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
npm run reset      # 기존 데이터 삭제 + 7일치 목 데이터 생성
npm run send       # 24시간치 가짜 데이터 전송
npm run simulate   # ESP32 흉내 실시간 전송
npm run read       # 저장된 데이터 조회 + 통계
```

## 라이브 데모

https://fridge-monitor-9a844.web.app
