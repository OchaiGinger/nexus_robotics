# ros2_ws/src/nexus_bridge/nexus_bridge/dispatch_tester.py
"""
dispatch_tester — a CLI that talks to dispatch_node exactly the way
rosActor.ts does (publish /action/dispatch, subscribe /action/complete),
but from inside the ROS2 graph directly — no rosbridge, no websocket, no
Next.js required. Use this to exercise the whole robot-side pipeline
from a terminal while building/debugging each task node.

Usage:
    ros2 run nexus_bridge dispatch_tester

Then follow the prompts: pick a robot action, fill in the fields it
asks for, watch it print RECEIVED/DOING/SENT-style progress as
/screen/state updates arrive, and finally print the /action/complete
result. Each dispatch blocks until that result arrives (or hits
DISPATCH_TIMEOUT_S), matching the "wait for success" behavior of the
real pipeline — so if it hangs, that's telling you something real
timed out somewhere downstream, not a bug in this tool.

Payload shapes sent (matching what dispatch_node.execute_robot expects,
which in turn matches the RobotPlan shapes robotActor.ts produces):
    pick          {"action": "pick", "tool": <str>}
    mark          {"action": "mark", "point": [x_mm, y_mm]}
    draw          {"action": "draw", "from": [x,y], "to": [x,y]}
    drawArc       {"action": "drawArc", "center": [x,y], "radius": r, "angle": a, "direction": "cw"|"ccw"}
    pickAndPlace  {"action": "pickAndPlace", "tool": <str>, "from": [x,y], "to": [x,y]}
"""
import json
import time
import uuid

import rclpy
from rclpy.node import Node
from std_msgs.msg import String


DISPATCH_TIMEOUT_S = 120.0

ACTIONS = {
    '1': ('pick', lambda: {'action': 'pick', 'tool': _ask('tool name (e.g. pencil)')}),
    '2': ('mark', lambda: {'action': 'mark', 'point': _ask_point('mark point')}),
    '3': ('draw', lambda: {'action': 'draw', 'from': _ask_point('line start'), 'to': _ask_point('line end')}),
    '4': ('drawArc', lambda: {
        'action': 'drawArc',
        'center': _ask_point('arc center'),
        'radius': float(_ask('radius (mm)')),
        'angle': float(_ask('angle (deg)')),
        'direction': _ask('direction (cw/ccw)', default='cw'),
    }),
    '5': ('pickAndPlace', lambda: {
        'action': 'pickAndPlace',
        'tool': _ask('tool name'),
        'from': _ask_point('place line start'),
        'to': _ask_point('place line end'),
    }),
}


def _ask(prompt, default=None):
    suffix = f' [{default}]' if default is not None else ''
    val = input(f'  {prompt}{suffix}: ').strip()
    return val if val else default


def _ask_point(prompt):
    raw = input(f'  {prompt} as "x,y" (mm): ').strip()
    x_str, y_str = raw.split(',')
    return [float(x_str.strip()), float(y_str.strip())]


class DispatchTester(Node):
    def __init__(self):
        super().__init__('dispatch_tester')
        self.dispatch_pub = self.create_publisher(String, '/action/dispatch', 10)
        self.complete_sub = self.create_subscription(String, '/action/complete', self._on_complete, 10)
        self.screen_sub = self.create_subscription(String, '/screen/state', self._on_screen, 10)
        self._pending = {}

    def _on_screen(self, msg):
        try:
            data = json.loads(msg.data)
            print(f'    [screen] {data.get("state")}  {data.get("detail", "")}')
        except json.JSONDecodeError:
            pass

    def _on_complete(self, msg):
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            return
        action_id = data.get('actionId')
        if action_id in self._pending:
            self._pending[action_id] = data

    def dispatch_and_wait(self, action_name, payload):
        action_id = f'{action_name}-{uuid.uuid4().hex[:8]}'
        self._pending[action_id] = None

        msg = String()
        msg.data = json.dumps({'actionId': action_id, 'source': 'robot', 'payload': payload})
        print(f'\n>>> dispatching {action_id}: {payload}')
        self.dispatch_pub.publish(msg)

        deadline = time.time() + DISPATCH_TIMEOUT_S
        while self._pending[action_id] is None:
            rclpy.spin_once(self, timeout_sec=0.1)
            if time.time() > deadline:
                print(f'!!! timed out after {DISPATCH_TIMEOUT_S}s waiting for completion')
                return None
        result = self._pending.pop(action_id)
        print(f'<<< completion: {json.dumps(result, indent=2)}')
        return result


def main(args=None):
    rclpy.init(args=args)
    tester = DispatchTester()

    print('dispatch_tester — talks directly to dispatch_node, no rosbridge/Next.js needed')
    print('(give it a couple seconds to discover dispatch_node before dispatching)')
    time.sleep(2.0)

    try:
        while True:
            print('\nChoose an action:')
            for key, (name, _) in ACTIONS.items():
                print(f'  {key}) {name}')
            print('  q) quit')
            choice = input('> ').strip().lower()

            if choice == 'q':
                break
            if choice not in ACTIONS:
                print('unrecognized choice')
                continue

            action_name, builder = ACTIONS[choice]
            try:
                payload = builder()
            except Exception as exc:  # noqa: BLE001 - bad input, just retry
                print(f'bad input, try again: {exc}')
                continue

            tester.dispatch_and_wait(action_name, payload)
    finally:
        tester.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
