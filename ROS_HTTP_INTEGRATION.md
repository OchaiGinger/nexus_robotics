# ROS HTTP Connection Integration Guide

This guide explains how to use the ROS HTTP connection service to bridge `nexus_robotics` (Next.js frontend) with `Nexus_ROS` (ROS backend) using roslib.js.

## 📋 Overview

The ROS HTTP Connection service provides:
- WebSocket-based communication with ROS Bridge
- Auto-reconnection with exponential backoff
- Type-safe payload handling
- Payload comparison between systems
- Message history tracking
- React hooks for easy integration

## 🚀 Setup

### 1. Install Dependencies
```bash
npm install roslib
```

### 2. Configure Environment

Create a `.env.local` file in your `nexus_robotics` directory:

```bash
# ROS Bridge Configuration
NEXT_PUBLIC_ROS_URL=your-robot-ip-or-localhost
NEXT_PUBLIC_ROS_PORT=9090
NEXT_PUBLIC_ROS_SECURE=false

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/nexus_robotics

# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3000

# Server-side ROS Bridge URL
ROS_BRIDGE_URL=http://localhost:9090
```

### 3. Start ROS Bridge

On your ROS system, launch the WebSocket bridge:

```bash
# Install rosbridge if you haven't already
sudo apt-get install ros-<distro>-rosbridge-server

# Launch the bridge
roslaunch rosbridge_server rosbridge_websocket.launch port:=9090
```

For ROS 2:
```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=9090
```

## 💻 Usage Examples

### Basic Connection with Hook

```typescript
import { useROSConnection } from '@/lib/useROSConnection';
import { ActorPayload } from '@/lib/rosHTTPConnection';

function MyComponent() {
  const { isConnected, error, sendPayload, subscribe } = useROSConnection({
    rosUrl: process.env.NEXT_PUBLIC_ROS_URL || 'localhost',
    rosPort: parseInt(process.env.NEXT_PUBLIC_ROS_PORT || '9090'),
  });

  useEffect(() => {
    if (isConnected) {
      // Subscribe to sensor data
      subscribe(
        '/robot/sensor/data',
        'std_msgs/String',
        (message) => {
          console.log('Received sensor data:', message.data);
        }
      );
    }
  }, [isConnected]);

  const handleMoveRobot = async () => {
    const command: ActorPayload = {
      actorId: 'robot_arm_01',
      actionType: 'move_to_position',
      parameters: {
        x: 0.5,
        y: 0.3,
        z: 0.1,
        speed: 0.2,
      },
    };

    await sendPayload('/robot/actor/command', command);
  };

  return (
    <div>
      <p>Status: {isConnected ? 'Connected ✓' : 'Disconnected ✗'}</p>
      {error && <p>Error: {error}</p>}
      <button onClick={handleMoveRobot} disabled={!isConnected}>
        Move Robot
      </button>
    </div>
  );
}
```

### Sending Actor Payloads

```typescript
const { sendPayload } = useROSConnection(config);

// Example: Gripper command
const gripperCommand: ActorPayload = {
  actorId: 'gripper_01',
  actionType: 'grip',
  parameters: {
    force: 50, // N
    position: 0.05, // m
  },
};

await sendPayload('/robot/gripper/command', gripperCommand);
```

### Subscribing to Sensors

```typescript
const { subscribe, unsubscribe } = useROSConnection(config);

useEffect(() => {
  subscribe(
    '/robot/imu',
    'sensor_msgs/Imu',
    (message) => {
      const imuData = message.data;
      console.log('Orientation:', imuData.orientation);
      console.log('Angular velocity:', imuData.angular_velocity);
    }
  );

  return () => {
    unsubscribe('/robot/imu');
  };
}, []);
```

### Comparing Payloads

```typescript
const { getHistory, comparePayloads } = useROSConnection(config);

const handleCompare = () => {
  const history = getHistory(undefined, 2); // Get last 2 messages

  if (history.length === 2) {
    const nexusPayload = history.find(p => p.source === 'nexus_robotics');
    const rosPayload = history.find(p => p.source === 'Nexus_ROS');

    if (nexusPayload && rosPayload) {
      const { isEqual, differences } = comparePayloads(nexusPayload, rosPayload);

      if (!isEqual) {
        console.log('Payload differences detected:');
        console.log(differences);
      }
    }
  }
};
```

### Monitoring Connection Status

```typescript
const { getStatus } = useROSConnection(config);

const status = getStatus();
console.log('Connected:', status.isConnected);
console.log('Active topics:', status.topicsCount);
console.log('Subscriptions:', status.subscribersCount);
```

## 📁 Project Structure

```
src/
├── lib/
│   ├── rosHTTPConnection.ts      # Core ROS connection service
│   └── useROSConnection.ts       # React hook for components
├── components/
│   └── RosConnectionExample.tsx  # Example component
└── app/
    └── api/
        └── ros/
            └── route.ts          # Server-side ROS API
```

## 🔌 Core Classes and Interfaces

### ROSHTTPConnection

Main service class for ROS communication.

```typescript
class ROSHTTPConnection {
  // Connection management
  async connect(): Promise<void>
  disconnect(): void
  getConnectionStatus(): ConnectionStatus

  // Pub/Sub
  async sendActorPayload(topic: string, payload: ActorPayload): Promise<void>
  async subscribeToTopic(topic: string, type: string, callback: Function): Promise<void>
  unsubscribeFromTopic(topicName: string): void

  // Service calls
  async callService(name: string, type: string, request: any): Promise<any>

  // Payload utilities
  comparePayloads(p1: RosPayload, p2: RosPayload): ComparisonResult
  getPayloadHistory(source?: string, limit?: number): RosPayload[]
  clearPayloadHistory(): void
}
```

### useROSConnection Hook

React hook for component integration.

```typescript
const {
  isConnected,      // boolean
  error,            // string | null
  sendPayload,      // async function
  subscribe,        // async function
  unsubscribe,      // function
  comparePayloads,  // function
  getHistory,       // function
  clearHistory,     // function
  getStatus,        // function
} = useROSConnection(config);
```

## 🛠 Advanced Usage

### Service Calls

```typescript
const { callService } = useROSConnection(config);

const response = await callService(
  '/robot/calculate_ik',
  'robot_msgs/CalculateIK',
  { position: { x: 0.5, y: 0.3, z: 0.1 } }
);
```

### Error Handling

```typescript
const { error, isConnected } = useROSConnection(config);

if (!isConnected) {
  if (error) {
    console.error('Connection error:', error);
    // Retry logic is automatic with exponential backoff
  }
}
```

### Batch Payload Comparison

```typescript
const compareHistories = () => {
  const nexusHistory = getHistory('nexus_robotics', 50);
  const rosHistory = getHistory('Nexus_ROS', 50);

  const mismatches = [];

  for (let i = 0; i < Math.min(nexusHistory.length, rosHistory.length); i++) {
    const { isEqual, differences } = comparePayloads(
      nexusHistory[i],
      rosHistory[i]
    );

    if (!isEqual) {
      mismatches.push({
        index: i,
        timestamp: nexusHistory[i].timestamp,
        differences,
      });
    }
  }

  return mismatches;
};
```

## 🐛 Troubleshooting

### Connection Fails

1. **Check ROS Bridge is Running**
   ```bash
   # Check if rosbridge is listening
   netstat -an | grep 9090
   ```

2. **Verify Environment Variables**
   ```bash
   echo $NEXT_PUBLIC_ROS_URL
   echo $NEXT_PUBLIC_ROS_PORT
   ```

3. **Check Firewall**
   ```bash
   # Allow WebSocket port
   sudo ufw allow 9090/tcp
   ```

### Messages Not Received

1. **Verify Topic Names**
   - Use `rostopic list` to see available topics
   - Check spelling and case sensitivity

2. **Check Message Types**
   - Use `rostopic type <topic>` to verify message type
   - Ensure correct type string in subscribe call

3. **Monitor Traffic**
   ```bash
   rostopic echo /your/topic
   ```

### Memory Leaks

1. **Always Unsubscribe**
   ```typescript
   useEffect(() => {
     subscribe(/* ... */);
     return () => unsubscribe(topicName); // Cleanup
   }, []);
   ```

2. **Clear History Periodically**
   ```typescript
   useEffect(() => {
    const cleanup = setInterval(() => clearHistory(), 60000); // Every minute
    return () => clearInterval(cleanup);
  }, []);
   ```

## 📊 Monitoring and Logging

The service logs important events to the console:

```
✓ Connected to ROS Bridge
✓ Sent actor payload to topic: /nexus/actor/command
✓ Subscribed to topic: /robot/sensor/data
✗ ROS Connection Error: WebSocket connection failed
✓ Service call successful: /robot/calculate_ik
```

For debugging, check the browser console and server logs:

```typescript
// Enable verbose logging
const status = getStatus();
console.table(status);
```

## 🔐 Security Considerations

1. **Use Secure WebSocket (wss://)** in production
   ```bash
   NEXT_PUBLIC_ROS_SECURE=true
   ```

2. **Validate Payloads** before sending
   ```typescript
   const validatePayload = (payload: ActorPayload) => {
     if (!payload.actorId || !payload.actionType) {
       throw new Error('Invalid payload');
     }
   };
   ```

3. **Implement Rate Limiting** for commands
   ```typescript
   const [lastCommand, setLastCommand] = useState(0);
   const MIN_INTERVAL = 100; // ms

   const sendSafePayload = async (topic, payload) => {
     const now = Date.now();
     if (now - lastCommand < MIN_INTERVAL) {
       throw new Error('Commands too frequent');
     }
     setLastCommand(now);
     await sendPayload(topic, payload);
   };
   ```

## 📚 Related Resources

- [roslib.js Documentation](http://wiki.ros.org/roslib.js)
- [rosbridge_suite](http://wiki.ros.org/rosbridge_suite)
- [ROS Message Types](http://wiki.ros.org/std_msgs)
- [Next.js Documentation](https://nextjs.org/docs)

## 📝 License

Same as nexus_robotics project
