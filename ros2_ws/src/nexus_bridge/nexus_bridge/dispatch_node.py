# ros2_ws/src/nexus_bridge/nexus_bridge/dispatch_node.py
"""
dispatch_node - receives /action/dispatch (published by rosActor.ts),
detects the job type, and routes to the matching task node:

  - source == "robot": branches on payload['action']
      "pick"         -> PickTool action
      "mark"         -> MarkPoint action
      "draw"         -> DrawLine action
      "drawArc"      -> DrawArc action
      "pickAndPlace" -> PickAndPlace action
      anything else  -> still stubbed, ack'd immediately
  - source == "human": still fully stubbed

Pair-wait behavior: delegatorActor's "both" mode dispatches one robot
atom and one human atom for the same job as two SEPARATE
/action/dispatch messages. Per spec, dispatch_node must not publish
EITHER completion until BOTH have finished. To do that safely it needs
to know, up front, how many messages to expect for a given job -
otherwise it can't distinguish "single-atom job, publish immediately"
from "first half of a pair, wait for the second".

REQUIRES a small addition on the Next.js side: each dispatch payload
should include:
    pairId:   string  - shared across both atoms of the same job
    pairSize: number  - 1 for a single-actor job, 2 for "both" mode
If these fields are absent, dispatch_node defaults pairId=actionId and
pairSize=1, which reproduces today's "publish immediately" behavior -
so this is backward compatible until that field is added.

Every message received/sent, and every routing decision, goes through
NexusLogger so it lands in the shared log file alongside every other
node's activity.
"""
import json
import threading
import time
from .nexus_common import NexusLogger, RobotIO

import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from std_msgs.msg import String
from rclpy.executors import MultiThreadedExecutor
from rclpy.callback_groups import ReentrantCallbackGroup

from nexus_interfaces.action import PickTool, MarkPoint, DrawLine, DrawArc, PickAndPlace
from nexus_interfaces.srv import SetScreenState
from .nexus_common import NexusLogger


class DispatchNode(Node):
    def __init__(self):
        super().__init__('dispatch_node')
        cb_group = ReentrantCallbackGroup()
        self.log = NexusLogger(self)

        self.dispatch_sub = self.create_subscription(
            String, '/action/dispatch', self.on_dispatch, 10, callback_group=cb_group
        )
        self.complete_pub = self.create_publisher(String, '/action/complete', 10)

        self.pick_tool_client = ActionClient(self, PickTool, 'pick_tool', callback_group=cb_group)
        self.mark_point_client = ActionClient(self, MarkPoint, 'mark_point', callback_group=cb_group)
        self.draw_line_client = ActionClient(self, DrawLine, 'draw_line', callback_group=cb_group)
        self.draw_arc_client = ActionClient(self, DrawArc, 'draw_arc', callback_group=cb_group)
        self.pick_and_place_client = ActionClient(self, PickAndPlace, 'pick_and_place', callback_group=cb_group)
        self.screen_client = self.create_client(SetScreenState, '/screen/set_state', callback_group=cb_group)

        self.io = RobotIO(self, cb_group)
        self._booted = False
        self._boot_lock = threading.Lock()
        self._tool_received = threading.Event()   # set by 'collect', consumed by human 'giveRobot'

        # pairId -> list of {actionId, source, result} already finished,
        # waiting for the rest of the pair before anything gets published.
        self._pending_pairs = {}
        self._pending_lock = threading.Lock()

        self.log.info('dispatch_node ready - listening on /action/dispatch')

    def on_dispatch(self, msg: String):
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            self.log.error(f'Malformed dispatch payload: {msg.data}')
            return

        action_id = data.get('actionId')
        source = data.get('source')
        payload = data.get('payload')
        pair_id = data.get('pairId', action_id)
        pair_size = data.get('pairSize', 1)

        if not action_id or source not in ('robot', 'human'):
            self.log.error(f'Invalid dispatch message: {data}')
            return

        self.log.received(
            f'actionId={action_id} source={source} pairId={pair_id} pairSize={pair_size} payload={payload}'
        )

        self._notify_screen_started(source, payload)
        self._boot_once()

        # Each execute_* call blocks its own thread (MultiThreadedExecutor
        # handles concurrency across the two dispatches of a "both" pair)
        # until its node reports success, matching "wait for the node to
        # return success before doing anything else".
        if source == 'robot':
            result = self.execute_robot(action_id, payload)
        else:
            result = self.execute_human(payload)

        self._resolve_pair(pair_id, pair_size, action_id, source, result)

    def _notify_screen_started(self, source, payload):
        try:
            req = SetScreenState.Request()
            action = payload.get('action') if isinstance(payload, dict) else None
            req.state = f'{source}_{action or "task"}_started'
            req.detail = json.dumps({'source': source, 'payload': payload})
            future = self.screen_client.call_async(req)
            future.add_done_callback(lambda f: None)  # fire-and-forget
        except Exception as exc:  # noqa: BLE001
            self.log.warn(f'screen notify failed (continuing): {exc}')
    def _boot_once(self):
        with self._boot_lock:
            if self._booted:
                return
            self._booted = True
            try:
                self.io.set_state('BOOT')
            except Exception as exc:  # noqa: BLE001
                self.log.warn(f'BOOT state failed (continuing): {exc}')
    # ---- robot / human execution ---------------------------------------

    def execute_robot(self, action_id, payload):
        action = payload.get('action') if isinstance(payload, dict) else None
        self.log.doing(f'routing robot action "{action}"')

        if action == 'pick':
            target_object = payload.get('tool') or payload.get('object')
            if not target_object:
                self.log.error(f"pick action missing 'tool'/'object' in payload: {payload}")
                return {'ok': False, 'action': 'pick', 'error': 'missing target object'}
            goal = PickTool.Goal(target_object=target_object)
            return self._run_action(self.pick_tool_client, goal, 'pick')
        if action == 'collect':
            tool = payload.get('tool') or 'compass'
            goal = PickTool.Goal(target_object=tool)
            res = self._run_action(self.pick_tool_client, goal, 'collect')
            if res.get('ok'):
                self._tool_received.set()
            return res

        if action == 'mark':
            point = payload.get('point') or [0, 0]
            goal = MarkPoint.Goal(x_mm=float(point[0]), y_mm=float(point[1]))
            return self._run_action(self.mark_point_client, goal, 'mark')

        if action == 'draw':
            frm = payload.get('from') or [0, 0]
            to = payload.get('to') or [0, 0]
            goal = DrawLine.Goal(
                orientation=payload.get('orientation', ''),
                from_x_mm=float(frm[0]), from_y_mm=float(frm[1]),
                to_x_mm=float(to[0]), to_y_mm=float(to[1]),
            )
            return self._run_action(self.draw_line_client, goal, 'draw')

        if action == 'drawArc':
            center = payload.get('center') or [0, 0]
            goal = DrawArc.Goal(
                center_x_mm=float(center[0]), center_y_mm=float(center[1]),
                radius_mm=float(payload.get('radius', 0)),
                angle_deg=float(payload.get('angle', 0)),
                direction=payload.get('direction', 'cw'),
            )
            return self._run_action(self.draw_arc_client, goal, 'drawArc')

        if action == 'pickAndPlace':
            target_object = payload.get('tool') or payload.get('object')
            frm = payload.get('from') or [0, 0]
            to = payload.get('to') or [0, 0]
            if not target_object:
                self.log.error(f"pickAndPlace missing 'tool'/'object' in payload: {payload}")
                return {'ok': False, 'action': 'pickAndPlace', 'error': 'missing target object'}
            goal = PickAndPlace.Goal(
                target_object=target_object,
                place_from_x_mm=float(frm[0]), place_from_y_mm=float(frm[1]),
                place_to_x_mm=float(to[0]), place_to_y_mm=float(to[1]),
            )
            return self._run_action(self.pick_and_place_client, goal, 'pickAndPlace')

        self.log.warn(f'[stub] no node wired for robot action "{action}": {payload}')
        return {'ok': True, 'action': action}

    def _run_action(self, client, goal, action_name):
        if not client.wait_for_server(timeout_sec=5.0):
            self.log.error(f'{action_name}: action server unavailable')
            return {'ok': False, 'action': action_name, 'error': f'{action_name} action server unavailable'}

        self.log.sent(f'{action_name} goal: {goal}')
        send_future = client.send_goal_async(goal)
        self._block_on(send_future)
        goal_handle = send_future.result()

        if goal_handle is None or not goal_handle.accepted:
            self.log.error(f'{action_name}: goal rejected')
            return {'ok': False, 'action': action_name, 'error': f'{action_name} goal rejected'}

        result_future = goal_handle.get_result_async()
        self._block_on(result_future)
        result = result_future.result().result

        self.log.received(f'{action_name} result: success={result.success} message="{result.message}"')
        return {'ok': result.success, 'action': action_name, 'message': result.message}

    def execute_human(self, payload):
        info = payload.get('humanInstructions', payload) if isinstance(payload, dict) else {}
        if not isinstance(info, dict):
            info = {}
        atom = info.get('atomType') or ''
        tool = (payload.get('tool') if isinstance(payload, dict) else None) or info.get('tool')
        text = info.get('text')
        if text:
            self.io.notify_human('human_task', text)

        if atom == 'giveRobot':
            self.log.doing('human giveRobot: waiting for robot tool validation')
            ok = self._tool_received.wait(timeout=600.0)
            self._tool_received.clear()
            return {'ok': ok, 'atom': atom}

        if atom.startswith('place'):
            tool = tool or atom[len('place'):].lower()
            self.log.doing(f'human {atom}: waiting for button, then validating "{tool}"')
            try:
                self.io.wait_button()
                self.io.validate_tool(tool, check_state='HUMAN_CHECK')
                self.io.set_state('STANDBY')
                return {'ok': True, 'atom': atom, 'tool': tool}
            except Exception as exc:  # noqa: BLE001
                self.log.error(f'human {atom} failed: {exc}')
                return {'ok': False, 'atom': atom, 'error': str(exc)}

        self.log.info(f'[stub] human atom "{atom}" completes immediately')
        return {'ok': True, 'atom': atom}
    
    def _block_on(self, future, timeout_sec=None):
        deadline = None if timeout_sec is None else time.time() + timeout_sec
        while not future.done():
            if deadline and time.time() > deadline:
                raise RuntimeError('timed out waiting on action future')
            time.sleep(0.02)

    # ---- pair-wait + publish --------------------------------------------

    def _resolve_pair(self, pair_id, pair_size, action_id, source, result):
        with self._pending_lock:
            entries = self._pending_pairs.setdefault(pair_id, [])
            entries.append({'actionId': action_id, 'source': source, 'result': result})

            if len(entries) < pair_size:
                self.log.info(f'pairId={pair_id}: {len(entries)}/{pair_size} done - holding completion')
                return

            ready = self._pending_pairs.pop(pair_id)

        for entry in ready:
            self.publish_completion(entry['actionId'], entry['source'], entry['result'])

    def publish_completion(self, action_id, source, result):
        msg = String()
        msg.data = json.dumps({
            'actionId': action_id,
            'source': source,
            'result': result,
        })
        self.complete_pub.publish(msg)
        self.log.sent(f'completion for actionId={action_id} source={source} result={result}')


def main(args=None):
    rclpy.init(args=args)
    node = DispatchNode()
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
