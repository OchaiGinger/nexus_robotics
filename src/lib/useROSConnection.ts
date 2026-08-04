'use client';

import { useEffect, useRef, useState } from 'react';
import ROSHTTPConnection, {
  RosPayload,
  RosConnectionConfig,
  ActorPayload,
} from './rosHTTPConnection';

export interface UseROSConnectionReturn {
  isConnected: boolean;
  error: string | null;
  sendPayload: (topicName: string, payload: ActorPayload) => Promise<void>;
  subscribe: (
    topicName: string,
    messageType: string,
    callback: (message: RosPayload) => void
  ) => Promise<void>;
  unsubscribe: (topicName: string) => void;
  comparePayloads: (
    nexus: RosPayload,
    ros: RosPayload
  ) => {
    isEqual: boolean;
    differences: Record<string, any>;
  };
  getHistory: (
    source?: 'nexus_robotics' | 'Nexus_ROS',
    limit?: number
  ) => RosPayload[];
  clearHistory: () => void;
  getStatus: () => any;
}

export function useROSConnection(
  config: RosConnectionConfig
): UseROSConnectionReturn {
  const connectionRef = useRef<ROSHTTPConnection | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeConnection = async () => {
      try {
        if (!connectionRef.current) {
          connectionRef.current = new ROSHTTPConnection(config);
        }

        await connectionRef.current.connect();
        setIsConnected(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
        setIsConnected(false);
      }
    };

    initializeConnection();

    return () => {
      if (connectionRef.current) {
        connectionRef.current.disconnect();
      }
    };
  }, [config]);

  const sendPayload = async (
    topicName: string,
    payload: ActorPayload
  ): Promise<void> => {
    if (!connectionRef.current) {
      throw new Error('ROS connection not initialized');
    }
    await connectionRef.current.sendActorPayload(topicName, payload);
  };

  const subscribe = async (
    topicName: string,
    messageType: string,
    callback: (message: RosPayload) => void
  ): Promise<void> => {
    if (!connectionRef.current) {
      throw new Error('ROS connection not initialized');
    }
    await connectionRef.current.subscribeToTopic(topicName, messageType, callback);
  };

  const unsubscribe = (topicName: string) => {
    if (connectionRef.current) {
      connectionRef.current.unsubscribeFromTopic(topicName);
    }
  };

  const comparePayloads = (
    nexus: RosPayload,
    ros: RosPayload
  ) => {
    if (!connectionRef.current) {
      throw new Error('ROS connection not initialized');
    }
    return connectionRef.current.comparePayloads(nexus, ros);
  };

  const getHistory = (
    source?: 'nexus_robotics' | 'Nexus_ROS',
    limit?: number
  ) => {
    if (!connectionRef.current) {
      return [];
    }
    return connectionRef.current.getPayloadHistory(source, limit);
  };

  const clearHistory = () => {
    if (connectionRef.current) {
      connectionRef.current.clearPayloadHistory();
    }
  };

  const getStatus = () => {
    if (!connectionRef.current) {
      return null;
    }
    return connectionRef.current.getConnectionStatus();
  };

  return {
    isConnected,
    error,
    sendPayload,
    subscribe,
    unsubscribe,
    comparePayloads,
    getHistory,
    clearHistory,
    getStatus,
  };
}