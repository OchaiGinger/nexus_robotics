import os
from glob import glob

from setuptools import setup

package_name = 'nexus_bridge'

setup(
    name=package_name,
    version='0.0.1',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages', [f'resource/{package_name}']),
        (f'share/{package_name}', ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    entry_points={
        'console_scripts': [
            'vision_node = nexus_bridge.vision_node:main',
            'dispatch_node = nexus_bridge.dispatch_node:main',
            'pick_tool_node = nexus_bridge.pick_tool_node:main',
            'motion_node = nexus_bridge.motion_node:main',
            'tool_state_node = nexus_bridge.tool_state_node:main',
            'screen_state_node = nexus_bridge.screen_state_node:main',
            'grid_node = nexus_bridge.grid_node:main',
            'mark_point_node = nexus_bridge.mark_point_node:main',
            'draw_line_node = nexus_bridge.draw_line_node:main',
            'draw_arc_node = nexus_bridge.draw_arc_node:main',
            'pick_and_place_node = nexus_bridge.pick_and_place_node:main',
            'dispatch_tester = nexus_bridge.dispatch_tester:main',
        ],
    },
)