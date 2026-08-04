'use client';

import { useEffect, useState } from 'react';
import { useROSConnection } from '@/lib/useROSConnection';
import { RosPayload, ActorPayload } from '@/lib/rosHTTPConnection';

export function RosConnectionExample() {
  const { isConnected, error, sendPayload, subscribe, getHistory, comparePayloads, getStatus } =
    useROSConnection({
      rosUrl: process.env.NEXT_PUBLIC_ROS_URL || 'localhost',
      rosPort: parseInt(process.env.NEXT_PUBLIC_ROS_PORT || '9090'),
      secure: process.env.NEXT_PUBLIC_ROS_SECURE === 'true',
    });

  const [receivedData, setReceivedData] = useState<RosPayload | null>(null);
  const [history, setHistory] = useState<RosPayload[]>([]);
  const [statusInfo, setStatusInfo] = useState<any>(null);

  useEffect(() => {
    if (isConnected) {
      // Subscribe to incoming data
      subscribe(
        '/nexus/status',
        'std_msgs/String',
        (message) => {
          setReceivedData(message);
          console.log('Received message:', message);
        }
      );

      // Update history every second
      const historyInterval = setInterval(() => {
        setHistory(getHistory(undefined, 10));
        setStatusInfo(getStatus());
      }, 1000);

      return () => clearInterval(historyInterval);
    }
  }, [isConnected, subscribe, getHistory, getStatus]);

  const handleSendActorCommand = async () => {
    try {
      const actorPayload: ActorPayload = {
        actorId: 'actor_001',
        actionType: 'move',
        parameters: {
          x: 1.5,
          y: 2.3,
          z: 0.5,
          speed: 0.5,
        },
      };

      await sendPayload('/nexus/actor/command', actorPayload);
    } catch (err) {
      console.error('Failed to send command:', err);
    }
  };

  const handleComparePayloads = () => {
    if (history.length >= 2) {
      const result = comparePayloads(history[0], history[1]);
      console.log('Comparison result:', result);
    }
  };

  return (
    <div className="p-6 bg-gray-50 rounded-lg">
      <div className="mb-4">
        <h2 className="text-2xl font-bold mb-2">ROS Connection Status</h2>
        <div
          className={`p-3 rounded ${isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
        >
          {isConnected ? '✓ Connected to ROS' : '✗ Disconnected'}
        </div>
        {error && <div className="mt-2 p-3 bg-yellow-100 text-yellow-700 rounded">{error}</div>}
      </div>

      {statusInfo && (
        <div className="mb-4 p-4 bg-white rounded border">
          <h3 className="font-semibold mb-2">Connection Info</h3>
          <pre className="text-sm bg-gray-100 p-2 rounded">{JSON.stringify(statusInfo, null, 2)}</pre>
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <button
          onClick={handleSendActorCommand}
          disabled={!isConnected}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          Send Actor Command
        </button>
        <button
          onClick={handleComparePayloads}
          disabled={history.length < 2}
          className="px-4 py-2 bg-purple-500 text-white rounded disabled:bg-gray-300"
        >
          Compare Payloads
        </button>
      </div>

      {receivedData && (
        <div className="mb-4 p-4 bg-white rounded border">
          <h3 className="font-semibold mb-2">Last Received Message</h3>
          <pre className="text-sm bg-gray-100 p-2 rounded overflow-auto">
            {JSON.stringify(receivedData, null, 2)}
          </pre>
        </div>
      )}

      <div className="p-4 bg-white rounded border">
        <h3 className="font-semibold mb-2">Payload History ({history.length})</h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {history.map((payload, idx) => (
            <div key={idx} className="p-2 bg-gray-100 rounded text-sm">
              <div className="font-semibold">{payload.source} - {payload.topic}</div>
              <div className="text-gray-600">{payload.timestamp}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}