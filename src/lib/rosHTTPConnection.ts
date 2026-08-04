/**
 * ROS HTTP Connection Service using roslib.js
 * Handles WebSocket connections to ROS bridge for sending/receiving payload data
 * Integrates with nexus_robotics and Nexus_ROS repositories
 */

import ROSLIB from 'roslib';

export interface RosPayload {
  timestamp: string;
  source: 'nexus_robotics' | 'Nexus_ROS';
  topic: string;
  data: Record<string, any>;
}

export interface RosConnectionConfig {
  rosUrl: string;
  rosPort: number;
  secure?: boolean;
}

export interface ActorPayload {
  actorId: string;
  actionType: string;
  parameters: Record<string, any>;
}

class ROSHTTPConnection {
  private ros: ROSLIB.Ros | null = null;
  private topics: Map<string, ROSLIB.Topic<any>> = new Map();
  private subscribers: Map<string, ROSLIB.Topic<any>> = new Map();
  private isConnected: boolean = false;
  private config: RosConnectionConfig;
  private payloadHistory: RosPayload[] = [];
  private connectionRetries: number = 0;
  private maxRetries: number = 5;

  constructor(config: RosConnectionConfig) {
    this.config = {
      rosPort: 9090,
      secure: false,
      ...config,
    };
  }

  /**
   * Initialize ROS connection
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const protocol = this.config.secure ? 'wss' : 'ws';
        const rosUrl = `${protocol}://${this.config.rosUrl}:${this.config.rosPort}`;

        this.ros = new ROSLIB.Ros({
          url: rosUrl,
        });

        this.ros.on('connection', () => {
          this.isConnected = true;
          this.connectionRetries = 0;
          console.log('✓ Connected to ROS Bridge');
          resolve();
        });

        this.ros.on('error', (error: any) => {
          console.error('✗ ROS Connection Error:', error);
          this.handleConnectionError(reject);
        });

        this.ros.on('close', () => {
          this.isConnected = false;
          console.log('✗ ROS Connection Closed');
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle connection errors with retry logic
   */
  private handleConnectionError(reject?: (reason?: any) => void): void {
    if (this.connectionRetries < this.maxRetries) {
      this.connectionRetries++;
      const retryDelay = Math.pow(2, this.connectionRetries) * 1000; // Exponential backoff
      console.log(
        `Retrying connection in ${retryDelay}ms (Attempt ${this.connectionRetries}/${this.maxRetries})`
      );
      setTimeout(() => this.connect(), retryDelay);
    } else if (reject) {
      reject(new Error('Failed to connect to ROS after max retries'));
    }
  }

  /**
   * Send actor payload to ROS topic
   */
  async sendActorPayload(
    topicName: string,
    actorPayload: ActorPayload
  ): Promise<void> {
    if (!this.isConnected || !this.ros) {
      throw new Error('ROS connection not established');
    }

    try {
      let topic = this.topics.get(topicName);

      if (!topic) {
        topic = new ROSLIB.Topic({
          ros: this.ros,
          name: topicName,
          messageType: 'std_msgs/String',
        });
        this.topics.set(topicName, topic);
      }

      const payload: RosPayload = {
        timestamp: new Date().toISOString(),
        source: 'nexus_robotics',
        topic: topicName,
        data: actorPayload,
      };

      const message = new ROSLIB.Message({
        data: JSON.stringify(payload),
      });

      topic.publish(message);
      this.payloadHistory.push(payload);

      console.log(`✓ Sent actor payload to topic: ${topicName}`, payload);
    } catch (error) {
      console.error(`✗ Error sending actor payload: ${error}`);
      throw error;
    }
  }

  /**
   * Subscribe to ROS topic and receive data
   */
  async subscribeToTopic(
    topicName: string,
    messageType: string,
    callback: (message: RosPayload) => void
  ): Promise<void> {
    if (!this.isConnected || !this.ros) {
      throw new Error('ROS connection not established');
    }

    try {
      let subscription = this.subscribers.get(topicName);

      if (!subscription) {
        subscription = new ROSLIB.Topic({
          ros: this.ros,
          name: topicName,
          messageType: messageType,
        });

        subscription.subscribe((message: any) => {
          const parsedPayload: RosPayload = {
            timestamp: new Date().toISOString(),
            source: 'Nexus_ROS',
            topic: topicName,
            data: typeof message.data === 'string' 
              ? JSON.parse(message.data) 
              : message,
          };

          this.payloadHistory.push(parsedPayload);
          callback(parsedPayload);
        });

        this.subscribers.set(topicName, subscription);
      }

      console.log(`✓ Subscribed to topic: ${topicName}`);
    } catch (error) {
      console.error(`✗ Error subscribing to topic: ${error}`);
      throw error;
    }
  }

  /**
   * Compare payloads from nexus_robotics and Nexus_ROS
   */
  comparePayloads(
    nexusPayload: RosPayload,
    rosPayload: RosPayload
  ): {
    isEqual: boolean;
    differences: Record<string, any>;
  } {
    const differences: Record<string, any> = {};
    let isEqual = true;

    // Compare data fields
    const allKeys = new Set([
      ...Object.keys(nexusPayload.data),
      ...Object.keys(rosPayload.data),
    ]);

    allKeys.forEach((key) => {
      const nexusValue = nexusPayload.data[key];
      const rosValue = rosPayload.data[key];

      if (JSON.stringify(nexusValue) !== JSON.stringify(rosValue)) {
        isEqual = false;
        differences[key] = {
          nexus_robotics: nexusValue,
          Nexus_ROS: rosValue,
        };
      }
    });

    return { isEqual, differences };
  }

  /**
   * Get payload comparison history
   */
  getPayloadHistory(
    source?: 'nexus_robotics' | 'Nexus_ROS',
    limit?: number
  ): RosPayload[] {
    let history = this.payloadHistory;

    if (source) {
      history = history.filter((p) => p.source === source);
    }

    if (limit) {
      return history.slice(-limit);
    }

    return history;
  }

  /**
   * Clear payload history
   */
  clearPayloadHistory(): void {
    this.payloadHistory = [];
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): {
    isConnected: boolean;
    url: string;
    topicsCount: number;
    subscribersCount: number;
  } {
    return {
      isConnected: this.isConnected,
      url: `${this.config.secure ? 'wss' : 'ws'}://${this.config.rosUrl}:${this.config.rosPort}`,
      topicsCount: this.topics.size,
      subscribersCount: this.subscribers.size,
    };
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribeFromTopic(topicName: string): void {
    const subscription = this.subscribers.get(topicName);
    if (subscription) {
      subscription.unsubscribe();
      this.subscribers.delete(topicName);
      console.log(`✓ Unsubscribed from topic: ${topicName}`);
    }
  }

  /**
   * Disconnect from ROS
   */
  disconnect(): void {
    if (this.ros) {
      // Unsubscribe from all topics
      this.subscribers.forEach((_, topicName) => {
        this.unsubscribeFromTopic(topicName);
      });

      this.ros.close();
      this.isConnected = false;
      this.ros = null;
      console.log('✓ Disconnected from ROS Bridge');
    }
  }

  /**
   * Call ROS service
   */
  async callService(
    serviceName: string,
    serviceType: string,
    request: Record<string, any>
  ): Promise<any> {
    if (!this.isConnected || !this.ros) {
      throw new Error('ROS connection not established');
    }

    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({
        ros: this.ros!,
        name: serviceName,
        serviceType: serviceType,
      });

      const serviceRequest = new ROSLIB.ServiceRequest(request);

      service.callService(
        serviceRequest,
        (response: any) => {
          console.log(`✓ Service call successful: ${serviceName}`, response);
          resolve(response);
        },
        (error: any) => {
          console.error(`✗ Service call failed: ${serviceName}`, error);
          reject(error);
        }
      );
    });
  }
}

export default ROSHTTPConnection;