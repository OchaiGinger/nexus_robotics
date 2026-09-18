FROM ros:humble

RUN apt-get update && apt-get install -y \
    ros-humble-rosbridge-suite \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip install "setuptools==58.2.0"

WORKDIR /ros2_ws
COPY ros2_ws/src ./src

RUN . /opt/ros/humble/setup.sh && \
    colcon build --symlink-install

# setuptools installs console_scripts to install/<pkg>/bin/ instead of
# the install/<pkg>/lib/<pkg>/ path `ros2 run` expects — symlink them
# into place so ros2 run can find them.
RUN mkdir -p /ros2_ws/install/nexus_bridge/lib/nexus_bridge && \
    for exe in /ros2_ws/install/nexus_bridge/bin/*; do \
        ln -sf "$exe" "/ros2_ws/install/nexus_bridge/lib/nexus_bridge/$(basename "$exe")"; \
    done

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]