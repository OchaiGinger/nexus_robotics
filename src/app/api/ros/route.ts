import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side ROS API routes
 * Handles secure communication with ROS backend
 */

export async function POST(request: NextRequest) {
  try {
    const { action, topicName, data } = await request.json();

    // Validate request
    if (!action || !topicName) {
      return NextResponse.json(
        { error: 'Missing required fields: action, topicName' },
        { status: 400 }
      );
    }

    // Forward to ROS bridge or process server-side
    const rosBridgeUrl = process.env.ROS_BRIDGE_URL || 'http://localhost:9090';

    switch (action) {
      case 'publish':
        return await publishToTopic(rosBridgeUrl, topicName, data);

      case 'subscribe':
        return await subscribeTopic(rosBridgeUrl, topicName);

      case 'service_call':
        return await callService(rosBridgeUrl, topicName, data);

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function publishToTopic(
  bridgeUrl: string,
  topicName: string,
  data: any
): Promise<NextResponse> {
  try {
    const response = await fetch(`${bridgeUrl}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: topicName,
        msg: data,
      }),
    });

    return NextResponse.json({
      success: true,
      message: 'Published to topic',
      topic: topicName,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to publish' },
      { status: 500 }
    );
  }
}

async function subscribeTopic(
  bridgeUrl: string,
  topicName: string
): Promise<NextResponse> {
  return NextResponse.json({
    success: true,
    message: 'Subscribe request recorded',
    topic: topicName,
  });
}

async function callService(
  bridgeUrl: string,
  serviceName: string,
  request: any
): Promise<NextResponse> {
  try {
    const response = await fetch(`${bridgeUrl}/call_service`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: serviceName,
        args: request,
      }),
    });

    const result = await response.json();
    return NextResponse.json({
      success: true,
      service: serviceName,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Service call failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');

  if (action === 'status') {
    const rosUrl = process.env.ROS_BRIDGE_URL || 'http://localhost:9090';
    try {
      // Check ROS bridge health
      const response = await fetch(rosUrl, { method: 'HEAD' });
      return NextResponse.json({
        rosConnected: response.ok,
        timestamp: new Date().toISOString(),
      });
    } catch {
      return NextResponse.json({
        rosConnected: false,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}