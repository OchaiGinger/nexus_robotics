# ros2_ws/src/nexus_bridge/nexus_bridge/screen_state_node.py
"""
screen_state_node - receives step-level status updates from dispatch_node
and task nodes, republishes them on /screen/state for anything else that
wants them, AND now actually drives the physical 16-char OLED over
serial to its own Arduino.

Protocol spoken to the Arduino (see esp32/oled_display.ino,
esp32/PROTOCOL.md): one line, `TEXT <up to 16 chars>\n`, Arduino replies
`OK\n`.

This is a SEPARATE serial connection/board from motion_node's servo
controller - screen_state_node owns its own serial port param
(display_serial_port) so the two boards don't collide. Defaults to
use_mock_serial:=true, same pattern as motion_node, so this all works
with zero hardware until the real OLED (currently unresponsive, per
your note) is sorted out.

What text actually gets shown: SetScreenState's `state` string is
truncated/mapped down to <=16 chars via _state_to_display_text() below -
a short lookup table plus a generic fallback. Tune the wording in that
table once you know what's actually readable/useful on the physical
display.
"""
import json
import threading
import time
import queue

import rclpy
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from std_msgs.msg import String

from nexus_interfaces.srv import SetScreenState, SetDisplayText
from .nexus_common import NexusLogger

# Short, hand-picked <=16-char strings for known states. Anything not
# listed here falls back to a generic truncation of the raw state name.
STATE_DISPLAY_TEXT = {
    'picktool_checking_held_tool': 'CHECK TOOL',
    'picktool_dropping_previous_tool': 'DROPPING TOOL',
    'picktool_calibrating': 'CALIBRATING',
    'picktool_searching': 'SEARCHING...',
    'picktool_picking': 'PICKING UP',
    'picktool_returning_ready': 'GOING READY',
    'picktool_success': 'PICK OK',
    'picktool_failed': 'PICK FAILED',
}


def _state_to_display_text(state):
    if state in STATE_DISPLAY_TEXT:
        return STATE_DISPLAY_TEXT[state]
    return state.replace('_', ' ').upper()[:16]


class SerialLink:
    def readline_loop(self, on_line):
        raise NotImplementedError

    def send_line(self, line):
        raise NotImplementedError

    def close(self):
        pass


class RealSerialLink(SerialLink):
    def __init__(self, port, baud, logger):
        import serial
        self.logger = logger
        self.ser = serial.Serial(port, baud, timeout=1)
        self._stop = threading.Event()

    def readline_loop(self, on_line):
        def _loop():
            while not self._stop.is_set():
                try:
                    raw = self.ser.readline()
                except Exception as exc:  # noqa: BLE001
                    self.logger.error(f'display serial read error: {exc}')
                    time.sleep(0.5)
                    continue
                if not raw:
                    continue
                line = raw.decode('utf-8', errors='ignore').strip()
                if line:
                    on_line(line)
        threading.Thread(target=_loop, daemon=True).start()

    def send_line(self, line):
        self.ser.write((line + '\n').encode('utf-8'))

    def close(self):
        self._stop.set()
        try:
            self.ser.close()
        except Exception:
            pass


class MockSerialLink(SerialLink):
    def __init__(self, logger):
        self.logger = logger
        self._on_line = None
        self.logger.warn('screen_state_node running in MOCK serial mode - no display Arduino attached')

    def readline_loop(self, on_line):
        self._on_line = on_line

    def send_line(self, line):
        def _respond():
            time.sleep(0.05)
            if self._on_line:
                self._on_line('OK')
        threading.Thread(target=_respond, daemon=True).start()


class ScreenStateNode(Node):
    def __init__(self):
        super().__init__('screen_state_node')
        cb_group = ReentrantCallbackGroup()
        self.log = NexusLogger(self)

        self.declare_parameter('use_mock_serial', True)
        self.declare_parameter('display_serial_port', '/dev/ttyUSB1')
        self.declare_parameter('baud', 9600)

        use_mock = self.get_parameter('use_mock_serial').value
        port = self.get_parameter('display_serial_port').value
        baud = self.get_parameter('baud').value

        self.link = MockSerialLink(self.log) if use_mock else RealSerialLink(port, baud, self.log)
        self._incoming: "queue.Queue[str]" = queue.Queue()
        self.link.readline_loop(self._incoming.put)

        self.state_pub = self.create_publisher(String, '/screen/state', 10)
        self.set_state_srv = self.create_service(
            SetScreenState, '/screen/set_state', self.handle_set_state, callback_group=cb_group
        )
        self.set_text_srv = self.create_service(
            SetDisplayText, '/screen/set_display_text', self.handle_set_display_text, callback_group=cb_group
        )

        self.log.info(f'screen_state_node ready (mock_serial={use_mock}) - serving /screen/set_state')

    def handle_set_state(self, request, response):
        self.log.received(f'SetScreenState request: state="{request.state}" detail={request.detail}')

        msg = String()
        msg.data = json.dumps({'state': request.state, 'detail': request.detail, 'ts': time.time()})
        self.state_pub.publish(msg)

        text = _state_to_display_text(request.state)
        self._send_text(text)

        response.success = True
        self.log.sent(f'screen state -> {request.state} (display: "{text}")')
        return response

    def handle_set_display_text(self, request, response):
        self.log.received(f'SetDisplayText request: "{request.text}"')
        response.success = self._send_text(request.text)
        return response

    def _send_text(self, text):
        text = text[:16]
        self._drain_incoming()
        self.link.send_line(f'TEXT {text}')
        line = self._wait_for(lambda l: l.startswith('OK'), timeout=3.0)
        if line is None:
            self.log.error(f'display did not ack text "{text}"')
            return False
        return True

    def _drain_incoming(self):
        while not self._incoming.empty():
            try:
                self._incoming.get_nowait()
            except queue.Empty:
                break

    def _wait_for(self, predicate, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            remaining = max(0.0, deadline - time.time())
            try:
                line = self._incoming.get(timeout=min(0.2, remaining))
            except queue.Empty:
                continue
            if predicate(line):
                return line
        return None

    def destroy_node(self):
        self.link.close()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = ScreenStateNode()
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
