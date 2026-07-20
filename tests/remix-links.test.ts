import { describe, expect, it } from "vitest";
import { getAccountRemixPath } from "@/lib/remix-links";

describe("account remix links", () => {
  it("stays stable when an account creates a new session", () => {
    const accountId = "account-123";
    const firstSessionLink = getAccountRemixPath(accountId);
    const secondSessionLink = getAccountRemixPath(accountId);

    expect(firstSessionLink).toBe("/r/account/account-123");
    expect(secondSessionLink).toBe(firstSessionLink);
  });

  it("safely encodes account identifiers", () => {
    expect(getAccountRemixPath("account/with spaces")).toBe("/r/account/account%2Fwith%20spaces");
  });
});
