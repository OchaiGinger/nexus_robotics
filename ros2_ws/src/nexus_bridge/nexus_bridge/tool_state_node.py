# ros2_ws/src/nexus_bridge/nexus_bridge/tool_state_node.py
"""
tool_state_node — the "memory" of which tool the robot is currently
holding, per pick_tool_node step 1 ("check memory for last tool").

Deliberately in-memory only: state resets on node restart. If you later
need this to survive a crash/restart, swap self.held_tool for a tiny
JSON file read/write, or a ROS2 parameter with use_sim_time-style
persistence — the service interface below wouldn't need to change.
"""
import rclpy
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup

from nexus_interfaces.srv import GetHeldTool, SetHeldTool
from .nexus_common import NexusLogger


class ToolStateNode(Node):
    def __init__(self):
        super().__init__('tool_state_node')
        cb_group = ReentrantCallbackGroup()

        # Empty string means "holding nothing".
        self.held_tool = ''

        self.get_srv = self.create_service(
            GetHeldTool, '/tool_state/get_held_tool', self.handle_get, callback_group=cb_group
        )
        self.set_srv = self.create_service(
            SetHeldTool, '/tool_state/set_held_tool', self.handle_set, callback_group=cb_group
        )

        self.log = NexusLogger(self)
        self.log.info('tool_state_node ready — holding: <none>')

    def handle_get(self, request, response):
        self.log.received('GetHeldTool request')
        response.tool = self.held_tool
        self.log.sent(f'held tool: "{self.held_tool}"')
        return response

    def handle_set(self, request, response):
        self.log.received(f'SetHeldTool request: "{request.tool}"')
        previous = self.held_tool
        self.held_tool = request.tool
        self.log.sent(f'held tool changed: "{previous}" -> "{self.held_tool}"')
        response.success = True
        return response


def main(args=None):
    rclpy.init(args=args)
    node = ToolStateNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
