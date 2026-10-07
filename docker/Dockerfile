FROM ros:humble

RUN apt-get update && apt-get install -y \
    ros-humble-rosbridge-suite \
    ros-humble-moveit \
    ros-humble-moveit-configs-utils \
    ros-humble-ros2-control \
    ros-humble-ros2-controllers \
    ros-humble-xacro \
    ros-humble-rviz2 \
    python3-pip \
    libgl1 \
    libglib2.0-0 \
    libv4l-dev \
    v4l-utils \
    && rm -rf /var/lib/apt/lists/*

COPY docker/torch-2.14.0+cpu-cp310-cp310-manylinux_2_28_x86_64.whl /tmp/
RUN pip install /tmp/torch-2.14.0+cpu-cp310-cp310-manylinux_2_28_x86_64.whl

# Ensure packaging is modern enough for setuptools' canonicalize_version()
# call (strip_trailing_zero kwarg needs packaging>=22) — torch or other
# deps above may have pulled in an older packaging that shadows the one
# ROS Humble's setuptools expects. Pin last so nothing downgrades it.
RUN pip install "packaging>=23"

# opencv-python-headless (not opencv-python) — GUI bindings aren't needed
# since vision_node saves frames to disk rather than calling cv2.imshow,
# and the headless build avoids pulling in Qt/GTK system deps we don't
# have installed. ultralytics is the YOLO wrapper vision_node imports.
# opencv-python-headless (not opencv-python) — GUI bindings aren't needed
# since vision_node saves frames to disk rather than calling cv2.imshow,
# and the headless build avoids pulling in Qt/GTK system deps we don't
# have installed. ultralytics is the YOLO wrapper vision_node imports.
# AFTER (giving pip a reasonable timeout, e.g., 60 seconds)
RUN pip install --no-cache-dir --default-timeout=60 opencv-python-headless
RUN pip install --no-cache-dir --default-timeout=120 --retries=10 \
    torchvision==0.29.0+cpu --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --default-timeout=120 --retries=10 ultralytics

# pyserial — motion_node's link to the ESP32/Arduino over USB serial.
RUN pip install --no-cache-dir --default-timeout=120 --retries=10 pyserial
WORKDIR /ros2_ws
COPY ros2_ws/src ./src

RUN . /opt/ros/humble/setup.sh && \
    colcon build --symlink-install

RUN mkdir -p /ros2_ws/install/nexus_bridge/lib/nexus_bridge && \
    for exe in /ros2_ws/install/nexus_bridge/bin/*; do \
        ln -sf "$exe" "/ros2_ws/install/nexus_bridge/lib/nexus_bridge/$(basename "$exe")"; \
    done

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]