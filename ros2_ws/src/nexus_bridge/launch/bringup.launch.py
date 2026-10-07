# ros2_ws/src/nexus_bridge/launch/bringup.launch.py
"""
Brings up every node that doesn't need its own camera stream, as one
unit: tool_state_node, screen_state_node, motion_node, pick_tool_node,
mark_point_node, draw_line_node, draw_arc_node, pick_and_place_node,
dispatch_node.

vision_node and grid_node are deliberately NOT included here - they stay
on their own compose services since they depend on external camera
streams (cam1's ffmpeg source, cam2's phone IP) you'll want to
start/restart independently of the core pipeline.

Usage:
    ros2 launch nexus_bridge bringup.launch.py
    ros2 launch nexus_bridge bringup.launch.py use_mock_serial:=false serial_port:=/dev/ttyUSB0
    ros2 launch nexus_bridge bringup.launch.py use_mock_display_serial:=false display_serial_port:=/dev/ttyUSB1
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    args = [
        DeclareLaunchArgument('use_mock_serial', default_value='true',
                               description='true = simulate the ESP32 servo/TOF link, false = talk to real hardware'),
        DeclareLaunchArgument('serial_port', default_value='/dev/ttyUSB0',
                               description='Serial device for motion_node when use_mock_serial:=false'),
        DeclareLaunchArgument('use_mock_display_serial', default_value='true',
                               description='true = simulate the OLED Arduino, false = talk to real hardware'),
        DeclareLaunchArgument('display_serial_port', default_value='/dev/ttyUSB1',
                               description='Serial device for screen_state_node when use_mock_display_serial:=false'),
    ]

    nodes = [
        Node(package='nexus_bridge', executable='tool_state_node', name='tool_state_node', output='screen'),
        Node(
            package='nexus_bridge', executable='screen_state_node', name='screen_state_node', output='screen',
            parameters=[{
                'use_mock_serial': LaunchConfiguration('use_mock_display_serial'),
                'display_serial_port': LaunchConfiguration('display_serial_port'),
            }],
        ),
        Node(
            package='nexus_bridge', executable='motion_node', name='motion_node', output='screen',
            parameters=[{
                'use_mock_serial': LaunchConfiguration('use_mock_serial'),
                'serial_port': LaunchConfiguration('serial_port'),
            }],
        ),
        Node(package='nexus_bridge', executable='pick_tool_node', name='pick_tool_node', output='screen'),
        Node(package='nexus_bridge', executable='mark_point_node', name='mark_point_node', output='screen'),
        Node(package='nexus_bridge', executable='draw_line_node', name='draw_line_node', output='screen'),
        Node(package='nexus_bridge', executable='draw_arc_node', name='draw_arc_node', output='screen'),
        Node(package='nexus_bridge', executable='pick_and_place_node', name='pick_and_place_node', output='screen'),
        Node(package='nexus_bridge', executable='dispatch_node', name='dispatch_node', output='screen'),
    ]

    return LaunchDescription(args + nodes)
