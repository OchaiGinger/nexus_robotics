# nexus_bridge/pick_tool_node.py
"""pickTool = receive_tool: STANDBY -> human places tool + presses button ->
camera validates tool -> remember tool -> STANDBY."""
import rclpy
from rclpy.node import Node
from rclpy.action import ActionServer
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor

from nexus_interfaces.action import PickTool
from nexus_interfaces.srv import SetHeldTool
from .nexus_common import NexusLogger, call_sync, RobotIO


class PickToolNode(Node):
    def __init__(self):
        super().__init__('pick_tool_node')
        cb_group = ReentrantCallbackGroup()
        self.log = NexusLogger(self)
        self.io = RobotIO(self, cb_group)
        self.set_held_client = self.create_client(SetHeldTool, '/tool_state/set_held_tool', callback_group=cb_group)
        self.action_server = ActionServer(
            self, PickTool, 'pick_tool', execute_callback=self.execute, callback_group=cb_group,
        )
        self.log.info('pick_tool_node ready — action server on "pick_tool"')

    def execute(self, goal_handle):
        target = goal_handle.request.target_object
        result = PickTool.Result()
        self.log.received(f'PickTool goal: {target}')

        def step(name):
            goal_handle.publish_feedback(PickTool.Feedback(current_step=name))
            self.log.doing(f'[pickTool:{target}] step: {name}')

        try:
            step('receive_tool')
            self.io.set_state('STANDBY')
            self.io.notify_human('place_tool', f'Place "{target}" in the robot tool link, then press the button.')

            step('waiting_for_button')
            self.io.wait_button()

            step('validating_tool')
            self.io.validate_tool(target)

            call_sync(self.set_held_client, SetHeldTool.Request(tool=target))

            step('standby')
            self.io.set_state('STANDBY')

            result.success = True
            result.message = f'holding "{target}"'
            goal_handle.succeed()
            return result

        except Exception as exc:  # noqa: BLE001
            self.log.error(f'[pickTool:{target}] failed: {exc}')
            try:
                self.io.set_state('STANDBY')
            except Exception:  # noqa: BLE001
                pass
            result.success = False
            result.message = str(exc)
            goal_handle.abort()
            return result


def main(args=None):
    rclpy.init(args=args)
    node = PickToolNode()
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()