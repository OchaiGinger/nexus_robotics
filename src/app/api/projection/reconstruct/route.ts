import { NextRequest, NextResponse } from "next/server";
import { projectionAgentPayloadSchema } from "@/lib/schemas/job-payloads";

type ProjectionRequest = {
  jobId: string;
  payload: unknown;
};

type LocalArtifact = {
  kind: "local-preview";
  vertices: number[][];
  faces: number[][];
};

type ProviderArtifact = {
  kind: "provider";
  modelUrl?: string;
  renderUrl?: string;
  provider: string;
};

type ProjectionArtifact = LocalArtifact | ProviderArtifact;

type ProjectionArtifactSummary = {
  kind: "local-preview" | "provider";
  modelUrl?: string;
  renderUrl?: string;
  provider?: string;
};

type ProjectionStep = {
  t: string;
  jobId: string;
  source: string;
  view?: string;
  format?: string;
  angles?: number[];
  artifact?: ProjectionArtifactSummary;
};

type ProjectionResponse = {
  jobId: string;
  artifact: ProjectionArtifact;
  steps: ProjectionStep[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findString(value: unknown, keys: string[]): string | undefined {
  if (typeof value === "string" && keys.includes("value")) {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  for (const candidate of Object.values(value)) {
    const found = findString(candidate, keys);
    if (found) return found;
  }

  return undefined;
}

function localPreview(): LocalArtifact {
  return {
    kind: "local-preview",
    vertices: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    faces: [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [1, 2, 6, 5],
      [3, 0, 4, 7],
    ],
  };
}

async function callTrellis(payload: {
  imageDataUrl: string;
  imageMimeType?: string;
  label?: string;
}): Promise<ProviderArtifact | null> {
  const endpoint = process.env.TRELLIS_API_URL;
  if (!endpoint) return null;

  const requestFormat = process.env.TRELLIS_REQUEST_FORMAT ?? "generic";
  const body =
    requestFormat === "fal"
      ? {
          image_url: payload.imageDataUrl,
          prompt: `Reconstruct ${payload.label || "the uploaded object"} as a textured 3D model.`,
        }
      : {
          image: payload.imageDataUrl,
          imageMimeType: payload.imageMimeType,
          prompt: `Reconstruct ${payload.label || "the uploaded object"} as a textured 3D model.`,
          model: process.env.TRELLIS_MODEL ?? undefined,
        };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.TRELLIS_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Trellis request failed (${response.status}): ${detail}`);
  }

  const data = (await response.json().catch(() => null)) as unknown;
  const modelUrl =
    findString(data, ["model_url", "modelUrl", "output_url", "outputUrl"]) ??
    findString(data, ["url", "asset_url", "assetUrl"]);
  const renderUrl =
    findString(data, ["render_url", "renderUrl", "preview_url", "previewUrl"]) ??
    findString(data, ["image_url", "imageUrl"]);

  return {
    kind: "provider",
    modelUrl,
    renderUrl,
    provider: requestFormat,
  };
}

export async function POST(req: NextRequest) {
  let request: ProjectionRequest;
  try {
    request = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  if (!request.jobId || typeof request.jobId !== "string") {
    return NextResponse.json(
      { error: "jobId is required" },
      { status: 400 },
    );
  }

  const result = projectionAgentPayloadSchema.safeParse(request.payload);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "Invalid projection payload",
        issues: result.error.issues,
      },
      { status: 400 },
    );
  }

  if (!result.data.imageDataUrl) {
    return NextResponse.json(
      { error: "An uploaded image is required" },
      { status: 400 },
    );
  }

  try {
    const providerArtifact = await callTrellis(result.data);
    const artifact: ProjectionArtifact = providerArtifact ?? localPreview();
    const artifactSummary = {
      kind: artifact.kind,
      modelUrl: "modelUrl" in artifact ? artifact.modelUrl : undefined,
      renderUrl: "renderUrl" in artifact ? artifact.renderUrl : undefined,
      provider: "provider" in artifact ? artifact.provider : undefined,
    };
    const steps: ProjectionStep[] = [
      {
        t: "reconstruct",
        jobId: request.jobId,
        source: providerArtifact ? "trellis" : "local-preview",
        artifact: artifactSummary,
      },
      {
        t: "render",
        jobId: request.jobId,
        source: providerArtifact ? "trellis" : "local-preview",
        view: "isometric",
        artifact: artifactSummary,
      },
      {
        t: "snapshot",
        jobId: request.jobId,
        source: "viewer",
        format: "png",
      },
      {
        t: "export",
        jobId: request.jobId,
        source: "viewer",
        angles: [0, 45, 90, 180, 270, 315],
      },
    ];

    const response: ProjectionResponse = {
      jobId: request.jobId,
      artifact,
      steps,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 503 },
    );
  }
}
