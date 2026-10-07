# ros2_ws/src/nexus_bridge/nexus_bridge/pick_and_place_node.py
"""
pick_and_place_node — implements pickAndPlace. Steps 1-4 are identical
to pick_tool_node's steps 1-4 (memory check -> drop-if-holding-other ->
calibrate -> search+detect), then diverges:

  1-4. (shared with pickTool — see pick_tool_node.py's docstring)
  5. motion.move_to("standby") — arbitrary fixed pose, per your "random
     configuration for now" note
  6. grid.get_line(place_from, place_to) — the virtual placement line
  7. poll motion.get_distance() until threshold (same TOF pattern as
     mark_point_node)
  8. motion.execute_path("place", ...)
  9. motion.execute_path("arrange", ...) — touches paper tip at arrange height
  10. ARRANGE LOOP (bounded, not infinite — fail-fast per your "b"
      decision if it doesn't converge): repeatedly call
      grid.detect_tool_alignment, nudge via motion.execute_path("arrange",
      {push_x, push_y}), until deviation_mm < ARRANGE_CONVERGE_MM or
      ARRANGE_MAX_ITERATIONS is hit.
  11. motion.move_to("ready")
  12. grid.save_snapshot()
  -> success

KNOWN GAP: grid_node.handle_detect_alignment is currently a placeholder
that always returns found=false (no tool-shape model exists yet — see
its docstring). That means step 10 here will currently fail immediately
every time, by design — a clean, visible failure rather than silently
pretending to align against fake data. This node's logic is otherwise
complete and ready for the moment grid_node's detection is real; no
changes will be needed here when that happens.
"""
import json
import time

import rclpy
from rclpy.node import Node
from rclpy.action import ActionServer
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor

from nexus_interfaces.action import PickAndPlace, RotateSearch
from nexus_interfaces.srv import (
    MoveTo, ExecutePath, GetHeldTool, SetHeldTool, DetectObject,
    GetGridLine, GetDistance, DetectToolAlignment, SaveTaskSnapshot,
)
from .nexus_common import NexusLogger, call_sync, ActionClientCompat

DETECTION_POLL_INTERVAL_S = 0.4
DETECTION_CONFIDENCE_THRESHOLD = 0.25
SEARCH_MAX_ANGLE_DEG = 360.0
STANDARD_DROP_X = 0.0
STANDARD_DROP_Y = 0.0
LAND_THRESHOLD_MM = 20.0
LAND_TIMEOUT_S = 15.0
LAND_POLL_INTERVAL_S = 0.3
ARRANGE_CONVERGE_MM = 2.0
ARRANGE_MAX_ITERATIONS = 10


class PickAndPlaceNode(Node):
    def __init__(self):
        super().__init__('pick_and_place_node')
        cb_group = ReentrantCallbackGroup()
        self.log = NexusLogger(self)

        self.move_client = self.create_client(MoveTo, '/motion/move_to', callback_group=cb_group)
        self.execute_path_client = self.create_client(ExecutePath, '/motion/execute_path', callback_group=cb_group)
        self.distance_client = self.create_client(GetDistance, '/motion/get_distance', callback_group=cb_group)
        self.rotate_client = ActionClientCompat(self, RotateSearch, '/motion/rotate_search', cb_group)
        self.get_held_client = self.create_client(GetHeldTool, '/tool_state/get_held_tool', callback_group=cb_group)
        self.set_held_client = self.create_client(SetHeldTool, '/tool_state/set_held_tool', callback_group=cb_group)
        self.detect_client = self.create_client(DetectObject, '/vision/detect_object', callback_group=cb_group)
        self.grid_line_client = self.create_client(GetGridLine, '/grid/get_line', callback_group=cb_group)
        self.alignment_client = self.create_client(DetectToolAlignment, '/grid/detect_tool_alignment', callback_group=cb_group)
        self.snapshot_client = self.create_client(SaveTaskSnapshot, '/grid/save_snapshot', callback_group=cb_group)

        self.action_server = ActionServer(
            self, PickAndPlace, 'pick_and_place', execute_callback=self.execute, callback_group=cb_group,
        )
        self.log.info('pick_and_place_node ready — action server on "pick_and_place"')

    def move_to(self, config_name, x=0.0, y=0.0):
        req = MoveTo.Request(config_name=config_name, x=float(x), y=float(y))
        self.log.doing(f'move_to("{config_name}")')
        result = call_sync(self.move_client, req, timeout_sec=15.0)
        if not result.success:
            raise RuntimeError(f'move_to("{config_name}") failed: {result.message}')
        self.log.sent(f'move_to("{config_name}") -> success')

    def execute_path(self, path_type, params):
        req = ExecutePath.Request(path_type=path_type, params_json=json.dumps(params))
        self.log.doing(f'execute_path("{path_type}") params={params}')
        result = call_sync(self.execute_path_client, req, timeout_sec=15.0)
        if not result.success:
            raise RuntimeError(f'execute_path("{path_type}") failed: {result.message}')
        self.log.sent(f'execute_path("{path_type}") -> success')

    def execute(self, goal_handle):
        req = goal_handle.request
        target = req.target_object
        result = PickAndPlace.Result()
        job_id = f'{int(time.time())}'
        self.log.received(
            f'PickAndPlace goal: target="{target}" '
            f'place=({req.place_from_x_mm},{req.place_from_y_mm})->({req.place_to_x_mm},{req.place_to_y_mm})'
        )

        def step(name):
            goal_handle.publish_feedback(PickAndPlace.Feedback(current_step=name))
            self.log.doing(f'[pickAndPlace] step: {name}')

        try:
            # --- steps 1-4, shared with pick_tool_node ---
            step('checking_held_tool')
            held = call_sync(self.get_held_client, GetHeldTool.Request()).tool

            if held != target:
                if held:
                    step('dropping_previous_tool')
                    self.move_to('drop', STANDARD_DROP_X, STANDARD_DROP_Y)
                    call_sync(self.set_held_client, SetHeldTool.Request(tool=''))

                step('calibrating')
                self.move_to('calibrate')

                step('searching')
                found = self._search_until_found(target)
                if found is None:
                    raise RuntimeError(f'"{target}" not found after full search rotation')

                step('picking')
                self.move_to('pick', found['x'], found['y'])
                call_sync(self.set_held_client, SetHeldTool.Request(tool=target))
            else:
                self.log.info(f'already holding "{target}" — skipping search/pick')

            # --- step 5: standby ---
            step('standby')
            self.move_to('standby')

            # --- step 6: virtual placement line ---
            step('checking_placement_line')
            grid_result = call_sync(self.grid_line_client, GetGridLine.Request(
                from_x_mm=req.place_from_x_mm, from_y_mm=req.place_from_y_mm,
                to_x_mm=req.place_to_x_mm, to_y_mm=req.place_to_y_mm, label='place_line',
            ))
            if not grid_result.success:
                raise RuntimeError(f'grid validation failed: {grid_result.message}')

            # --- step 7: TOF-guided approach ---
            step('waiting_for_tof')
            deadline = time.time() + LAND_TIMEOUT_S
            distance = None
            while time.time() < deadline:
                dist_result = call_sync(self.distance_client, GetDistance.Request(), timeout_sec=3.0)
                if dist_result.ok:
                    distance = dist_result.distance_mm
                    self.log.info(f'TOF distance: {distance}mm (threshold {LAND_THRESHOLD_MM}mm)')
                    if distance <= LAND_THRESHOLD_MM:
                        break
                time.sleep(LAND_POLL_INTERVAL_S)
            else:
                raise RuntimeError(f'TOF never reached {LAND_THRESHOLD_MM}mm within {LAND_TIMEOUT_S}s (last={distance})')

            # --- step 8: place ---
            step('placing')
            self.execute_path('place', {
                'from': [req.place_from_x_mm, req.place_from_y_mm],
                'to': [req.place_to_x_mm, req.place_to_y_mm],
            })

            # --- step 9 + 10: arrange, touching down then converging ---
            step('touching_arrange_height')
            self.execute_path('arrange', {'phase': 'touch_down'})

            step('arranging')
            for i in range(ARRANGE_MAX_ITERATIONS):
                alignment = call_sync(self.alignment_client, DetectToolAlignment.Request(
                    tool_label=target,
                    line_from_x_mm=req.place_from_x_mm, line_from_y_mm=req.place_from_y_mm,
                    line_to_x_mm=req.place_to_x_mm, line_to_y_mm=req.place_to_y_mm,
                ), timeout_sec=5.0)
                if not alignment.found:
                    raise RuntimeError(
                        'grid.detect_tool_alignment could not find the tool — '
                        'this is expected until grid_node has a real tool-shape model (see its docstring)'
                    )
                self.log.info(
                    f'arrange iteration {i}: deviation={alignment.deviation_mm}mm '
                    f'side={alignment.nearest_side} push=({alignment.push_x_mm},{alignment.push_y_mm})'
                )
                if alignment.deviation_mm <= ARRANGE_CONVERGE_MM:
                    self.log.info(f'arrange converged after {i} iterations')
                    break
                self.execute_path('arrange', {
                    'phase': 'nudge', 'push_x': alignment.push_x_mm, 'push_y': alignment.push_y_mm,
                })
            else:
                raise RuntimeError(f'arrange did not converge within {ARRANGE_MAX_ITERATIONS} iterations')

            # --- step 11-12: ready + snapshot ---
            step('returning_ready')
            self.move_to('ready')

            step('saving_snapshot')
            call_sync(self.snapshot_client, SaveTaskSnapshot.Request(task_id=job_id, task_type='pick_and_place'))

            step('success')
            result.success = True
            result.message = f'placed and arranged "{target}"'
            goal_handle.succeed()
            return result

        except Exception as exc:  # noqa: BLE001
            self.log.error(f'[pickAndPlace] failed: {exc}')
            result.success = False
            result.message = str(exc)
            goal_handle.abort()
            return result

    def _search_until_found(self, target):
        goal = RotateSearch.Goal(max_angle_deg=SEARCH_MAX_ANGLE_DEG)
        handle = self.rotate_client.send_goal(goal)
        try:
            while True:
                if handle.is_result_ready():
                    return None
                detect_result = call_sync(self.detect_client, DetectObject.Request(label=target), timeout_sec=3.0)
                if detect_result.found and detect_result.confidence >= DETECTION_CONFIDENCE_THRESHOLD:
                    handle.cancel()
                    return {'x': detect_result.x, 'y': detect_result.y}
                time.sleep(DETECTION_POLL_INTERVAL_S)
        finally:
            handle.wait_until_settled(timeout_sec=5.0)


def main(args=None):
    rclpy.init(args=args)
    node = PickAndPlaceNode()
    executor = MultiThreadedExecutor(num_threads=8)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
