# nexus_bridge/mark_point_node.py
import time

import rclpy
from rclpy.node import Node
from rclpy.action import ActionServer
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor

from nexus_interfaces.action import MarkPoint
from nexus_interfaces.srv import GetHeldTool, GetGridPoint, SaveTaskSnapshot
from .nexus_common import NexusLogger, call_sync, RobotIO, MoveItClient, DRAW_Z_M, MARK_STEP_M

READY_DRAW_STUB_S = 5.0   # stub: TOF descent (calibrate later)
MARK_STUB_S = 5.0         # stub: 0.5mm right / back / 0.5mm up


class MarkPointNode(Node):
    def __init__(self):
        super().__init__('mark_point_node')
        cb_group = ReentrantCallbackGroup()
        self.log = NexusLogger(self)
        self.io = RobotIO(self, cb_group)
        self.arm = MoveItClient(self, cb_group)
        self.get_held_client = self.create_client(GetHeldTool, '/tool_state/get_held_tool', callback_group=cb_group)
        self.grid_point_client = self.create_client(GetGridPoint, '/grid/get_point', callback_group=cb_group)
        self.snapshot_client = self.create_client(SaveTaskSnapshot, '/grid/save_snapshot', callback_group=cb_group)
        self.action_server = ActionServer(
            self, MarkPoint, 'mark_point', execute_callback=self.execute, callback_group=cb_group,
        )
        self.log.info('mark_point_node ready — action server on "mark_point"')

    def execute(self, goal_handle):
        x_mm, y_mm = goal_handle.request.x_mm, goal_handle.request.y_mm
        result = MarkPoint.Result()
        job_id = f'{int(time.time())}'
        self.log.received(f'MarkPoint goal: ({x_mm}, {y_mm})')

        def step(name):
            goal_handle.publish_feedback(MarkPoint.Feedback(current_step=name))
            self.log.doing(f'[markPoint] step: {name}')

        try:
            step('validating_tool')
            tool = call_sync(self.get_held_client, GetHeldTool.Request()).tool
            if not tool:
                raise RuntimeError('no tool held (pickTool must run first)')
            self.io.validate_tool(tool)

            step('validating_paper')
            self.io.wait_paper()

            step('validating_point')
            grid_result = call_sync(self.grid_point_client, GetGridPoint.Request(x_mm=x_mm, y_mm=y_mm, label='mark'))
            if not grid_result.success:
                raise RuntimeError(f'grid validation failed: {grid_result.message}')

            step('locating_point')
            rx, ry = self.arm.robot_point(x_mm, y_mm)

            step('ready_draw')
            self.io.set_state('READY_DRAW')
            self.arm.approach(rx - MARK_STEP_M, ry)

            step('marking')
            self.io.set_state('MARK')
            self.arm.line_through([(rx, ry, DRAW_Z_M), (rx, ry + MARK_STEP_M, DRAW_Z_M)], max_step_m=0.0001)

            step('lifting')
            self.arm.lift(rx, ry + MARK_STEP_M)

            step('saving_snapshot')
            call_sync(self.snapshot_client, SaveTaskSnapshot.Request(task_id=job_id, task_type='mark_point'))

            step('standby')
            self.io.set_state('STANDBY')

            result.success = True
            result.message = f'marked point ({x_mm}, {y_mm})'
            goal_handle.succeed()
            return result

        except Exception as exc:  # noqa: BLE001
            self.log.error(f'[markPoint] failed: {exc}')
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
    node = MarkPointNode()
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()