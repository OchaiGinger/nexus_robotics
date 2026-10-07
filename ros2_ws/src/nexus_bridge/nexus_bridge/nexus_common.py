# ros2_ws/src/nexus_bridge/nexus_bridge/nexus_common.py
"""
Shared plumbing used by every node in this package:

  - NexusLogger: wraps a node's normal ROS logger so every log line also
    gets appended to ONE shared file, in real time, from every node/
    process at once — so you can `tail -f` or just open one file and see
    the whole pipeline's activity interleaved in order, instead of
    hunting through per-container `docker compose logs`.

  - call_sync / ActionClientCompat: the same blocking-call helpers
    pick_tool_node.py introduced, pulled out here so every new task node
    (mark_point_node, draw_line_node, draw_arc_node, pick_and_place_node)
    shares one implementation instead of five copies.

Logging format written to the shared file:
    <iso-timestamp> [<node_name>] <LEVEL> <message>

The file is opened fresh (append mode) on every single write rather than
held open, since multiple separate OS processes are writing to it
concurrently — this trades a little performance for not needing any
cross-process locking, which is fine at this log volume.
"""
import os
import time
import datetime
import threading
from std_msgs.msg import String, Empty
from nexus_interfaces.srv import SetState, DetectObject, DetectPaper, GetRobotPoint
import math
from rclpy.action import ActionClient
from geometry_msgs.msg import Pose
from sensor_msgs.msg import JointState
from shape_msgs.msg import SolidPrimitive
from moveit_msgs.action import MoveGroup, ExecuteTrajectory
from moveit_msgs.msg import BoundingVolume, Constraints, JointConstraint, MoveItErrorCodes, PositionConstraint
from moveit_msgs.srv import GetCartesianPath

LOG_FILE_PATH = os.environ.get('NEXUS_LOG_FILE', '/ros2_ws/logs/nexus.log')


def _write_log_line(node_name, level, message):
    try:
        os.makedirs(os.path.dirname(LOG_FILE_PATH), exist_ok=True)
        ts = datetime.datetime.now().isoformat(timespec='milliseconds')
        with open(LOG_FILE_PATH, 'a', encoding='utf-8') as f:
            f.write(f'{ts} [{node_name}] {level} {message}\n')
    except Exception:
        pass  # never let logging itself take a node down


class NexusLogger:
    """Use like: self.log = NexusLogger(self); self.log.received(...);
    self.log.doing(...); self.log.sent(...); self.log.error(...)."""

    def __init__(self, node):
        self.node = node
        self.name = node.get_name()
        self._logger = node.get_logger()

    def received(self, message):
        self._logger.info(message)
        _write_log_line(self.name, 'RECEIVED', message)

    def doing(self, message):
        self._logger.info(message)
        _write_log_line(self.name, 'DOING', message)

    def sent(self, message):
        self._logger.info(message)
        _write_log_line(self.name, 'SENT', message)

    def info(self, message):
        self._logger.info(message)
        _write_log_line(self.name, 'INFO', message)

    def warn(self, message):
        self._logger.warning(message)
        _write_log_line(self.name, 'WARN', message)

    def error(self, message):
        self._logger.error(message)
        _write_log_line(self.name, 'ERROR', message)

def call_sync(client, request, timeout_sec=10.0):
    """Blocks the calling thread until a service response lands or the
    timeout hits. Requires the caller's node to run under a
    MultiThreadedExecutor with more than one thread — the response is
    processed on another thread in that pool while this one waits."""
    if not client.wait_for_service(timeout_sec=5.0):
        raise RuntimeError(f'service {client.srv_name} not available')
    future = client.call_async(request)
    deadline = time.time() + timeout_sec
    while not future.done():
        if time.time() > deadline:
            raise RuntimeError(f'timed out waiting for {client.srv_name}')
        time.sleep(0.02)
    return future.result()


class ActionClientCompat:
    """Synchronous-feeling wrapper around rclpy's ActionClient, shared
    across task nodes that call a long-running action (RotateSearch,
    or any future one) and want to block-and-poll rather than juggle
    futures/callbacks inline in their step logic."""

    def __init__(self, node, action_type, action_name, callback_group):
        from rclpy.action import ActionClient
        self.node = node
        self.client = ActionClient(node, action_type, action_name, callback_group=callback_group)

    def send_goal(self, goal_msg):
        if not self.client.wait_for_server(timeout_sec=5.0):
            raise RuntimeError(f'action server {self.client._action_name} not available')
        send_future = self.client.send_goal_async(goal_msg)
        goal_handle = self._spin_until(send_future, timeout_sec=5.0)
        if goal_handle is None or not goal_handle.accepted:
            raise RuntimeError('goal was rejected')
        return _GoalHandleCompat(goal_handle)

    def _spin_until(self, future, timeout_sec):
        deadline = time.time() + timeout_sec
        while not future.done():
            if time.time() > deadline:
                return None
            time.sleep(0.02)
        return future.result()


class _GoalHandleCompat:
    def __init__(self, goal_handle):
        self._goal_handle = goal_handle
        self._result_future = goal_handle.get_result_async()

    def is_result_ready(self):
        return self._result_future.done()

    def cancel(self):
        self._goal_handle.cancel_goal_async()

    def wait_until_settled(self, timeout_sec):
        deadline = time.time() + timeout_sec
        while not self._result_future.done():
            if time.time() > deadline:
                return
            time.sleep(0.02)
# ---- states (MUST match STATES[] in motion_controller.ino) ----------------
STATES = (
    'BOOT', 'STANDBY', 'TOOL_CHECK', 'HUMAN_CHECK', 'CONFIRMED', 'GRID_CHECK',
    'TOOL_MISSING', 'PAPER_MISSING', 'READY_DRAW', 'MARK', 'DRAW_LINE', 'DRAW_ARC',
)

BUTTON_TIMEOUT_S = 600.0
TOOL_CHECK_WINDOW_S = 3.0
TOOL_CHECK_POLL_S = 0.5
DETECT_CONFIDENCE = 0.25
CONFIRMED_HOLD_S = 1.0
PAPER_CONFIRM_S = 5.0
PAPER_POLL_S = 0.5
PAPER_TIMEOUT_S = 600.0


class RobotIO:
    """LED/buzzer states, push button, tool + paper validation, human notify.
    Create once per node: self.io = RobotIO(self, cb_group)."""

    def __init__(self, node, cb_group):
        self.node = node
        self.log = NexusLogger(node)
        self._btn_lock = threading.Lock()
        self._btn_count = 0
        self.state_client = node.create_client(SetState, '/motion/set_state', callback_group=cb_group)
        self.detect_client = node.create_client(DetectObject, '/vision/detect_object', callback_group=cb_group)
        self.paper_client = node.create_client(DetectPaper, '/grid/detect_paper', callback_group=cb_group)
        self.human_pub = node.create_publisher(String, '/human/notify', 10)
        node.create_subscription(Empty, '/button/pressed', self._on_button, 10, callback_group=cb_group)

    def _on_button(self, _msg):
        with self._btn_lock:
            self._btn_count += 1
        self.log.received('push button pressed')

    def set_state(self, name):
        if name not in STATES:
            raise ValueError(f'unknown state {name}')
        r = call_sync(self.state_client, SetState.Request(state=name), timeout_sec=30.0)
        if not r.success:
            raise RuntimeError(f'set_state({name}) failed: {r.message}')
        self.log.sent(f'state -> {name}')

    def wait_button(self, timeout_s=BUTTON_TIMEOUT_S):
        with self._btn_lock:
            start = self._btn_count
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            with self._btn_lock:
                if self._btn_count > start:
                    return
            time.sleep(0.05)
        raise RuntimeError('timed out waiting for push button')

    def notify_human(self, kind, message):
        import json
        msg = String()
        msg.data = json.dumps({'type': kind, 'message': message})
        self.human_pub.publish(msg)
        self.log.sent(f'human notify: {kind}: {message}')

    def tool_present(self, label):
        deadline = time.time() + TOOL_CHECK_WINDOW_S
        while True:
            r = call_sync(self.detect_client, DetectObject.Request(label=label), timeout_sec=10.0)
            if r.found and r.confidence >= DETECT_CONFIDENCE:
                return True
            if time.time() >= deadline:
                return False
            time.sleep(TOOL_CHECK_POLL_S)

    def validate_tool(self, label, check_state='TOOL_CHECK'):
        """Blocks until the tool is confirmed. On failure: error state,
        message to human, wait for button press, check again."""
        while True:
            self.set_state(check_state)
            if self.tool_present(label):
                self.set_state('CONFIRMED')
                time.sleep(CONFIRMED_HOLD_S)
                return
            self.set_state('TOOL_MISSING')
            self.notify_human('tool_missing', f'Tool "{label}" not detected. Place it and press the button.')
            self.wait_button()

    def paper_present(self, paper_size='A4'):
        r = call_sync(self.paper_client, DetectPaper.Request(paper_size=paper_size), timeout_sec=10.0)
        return bool(r.found)

    def wait_paper(self, paper_size='A4'):
        deadline = time.time() + PAPER_TIMEOUT_S
        self.set_state('GRID_CHECK')
        missing = False
        while time.time() < deadline:
            if self.paper_present(paper_size):
                if not missing:
                    return
                self.set_state('GRID_CHECK')
                missing = False
                time.sleep(PAPER_CONFIRM_S)
                if self.paper_present(paper_size):
                    return
                continue
            if not missing:
                self.set_state('PAPER_MISSING')
                self.notify_human('paper_missing', 'Paper not detected. Place paper in view.')
                missing = True
            time.sleep(PAPER_POLL_S)
        raise RuntimeError('timed out waiting for paper')

# ---- MoveIt connection (positions in metres, frame base_link, +Z up) ---------
ARM_GROUP = 'arm'
TOOL_LINK = 'j6_kotelo__cut_extrude3'
PLAN_FRAME = 'base_link'
READY_DRAW_POS_M = (0.190, 0.0, 0.060)   # placeholder: fixed point above the sheet's near-centre
HOVER_Z_M = 0.060                         # placeholder: tool-link height while travelling over the sheet
DRAW_Z_M = 0.030                          # placeholder: tool-link height with the pen on the paper
VEL_SCALE = 0.3
MARK_STEP_M = 0.00025                     # 0.25 mm
ARC_JOINT = 'forearm_wrist'               # joint 4 sweeps the arc
ARC_CW_SIGN = -1.0                        # flip to 1.0 if the arc runs the wrong way in RViz


class MoveItClient:
    """Plans and executes arm motion through MoveIt. Create once per node."""

    def __init__(self, node, cb_group):
        self.node = node
        self.log = NexusLogger(node)
        self._joints = {}
        node.create_subscription(JointState, '/joint_states', self._on_joints, 10, callback_group=cb_group)
        self.move_client = ActionClient(node, MoveGroup, '/move_action', callback_group=cb_group)
        self.exec_client = ActionClient(node, ExecuteTrajectory, '/execute_trajectory', callback_group=cb_group)
        self.cart_client = node.create_client(GetCartesianPath, '/compute_cartesian_path', callback_group=cb_group)
        self.point_client = node.create_client(GetRobotPoint, '/grid/get_robot_point', callback_group=cb_group)

    def _on_joints(self, msg):
        for name, pos in zip(msg.name, msg.position):
            self._joints[name] = pos

    @staticmethod
    def _wait(future, timeout_sec):
        deadline = time.time() + timeout_sec
        while not future.done():
            if time.time() > deadline:
                raise RuntimeError('timed out waiting for MoveIt')
            time.sleep(0.02)
        return future.result()

    def _send(self, client, goal, timeout_sec=90.0):
        if not client.wait_for_server(timeout_sec=10.0):
            raise RuntimeError(f'{client._action_name} not available - is the moveit container running?')
        handle = self._wait(client.send_goal_async(goal), 10.0)
        if not handle.accepted:
            raise RuntimeError('MoveIt rejected the goal')
        return self._wait(handle.get_result_async(), timeout_sec).result

    def _move(self, constraints):
        goal = MoveGroup.Goal()
        r = goal.request
        r.group_name = ARM_GROUP
        r.num_planning_attempts = 5
        r.allowed_planning_time = 5.0
        r.max_velocity_scaling_factor = VEL_SCALE
        r.max_acceleration_scaling_factor = VEL_SCALE
        r.goal_constraints = [constraints]
        goal.planning_options.plan_only = False
        goal.planning_options.planning_scene_diff.is_diff = True
        goal.planning_options.planning_scene_diff.robot_state.is_diff = True
        res = self._send(self.move_client, goal)
        if res.error_code.val != MoveItErrorCodes.SUCCESS:
            raise RuntimeError(f'MoveIt move failed (error code {res.error_code.val})')

    @staticmethod
    def _pose(x, y, z):
        p = Pose()
        p.position.x, p.position.y, p.position.z = float(x), float(y), float(z)
        p.orientation.w = 1.0
        return p

    def robot_point(self, x_mm, y_mm):
        """Paper mm -> robot-frame metres, via grid_node."""
        r = call_sync(self.point_client, GetRobotPoint.Request(x_mm=float(x_mm), y_mm=float(y_mm)), timeout_sec=10.0)
        if not r.success:
            raise RuntimeError(f'paper -> robot point failed: {r.message}')
        return r.robot_x_mm / 1000.0, r.robot_y_mm / 1000.0

    def move_to_xyz(self, x, y, z):
        """Free-space move of the tool link to a position (orientation unconstrained)."""
        sphere = SolidPrimitive(type=SolidPrimitive.SPHERE, dimensions=[0.003])
        region = BoundingVolume(primitives=[sphere], primitive_poses=[self._pose(x, y, z)])
        pc = PositionConstraint(link_name=TOOL_LINK, constraint_region=region, weight=1.0)
        pc.header.frame_id = PLAN_FRAME
        self.log.doing(f'MoveIt: move to ({x:.4f}, {y:.4f}, {z:.4f}) m')
        self._move(Constraints(position_constraints=[pc]))

    def line_through(self, points, max_step_m=0.002):
        """Straight-line Cartesian path through [(x, y, z), ...] from the current tool position."""
        req = GetCartesianPath.Request()
        req.header.frame_id = PLAN_FRAME
        req.start_state.is_diff = True
        req.group_name = ARM_GROUP
        req.link_name = TOOL_LINK
        req.max_step = float(max_step_m)
        req.jump_threshold = 0.0
        req.avoid_collisions = False
        req.waypoints = [self._pose(*p) for p in points]
        res = call_sync(self.cart_client, req, timeout_sec=20.0)
        if res.fraction < 0.99:
            raise RuntimeError(f'Cartesian path only {res.fraction * 100:.0f}% reachable')
        goal = ExecuteTrajectory.Goal()
        goal.trajectory = res.solution
        self.log.doing(f'MoveIt: Cartesian path through {len(points)} point(s)')
        out = self._send(self.exec_client, goal)
        if out.error_code.val != MoveItErrorCodes.SUCCESS:
            raise RuntimeError(f'Cartesian execution failed (error code {out.error_code.val})')

    def rotate_joint(self, joint, delta_rad):
        cur = self._joints.get(joint)
        if cur is None:
            raise RuntimeError(f'no /joint_states value for {joint} yet')
        jc = JointConstraint(joint_name=joint, position=cur + delta_rad,
                             tolerance_above=0.001, tolerance_below=0.001, weight=1.0)
        self.log.doing(f'MoveIt: rotate {joint} by {math.degrees(delta_rad):.1f} deg')
        self._move(Constraints(joint_constraints=[jc]))

    def go_ready(self):
        self.move_to_xyz(*READY_DRAW_POS_M)

    def approach(self, x, y):
        """READY_DRAW pose -> above (x, y) -> straight down to DRAW_Z_M."""
        self.go_ready()
        self.move_to_xyz(x, y, HOVER_Z_M)
        self.line_through([(x, y, DRAW_Z_M)])   # TODO: replace this descent with the TOF-controlled one

    def lift(self, x, y):
        self.line_through([(x, y, HOVER_Z_M)])