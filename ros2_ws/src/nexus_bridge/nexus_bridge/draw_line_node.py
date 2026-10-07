# nexus_bridge/draw_line_node.py
import time

import rclpy
from rclpy.node import Node
from rclpy.action import ActionServer
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor

from nexus_interfaces.action import DrawLine
from nexus_interfaces.srv import GetHeldTool, GetGridLine, SaveTaskSnapshot
from .nexus_common import NexusLogger, call_sync, RobotIO, MoveItClient, DRAW_Z_M

READY_DRAW_STUB_S = 5.0
DRAW_STUB_S = 10.0


class DrawLineNode(Node):
    def __init__(self):
        super().__init__('draw_line_node')
        cb_group = ReentrantCallbackGroup()
        self.log = NexusLogger(self)
        self.io = RobotIO(self, cb_group)
        self.arm = MoveItClient(self, cb_group)
        self.get_held_client = self.create_client(GetHeldTool, '/tool_state/get_held_tool', callback_group=cb_group)
        self.grid_line_client = self.create_client(GetGridLine, '/grid/get_line', callback_group=cb_group)
        self.snapshot_client = self.create_client(SaveTaskSnapshot, '/grid/save_snapshot', callback_group=cb_group)
        self.action_server = ActionServer(
            self, DrawLine, 'draw_line', execute_callback=self.execute, callback_group=cb_group,
        )
        self.log.info('draw_line_node ready — action server on "draw_line"')

    def execute(self, goal_handle):
        req = goal_handle.request
        result = DrawLine.Result()
        job_id = f'{int(time.time())}'
        self.log.received(
            f'DrawLine goal: ({req.from_x_mm},{req.from_y_mm}) -> ({req.to_x_mm},{req.to_y_mm}) orientation="{req.orientation}"'
        )

        def step(name):
            goal_handle.publish_feedback(DrawLine.Feedback(current_step=name))
            self.log.doing(f'[drawLine] step: {name}')

        try:
            step('validating_tool')
            tool = call_sync(self.get_held_client, GetHeldTool.Request()).tool
            if not tool:
                raise RuntimeError('no tool held (pickTool must run first)')
            self.io.validate_tool(tool)

            step('validating_paper')
            self.io.wait_paper()

            step('validating_line')
            grid_result = call_sync(self.grid_line_client, GetGridLine.Request(
                from_x_mm=req.from_x_mm, from_y_mm=req.from_y_mm,
                to_x_mm=req.to_x_mm, to_y_mm=req.to_y_mm, label='drawLine',
            ))
            if not grid_result.success:
                raise RuntimeError(f'grid validation failed: {grid_result.message}')
            orientation = req.orientation or grid_result.orientation

            step('locating_points')
            x1, y1 = self.arm.robot_point(req.from_x_mm, req.from_y_mm)
            x2, y2 = self.arm.robot_point(req.to_x_mm, req.to_y_mm)

            step('ready_draw')
            self.io.set_state('READY_DRAW')
            self.arm.approach(x1, y1)

            step('drawing')
            self.io.set_state('DRAW_LINE')
            self.arm.line_through([(x2, y2, DRAW_Z_M)])

            step('lifting')
            self.arm.lift(x2, y2)
            step('saving_snapshot')
            call_sync(self.snapshot_client, SaveTaskSnapshot.Request(task_id=job_id, task_type='draw_line'))

            step('standby')
            self.io.set_state('STANDBY')

            result.success = True
            result.message = f'drew {orientation} line'
            goal_handle.succeed()
            return result

        except Exception as exc:  # noqa: BLE001
            self.log.error(f'[drawLine] failed: {exc}')
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
    node = DrawLineNode()
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()