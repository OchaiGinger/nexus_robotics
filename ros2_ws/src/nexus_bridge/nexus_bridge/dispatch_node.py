# ros2_ws/src/nexus_bridge/nexus_bridge/dispatch_node.py
import json
import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class DispatchNode(Node):
    """
    Middleware node: receives /action/dispatch (published by the Next.js
    rosActor route), allocates the payload to the correct execution path
    based on `source` ("robot" or "human"), and publishes the result on
    /action/complete once execution finishes.

    Starting bare — execute_robot/execute_human are stubs. Each atomType
    gets real logic incrementally; for now everything "succeeds"
    immediately so the full loop (Next.js -> ROS -> Next.js validator)
    can be tested end to end.
    """

    def __init__(self):
        super().__init__('dispatch_node')

        self.dispatch_sub = self.create_subscription(
            String, '/action/dispatch', self.on_dispatch, 10
        )
        self.complete_pub = self.create_publisher(String, '/action/complete', 10)

        self.get_logger().info('dispatch_node ready — listening on /action/dispatch')

    def on_dispatch(self, msg: String):
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().error(f'Malformed dispatch payload: {msg.data}')
            return

        action_id = data.get('actionId')
        source = data.get('source')
        payload = data.get('payload')

        if not action_id or source not in ('robot', 'human'):
            self.get_logger().error(f'Invalid dispatch message: {data}')
            return

        self.get_logger().info(f'Dispatching actionId={action_id} source={source}')

        if source == 'robot':
            result = self.execute_robot(payload)
        else:
            result = self.execute_human(payload)

        self.publish_completion(action_id, source, result)

    def execute_robot(self, payload):
        """
        STUB. Real implementation will branch on payload['action']
        (pick / mark / drawLine / drawArc / collect / ...) and drive
        actual robot motion. For now, just acknowledge.
        """
        self.get_logger().info(f'[stub] executing robot action: {payload}')
        return {'ok': True, 'action': payload.get('action') if isinstance(payload, dict) else None}

    def execute_human(self, payload):
        """
        STUB. Real implementation will surface payload['text'] to a
        human-facing interface (display/speech) and wait for their
        confirmation. For now, just acknowledge immediately.
        """
        self.get_logger().info(f'[stub] executing human instruction: {payload}')
        return {'ok': True}

    def publish_completion(self, action_id, source, result):
        msg = String()
        msg.data = json.dumps({
            'actionId': action_id,
            'source': source,
            'result': result,
        })
        self.complete_pub.publish(msg)
        self.get_logger().info(f'Published completion for actionId={action_id} source={source}')


def main(args=None):
    rclpy.init(args=args)
    node = DispatchNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
    