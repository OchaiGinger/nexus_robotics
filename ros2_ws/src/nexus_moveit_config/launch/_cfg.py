from moveit_configs_utils import MoveItConfigsBuilder


def build():
    return (
        MoveItConfigsBuilder("nexus_arm", package_name="nexus_moveit_config")
        .robot_description(file_path="config/nexus_arm.urdf.xacro")
        .robot_description_semantic(file_path="config/nexus_arm.srdf")
        .trajectory_execution(file_path="config/moveit_controllers.yaml")
        .planning_pipelines(pipelines=["ompl"])
        .to_moveit_configs()
    )