# motion_node <-> ESP32 serial protocol

Plain text, newline-terminated, one command in flight at a time (matches
the "wait for success before the next step" model everywhere else in
this pipeline — motion_node never sends a second command before it's
seen the response to the first).

USB serial, 115200 baud, 8N1.

| Direction | Line | Meaning |
|---|---|---|
| host → esp32 | `SETANGLE <deg>` | Move the servo to `<deg>` (0–180) |
| esp32 → host | `OK` | Servo move complete |
| host → esp32 | `ROTATE_START` | Begin continuous sweep (bounces 0↔180) |
| esp32 → host | `ANGLE <deg>` | Streamed repeatedly while sweeping |
| host → esp32 | `ROTATE_STOP` | Stop sweeping at current position |
| esp32 → host | `OK <deg>` | Confirms stop, reports final angle |
| host → esp32 | `GET_TOF` | One-shot distance read |
| esp32 → host | `TOF <mm>` | Distance in millimeters |

## Wiring checklist before flipping `use_mock_serial:=false`

1. Servo signal wire → the pin defined as `SERVO_PIN` in
   `motion_controller.ino` (default: GPIO18). Power the servo from a
   supply rated for its stall current — don't run it off the ESP32's
   3V3/5V pin except for very small micro servos.
2. Flash `motion_controller.ino` via the Arduino IDE or `arduino-cli`,
   board setting matching your ESP32 dev board (or plain Arduino Uno/Nano
   — the sketch has no ESP32-specific WiFi/BLE calls, so it'll compile
   for either).
3. Find the serial device name:
   - Linux: `ls /dev/ttyUSB*` or `/dev/ttyACM*`
   - Windows: Device Manager → Ports (COM & LPT) → note the COM number
4. Launch `motion_node` with:
   ```
   ros2 run nexus_bridge motion_node --ros-args \
     -p use_mock_serial:=false \
     -p serial_port:=/dev/ttyUSB0 \
     -p baud:=115200
   ```
5. Sanity check with a plain serial monitor first (Arduino IDE's Serial
   Monitor, or `screen /dev/ttyUSB0 115200`) — type `SETANGLE 45` and
   confirm the servo moves and you see `OK` echoed back, before trusting
   motion_node's end of it.

## TOF sensor

Not required for pickTool — `GET_TOF` currently returns a hardcoded
placeholder (120mm) in the sketch. When you're ready to wire a real TOF
sensor (for markPoint/drawLine/drawArc/pickAndPlace later), tell me the
exact model (e.g. VL53L0X, VL53L1X, an ultrasonic HC-SR04) and I'll swap
`readTofMm()` for the real driver and add continuous-stream support
(`TOF_STREAM_START`/`TOF_STREAM_STOP`) to motion_node and the sketch —
the pickTool code above doesn't touch TOF at all, so this can happen
independently.

## OLED display (separate board, see oled_display.ino)

This is a SECOND, separate Arduino/board from the servo controller
above — its own USB port, its own protocol, driven by
`screen_state_node` instead of `motion_node`. One command:

| Direction | Line | Meaning |
|---|---|---|
| host → arduino | `TEXT <up to 16 chars>` | Show this text |
| arduino → host | `OK` | Displayed |

Wiring (standard I2C, matches your 4-pin GND/VCC/SCK/SDA module —
reading "SCK" as SCL):
```
GND -> GND
VCC -> 5V (check your module's actual voltage rating first)
SCL -> Arduino SCL/A5
SDA -> Arduino SDA/A4
```

`oled_display.ino` assumes a small SSD1306 graphic OLED (128x32) shown
as one text line, since "16x1 OLED, 4-pin I2C" doesn't match a classic
HD44780 character LCD's usual wiring (those are typically parallel,
6+ pins, unless behind an I2C backpack — also possible, in which case
tell me and I'll switch the sketch to `LiquidCrystal_I2C` instead, same
serial protocol either way). Since your current unit isn't responding,
you won't know for sure which it is until you get one actually working
— the protocol on the ROS/serial side won't need to change regardless
of which display driver turns out to be right, only the ~10 lines
inside `handleCommand()` in the sketch.

Bring it up the same way as the servo board:
```
ros2 launch nexus_bridge bringup.launch.py use_mock_display_serial:=false display_serial_port:=/dev/ttyUSB1
```
(a different port than the servo board, since they're separate physical
Arduinos.)
