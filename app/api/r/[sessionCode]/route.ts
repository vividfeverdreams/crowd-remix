import { NextRequest, NextResponse } from "next/server";
import { ingestSubmission } from "@/lib/submission-pipeline";
import { getPublicSubmissionStatus } from "@/lib/public-submission-status";
import { publicSubmissionSchema } from "@/lib/schemas";
import { getClientIp } from "@/lib/request";
import { validateSubmissionImage } from "@/lib/submission-image";
import { resolvePublicRemixPromptSelection } from "@/lib/public-remix-prompts";

type PublicApiRouteProps = {
  params: Promise<{
    sessionCode: string;
  }>;
};

const participantDeviceCookieName = "dream_sequence_participant";

export async function GET(request: Request, { params }: PublicApiRouteProps) {
  const { sessionCode } = await params;
  const { searchParams } = new URL(request.url);
  const submissionId = searchParams.get("submissionId")?.trim() ?? "";

  if (!submissionId) {
    return NextResponse.json(
      {
        error: "Submission id is required."
      },
      {
        status: 400
      }
    );
  }

  const status = await getPublicSubmissionStatus(sessionCode, submissionId);

  if (!status) {
    return NextResponse.json(
      {
        error: "Submission not found."
      },
      {
        status: 404
      }
    );
  }

  return NextResponse.json(status);
}

export async function POST(request: NextRequest, { params }: PublicApiRouteProps) {
  const submissionRequest = await readPublicSubmissionRequest(request).catch(
    (error) => ({
      error:
        error instanceof Error
          ? error.message
          : "Could not read the attached photo."
    })
  );

  if ("error" in submissionRequest) {
    return NextResponse.json(
      {
        error: submissionRequest.error
      },
      {
        status: 400
      }
    );
  }

  const parsed = publicSubmissionSchema.safeParse(submissionRequest?.fields);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          "Choose a remix statement and answer."
      },
      {
        status: 400
      }
    );
  }

  const resolvedPrompt = (() => {
    try {
      return resolvePublicRemixPromptSelection(
        parsed.data.templateId,
        parsed.data.responseId
      );
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Choose a remix statement and answer."
      };
    }
  })();

  if ("error" in resolvedPrompt) {
    return NextResponse.json(
      {
        error: resolvedPrompt.error
      },
      {
        status: 400
      }
    );
  }

  if (resolvedPrompt.kind === "image" && !submissionRequest.referenceImage) {
    return NextResponse.json(
      {
        error: "Choose an image for this remix statement."
      },
      {
        status: 400
      }
    );
  }

  if (resolvedPrompt.kind === "choice" && submissionRequest.referenceImage) {
    return NextResponse.json(
      {
        error: "Images can only be added to image remix statements."
      },
      {
        status: 400
      }
    );
  }

  const { sessionCode } = await params;
  const savedParticipantToken =
    request.cookies.get(participantDeviceCookieName)?.value.trim() ?? "";
  const participantToken =
    savedParticipantToken.length >= 16
      ? savedParticipantToken
      : parsed.data.participantToken;

  try {
    const result = await ingestSubmission({
      sessionCode,
      source: "web",
      prompt: resolvedPrompt.prompt,
      sender: parsed.data.senderLabel,
      participantToken,
      senderFingerprintSeed: getClientIp(request),
      referenceImage: submissionRequest?.referenceImage ?? null
    });

    const response = NextResponse.json(
      {
        ...result,
        prompt: resolvedPrompt.prompt
      },
      {
        status: result.status === "banned" ? 403 : 200
      }
    );

    if (savedParticipantToken.length < 16) {
      response.cookies.set(participantDeviceCookieName, participantToken, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
      });
    }

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not submit the remix."
      },
      {
        status: 400
      }
    );
  }
}

async function readPublicSubmissionRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("multipart/form-data")) {
    return {
      fields: await request.json().catch(() => null),
      referenceImage: null
    };
  }

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    throw new Error("Could not read the remix form.");
  }

  const imageEntry = formData.get("referenceImage");
  const referenceImage =
    imageEntry instanceof File && imageEntry.size > 0
      ? await validateSubmissionImage(imageEntry)
      : null;

  return {
    fields: {
      templateId: String(formData.get("templateId") ?? ""),
      responseId: String(formData.get("responseId") ?? ""),
      senderLabel: String(formData.get("senderLabel") ?? ""),
      participantToken: String(formData.get("participantToken") ?? "")
    },
    referenceImage
  };
}
