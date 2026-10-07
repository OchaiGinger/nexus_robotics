# ros2_ws/src/nexus_bridge/nexus_bridge/motion_node.py
"""
motion_node — stand-in for MoveIt2 until a URDF/real arm exists. Owns the
single demo servo (and, later, the TOF sensor) over a USB-serial link to
an ESP32/Arduino, and exposes two ROS2-native interfaces on top of it:

  - MoveTo service:  one-shot "go to this named configuration" moves
  - RotateSearch action: continuous rotation with streamed feedback and
    cancel support, used by pick_tool_node's search step

Serial protocol spoken to the ESP32 (see esp32/motion_controller.ino and
esp32/PROTOCOL.md):

    host -> esp32   esp32 -> host
    SETANGLE <deg>  OK
    ROTATE_START    ANGLE <deg>   (streamed repeatedly)
    ROTATE_STOP     OK <deg>
    GET_TOF         TOF <mm>      (scaffolded; not used by pickTool yet)

Runs with use_mock_serial:=true by default so the rest of the pipeline
(pick_tool_node, dispatch_node) is fully testable with zero hardware.
Flip the param to false once the ESP32 is flashed and wired, and set
serial_port to match (e.g. /dev/ttyUSB0 on Linux, a COM port on Windows).

CONFIG_ANGLES below are placeholder poses. There's no kinematics yet, so
every named config just maps to a fixed servo angle EXCEPT "pick", whose
angle is derived from the detected x-coordinate as a rough stand-in for
"point roughly toward the object" — replace this mapping wholesale once
a real arm/URDF exists.
"""
import json
import threading
import time
import queue

import rclpy
from rclpy.node import Node
from rclpy.action import ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor

from std_msgs.msg import Empty
from nexus_interfaces.srv import MoveTo, ExecutePath, GetDistance, SetState
from nexus_interfaces.action import RotateSearch
from .nexus_common import NexusLogger, STATES
# Placeholder angle table. "pick" is handled specially (see move_to_config).
CONFIG_ANGLES = {
    'drop': 10,
    'calibrate': 90,
    'ready': 90,
    'grip_close': 90,   # no real gripper yet; same servo just holds position
    'grip_open': 90,
    'standby': 90,          # pickAndPlace step 5, "arbitrary fixed configuration"
    'mark_standby': 90,     # markPoint step 2
    'mark_land': 45,        # markPoint step 4
    'mark_config': 30,      # markPoint step 5, actually making the mark
    'draw_standby': 90,     # drawLine step 2 — mirrors mark_standby; NOT
                             # yet XY-aware, just an arbitrary fixed pose
                             # so the TOF sensor has a stable position to
                             # measure from before landing
    'draw_land': 45,         # drawLine step 4 — mirrors mark_land; kept
                             # as a separate entry from mark_land on
                             # purpose so tuning one doesn't silently
                             # affect the other once real hardware exists
}

# Assumed camera frame width from vision_node's detections, for mapping a
# detected x pixel coordinate to a servo angle 0-180. Update this if the
# camera resolution changes.
ASSUMED_FRAME_WIDTH_PX = 640.0

# Placeholder single-servo stand-in for real X/Y kinematics on the paper.
# grid_node has already certified x_mm is a real point on a real sheet of
# this width - this is the (temporary, one-DOF) answer to "so what angle
# does the servo go to for that point". Replace wholesale once the
# stepper-driven arm/URDF exists. Matches PAPER_SIZES_MM['A4'][0] in
# grid_node.py - update both together if paper size assumptions change.
ASSUMED_PAPER_WIDTH_MM = 210.0


class SerialLink:
    """Thin wrapper so motion_node doesn't care whether it's talking to a
    real ESP32 over pyserial or a mock. Both expose: send_line(str),
    read_line(timeout) -> str | None, close()."""

    def readline_loop(self, on_line):
        raise NotImplementedError

    def send_line(self, line):
        raise NotImplementedError

    def close(self):
        pass


class RealSerialLink(SerialLink):
    def __init__(self, port, baud, logger):
        import serial  # pyserial; only imported when actually used
        self.logger = logger
        self.ser = serial.Serial(port, baud, timeout=1)
        time.sleep(2)  # Uno resets on serial open (DTR toggle) — give it
                        # time to finish rebooting before sending commands
        self._stop = threading.Event()
        self._thread = None
    def readline_loop(self, on_line):
        def _loop():
            while not self._stop.is_set():
                try:
                    raw = self.ser.readline()
                except Exception as exc:  # noqa: BLE001 - log and keep trying
                    self.logger.error(f'serial read error: {exc}')
                    time.sleep(0.5)
                    continue
                if not raw:
                    continue
                line = raw.decode('utf-8', errors='ignore').strip()
                if line:
                    on_line(line)
        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()

    def send_line(self, line):
        self.ser.write((line + '\n').encode('utf-8'))

    def close(self):
        self._stop.set()
        try:
            self.ser.close()
        except Exception:
            pass


class MockSerialLink(SerialLink):
    """Simulates an ESP32 running the protocol in PROTOCOL.md, with
    realistic-ish delays, so everything above motion_node can be
    developed and tested with no hardware attached."""

    def __init__(self, logger):
        self.logger = logger
        self._stop = threading.Event()
        self._rotating = threading.Event()
        self._angle = 90.0
        self._on_line = None
        self._mock_distance_mm = 300.0  # simulated approach: decreases each GET_TOF call
        self.logger.warn('motion_node running in MOCK serial mode — no ESP32 attached')

    def readline_loop(self, on_line):
        self._on_line = on_line

    def send_line(self, line):
        threading.Thread(target=self._handle, args=(line,), daemon=True).start()

    def _handle(self, line):
        parts = line.split()
        cmd = parts[0] if parts else ''

        if cmd == 'SETANGLE':
            target = float(parts[1])
            time.sleep(0.4)  # pretend the servo takes a moment to move
            self._angle = target
            self._emit('OK')

        elif cmd == 'ROTATE_START':
            self._rotating.set()

            def _sweep():
                angle = self._angle
                direction = 1
                while self._rotating.is_set():
                    angle += direction * 5
                    if angle >= 180 or angle <= 0:
                        direction *= -1
                    self._angle = max(0.0, min(180.0, angle))
                    self._emit(f'ANGLE {self._angle:.1f}')
                    time.sleep(0.15)

            threading.Thread(target=_sweep, daemon=True).start()

        elif cmd == 'ROTATE_STOP':
            self._rotating.clear()
            time.sleep(0.05)
            self._emit(f'OK {self._angle:.1f}')

        elif cmd == 'STATE':
            name = parts[1] if len(parts) > 1 else ''
            if name == 'BOOT':
                time.sleep(6.0)
                self._emit('OK BOOT')
            elif name in STATES:
                time.sleep(0.05)
                self._emit(f'OK {name}')
            else:
                self._emit('ERR UNKNOWN')

        elif cmd == 'GET_TOF':
            # Simulate a real approach: distance decreases toward ~15mm
            # then holds, so a caller polling this in a loop actually
            # sees convergence instead of a constant value forever.
            self._mock_distance_mm = max(15.0, self._mock_distance_mm - 25.0)
            self._emit(f'TOF {self._mock_distance_mm:.1f}')

    def _emit(self, line):
        if self._on_line:
            self._on_line(line)

    def close(self):
        self._rotating.clear()
        self._stop.set()


class MotionNode(Node):
    def __init__(self):
        super().__init__('motion_node')
        cb_group = ReentrantCallbackGroup()

        self.declare_parameter('use_mock_serial', True)
        self.declare_parameter('serial_port', '/dev/ttyUSB0')
        self.declare_parameter('baud', 115200)

        use_mock = self.get_parameter('use_mock_serial').value
        port = self.get_parameter('serial_port').value
        baud = self.get_parameter('baud').value

        if use_mock:
            self.link = MockSerialLink(self.get_logger())
        else:
            self.link = RealSerialLink(port, baud, self.get_logger())

        # Incoming lines from the ESP32 land here; whichever call is
        # currently waiting (move_to or the rotate-search loop) reads
        # from it. Only one motion command is ever in flight at a time,
        # which matches "everything waits for the previous step" — this
        # node never needs to disambiguate concurrent commands.
        self._incoming: "queue.Queue[str]" = queue.Queue()
        self._cmd_lock = threading.Lock()
        self.button_pub = self.create_publisher(Empty, '/button/pressed', 10)
        self.link.readline_loop(self._on_serial_line)

        self.move_srv = self.create_service(
            MoveTo, '/motion/move_to', self.handle_move_to, callback_group=cb_group
        )
        self.execute_path_srv = self.create_service(
            ExecutePath, '/motion/execute_path', self.handle_execute_path, callback_group=cb_group
        )
        self.get_distance_srv = self.create_service(
            GetDistance, '/motion/get_distance', self.handle_get_distance, callback_group=cb_group
        )
        self.set_state_srv = self.create_service(
            SetState, '/motion/set_state', self.handle_set_state, callback_group=cb_group
        )

        self.log = NexusLogger(self)

        self._rotate_active = threading.Event()
        self.rotate_action = ActionServer(
            self,
            RotateSearch,
            '/motion/rotate_search',
            execute_callback=self.execute_rotate_search,
            goal_callback=self.goal_callback,
            cancel_callback=self.cancel_callback,
            callback_group=cb_group,
        )

        self.get_logger().info(
            f'motion_node ready (mock_serial={use_mock}) — '
            f'/motion/move_to, /motion/rotate_search'
        )

    # ---- MoveTo -----------------------------------------------------

    def handle_move_to(self, request, response):
        config = request.config_name
        self.log.received(f'MoveTo request: config="{config}" x={request.x} y={request.y}')
        if config == 'pick':
            angle = self._angle_from_x(request.x)
        elif config in ('draw_standby', 'draw_land'):
            # Position-dependent, unlike the other fixed CONFIG_ANGLES
            # entries - the whole point of these two configs is to
            # respond to the x_mm grid_node already certified, not to
            # sit at one static angle regardless of where we're drawing.
            angle = self._angle_from_mm_x(request.x)
        elif config in CONFIG_ANGLES:
            angle = CONFIG_ANGLES[config]
        else:
            response.success = False
            response.message = f'unknown config_name "{config}"'
            self.log.error(response.message)
            return response

        self._drain_incoming()
        self.log.doing(f'sending SETANGLE {angle} for config "{config}"')
        self.link.send_line(f'SETANGLE {angle}')
        line = self._wait_for(lambda l: l.startswith('OK'), timeout=5.0)
        if line is None:
            response.success = False
            response.message = f'timed out waiting for servo ack on config "{config}"'
            self.log.error(response.message)
            return response

        response.success = True
        response.message = f'moved to "{config}" (angle={angle})'
        self.log.sent(response.message)
        return response

    def handle_execute_path(self, request, response):
        self.log.received(f'ExecutePath request: type="{request.path_type}" params={request.params_json}')
        try:
            params = json.loads(request.params_json) if request.params_json else {}
        except json.JSONDecodeError:
            response.success = False
            response.message = 'params_json was not valid JSON'
            self.log.error(response.message)
            return response

        # No real per-path-type kinematics yet — every type resolves to
        # one servo move plus a realistic delay so the rest of the
        # pipeline (and its logging/state transitions) is fully
        # testable now. Swap this out path_type-by-path_type once a
        # real arm/URDF exists.
        angle = 90
        if request.path_type == 'draw_arc':
            angle = int(max(0, min(180, params.get('angle', 0))))
        elif request.path_type == 'draw_line':
            # Placeholder only: a single servo can't trace an X/Y line,
            # so this just points at the line's horizontal midpoint as
            # a stand-in that at least responds to the real coordinates
            # instead of a flat constant. Replace once the stepper
            # arm/URDF can follow the actual from->to path.
            frm = params.get('from', [0, 0])
            to = params.get('to', [0, 0])
            mid_x_mm = (float(frm[0]) + float(to[0])) / 2.0
            angle = self._angle_from_mm_x(mid_x_mm)
        self._drain_incoming()
        self.log.doing(f'executing path "{request.path_type}" -> SETANGLE {angle}')
        self.link.send_line(f'SETANGLE {angle}')
        line = self._wait_for(lambda l: l.startswith('OK'), timeout=5.0)
        if line is None:
            response.success = False
            response.message = f'timed out waiting for servo ack on path "{request.path_type}"'
            self.log.error(response.message)
            return response

        response.success = True
        response.message = f'executed "{request.path_type}"'
        self.log.sent(response.message)
        return response

    def handle_get_distance(self, request, response):
        self.log.received('GetDistance request')
        self._drain_incoming()
        self.link.send_line('GET_TOF')
        line = self._wait_for(lambda l: l.startswith('TOF'), timeout=3.0)
        if line is None:
            response.ok = False
            response.distance_mm = 0.0
            self.log.error('timed out waiting for TOF reading')
            return response
        response.distance_mm = float(line.split()[1])
        response.ok = response.distance_mm >= 0.0
        self.log.sent(f'TOF reading: {response.distance_mm}mm')
        return response

    def _angle_from_x(self, x_px):
        # Placeholder mapping only — replace once real kinematics exist.
        frac = max(0.0, min(1.0, x_px / ASSUMED_FRAME_WIDTH_PX))
        return round(frac * 180)

    def _angle_from_mm_x(self, x_mm):
        # Placeholder mapping only, same shape as _angle_from_x above but
        # for grid-certified paper mm instead of a camera pixel. Replace
        # once real kinematics exist.
        frac = max(0.0, min(1.0, x_mm / ASSUMED_PAPER_WIDTH_MM))
        return round(frac * 180)

    # ---- RotateSearch -------------------------------------------------

    def goal_callback(self, goal_request):
        return GoalResponse.ACCEPT

    def cancel_callback(self, cancel_request):
        return CancelResponse.ACCEPT

    def execute_rotate_search(self, goal_handle):
        max_angle = goal_handle.request.max_angle_deg
        self._drain_incoming()
        self.link.send_line('ROTATE_START')

        result = RotateSearch.Result()
        start_time = time.time()
        last_angle = 0.0

        while True:
            if goal_handle.is_cancel_requested:
                self.link.send_line('ROTATE_STOP')
                self._wait_for(lambda l: l.startswith('OK'), timeout=3.0)
                goal_handle.canceled()
                result.completed_full_rotation = False
                result.final_angle_deg = last_angle
                return result

            line = self._wait_for(lambda l: l.startswith('ANGLE'), timeout=1.0)
            if line is not None:
                last_angle = float(line.split()[1])
                fb = RotateSearch.Feedback()
                fb.current_angle_deg = last_angle
                goal_handle.publish_feedback(fb)

            if last_angle >= max_angle or (time.time() - start_time) > 60.0:
                self.link.send_line('ROTATE_STOP')
                self._wait_for(lambda l: l.startswith('OK'), timeout=3.0)
                goal_handle.succeed()
                result.completed_full_rotation = True
                result.final_angle_deg = last_angle
                return result
    def _on_serial_line(self, line):
        if line == 'BTN':
            self.button_pub.publish(Empty())
            return
        self._incoming.put(line)

    def handle_set_state(self, request, response):
        name = request.state
        self.log.received(f'SetState request: {name}')
        with self._cmd_lock:
            self._drain_incoming()
            self.link.send_line(f'STATE {name}')
            timeout = 30.0 if name == 'BOOT' else 3.0
            line = self._wait_for(lambda l: l.startswith('OK') or l.startswith('ERR'), timeout=timeout)
        if line is None:
            response.success = False
            response.message = f'timed out waiting for ack on state {name}'
            self.log.error(response.message)
            return response
        response.success = line.startswith('OK')
        response.message = line
        self.log.sent(f'state {name}: {line}')
        return response

    # ---- helpers ------------------------------------------------------

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
    node = MotionNode()
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()