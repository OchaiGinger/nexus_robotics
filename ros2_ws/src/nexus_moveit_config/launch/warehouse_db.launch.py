import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _cfg import build
from moveit_configs_utils.launches import generate_warehouse_db_launch


def generate_launch_description():
    return generate_warehouse_db_launch(build())