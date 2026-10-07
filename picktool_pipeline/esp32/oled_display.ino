/*
 * oled_display.ino
 *
 * Runs on its OWN Arduino, separate from motion_controller.ino's board
 * (separate serial port, so servo commands and display commands never
 * collide). Speaks a one-command protocol: TEXT <up to 16 chars> -> OK.
 *
 * Wiring assumed (4 pins: GND, VCC, SCL, SDA - standard I2C):
 *   GND -> GND
 *   VCC -> 5V (or 3.3V - check your specific module's rating)
 *   SCL -> Arduino SCL (Uno: A5, Nano: A5, Leonardo: dedicated SCL pin)
 *   SDA -> Arduino SDA (Uno: A4, Nano: A4, Leonardo: dedicated SDA pin)
 *
 * ASSUMPTION: this is a small SSD1306-driven graphic OLED (commonly
 * 128x32), used here to show one line of up to 16 characters - not a
 * true HD44780 16x1 character LCD. Since your current display "isn't
 * responding," you won't know for certain until you get a working unit
 * to test against. If it turns out to be a genuine character LCD
 * instead, swap the Adafruit_SSD1306 calls below for
 * LiquidCrystal_I2C's lcd.setCursor()/lcd.print() - the serial protocol
 * (TEXT <string> -> OK) doesn't need to change either way, just the
 * driver calls inside handleCommand().
 *
 * Requires (Arduino Library Manager):
 *   - Adafruit SSD1306
 *   - Adafruit GFX Library
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32   // change to 64 if your module is 128x64
#define OLED_RESET -1      // most I2C OLED boards share the Arduino's reset pin
#define OLED_I2C_ADDRESS 0x3C  // common default; try 0x3D if this doesn't work

#define BAUD_RATE 9600

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void setup() {
  Serial.begin(BAUD_RATE);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS)) {
    // Can't Serial.println usefully here if the OLED itself is the
    // problem, but keep going so serial commands still get an OK/no-OK
    // response for debugging over the wire.
  }

  display.clearDisplay();
  display.setTextSize(2);       // size 2 ~ up to ~10-11 chars per line at 128px wide;
                                 // drop to setTextSize(1) if you need the full 16 chars visible at once
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("READY");
  display.display();
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    handleCommand(line);
  }
}

void handleCommand(const String &line) {
  if (line.startsWith("TEXT ")) {
    String text = line.substring(5);
    if (text.length() > 16) {
      text = text.substring(0, 16);
    }
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(text);
    display.display();
    Serial.println("OK");
  }
}
