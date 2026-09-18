// src/app/api/actors/human-interpret/route.ts
import { NextRequest, NextResponse } from "next/server";

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

export async function POST(req: NextRequest) {
  const { job, humanInstructions } = await req.json();

  if (!job?.id || !humanInstructions?.text) {
    return NextResponse.json(
      { error: "job.id and humanInstructions.text are required" },
      { status: 400 },
    );
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "NVIDIA_API_KEY is not configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You explain short construction/robotics instructions in clear, friendly, spoken-style language for a human operator who will hear this out loud. Keep it brief — one or two sentences. Do not add extra steps or safety warnings unless asked.",
          },
          { role: "user", content: humanInstructions.text },
        ],
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 300,
        stream: false, // simpler for this server-to-server call — one JSON response, no chunk handling
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`NVIDIA API request failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const explanation: string = data?.choices?.[0]?.message?.content ?? humanInstructions.text;

    return NextResponse.json({
      label: "done",
      jobId: job.id,
      humanResult: {
        text: explanation,
        atomType: humanInstructions.atomType,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}