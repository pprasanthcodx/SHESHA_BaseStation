#include <SPI.h>
#include <LoRa.h>

// ---------------- Pins ----------------
#define PIN_LORA_SS   5
#define PIN_LORA_RST  14
#define PIN_LORA_DIO0 2    // Change to 4 if you moved the receiver DIO0 wire too

// Simple 8-bit XOR checksum (must perfectly match transmitter)
uint8_t calculateChecksum(const char* s) {
  uint8_t c = 0;
  while (*s) c ^= (uint8_t)*s++;
  return c;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n--- SHESHA PRO RECEIVER ONLINE ---");

  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  
  if (!LoRa.begin(433E6)) {
    Serial.println("CRITICAL: LoRa Receiver failed to init");
    while (true); // Halt if radio is disconnected
  }

  // Must match the transmitter settings exactly
  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  
  Serial.println("Listening for telemetry...");
}

void loop() {
  int packetSize = LoRa.parsePacket();
  
  if (packetSize) {
    char packetBuffer[128];
    int idx = 0;

    // 1. Read incoming packet safely into buffer
    while (LoRa.available() && idx < 127) {
      packetBuffer[idx++] = (char)LoRa.read();
    }
    packetBuffer[idx] = '\0'; 

    int rssi = LoRa.packetRssi();

    // 2. Locate the CRC (it sits after the very last comma)
    char* lastComma = strrchr(packetBuffer, ',');
    
    if (lastComma != nullptr) {
      // 3. Separate the 'body' from the 'crc'
      *lastComma = '\0'; 
      const char* body = packetBuffer;
      uint8_t receivedCrc = (uint8_t)atoi(lastComma + 1);

      // 4. Validate Data Integrity via Checksum
      uint8_t calculatedCrc = calculateChecksum(body);

      if (calculatedCrc == receivedCrc) {
        // 5. PACKET VERIFIED. Print 9 columns for the Python Logger:
        // ID,Trigger,Distance,Tilt,Soil,Battery,Seq,CRC,RSSI
        Serial.printf("%s,%u,%d\n", body, receivedCrc, rssi);
      } else {
        Serial.println("RX_WARNING: Corrupt packet dropped");
      }
    }
  }
}