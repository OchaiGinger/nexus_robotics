# pickTool pipeline — what's here and how to wire it in

This zip now covers all five task nodes (pickTool, pickAndPlace,
markPoint, drawLine, drawArc), shared logging, real paper detection on
cam2, an OLED status display, and a standalone test CLI. See the "Known
open items" section at the bottom for what's still a placeholder.

## New package: nexus_interfaces
Drop the whole `nexus_interfaces/` folder into `ros2_ws/src/`. Complete
standalone package — nothing else needed for it to build.

## Files in nexus_bridge/nexus_bridge/
New/updated this round:
- `nexus_common.py` — **new.** Shared logger (writes to console AND one
  shared log file) and the blocking service/action-call helpers, used
  by every node below.
- `dispatch_node.py` — updated. Now routes all 5 task types (pick, mark,
  draw, drawArc, pickAndPlace) to their action servers, still with the
  pairId/pairSize wait logic from before.
- `pick_tool_node.py` — updated to use the shared logger/helpers (logic
  unchanged from before).
- `mark_point_node.py` — **new.** MarkPoint action server.
- `draw_line_node.py` — **new.** DrawLine action server.
- `draw_arc_node.py` — **new.** DrawArc action server.
- `pick_and_place_node.py` — **new.** PickAndPlace action server (the
  big one — memory check, search+pick, standby, placement line, TOF
  approach, place, bounded arrange-convergence loop).
- `motion_node.py` — updated. Added `ExecutePath` (generic draw/mark/
  place/arrange moves) and `GetDistance` (TOF) services alongside the
  existing `MoveTo`/`RotateSearch`. New config names added:
  `standby`, `mark_standby`, `mark_land`, `mark_config`.
- `grid_node.py` — rewritten. Now actually looks for an A4/A3-shaped
  rectangle in frame (Canny edges → contour → 4-point approx → aspect
  check against the real paper ratio), rectifies it, and exposes
  `/grid/detect_paper`, `/grid/get_point`, `/grid/get_line`,
  `/grid/detect_tool_alignment` (**placeholder** — see below),
  `/grid/save_snapshot`. Viewer still at `http://localhost:8091/`, now
  drawing the detected paper outline plus every point/line sent since
  the last reset.
- `tool_state_node.py` — updated to use the shared logger.
- `screen_state_node.py` — rewritten. Now actually drives a physical
  16-char OLED over its own serial connection to a second Arduino
  (`use_mock_serial:=true` by default, same pattern as `motion_node`).
- `dispatch_tester.py` — **new.** Interactive CLI that talks directly to
  `dispatch_node` (publishes `/action/dispatch`, waits on
  `/action/complete`), bypassing rosbridge/Next.js entirely — see
  "Testing" below.
- `vision_node.py` — unchanged from last round (bug fix only).

## esp32/ folder
- `motion_controller.ino` — unchanged (servo + placeholder TOF board).
- `oled_display.ino` — **new.** Second Arduino sketch for the 16×1 OLED,
  its own serial port, one command (`TEXT <str>` → `OK`). See
  `PROTOCOL.md` for wiring and the SSD1306-vs-HD44780 note.

## Manual additions needed

**`nexus_bridge/package.xml`**, **`setup.py`**, **`Dockerfile`**,
**`docker-compose.yml`** — same 4 files as before, now with more entry
points. Add these to `setup.py`'s `entry_points`:
```python
'mark_point_node = nexus_bridge.mark_point_node:main',
'draw_line_node = nexus_bridge.draw_line_node:main',
'draw_arc_node = nexus_bridge.draw_arc_node:main',
'pick_and_place_node = nexus_bridge.pick_and_place_node:main',
'dispatch_tester = nexus_bridge.dispatch_tester:main',
```
(alongside the ones already added last round.)

**`docker-compose.yml`** — two more small additions on top of last
round's edits:

1. Mount a log folder so you can read the shared log file from Windows
   without `docker compose logs`, on the `nexus_nodes` service:
   ```yaml
   nexus_nodes:
     # ...existing config...
     volumes:
       - ./logs:/ros2_ws/logs
       - ./captures:/ros2_ws/captures
   ```
   Then `./logs/nexus.log` on your Windows machine has everything, live,
   from every node. `./captures/grid_snapshots/` gets the per-task
   screenshots `grid_node` saves.

2. Add the same two volumes to `grid_node`'s service (it also writes to
   `/ros2_ws/logs` and `/ros2_ws/captures`).

3. `pyserial` needs to already be in the Dockerfile from last round —
   both `motion_node` and `screen_state_node` use it now.

## Testing — three levels, from most to least isolated

**1. Test one node's service/action directly**, with everything else
mocked out (fastest feedback loop while building):
```bash
docker compose up rosbridge nexus_nodes vision_node grid_node
docker compose exec nexus_nodes ros2 service call /motion/move_to nexus_interfaces/srv/MoveTo "{config_name: 'ready', x: 0.0, y: 0.0}"
docker compose exec nexus_nodes ros2 service call /grid/detect_paper nexus_interfaces/srv/DetectPaper "{paper_size: 'A4'}"
docker compose exec nexus_nodes ros2 action send_goal /pick_tool nexus_interfaces/action/PickTool "{target_object: 'pencil'}"
```

**2. Test the whole robot pipeline via dispatch_node, no Next.js at
all** — this is what `dispatch_tester` is for:
```bash
docker compose exec nexus_nodes ros2 run nexus_bridge dispatch_tester
```
Pick an action from the menu, fill in the prompts, watch `/screen/state`
updates print live as the task runs, then see the final
`/action/complete` result. This is the tool to reach for once a task
node is built and you want to confirm the whole chain (dispatch → task
node → motion/grid/vision/tool_state → completion) without touching
rosbridge or the frontend.

**3. Full stack**, per the run sequence from before — `npm run dev` +
triggering from the actual UI.

## Reading the shared log

Every node's RECEIVED/DOING/SENT/ERROR lines land in one file:
```bash
type logs\nexus.log        # PowerShell/cmd, one-time look
Get-Content logs\nexus.log -Wait -Tail 50   # PowerShell, live tail
```

## Known open items / assumptions baked in, flagged for later

1. **Grasp confirmation is open-loop** (unchanged from before).
2. **`_angle_from_x` / all servo angle mappings are placeholders** —
   there's still no real kinematics; every task node's "motion" is
   currently one servo move plus a delay, regardless of task type. This
   is intentional (per your "just prepared for the servo motor instead"
   note) — the point right now is a correct, testable STATE MACHINE for
   each task, not real movement.
3. **`grid_node.handle_detect_alignment` always returns `found=false`.**
   No tool-shape detection model exists yet, so `pick_and_place_node`'s
   arrange step will currently fail every time, by design — a clean
   failure rather than fake success. This is the one piece genuinely
   blocked on a real vision model for tool shapes.
4. **Paper-space coordinate assumption**: `x_mm`/`y_mm` inputs are
   assumed to already be real paper millimeters (based on your
   `angleActor` log's `[65,10]`→`[145,10]`, `"len":80` matching a
   plausible 80mm baseline on A4/A3). If that turns out wrong, the fix
   is confined to `grid_node._mm_to_raw_px()` and the paper-bounds
   check in `handle_get_point` — nothing else needs to change.
5. **OLED sketch assumes SSD1306** (small graphic OLED), based on the
   4-pin I2C wiring you described. Flagged in `oled_display.ino` and
   `PROTOCOL.md` as the one thing to confirm once you have a responding
   unit — swapping to a true HD44780 (via `LiquidCrystal_I2C`) is a
   small, contained change if that's actually what you have.
6. **`pairId`/`pairSize` still need adding on the Next.js side**
   (unchanged from before).
7. **Fail-fast everywhere, no retries** — per your "(b)" decision. A
   failed step reports failure immediately rather than looping. The
   `pick_and_place_node` arrange step's bounded iteration (up to 10
   tries) is the one exception, but that's normal converge-or-fail
   algorithm behavior, not error-retry.
