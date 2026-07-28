export const maximumSubmissionImageBytes = 4 * 1024 * 1024;

export const supportedSubmissionImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

export type SupportedSubmissionImageType =
  (typeof supportedSubmissionImageTypes)[number];

export type ValidatedSubmissionImage = {
  data: Buffer;
  mimeType: SupportedSubmissionImageType;
};

export async function validateSubmissionImage(
  file: File
): Promise<ValidatedSubmissionImage> {
  if (file.size <= 0) {
    throw new Error("The attached photo is empty.");
  }

  if (file.size > maximumSubmissionImageBytes) {
    throw new Error("Keep the attached photo under 4 MB.");
  }

  const data = Buffer.from(await file.arrayBuffer());
  const detectedMimeType = detectSubmissionImageType(data);

  if (!detectedMimeType) {
    throw new Error("Attach a JPEG, PNG, or WebP photo.");
  }

  if (
    !supportedSubmissionImageTypes.includes(
      file.type as SupportedSubmissionImageType
    ) ||
    file.type !== detectedMimeType
  ) {
    throw new Error("The attached photo type does not match its file contents.");
  }

  return {
    data,
    mimeType: detectedMimeType
  };
}

function detectSubmissionImageType(
  data: Buffer
): SupportedSubmissionImageType | null {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }

  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}
