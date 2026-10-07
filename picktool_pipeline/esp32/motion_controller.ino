#include <Servo.h>
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

#define BAUD_RATE 115200
#define PIN_CONFIRMED 2
#define PIN_READY     3
#define PIN_MARK      4
#define PIN_LINE      5
#define PIN_ARC       6
#define PIN_BTN       7   // button between pin 7 and GND (INPUT_PULLUP)
#define PIN_ERROR     8
#define PIN_STANDBY   9
#define PIN_SERVO     10
#define PIN_BUZZER    11
#define PIN_CHECK     12
#define PIN_BOOT      13
// TOF VL53L0X on I2C: SDA = A4, SCL = A5 (no digital pin used)

// Names MUST match STATES in nexus_common.py
struct StateDef { const char* name; uint8_t led; uint16_t period; bool buzz; int16_t servo; };
const StateDef STATES[] = {
  {"STANDBY",       PIN_STANDBY,   1000, true,  0},
  {"TOOL_CHECK",    PIN_CHECK,      500, false, -1},
  {"HUMAN_CHECK",   PIN_CHECK,      750, false, -1},
  {"CONFIRMED",     PIN_CONFIRMED,    0, false, -1},
  {"GRID_CHECK",    PIN_CONFIRMED,  250, false, -1},
  {"TOOL_MISSING",  PIN_ERROR,      100, true,  -1},
  {"PAPER_MISSING", PIN_ERROR,      100, true,  -1},
  {"READY_DRAW",    PIN_READY,      500, false, 45},
  {"MARK",          PIN_MARK,       500, true,  90},
  {"DRAW_LINE",     PIN_LINE,       500, true,  135},
  {"DRAW_ARC",      PIN_ARC,        500, true,  180},
};
const uint8_t STATE_COUNT = sizeof(STATES) / sizeof(STATES[0]);
const uint8_t ALL_LEDS[] = {2, 3, 4, 5, 6, 8, 9, 12, 13};
const uint8_t CHASE[]    = {2, 3, 4, 5, 6, 8, 9, 12};

Servo servo;
Adafruit_VL53L0X lox = Adafruit_VL53L0X();
bool tofReady = false;
int currentAngle = 0;
int8_t cur = -1;
bool phaseOn = false;
unsigned long lastToggle = 0;

bool rotating = false;
int rotateDirection = 1;
unsigned long lastRotateStepMs = 0;

// returns distance in mm, or -1 if the sensor is missing / out of range
int readTof() {
  if (!tofReady) return -1;
  VL53L0X_RangingMeasurementData_t m;
  lox.rangingTest(&m, false);
  if (m.RangeStatus == 4) return -1;      // phase failure / out of range
  if (m.RangeMilliMeter > 2000) return -1;
  return (int)m.RangeMilliMeter;
}

void allOff() {
  for (uint8_t i = 0; i < sizeof(ALL_LEDS); i++) digitalWrite(ALL_LEDS[i], LOW);
  noTone(PIN_BUZZER);
}

void drive(bool on) {
  if (cur < 0) return;
  const StateDef &s = STATES[cur];
  if (s.led) digitalWrite(s.led, on ? HIGH : LOW);
  if (s.buzz) { if (on) tone(PIN_BUZZER, 2000); else noTone(PIN_BUZZER); }
}

void applyState(int idx) {
  allOff();
  cur = idx;
  phaseOn = true;
  lastToggle = millis();
  drive(true);
  if (STATES[idx].servo >= 0) {
    currentAngle = STATES[idx].servo;
    servo.write(currentAngle);
  }
}

void runBoot() {
  allOff();
  cur = -1;
  tone(PIN_BUZZER, 2000);
  const uint8_t seq[] = {1, 1, 1, 3, 3, 3, 1, 1, 1};  // SOS: 1=dot 3=dash
  for (uint8_t i = 0; i < 9; i++) {
    digitalWrite(PIN_BOOT, HIGH); delay(seq[i] * 150);
    digitalWrite(PIN_BOOT, LOW);  delay(150);
    if (i == 2 || i == 5) delay(300);
  }
  for (uint8_t i = 0; i < sizeof(CHASE); i++) {
    digitalWrite(CHASE[i], HIGH); delay(300);
    digitalWrite(CHASE[i], LOW);
  }
  noTone(PIN_BUZZER);
  applyState(0);  // STANDBY
}

void handleCommand(const String &line) {
  if (line.startsWith("STATE ")) {
    String name = line.substring(6);
    name.trim();
    if (name == "BOOT") { runBoot(); Serial.println("OK BOOT"); return; }
    for (uint8_t i = 0; i < STATE_COUNT; i++) {
      if (name == STATES[i].name) {
        applyState(i);
        Serial.print("OK "); Serial.println(name);
        return;
      }
    }
    Serial.println("ERR UNKNOWN");

  } else if (line.startsWith("SETANGLE")) {
    currentAngle = constrain(line.substring(9).toInt(), 0, 180);
    servo.write(currentAngle);
    Serial.println("OK");

  } else if (line == "ROTATE_START") {
    rotating = true;
    lastRotateStepMs = millis();

  } else if (line == "ROTATE_STOP") {
    rotating = false;
    Serial.print("OK "); Serial.println(currentAngle);

  } else if (line == "GET_TOF") {
    Serial.print("TOF ");
    Serial.println(readTof());
  }
}

void readSerial() {
  static char buf[48];
  static uint8_t n = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (n) { buf[n] = 0; n = 0; handleCommand(String(buf)); }
    } else if (n < sizeof(buf) - 1) {
      buf[n++] = c;
    }
  }
}

void updateBlink() {
  if (cur < 0) return;
  uint16_t p = STATES[cur].period;
  if (p == 0) return;
  if (millis() - lastToggle >= p) {
    lastToggle = millis();
    phaseOn = !phaseOn;
    drive(phaseOn);
  }
}

void updateButton() {
  static bool stable = HIGH, lastRead = HIGH;
  static unsigned long t = 0;
  bool r = digitalRead(PIN_BTN);
  if (r != lastRead) { t = millis(); lastRead = r; }
  if (millis() - t > 50 && r != stable) {
    stable = r;
    if (stable == LOW) Serial.println("BTN");
  }
}

void updateRotate() {
  if (!rotating || millis() - lastRotateStepMs < 150) return;
  lastRotateStepMs = millis();
  currentAngle += rotateDirection * 5;
  if (currentAngle >= 180) { currentAngle = 180; rotateDirection = -1; }
  else if (currentAngle <= 0) { currentAngle = 0; rotateDirection = 1; }
  servo.write(currentAngle);
  Serial.print("ANGLE "); Serial.println(currentAngle);
}

void setup() {
  Serial.begin(BAUD_RATE);
  for (uint8_t i = 0; i < sizeof(ALL_LEDS); i++) pinMode(ALL_LEDS[i], OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);
  allOff();
  servo.attach(PIN_SERVO);
  servo.write(currentAngle);
  Wire.begin();
  tofReady = lox.begin();   // false if the sensor is not found
}

void loop() {
  readSerial();
  updateBlink();
  updateButton();
  updateRotate();
}