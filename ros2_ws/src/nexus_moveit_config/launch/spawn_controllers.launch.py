import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _cfg import build
from moveit_configs_utils.launches import generate_spawn_controllers_launch


def generate_launch_description():
    return generate_spawn_controllers_launch(build())