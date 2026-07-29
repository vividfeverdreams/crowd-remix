import { describe, expect, it } from "vitest";
import {
  pickRandomChoiceResponses,
  pickRandomPublicRemixPromptTemplate,
  publicRemixPromptTemplates,
  resolvePublicRemixPromptSelection
} from "@/lib/public-remix-prompts";

describe("public remix prompt catalog", () => {
  it("contains exactly 15 choice templates and 15 image templates", () => {
    const choiceTemplates = publicRemixPromptTemplates.filter(
      (template) => template.kind === "choice"
    );
    const imageTemplates = publicRemixPromptTemplates.filter(
      (template) => template.kind === "image"
    );

    expect(publicRemixPromptTemplates).toHaveLength(30);
    expect(choiceTemplates).toHaveLength(15);
    expect(imageTemplates).toHaveLength(15);
    expect(new Set(publicRemixPromptTemplates.map((template) => template.id)).size).toBe(
      30
    );
  });

  it("gives every choice template exactly 50 unique tied responses", () => {
    const allResponseIds = new Set<string>();

    for (const template of publicRemixPromptTemplates) {
      if (template.kind !== "choice") {
        continue;
      }

      const normalizedLabels = template.responses.map((response) =>
        response.label.trim().toLocaleLowerCase()
      );

      expect(template.responses).toHaveLength(50);
      expect(new Set(normalizedLabels).size).toBe(50);

      for (const response of template.responses) {
        expect(allResponseIds.has(response.id)).toBe(false);
        allResponseIds.add(response.id);

        const resolved = resolvePublicRemixPromptSelection(
          template.id,
          response.id
        );

        expect(resolved.kind).toBe("choice");
        expect(resolved.response?.id).toBe(response.id);
        expect(resolved.prompt).toBe(
          `${template.beforeBlank}${response.label}${template.afterBlank}`
        );
        expect(resolved.prompt.length).toBeLessThanOrEqual(600);
      }
    }

    expect(allResponseIds.size).toBe(750);
  });

  it("resolves image statements without accepting a choice response", () => {
    const imageTemplate = publicRemixPromptTemplates.find(
      (template) => template.kind === "image"
    );

    expect(imageTemplate?.kind).toBe("image");

    if (!imageTemplate || imageTemplate.kind !== "image") {
      throw new Error("Expected an image template.");
    }

    expect(
      resolvePublicRemixPromptSelection(imageTemplate.id)
    ).toMatchObject({
      kind: "image",
      prompt: imageTemplate.statement,
      response: null
    });
    expect(() =>
      resolvePublicRemixPromptSelection(
        imageTemplate.id,
        "choice-style-1-1"
      )
    ).toThrow("do not accept");
  });

  it("rejects unknown templates and responses from a different statement", () => {
    const choiceTemplates = publicRemixPromptTemplates.filter(
      (template) => template.kind === "choice"
    );
    const first = choiceTemplates[0];
    const second = choiceTemplates[1];

    expect(first?.kind).toBe("choice");
    expect(second?.kind).toBe("choice");

    if (
      !first ||
      first.kind !== "choice" ||
      !second ||
      second.kind !== "choice"
    ) {
      throw new Error("Expected two choice templates.");
    }

    expect(() =>
      resolvePublicRemixPromptSelection("not-a-template", first.responses[0]?.id)
    ).toThrow("available remix statements");
    expect(() =>
      resolvePublicRemixPromptSelection(first.id, second.responses[0]?.id)
    ).toThrow("four remix answers");
  });

  it("samples four distinct answers and never returns the same four-answer set", () => {
    const template = publicRemixPromptTemplates.find(
      (candidate) => candidate.kind === "choice"
    );

    if (!template || template.kind !== "choice") {
      throw new Error("Expected a choice template.");
    }

    const first = pickRandomChoiceResponses(template, [], () => 0);
    const second = pickRandomChoiceResponses(
      template,
      first.map((response) => response.id),
      () => 0
    );

    expect(first).toHaveLength(4);
    expect(new Set(first.map((response) => response.id)).size).toBe(4);
    expect(second).toHaveLength(4);
    expect(new Set(second.map((response) => response.id)).size).toBe(4);
    expect(new Set(second.map((response) => response.id))).not.toEqual(
      new Set(first.map((response) => response.id))
    );
  });

  it("always changes the statement when shuffling from an active one", () => {
    const current = publicRemixPromptTemplates[0];

    if (!current) {
      throw new Error("Expected a prompt template.");
    }

    const next = pickRandomPublicRemixPromptTemplate(current.id, () => 0);

    expect(next).not.toBeNull();
    expect(next?.id).not.toBe(current.id);
  });
});
