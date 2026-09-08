#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <Adafruit_VL53L0X.h>
#include <sys/time.h>
#include <driver/rtc_io.h>

// ---------------- Pins ----------------
#define PIN_LORA_SS   5
#define PIN_LORA_RST  14
#define PIN_LORA_DIO0 4
#define PIN_VIB       27
#define PIN_SOIL      32
#define PIN_BATTERY   34

// ---------------- Sleep/Vibration Config ----------------
#define SLEEP_INTERVAL_SEC   300   // 5 minutes routine cycle
#define VIB_CONFIRM_MS        5000 // must stay vibrating ~5s to count as real
#define VIB_SAMPLE_MS         100
#define VIB_CONFIRM_SAMPLES   (VIB_CONFIRM_MS / VIB_SAMPLE_MS)
#define VIB_HIT_THRESHOLD     (VIB_CONFIRM_SAMPLES * 6 / 10) // 60% of samples must read LOW

Adafruit_VL53L0X lox = Adafruit_VL53L0X();

// Survives deep sleep (reset only on power loss/EN reset)
RTC_DATA_ATTR uint32_t packetId = 0;
RTC_DATA_ATTR time_t   targetWakeEpoch = 0;

uint8_t calculateChecksum(const char* s) {
  uint8_t c = 0;
  while (*s) c ^= (uint8_t)*s++;
  return c;
}

// Polls the vibration pin for VIB_CONFIRM_MS. Returns true only if it
// was genuinely shaking for most of that window (not a brief false blip).
bool checkSustainedVibration() {
  int hits = 0;
  for (int i = 0; i < VIB_CONFIRM_SAMPLES; i++) {
    if (digitalRead(PIN_VIB) == LOW) hits++;
    delay(VIB_SAMPLE_MS);
  }
  return hits >= VIB_HIT_THRESHOLD;
}

void sendPacket(const char* trigger) {
  // Distance
  uint16_t distanceMm = 0;
  VL53L0X_RangingMeasurementData_t measure;
  lox.rangingTest(&measure, false);
  if (measure.RangeStatus != 4) distanceMm = measure.RangeMilliMeter;

  // Tilt (single-shot read, no EMA needed since we're not continuously polling anymore)
  Wire.beginTransmission(0x68);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom((uint16_t)0x68, (uint8_t)6, true);
  Wire.read(); Wire.read();
  Wire.read(); Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  float tiltZ = -(az / 16384.0f) * 9.81f;

  int soilPct = constrain(map(analogRead(PIN_SOIL), 4095, 1500, 0, 100), 0, 100);
  int batteryPct = 83; // PIN_BATTERY not wired - placeholder until voltage divider is added

  char body[96];
  snprintf(body, sizeof(body), "NODE_01,%s,%u,%.2f,%d,%d,%u",
           trigger, distanceMm, tiltZ, soilPct, batteryPct, packetId);
  uint8_t crc = calculateChecksum(body);
  char payload[128];
  snprintf(payload, sizeof(payload), "%s,%u", body, crc);

  LoRa.beginPacket();
  LoRa.print(payload);
  LoRa.endPacket();

  Serial.print("Sent: ");
  Serial.println(payload);
  packetId++;
}

void goToSleep() {
  time_t now = time(NULL);
  int64_t remaining = (int64_t)targetWakeEpoch - (int64_t)now;
  if (remaining <= 0) remaining = 1; // safety floor

  Serial.printf("Sleeping for %lld sec (routine target unchanged)\n", remaining);
  Serial.flush();

  esp_sleep_enable_timer_wakeup((uint64_t)remaining * 1000000ULL);

  // Wake on vibration pin going LOW (sensor pulls low when triggered)
  rtc_gpio_pullup_en((gpio_num_t)PIN_VIB);
  rtc_gpio_pulldown_dis((gpio_num_t)PIN_VIB);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_VIB, 0);

  esp_deep_sleep_start();
}

void setup() {
  delay(1500); // let boost converter caps settle
  Serial.begin(115200);
  delay(100);

  pinMode(PIN_VIB, INPUT_PULLUP);
  pinMode(PIN_SOIL, INPUT);
  Wire.begin(21, 22);
  lox.begin();

  // Wake MPU6050
  Wire.beginTransmission(0x68);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission();

  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  LoRa.begin(433E6);
  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setTxPower(2);

  Serial.println("\n--- SHESHA PRO TRANSMITTER (DEEP SLEEP MODE) ---");

  time_t now = time(NULL);
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();

  if (targetWakeEpoch == 0) {
    // Very first boot ever
    targetWakeEpoch = now + SLEEP_INTERVAL_SEC;
    sendPacket("ROUTINE_5MIN");

  } else if (cause == ESP_SLEEP_WAKEUP_EXT0) {
    // Woke early because of vibration - verify it's real
    if (checkSustainedVibration()) {
      sendPacket("EMERGENCY_IMPACT");
      // targetWakeEpoch NOT touched - routine schedule stays on track
    } else {
      Serial.println("False alarm - short vibration, ignoring. Timer unchanged.");
      // no send, no timer reset
    }

  } else {
    // Timer wakeup (or we overslept past target) -> routine reading
    sendPacket("ROUTINE_5MIN");
    targetWakeEpoch = now + SLEEP_INTERVAL_SEC;
  }

  goToSleep();
}

void loop() {
  // unused - device deep sleeps at the end of setup() every cycle
}
