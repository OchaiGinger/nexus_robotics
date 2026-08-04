import { NextRequest, NextResponse } from "next/server";
import { JobType, schemaByType } from "@/lib/schemas/job-payloads";

type ValidateRequestBody = {
  id: string;
  type: JobType;
  payload: unknown;
};

export async function POST(req: NextRequest) {
  let body: ValidateRequestBody;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { valid: false, reason: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  if (!body?.id || !body?.type) {
    return NextResponse.json(
      { valid: false, reason: "Job must include id and type" },
      { status: 400 },
    );
  }

  const schema = schemaByType[body.type];
  if (!schema) {
    return NextResponse.json(
      { valid: false, reason: `Unknown job type: ${body.type}` },
      { status: 400 },
    );
  }

  const result = schema.safeParse(body.payload);

  if (!result.success) {
    return NextResponse.json(
      {
        valid: false,
        reason: result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
        issues: result.error.issues,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ valid: true, job: body });
}