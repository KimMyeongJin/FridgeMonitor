/*
 * =====================================================
 *  냉장고 실시간 온도 모니터링 시스템
 *  ESP32 + MAX31865 + PT100 + Firebase
 * =====================================================
 *
 *  배선 (MAX31865 -> ESP32):
 *    VIN  -> 3V3
 *    GND  -> GND
 *    CLK  -> GPIO 18
 *    SDO  -> GPIO 19
 *    SDI  -> GPIO 23
 *    CS   -> GPIO 5
 *
 *  Arduino IDE 라이브러리 설치 필요:
 *    1. Adafruit MAX31865
 *    2. Firebase ESP Client (by mobizt)
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <Adafruit_MAX31865.h>
#include <time.h>

// Firebase 헬퍼
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// 비밀 설정 (secrets.h.example을 복사하여 secrets.h로 만드세요)
#include "secrets.h"

// =====================================================
// [설정]
// =====================================================

// Wi-Fi 설정 (secrets.h에서 불러옴)
const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

// Firebase 설정 (secrets.h에서 불러옴)
#define API_KEY       SECRET_API_KEY
#define PROJECT_ID    SECRET_PROJECT_ID

// 장치 식별자
const char* DEVICE_ID = "fridge_01";

// 측정 간격 (밀리초) - 기본 30초
const unsigned long SEND_INTERVAL = 30000;

// 온도 알림 임계값 (섭씨)
const float TEMP_ALERT_HIGH = 8.0;   // 냉장실: 8도 초과 시 경고
const float TEMP_ALERT_LOW  = -25.0; // 냉동실: -25도 미만 시 경고

// =====================================================
// [하드웨어 설정] - 변경하지 마세요
// =====================================================

// MAX31865 SPI 핀 (CS, SDI, SDO, CLK)
Adafruit_MAX31865 thermo = Adafruit_MAX31865(5, 23, 19, 18);

// PT100 기준값
#define RREF      430.0
#define RNOMINAL  100.0

// =====================================================
// [Firebase 객체]
// =====================================================
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

bool firebaseReady = false;

// =====================================================
// [전역 변수]
// =====================================================
unsigned long lastSendTime = 0;
int wifiRetryCount = 0;
const int MAX_WIFI_RETRY = 20;

// 온도 이력 버퍼 (오프라인 시 임시 저장)
#define BUFFER_SIZE 60
float tempBuffer[BUFFER_SIZE];
String timeBuffer[BUFFER_SIZE];
int bufferIndex = 0;
int bufferedCount = 0;

// =====================================================
// [NTP 시간 동기화]
// =====================================================
String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("[시간] NTP 동기화 실패");
    return "";
  }
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buf);
}

// =====================================================
// [Wi-Fi 연결]
// =====================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("[WiFi] 연결 중: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  wifiRetryCount = 0;
  while (WiFi.status() != WL_CONNECTED && wifiRetryCount < MAX_WIFI_RETRY) {
    delay(500);
    Serial.print(".");
    wifiRetryCount++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("[WiFi] 연결 성공! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("[WiFi] 연결 실패 - 오프라인 모드로 동작");
  }
}

// =====================================================
// [Firebase 초기화]
// =====================================================
void initFirebase() {
  config.api_key = API_KEY;
  config.token_status_callback = tokenStatusCallback;

  // 익명 인증으로 로그인
  Serial.println("[Firebase] 익명 인증 시도...");
  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println("[Firebase] 인증 성공");
    firebaseReady = true;
  } else {
    Serial.printf("[Firebase] 인증 실패: %s\n", config.signer.signupError.message.c_str());
    firebaseReady = false;
  }

  Firebase.begin(&config, &auth);
  Firebase.reconnectNetwork(true);
}

// =====================================================
// [온도 읽기]
// =====================================================
float readTemperature() {
  float temp = thermo.temperature(RNOMINAL, RREF);

  uint8_t fault = thermo.readFault();
  if (fault) {
    Serial.print("[센서 오류] 코드: 0x");
    Serial.println(fault, HEX);

    if (fault & MAX31865_FAULT_HIGHTHRESH)   Serial.println("  - RTD High Threshold");
    if (fault & MAX31865_FAULT_LOWTHRESH)    Serial.println("  - RTD Low Threshold");
    if (fault & MAX31865_FAULT_REFINLOW)     Serial.println("  - REFIN- > 0.85 x Bias");
    if (fault & MAX31865_FAULT_REFINHIGH)    Serial.println("  - REFIN- < 0.85 x Bias (연결 확인!)");
    if (fault & MAX31865_FAULT_RTDINLOW)     Serial.println("  - RTDIN- < 0.85 x Bias (연결 확인!)");
    if (fault & MAX31865_FAULT_OVUV)         Serial.println("  - Under/Over Voltage");

    thermo.clearFault();
    return -999.0;
  }

  return temp;
}

// =====================================================
// [Firebase Firestore에 온도 전송]
// =====================================================
bool sendTemperature(float temperature, String timestamp) {
  if (!Firebase.ready() || !firebaseReady) return false;

  // Firestore 문서 데이터 구성
  FirebaseJson content;
  content.set("fields/device_id/stringValue", DEVICE_ID);
  content.set("fields/temperature/doubleValue", String(temperature, 2));
  content.set("fields/recorded_at/timestampValue", timestamp);

  // alert 여부
  bool isAlert = (temperature > TEMP_ALERT_HIGH) || (temperature < TEMP_ALERT_LOW);
  content.set("fields/alert/booleanValue", isAlert);

  // Firestore에 문서 생성 (temperatures 컬렉션)
  if (Firebase.Firestore.createDocument(&fbdo, PROJECT_ID, "",
      "temperatures", "", content.raw(), "")) {
    Serial.println("[Firebase] 전송 성공");
    return true;
  } else {
    Serial.printf("[Firebase] 전송 실패: %s\n", fbdo.errorReason().c_str());
    return false;
  }
}

// =====================================================
// [버퍼 관리 - 오프라인 시 임시 저장]
// =====================================================
void addToBuffer(float temp, String timestamp) {
  tempBuffer[bufferIndex] = temp;
  timeBuffer[bufferIndex] = timestamp;
  bufferIndex = (bufferIndex + 1) % BUFFER_SIZE;
  if (bufferedCount < BUFFER_SIZE) bufferedCount++;
}

void flushBuffer() {
  if (bufferedCount == 0) return;

  Serial.printf("[버퍼] 저장된 %d개 데이터 전송 중...\n", bufferedCount);

  int startIdx = (bufferIndex - bufferedCount + BUFFER_SIZE) % BUFFER_SIZE;
  int sent = 0;

  for (int i = 0; i < bufferedCount; i++) {
    int idx = (startIdx + i) % BUFFER_SIZE;
    if (sendTemperature(tempBuffer[idx], timeBuffer[idx])) {
      sent++;
    } else {
      break;
    }
    delay(200);  // Firebase 요청 간격
  }

  bufferedCount -= sent;
  Serial.printf("[버퍼] %d개 전송 완료, %d개 남음\n", sent, bufferedCount);
}

// =====================================================
// [온도 알림 체크]
// =====================================================
void checkTemperatureAlert(float temp) {
  if (temp > TEMP_ALERT_HIGH) {
    Serial.println("[경고] 온도가 너무 높습니다!");
    Serial.printf("  현재: %.1f C / 임계값: %.1f C\n", temp, TEMP_ALERT_HIGH);
  }
  if (temp < TEMP_ALERT_LOW) {
    Serial.println("[경고] 온도가 너무 낮습니다!");
    Serial.printf("  현재: %.1f C / 임계값: %.1f C\n", temp, TEMP_ALERT_LOW);
  }
}

// =====================================================
// [시리얼 모니터 출력]
// =====================================================
void printStatus(float temp, String timestamp) {
  Serial.println("------------------------------");
  Serial.printf("  온도: %.2f C\n", temp);
  Serial.printf("  시간: %s\n", timestamp.c_str());
  Serial.printf("  WiFi: %s\n", WiFi.status() == WL_CONNECTED ? "연결됨" : "끊김");
  Serial.printf("  Firebase: %s\n", firebaseReady ? "연결됨" : "끊김");
  Serial.printf("  버퍼: %d / %d\n", bufferedCount, BUFFER_SIZE);
  Serial.printf("  가동시간: %lu초\n", millis() / 1000);
  Serial.println("------------------------------");
}

// =====================================================
// [setup - 초기화]
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("=============================================");
  Serial.println("  냉장고 온도 모니터링 시스템 v2.0");
  Serial.println("  ESP32 + MAX31865 + PT100 + Firebase");
  Serial.println("=============================================");
  Serial.println();

  // MAX31865 초기화
  thermo.begin(MAX31865_2WIRE);
  Serial.println("[센서] MAX31865 초기화 완료 (2선 모드)");

  // Wi-Fi 연결
  connectWiFi();

  // NTP 시간 동기화 (UTC 기준 - Firestore 타임스탬프와 일치)
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("[시간] NTP 동기화 중 (UTC)...");
  delay(2000);

  // Firebase 초기화
  if (WiFi.status() == WL_CONNECTED) {
    initFirebase();
  }

  Serial.println();
  Serial.println("[시스템] 초기화 완료 - 측정 시작");
  Serial.printf("[시스템] 측정 간격: %lu초\n", SEND_INTERVAL / 1000);
  Serial.println();
}

// =====================================================
// [loop - 메인 루프]
// =====================================================
void loop() {
  unsigned long currentTime = millis();

  if (currentTime - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = currentTime;

    // 1. 현재 시간
    String timestamp = getTimestamp();
    if (timestamp == "") {
      timestamp = "1970-01-01T00:00:00Z";
    }

    // 2. 온도 읽기
    float temperature = readTemperature();

    if (temperature == -999.0) {
      Serial.println("[측정] 센서 오류 - 이번 측정 건너뜀");
      return;
    }

    // 3. 시리얼 모니터에 출력
    printStatus(temperature, timestamp);

    // 4. 온도 이상 체크
    checkTemperatureAlert(temperature);

    // 5. Wi-Fi 상태 확인 및 재연결
    if (WiFi.status() != WL_CONNECTED) {
      connectWiFi();
      if (WiFi.status() == WL_CONNECTED && !firebaseReady) {
        initFirebase();
      }
    }

    // 6. Firebase 전송 또는 버퍼 저장
    if (WiFi.status() == WL_CONNECTED && firebaseReady) {
      if (bufferedCount > 0) {
        flushBuffer();
      }
      if (!sendTemperature(temperature, timestamp)) {
        addToBuffer(temperature, timestamp);
      }
    } else {
      addToBuffer(temperature, timestamp);
      Serial.printf("[오프라인] 버퍼에 저장 (%d/%d)\n", bufferedCount, BUFFER_SIZE);
    }
  }
}
