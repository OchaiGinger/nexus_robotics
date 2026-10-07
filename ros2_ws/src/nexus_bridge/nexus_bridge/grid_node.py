# ros2_ws/src/nexus_bridge/nexus_bridge/grid_node.py
"""
grid_node — cam2 (stationary Android phone via IP Webcam) paper-aware
grid system.

Pipeline, run continuously in a background thread:
  1. Pull a frame from the phone stream.
  2. Look for the largest 4-sided contour in frame (classic CV: gray ->
     blur -> Canny edges -> findContours -> approxPolyDP down to 4
     points). This is a generic "find a rectangle" search, not YOLO —
     the paper isn't a trained object class, it's a shape.
  3. Check that quadrilateral's side-length ratio against the expected
     A4/A3 ratio (both are approx 1.414). If it doesn't match well
     enough (see ASPECT_TOLERANCE), the paper is NOT considered found —
     the loop just keeps looking next frame. This is normal operation,
     not an error, per the "wait, don't fail" instruction for this step.
  4. Once matched, perspective-warp that quadrilateral to a flat
     top-down RECTIFIED_WIDTH_PX x RECTIFIED_HEIGHT_PX image, so every
     mm-space calculation elsewhere (GetGridPoint, GetGridLine,
     DetectToolAlignment) works in a stable, undistorted frame
     regardless of the phone's actual viewing angle.

Services exposed:
  /grid/detect_paper          - one-shot check (see DetectPaper.srv)
  /grid/get_point             - validate + overlay a single mm point
  /grid/get_line              - validate + overlay a line, reports orientation
  /grid/detect_tool_alignment - bounding box vs. line, for pickAndPlace's
                                 arrange step
  /grid/save_snapshot         - writes the current overlay to disk

Viewer: same as before, http://<host>:8091/ - now shows the raw feed
with the detected paper outline (if any) plus every point/line sent
since the last detection reset.

Coordinate assumption (per your log): x_mm/y_mm inputs are already in
real paper millimeters, origin at the paper's top-left corner as seen
in the rectified image. If that assumption is wrong once compared
against real robot behavior, the fix is confined to _mm_to_raw_px()
below - nothing else needs to change.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import rclpy
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup
from sensor_msgs.msg import CompressedImage

from nexus_interfaces.srv import (
    DetectPaper, GetGridPoint, GetGridLine, DetectToolAlignment, SaveTaskSnapshot,
    CalibrateRobotFrame, GetRobotPoint,
)
from .nexus_common import NexusLogger

PAPER_SIZES_MM = {
    'A4': (210.0, 297.0),
    'A3': (297.0, 420.0),
}
ASPECT_TOLERANCE = 0.12          # fraction of expected ratio allowed as error
RECTIFIED_WIDTH_PX = 800         # working resolution for the flattened paper image
CANNY_LOW, CANNY_HIGH = 50, 150
MIN_CONTOUR_AREA_FRAC = 0.10     # ignore contours smaller than this fraction of the frame
SNAPSHOT_DIR = '/ros2_ws/captures/grid_snapshots'
CALIB_PATH = '/ros2_ws/captures/robot_calibration.json'
PAPER_FRESH_S = 1.5              # paper counts as "detected" only if seen this recently


class _MjpegHandler(BaseHTTPRequestHandler):
    frame_provider = None

    def do_GET(self):
        if self.path not in ('/', '/video'):
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Age', '0')
        self.send_header('Cache-Control', 'no-cache, private')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=FRAME')
        self.end_headers()
        try:
            while True:
                frame = self.frame_provider() if self.frame_provider else None
                if frame is None:
                    time.sleep(0.05)
                    continue
                ok, jpg = cv2.imencode('.jpg', frame)
                if not ok:
                    continue
                self.wfile.write(b'--FRAME\r\n')
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(jpg)))
                self.end_headers()
                self.wfile.write(jpg.tobytes())
                self.wfile.write(b'\r\n')
                time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format, *args):
        pass


class GridNode(Node):
    def __init__(self):
        super().__init__('grid_node')
        cb_group = ReentrantCallbackGroup()
        self.log = NexusLogger(self)

        self.declare_parameter('phone_stream_url', '')
        self.declare_parameter('mjpeg_port', 8091)
        self.declare_parameter('paper_size', 'A4')

        
        self.mjpeg_port = self.get_parameter('mjpeg_port').value
        self.paper_size = self.get_parameter('paper_size').value       
        self._frame_lock = threading.Lock()
        self._incoming_frame = None
        self._paper_last_seen = 0.0
        self.create_subscription(CompressedImage, '/camera/frame', self._on_frame, 1, callback_group=cb_group)
        self.log.info('grid_node using shared camera via /camera/frame')
        # Shared mutable state, guarded by _state_lock:
        #   _raw_frame        latest camera frame
        #   _paper_corners    4 (x,y) points in raw-frame pixel space, or None
        #   _rectified_size   (w_px, h_px) of the current rectification, or None
        #   _homography       3x3 matrix raw-frame px -> rectified px, or None
        #   _overlay_points   [(x_mm, y_mm, label), ...] since last reset
        #   _overlay_lines    [(fx,fy,tx,ty,label), ...] since last reset
        self._state_lock = threading.Lock()
        self._raw_frame = None
        self._paper_corners = None
        self._rectified_size = None
        self._homography = None
        self._overlay_points = []
        self._overlay_lines = []
        self._robot_H = self._load_calibration()        

        self._stop = threading.Event()
        threading.Thread(target=self._capture_loop, daemon=True).start()

        self.detect_srv = self.create_service(DetectPaper, '/grid/detect_paper', self.handle_detect_paper, callback_group=cb_group)
        self.point_srv = self.create_service(GetGridPoint, '/grid/get_point', self.handle_get_point, callback_group=cb_group)
        self.line_srv = self.create_service(GetGridLine, '/grid/get_line', self.handle_get_line, callback_group=cb_group)
        self.align_srv = self.create_service(DetectToolAlignment, '/grid/detect_tool_alignment', self.handle_detect_alignment, callback_group=cb_group)
        self.snapshot_srv = self.create_service(SaveTaskSnapshot, '/grid/save_snapshot', self.handle_save_snapshot, callback_group=cb_group)
        self.calib_srv = self.create_service(CalibrateRobotFrame, '/grid/calibrate_robot_frame', self.handle_calibrate, callback_group=cb_group)
        self.robot_point_srv = self.create_service(GetRobotPoint, '/grid/get_robot_point', self.handle_get_robot_point, callback_group=cb_group)

        self._start_http_server()
        self.log.info(f'grid_node ready - viewer at http://<this-machine-ip>:{self.mjpeg_port}/, paper_size={self.paper_size}')

    # ---- capture + paper detection loop --------------------------------
    def _on_frame(self, msg):
        arr = np.frombuffer(bytes(msg.data), dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is not None:
            with self._frame_lock:
                self._incoming_frame = frame
                
    def _capture_loop(self):
        while not self._stop.is_set():
            with self._frame_lock:
                frame = self._incoming_frame
                self._incoming_frame = None
            if frame is None:
                time.sleep(0.05)
                continue

            corners, aspect_error = self._find_paper(frame)
            if corners is not None:
                self._paper_last_seen = time.time()
            with self._state_lock:
                self._raw_frame = frame
                if corners is not None:
                    self._paper_corners = corners
                    w_mm, h_mm = PAPER_SIZES_MM[self.paper_size]
                    rect_h = int(RECTIFIED_WIDTH_PX * (h_mm / w_mm))
                    self._rectified_size = (RECTIFIED_WIDTH_PX, rect_h)
                    dst = np.array([[0, 0], [RECTIFIED_WIDTH_PX, 0],
                                     [RECTIFIED_WIDTH_PX, rect_h], [0, rect_h]], dtype=np.float32)
                    self._homography = cv2.getPerspectiveTransform(corners.astype(np.float32), dst)
                # if not found, deliberately KEEP the last known good
                # corners/homography rather than clearing them - a
                # single dropped frame (glare, hand passing over)
                # shouldn't throw away a perfectly good calibration.

    def _find_paper(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, CANNY_LOW, CANNY_HIGH)
        edges = cv2.dilate(edges, None, iterations=1)
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        frame_area = frame.shape[0] * frame.shape[1]
        best = None
        best_error = None

        for c in contours:
            area = cv2.contourArea(c)
            if area < frame_area * MIN_CONTOUR_AREA_FRAC:
                continue
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) != 4:
                continue

            pts = approx.reshape(4, 2).astype(np.float32)
            ordered = self._order_corners(pts)
            side_top = np.linalg.norm(ordered[1] - ordered[0])
            side_left = np.linalg.norm(ordered[3] - ordered[0])
            if side_top < 1 or side_left < 1:
                continue

            long_side, short_side = max(side_top, side_left), min(side_top, side_left)
            detected_ratio = long_side / short_side
            expected_ratio = max(PAPER_SIZES_MM[self.paper_size]) / min(PAPER_SIZES_MM[self.paper_size])
            error = abs(detected_ratio - expected_ratio) / expected_ratio

            if error <= ASPECT_TOLERANCE and (best_error is None or error < best_error):
                best = ordered
                best_error = error

        return best, best_error

    @staticmethod
    def _order_corners(pts):
        # Returns corners ordered [top-left, top-right, bottom-right, bottom-left].
        s = pts.sum(axis=1)
        diff = np.diff(pts, axis=1).flatten()
        top_left = pts[np.argmin(s)]
        bottom_right = pts[np.argmax(s)]
        top_right = pts[np.argmin(diff)]
        bottom_left = pts[np.argmax(diff)]
        return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float32)

    # ---- services --------------------------------------------------------
    def _load_calibration(self):
        try:
            with open(CALIB_PATH) as f:
                return np.array(json.load(f)['H'], dtype=np.float64)
        except Exception:
            return None

    @staticmethod
    def _mm_to_raw_px_f(x_mm, y_mm, corners, w_mm, h_mm):
        fx = x_mm / w_mm
        fy = y_mm / h_mm
        top = corners[0] + (corners[1] - corners[0]) * fx
        bottom = corners[3] + (corners[2] - corners[3]) * fx
        return top + (bottom - top) * fy

    def handle_calibrate(self, request, response):
        self.log.received(f'CalibrateRobotFrame request: origin=({request.origin_x_mm}, {request.origin_y_mm})')
        with self._state_lock:
            corners = self._paper_corners
        if corners is None:
            response.success = False
            response.message = 'paper not detected - place the sheet at its measured spot first'
            self.log.error(response.message)
            return response
        w_mm, h_mm = PAPER_SIZES_MM[self.paper_size]
        x0, y0 = float(request.origin_x_mm), float(request.origin_y_mm)
        # paper +x -> robot +x, paper +y -> robot -y (robot base on the LEFT of the image)
        robot = np.array([[x0, y0], [x0 + w_mm, y0], [x0 + w_mm, y0 - h_mm], [x0, y0 - h_mm]], dtype=np.float32)
        H = cv2.getPerspectiveTransform(np.array(corners, dtype=np.float32), robot)
        os.makedirs(os.path.dirname(CALIB_PATH), exist_ok=True)
        with open(CALIB_PATH, 'w') as f:
            json.dump({'H': H.tolist(), 'origin': [x0, y0], 'paper_size': self.paper_size}, f)
        with self._state_lock:
            self._robot_H = H.astype(np.float64)
        response.success = True
        response.message = f'calibrated; saved to {CALIB_PATH}'
        self.log.sent(response.message)
        return response

    def handle_get_robot_point(self, request, response):
        with self._state_lock:
            corners = self._paper_corners
            H = self._robot_H
        if H is None:
            response.success = False
            response.message = 'not calibrated - call /grid/calibrate_robot_frame first'
        elif corners is None:
            response.success = False
            response.message = 'paper not detected'
        else:
            w_mm, h_mm = PAPER_SIZES_MM[self.paper_size]
            if not (0 <= request.x_mm <= w_mm and 0 <= request.y_mm <= h_mm):
                response.success = False
                response.message = f'point ({request.x_mm}, {request.y_mm}) is outside the {self.paper_size} sheet'
            else:
                p = self._mm_to_raw_px_f(request.x_mm, request.y_mm, corners, w_mm, h_mm)
                q = cv2.perspectiveTransform(np.array([[p]], dtype=np.float64), H)[0][0]
                response.success = True
                response.message = 'ok'
                response.robot_x_mm = float(q[0])
                response.robot_y_mm = float(q[1])
        if not response.success:
            self.log.error(response.message)
        return response


    def handle_detect_paper(self, request, response):
        self.log.received(f'DetectPaper request: paper_size={request.paper_size}')
        with self._state_lock:
                    corners = self._paper_corners if (time.time() - self._paper_last_seen) <= PAPER_FRESH_S else None
        if corners is None:
            response.found = False
            response.corner_x = []
            response.corner_y = []
            response.aspect_ratio_error = -1.0
            self.log.doing('no matching paper rectangle currently in frame')
            return response

        response.found = True
        response.corner_x = [float(p[0]) for p in corners]
        response.corner_y = [float(p[1]) for p in corners]
        response.aspect_ratio_error = 0.0
        self.log.sent('paper detected and matched')
        return response

    def handle_get_point(self, request, response):
        self.log.received(f'GetGridPoint request: ({request.x_mm}, {request.y_mm}) label="{request.label}"')
        with self._state_lock:
            if self._homography is None:
                response.success = False
                response.message = 'no rectified paper available yet - call detect_paper / wait for match first'
                self.log.error(response.message)
                return response
            w_mm, h_mm = PAPER_SIZES_MM[self.paper_size]
            if not (0 <= request.x_mm <= w_mm and 0 <= request.y_mm <= h_mm):
                response.success = False
                response.message = f'point ({request.x_mm}, {request.y_mm}) is outside the {self.paper_size} sheet ({w_mm}x{h_mm}mm)'
                self.log.error(response.message)
                return response
            self._overlay_points.append((request.x_mm, request.y_mm, request.label))

        response.success = True
        response.message = 'point accepted'
        self.log.sent(response.message)
        return response

    def handle_get_line(self, request, response):
        self.log.received(
            f'GetGridLine request: ({request.from_x_mm},{request.from_y_mm}) -> '
            f'({request.to_x_mm},{request.to_y_mm}) label="{request.label}"'
        )
        dx = abs(request.to_x_mm - request.from_x_mm)
        dy = abs(request.to_y_mm - request.from_y_mm)
        orientation = 'vertical' if dx < dy * 0.2 else 'horizontal' if dy < dx * 0.2 else 'diagonal'

        with self._state_lock:
            if self._homography is None:
                response.success = False
                response.message = 'no rectified paper available yet'
                response.orientation = orientation
                self.log.error(response.message)
                return response
            self._overlay_lines.append((request.from_x_mm, request.from_y_mm, request.to_x_mm, request.to_y_mm, request.label))

        response.success = True
        response.message = 'line accepted'
        response.orientation = orientation
        self.log.sent(f'{response.message} (orientation={orientation})')
        return response

    def handle_detect_alignment(self, request, response):
        """
        PLACEHOLDER geometry: without a fine-tuned model for tool shapes,
        this can't yet find a real bounding box for `tool_label` in the
        rectified image. It returns found=false so pick_and_place_node's
        convergence loop fails cleanly and visibly rather than silently
        pretending to align against fake data. Swap the body of this
        method for real contour/YOLO-based detection once vision is
        ready for it - the service contract (deviation_mm, nearest_side,
        push_x_mm/push_y_mm) is already what pick_and_place_node expects,
        so nothing else needs to change when this gets implemented.
        """
        self.log.received(f'DetectToolAlignment request: tool="{request.tool_label}"')
        response.found = False
        response.deviation_mm = 0.0
        response.nearest_side = ''
        response.push_x_mm = 0.0
        response.push_y_mm = 0.0
        self.log.error('DetectToolAlignment not yet implemented - no tool-shape model available')
        return response

    def handle_save_snapshot(self, request, response):
        self.log.received(f'SaveTaskSnapshot request: task_id={request.task_id} type={request.task_type}')
        with self._state_lock:
            frame = self._raw_frame
            corners = self._paper_corners
            points = list(self._overlay_points)
            lines = list(self._overlay_lines)

        if frame is None:
            response.success = False
            response.path = ''
            self.log.error('no frame available to snapshot')
            return response

        annotated = self._render_overlay(frame, corners, points, lines)
        os.makedirs(SNAPSHOT_DIR, exist_ok=True)
        filename = f'{request.task_type}_{request.task_id}_{int(time.time())}.jpg'
        path = os.path.join(SNAPSHOT_DIR, filename)
        cv2.imwrite(path, annotated)

        response.success = True
        response.path = path
        self.log.sent(f'snapshot saved to {path}')
        return response

    def reset_overlay(self):
        """In-process helper (not yet exposed as a service across
        process boundaries) to call between tasks so one task's
        points/lines don't bleed into the next snapshot. TODO: expose
        as a tiny service once a task node needs to call it from a
        separate process."""
        with self._state_lock:
            self._overlay_points = []
            self._overlay_lines = []

    # ---- rendering -------------------------------------------------------

    def _render_overlay(self, frame, corners, points, lines):
        out = frame.copy()
        if corners is not None:
            cv2.polylines(out, [corners.astype(np.int32)], True, (0, 255, 0), 2)

        w_mm, h_mm = PAPER_SIZES_MM[self.paper_size]
        for (x_mm, y_mm, label) in points:
            px = self._mm_to_raw_px(x_mm, y_mm, corners, w_mm, h_mm)
            if px is not None:
                cv2.circle(out, px, 6, (0, 0, 255), -1)
                if label:
                    cv2.putText(out, label, (px[0] + 8, px[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)

        for (fx, fy, tx, ty, label) in lines:
            p1 = self._mm_to_raw_px(fx, fy, corners, w_mm, h_mm)
            p2 = self._mm_to_raw_px(tx, ty, corners, w_mm, h_mm)
            if p1 is not None and p2 is not None:
                cv2.line(out, p1, p2, (255, 0, 0), 2)
                if label:
                    cv2.putText(out, label, p1, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 1, cv2.LINE_AA)

        return out

    @staticmethod
    def _mm_to_raw_px(x_mm, y_mm, corners, w_mm, h_mm):
        if corners is None:
            return None
        # Bilinear interpolation across the 4 detected corners
        # (top-left, top-right, bottom-right, bottom-left) using the
        # point's fraction across the paper - cheap and good enough for
        # an overlay preview; the real geometry used for validation
        # lives in the homography computed in _capture_loop, not here.
        fx = x_mm / w_mm
        fy = y_mm / h_mm
        top = corners[0] + (corners[1] - corners[0]) * fx
        bottom = corners[3] + (corners[2] - corners[3]) * fx
        point = top + (bottom - top) * fy
        return (int(point[0]), int(point[1]))

    def _get_latest_annotated_frame(self):
        with self._state_lock:
            frame = self._raw_frame
            corners = self._paper_corners
            points = list(self._overlay_points)
            lines = list(self._overlay_lines)
        if frame is None:
            return None
        return self._render_overlay(frame, corners, points, lines)

    def _start_http_server(self):
        handler = type('BoundHandler', (_MjpegHandler,), {'frame_provider': self._get_latest_annotated_frame})
        self._http_server = ThreadingHTTPServer(('0.0.0.0', self.mjpeg_port), handler)
        threading.Thread(target=self._http_server.serve_forever, daemon=True).start()

    def destroy_node(self):
        self._stop.set()
        try:
            self._http_server.shutdown()
        except Exception:
            pass
        try:
            self.cap.release()
        except Exception:
            pass
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = GridNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
