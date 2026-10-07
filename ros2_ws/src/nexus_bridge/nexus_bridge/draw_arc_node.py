# nexus_bridge/draw_arc_node.py
import time

import rclpy
from rclpy.node import Node
from rclpy.action import ActionServer
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor

from nexus_interfaces.action import DrawArc
from nexus_interfaces.srv import GetHeldTool, GetGridPoint, SaveTaskSnapshot
from .nexus_common import NexusLogger, call_sync, RobotIO, MoveItClient, ARC_JOINT, ARC_CW_SIGN

READY_DRAW_STUB_S = 5.0
DRAW_STUB_S = 10.0
DEFAULT_ARC_TOOL = 'compass'   # used if no held tool is recorded


class DrawArcNode(Node):
    def __init__(self):
        super().__init__('draw_arc_node')
        cb_group = ReentrantCallbackGroup()
        self.log = NexusLogger(self)
        self.io = RobotIO(self, cb_group)
        self.arm = MoveItClient(self, cb_group)
        self.get_held_client = self.create_client(GetHeldTool, '/tool_state/get_held_tool', callback_group=cb_group)
        self.grid_point_client = self.create_client(GetGridPoint, '/grid/get_point', callback_group=cb_group)
        self.snapshot_client = self.create_client(SaveTaskSnapshot, '/grid/save_snapshot', callback_group=cb_group)
        self.action_server = ActionServer(
            self, DrawArc, 'draw_arc', execute_callback=self.execute, callback_group=cb_group,
        )
        self.log.info('draw_arc_node ready — action server on "draw_arc"')

    def execute(self, goal_handle):
        req = goal_handle.request
        result = DrawArc.Result()
        job_id = f'{int(time.time())}'
        self.log.received(
            f'DrawArc goal: center=({req.center_x_mm},{req.center_y_mm}) radius={req.radius_mm} '
            f'angle={req.angle_deg} direction={req.direction}'
        )

        def step(name):
            goal_handle.publish_feedback(DrawArc.Feedback(current_step=name))
            self.log.doing(f'[drawArc] step: {name}')

        try:
            step('validating_tool')
            tool = call_sync(self.get_held_client, GetHeldTool.Request()).tool or DEFAULT_ARC_TOOL
            self.io.validate_tool(tool)

            step('validating_paper')
            self.io.wait_paper()

            step('validating_center')
            grid_result = call_sync(self.grid_point_client, GetGridPoint.Request(
                x_mm=req.center_x_mm, y_mm=req.center_y_mm, label='arc_center',
            ))
            if not grid_result.success:
                raise RuntimeError(f'grid validation failed: {grid_result.message}')

            step('locating_center')
            cx, cy = self.arm.robot_point(req.center_x_mm, req.center_y_mm)

            step('ready_draw')
            self.io.set_state('READY_DRAW')
            self.arm.approach(cx, cy)

            step('drawing_arc')
            self.io.set_state('DRAW_ARC')
            sign = ARC_CW_SIGN if req.direction == 'cw' else -ARC_CW_SIGN
            self.arm.rotate_joint(ARC_JOINT, sign * math.radians(req.angle_deg))

            step('lifting')
            self.arm.lift(cx, cy)

            step('saving_snapshot')
            call_sync(self.snapshot_client, SaveTaskSnapshot.Request(task_id=job_id, task_type='draw_arc'))

            step('standby')
            self.io.set_state('STANDBY')

            result.success = True
            result.message = f'drew {req.angle_deg}deg arc'
            goal_handle.succeed()
            return result

        except Exception as exc:  # noqa: BLE001
            self.log.error(f'[drawArc] failed: {exc}')
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
    node = DrawArcNode()
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()