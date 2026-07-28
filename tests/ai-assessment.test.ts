import { describe, expect, it } from "vitest";
import { assessSubmission, heuristicAssessment } from "@/lib/ai-assessment";

describe("heuristicAssessment", () => {
  const session = {
    artistName: "Neon Echo",
    trackName: "Skyline Pressure",
    creativeBible: "Kinetic mirrored architecture and chrome fog.",
    allowedMotifs: "laser lattice, pulse halos, skyline fragments",
    bannedTerms: "celebrity, gore, nudity",
    colorPalette: "teal, ember",
    motionRules: "steady drift",
    basePrompt: "Abstract chrome tunnel with elegant motion."
  };

  it("approves a compatible venue-safe prompt", () => {
    const result = heuristicAssessment({
      submissionText: "Turn the skyline fragments into ember halos with slower breathing light",
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.score).toBeGreaterThan(50);
    expect(result.winningPrompt).toContain("Neon Echo");
  });

  it("rejects blocked content", () => {
    const result = heuristicAssessment({
      submissionText: "Add gore and a celebrity face to the tunnel",
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("rejected");
    expect(result.flags).toContain("blocked-term");
  });

  it("keeps motifs open-ended when the creation toggle is off", () => {
    const result = heuristicAssessment({
      submissionText: "Fill the tunnel with floating paper lanterns",
      session: {
        ...session,
        allowedMotifs: ""
      },
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toContain("Motifs are open-ended");
    expect(result.winningPrompt).not.toContain("Preferred motifs:");
  });
});

describe("assessSubmission in Raw Prompt Mode", () => {
  const session = {
    artistName: "Neon Echo",
    trackName: "Skyline Pressure",
    creativeBible: "Always render mirrored architecture.",
    allowedMotifs: "laser lattice",
    bannedTerms: "celebrity",
    colorPalette: "teal, ember",
    motionRules: "steady drift",
    basePrompt: "Abstract chrome tunnel with elegant motion.",
    venueSafeMode: true,
    artistControlEnabled: false
  };

  it("returns a safe crowd prompt exactly as written without artist-direction rewriting", async () => {
    const prompt = "Replace everything with hand-painted paper planets and snap zooms";
    const result = await assessSubmission({
      submissionText: prompt,
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toBe(prompt);
    expect(result.winningPrompt).not.toContain(session.artistName);
    expect(result.approvalReason).toContain("exactly as written");
  });

  it("ignores the artist banned-term list when artist control is off", async () => {
    const prompt = "A celebrity-shaped constellation made from paper stars";
    const result = await assessSubmission({
      submissionText: prompt,
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toBe(prompt);
  });

  it("still enforces the deterministic hard-safety filter when venue-safe mode is on", async () => {
    const prompt = "Fill the tunnel with gore and paper stars";
    const result = await assessSubmission({
      submissionText: prompt,
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("rejected");
    expect(result.flags).toContain("blocked-term");
    expect(result.winningPrompt).toBe(prompt);
  });

  it("passes prompts through when both artist control and venue-safe mode are off", async () => {
    const prompt = "Fill the tunnel with gore and paper stars";
    const result = await assessSubmission({
      submissionText: prompt,
      session: {
        ...session,
        venueSafeMode: false
      },
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toBe(prompt);
  });
});
