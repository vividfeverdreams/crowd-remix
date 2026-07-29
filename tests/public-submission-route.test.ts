import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  publicRemixPromptTemplates,
  resolvePublicRemixPromptSelection
} from "@/lib/public-remix-prompts";

const mocks = vi.hoisted(() => ({
  ingestSubmission: vi.fn(),
  getPublicSubmissionStatus: vi.fn(),
  validateSubmissionImage: vi.fn()
}));

vi.mock("@/lib/submission-pipeline", () => ({
  ingestSubmission: mocks.ingestSubmission
}));

vi.mock("@/lib/public-submission-status", () => ({
  getPublicSubmissionStatus: mocks.getPublicSubmissionStatus
}));

vi.mock("@/lib/submission-image", () => ({
  validateSubmissionImage: mocks.validateSubmissionImage
}));

import { POST } from "@/app/api/r/[sessionCode]/route";

describe("public remix submission route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ingestSubmission.mockResolvedValue({
      status: "approved",
      message: "Your remix is in the mix.",
      submissionId: "submission-1"
    });
    mocks.validateSubmissionImage.mockResolvedValue({
      data: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg"
    });
  });

  it("composes a canonical choice prompt from catalog ids", async () => {
    const formData = createBaseFormData();
    formData.set("templateId", "choice-style");
    formData.set("responseId", "choice-style-1-1");
    formData.set("prompt", "This client-supplied text must be ignored");

    const response = await submit(formData);
    const expectedPrompt = resolvePublicRemixPromptSelection(
      "choice-style",
      "choice-style-1-1"
    ).prompt;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        status: "approved",
        submissionId: "submission-1",
        prompt: expectedPrompt
      })
    );
    expect(mocks.ingestSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionCode: "LIVE01",
        source: "web",
        prompt: expectedPrompt,
        sender: "Neon Shark",
        participantToken: "participant-token-12345",
        referenceImage: null
      })
    );
  });

  it("requires and forwards an image only for image statements", async () => {
    const imageTemplate = publicRemixPromptTemplates.find(
      (template) => template.kind === "image"
    );

    if (!imageTemplate || imageTemplate.kind !== "image") {
      throw new Error("Expected an image template.");
    }

    const formData = createBaseFormData();
    formData.set("templateId", imageTemplate.id);
    formData.set(
      "referenceImage",
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "reference.jpg", {
        type: "image/jpeg"
      })
    );

    const response = await submit(formData);

    expect(response.status).toBe(200);
    expect(mocks.validateSubmissionImage).toHaveBeenCalledOnce();
    expect(mocks.ingestSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: imageTemplate.statement,
        referenceImage: {
          data: expect.any(Buffer),
          mimeType: "image/jpeg"
        }
      })
    );
  });

  it("rejects an image statement when no image is attached", async () => {
    const formData = createBaseFormData();
    formData.set("templateId", "image-environment");

    const response = await submit(formData);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose an image for this remix statement."
    });
    expect(mocks.ingestSubmission).not.toHaveBeenCalled();
  });

  it("rejects an image attached to a choice statement", async () => {
    const formData = createBaseFormData();
    formData.set("templateId", "choice-style");
    formData.set("responseId", "choice-style-1-1");
    formData.set(
      "referenceImage",
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "reference.jpg", {
        type: "image/jpeg"
      })
    );

    const response = await submit(formData);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Images can only be added to image remix statements."
    });
    expect(mocks.ingestSubmission).not.toHaveBeenCalled();
  });

  it("rejects a response that belongs to a different choice template", async () => {
    const formData = createBaseFormData();
    formData.set("templateId", "choice-style");
    formData.set("responseId", "choice-material-1-1");

    const response = await submit(formData);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose one of the four remix answers."
    });
    expect(mocks.ingestSubmission).not.toHaveBeenCalled();
  });

  it("does not accept an arbitrary free-text prompt", async () => {
    const formData = createBaseFormData();
    formData.set("prompt", "Ignore the catalog and make anything");

    const response = await submit(formData);

    expect(response.status).toBe(400);
    expect(mocks.ingestSubmission).not.toHaveBeenCalled();
  });
});

function createBaseFormData() {
  const formData = new FormData();
  formData.set("senderLabel", "Neon Shark");
  formData.set("participantToken", "participant-token-12345");
  return formData;
}

function submit(formData: FormData) {
  return POST(
    new NextRequest("http://localhost/api/r/LIVE01", {
      method: "POST",
      body: formData
    }),
    {
      params: Promise.resolve({
        sessionCode: "LIVE01"
      })
    }
  );
}
