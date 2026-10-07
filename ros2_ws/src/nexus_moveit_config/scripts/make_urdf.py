#!/usr/bin/env python3
"""Usage: python3 make_urdf.py <assembly_step.urdf> <out: config/nexus_arm.urdf.xacro>"""
import math
import sys
import xml.etree.ElementTree as ET

SRC, DST = sys.argv[1], sys.argv[2]
PKG = "nexus_moveit_config"

# joint: (lower_deg, upper_deg). wrist_tool is locked to 0..45 in joint_limits.yaml
ARM = {
    "base_shoulder_joint": (-180.0, 180.0),
    "shoulder_upperarm_joint": (-45.0, 90.0),
    "revolute_3": (-90.0, 90.0),
    "forearm_wrist": (-180.0, 180.0),
    "wrist_tool": (-45.0, 90.0),
}
EFFORT, VELOCITY = "10.0", "1.0"   # placeholders

tree = ET.parse(SRC)
robot = tree.getroot()
robot.set("name", "nexus_arm")

for mesh in robot.iter("mesh"):
    mesh.set("filename", mesh.get("filename").replace("package://assembly_step/meshes/", f"package://{PKG}/meshes/"))

for j in robot.findall("joint"):
    name = j.get("name")
    for tag in ("limit", "dynamics", "mimic"):
        for e in j.findall(tag):
            j.remove(e)
    if name in ARM:
        j.set("type", "revolute")
        lo, hi = ARM[name]
        ET.SubElement(j, "limit", lower=f"{math.radians(lo):.6f}", upper=f"{math.radians(hi):.6f}",
                      effort=EFFORT, velocity=VELOCITY)
    elif j.get("type") != "fixed":
        j.set("type", "fixed")
        for e in j.findall("axis"):
            j.remove(e)

# make +Z up: the export has "up" = -X of the `root` link
ET.SubElement(robot, "link", name="base_link")
bj = ET.SubElement(robot, "joint", name="base_link_to_root", type="fixed")
ET.SubElement(bj, "parent", link="base_link")
ET.SubElement(bj, "child", link="root")
ET.SubElement(bj, "origin", xyz="0 0 0", rpy=f"0 {math.pi / 2:.7f} 0")

# ros2_control: mock hardware now. Later replace ONLY the <plugin> line.
rc = ET.SubElement(robot, "ros2_control", name="NexusSystem", type="system")
hw = ET.SubElement(rc, "hardware")
ET.SubElement(hw, "plugin").text = "mock_components/GenericSystem"
for name in ARM:
    jj = ET.SubElement(rc, "joint", name=name)
    ET.SubElement(jj, "command_interface", name="position")
    si = ET.SubElement(jj, "state_interface", name="position")
    ET.SubElement(si, "param", name="initial_value").text = "0.0"

ET.indent(tree)
tree.write(DST, encoding="utf-8", xml_declaration=True)
print("wrote", DST)