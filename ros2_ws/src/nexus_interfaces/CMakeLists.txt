cmake_minimum_required(VERSION 3.8)
project(nexus_interfaces)

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(std_msgs REQUIRED)
find_package(action_msgs REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "srv/MoveTo.srv"
  "srv/DetectObject.srv"
  "srv/GetHeldTool.srv"
  "srv/SetHeldTool.srv"
  "srv/SetScreenState.srv"
  "srv/ExecutePath.srv"
  "srv/GetDistance.srv"
  "srv/DetectPaper.srv"
  "srv/GetGridPoint.srv"
  "srv/GetGridLine.srv"
  "srv/DetectToolAlignment.srv"
  "srv/SaveTaskSnapshot.srv"
  "srv/SetDisplayText.srv"
  "srv/CalibrateRobotFrame.srv"
  "srv/GetRobotPoint.srv"
  "srv/SetState.srv"
  "action/PickTool.action"
  "action/RotateSearch.action"
  "action/MarkPoint.action"
  "action/DrawLine.action"
  "action/DrawArc.action"
  "action/PickAndPlace.action"
  DEPENDENCIES std_msgs action_msgs
)

ament_package()
