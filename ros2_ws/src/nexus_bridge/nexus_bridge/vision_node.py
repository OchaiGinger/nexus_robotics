# nexus_bridge/vision_node.py
import os
import threading
import time
import cv2
import rclpy
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from sensor_msgs.msg import CompressedImage

from nexus_interfaces.srv import DetectObject

try:
    from ultralytics import YOLO
except ImportError as exc:
    raise ImportError("ultralytics not installed — `pip install ultralytics`") from exc

# MODEL_WEIGHTS = "/ros2_ws/weights/yolov8n.pt"
MODEL_WEIGHTS = "/ros2_ws/weights/bests.pt"
CAMERA_SOURCE = "http://host.docker.internal:8090"   # the ONE shared USB camera
CAPTURE_DIR = "/ros2_ws/captures"
FRAME_TOPIC = "/camera/frame"
FRAME_PUBLISH_HZ = 5.0

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "fflags;nobuffer|flags;low_delay"

LABEL_TO_COCO_CLASSES = {}
LABEL_TO_COCO_CLASS = {}

def _safe_makedirs(path):
    try:
        os.makedirs(path, exist_ok=True)
    except FileExistsError:
        pass


class YoloNode(Node):
    def __init__(self):
        super().__init__("yolo_node")
        cb_group = ReentrantCallbackGroup()

        while True:
            self.cap = cv2.VideoCapture(CAMERA_SOURCE, cv2.CAP_FFMPEG)
            if self.cap.isOpened():
                break
            self.get_logger().warn(f"Camera stream at {CAMERA_SOURCE} not available, retrying in 3 s...")
            self.cap.release()
            time.sleep(3.0)
        self.get_logger().info(f"Camera stream connected at {CAMERA_SOURCE}")

        self._frame_lock = threading.Lock()
        self._latest = None
        self._stop = threading.Event()
        threading.Thread(target=self._capture_loop, daemon=True).start()

        deadline = time.time() + 10.0
        while self._get_frame() is None and time.time() < deadline:
            time.sleep(0.1)

        _safe_makedirs(os.path.dirname(MODEL_WEIGHTS))
        self.model = YOLO(MODEL_WEIGHTS)
        warm = self._get_frame()
        if warm is not None:
            self.get_logger().info('warming up YOLO model...')
            self.model(warm, verbose=False)

        self.frame_pub = self.create_publisher(CompressedImage, FRAME_TOPIC, 1)
        self.create_timer(1.0 / FRAME_PUBLISH_HZ, self._publish_frame, callback_group=cb_group)

        self.srv = self.create_service(
            DetectObject, "/vision/detect_object", self.handle_detect, callback_group=cb_group
        )
        self.get_logger().info(f"yolo_node ready — /vision/detect_object, publishing {FRAME_TOPIC}")

    def _capture_loop(self):
        while not self._stop.is_set():
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.2)
                continue
            with self._frame_lock:
                self._latest = frame

    def _get_frame(self):
        with self._frame_lock:
            return None if self._latest is None else self._latest.copy()

    def _publish_frame(self):
        frame = self._get_frame()
        if frame is None:
            return
        ok, jpg = cv2.imencode('.jpg', frame)
        if not ok:
            return
        msg = CompressedImage()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.format = 'jpeg'
        msg.data = jpg.tobytes()
        self.frame_pub.publish(msg)

    def handle_detect(self, request, response):
        label = request.label
        frame = self._get_frame()
        if frame is None:
            self.get_logger().error("No frame available from camera")
            response.found = False
            return response

        _safe_makedirs(CAPTURE_DIR)
        cv2.imwrite(os.path.join(CAPTURE_DIR, f"detect_{label}_{int(time.time())}.jpg"), frame)

        results = self.model(frame, conf=0.05, verbose=False)[0]
        seen = [f"{self.model.names[int(b.cls[0])]}({float(b.conf[0]):.2f})"
                for b in results.boxes if float(b.conf[0]) >= 0.05]
        self.get_logger().info(f"[detect:{label}] saw: {', '.join(seen) if seen else 'nothing'}")

        target_class = LABEL_TO_COCO_CLASS.get(label, label)
        best = None
        for box in results.boxes:
            if self.model.names[int(box.cls[0])] != target_class:
                continue
            conf = float(box.conf[0])
            if best is None or conf > best["confidence"]:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                best = {"x": (x1 + x2) / 2, "y": (y1 + y2) / 2, "confidence": conf}

        if best is None:
            response.found = False
            return response
        response.found = True
        response.x = best["x"]
        response.y = best["y"]
        response.confidence = best["confidence"]
        return response

    def destroy_node(self):
        self._stop.set()
        self.cap.release()
        super().destroy_node()


def main():
    rclpy.init()
    node = YoloNode()
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()