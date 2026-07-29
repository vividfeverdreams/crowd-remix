import { describe, expect, it } from "vitest";
import {
  maximumSubmissionImageBytes,
  validateSubmissionImage
} from "@/lib/submission-image";

describe("submission image validation", () => {
  it("accepts a JPEG whose declared type matches its contents", async () => {
    const image = await validateSubmissionImage(
      createTestFile(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
        "image/jpeg"
      )
    );

    expect(image.mimeType).toBe("image/jpeg");
    expect(image.data.subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff])
    );
  });

  it("rejects a declared type that does not match the file signature", async () => {
    await expect(
      validateSubmissionImage(
        createTestFile(
          new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
          "image/png"
        )
      )
    ).rejects.toThrow("does not match");
  });

  it("rejects oversized photos before reading their bytes", async () => {
    const file = {
      size: maximumSubmissionImageBytes + 1,
      type: "image/jpeg",
      arrayBuffer: async () => new ArrayBuffer(0)
    } as File;

    await expect(validateSubmissionImage(file)).rejects.toThrow("under 4 MB");
  });
});

function createTestFile(data: Uint8Array, type: string) {
  return {
    size: data.byteLength,
    type,
    arrayBuffer: async () =>
      data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      )
  } as File;
}
