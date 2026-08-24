export type PublicRemixChoiceResponse = {
  id: string;
  label: string;
};

export type PublicRemixChoiceTemplate = {
  id: string;
  kind: "choice";
  beforeBlank: string;
  afterBlank: string;
  responses: readonly PublicRemixChoiceResponse[];
};

export type PublicRemixImageTemplate = {
  id: string;
  kind: "image";
  statement: string;
};

export type PublicRemixPromptTemplate =
  | PublicRemixChoiceTemplate
  | PublicRemixImageTemplate;

export type ResolvedPublicRemixPrompt = {
  kind: PublicRemixPromptTemplate["kind"];
  prompt: string;
  template: PublicRemixPromptTemplate;
  response: PublicRemixChoiceResponse | null;
};

const responseModifierCount = 5;
const responseRootCount = 10;
const maximumConsecutiveTemplateKindCount = 2;

function createChoiceResponses(
  templateId: string,
  roots: readonly string[],
  modifiers: readonly string[]
): PublicRemixChoiceResponse[] {
  if (
    roots.length !== responseRootCount ||
    modifiers.length !== responseModifierCount
  ) {
    throw new Error(
      `Choice template ${templateId} must define ${responseRootCount} roots and ${responseModifierCount} modifiers.`
    );
  }

  return roots.flatMap((root, rootIndex) =>
    modifiers.map((modifier, modifierIndex) => ({
      id: `${templateId}-${rootIndex + 1}-${modifierIndex + 1}`,
      label: `${root} ${modifier}`.trim()
    }))
  );
}

const choiceTemplates: PublicRemixChoiceTemplate[] = [
  {
    id: "choice-style",
    kind: "choice",
    beforeBlank: "Change the style of the video so that it’s ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-style",
      [
        "dreamlike",
        "hand-painted",
        "retro-futurist",
        "surreal and theatrical",
        "stop-motion-inspired",
        "glossy and cyber-organic",
        "made from paper cutouts",
        "boldly cel-shaded",
        "cosmic and ornate",
        "minimalist and geometric"
      ],
      [
        "with neon accents",
        "with soft film grain",
        "with iridescent light",
        "with bold graphic shadows",
        "with rich tactile textures"
      ]
    )
  },
  {
    id: "choice-material",
    kind: "choice",
    beforeBlank: "Make everything in the video ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-material",
      [
        "look like liquid chrome",
        "look covered in tiny mirrors",
        "look woven from glowing threads",
        "look soft and inflatable",
        "look carved from translucent ice",
        "look built from folded paper",
        "look coated in pearlescent slime",
        "look formed from glass mosaics",
        "look wrapped in velvet",
        "look sculpted from luminous clay"
      ],
      [
        "under violet light",
        "with slow ripples",
        "with rainbow reflections",
        "with oversized details",
        "with a soft inner glow"
      ]
    )
  },
  {
    id: "choice-setting",
    kind: "choice",
    beforeBlank: "Change the setting of the video to ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-setting",
      [
        "an endless desert of glass",
        "a floating garden above the clouds",
        "a glowing cave beneath the ocean",
        "a tiny city inside a crystal",
        "an overgrown palace greenhouse",
        "a neon canyon made of ribbons",
        "a moonlit forest of giant mushrooms",
        "a mirrored ballroom in space",
        "a soft sculptural dreamscape",
        "a mechanical jungle of flowers"
      ],
      [
        "at midnight",
        "during a pink sunrise",
        "beneath twin moons",
        "inside a drifting storm",
        "under dancing auroras"
      ]
    )
  },
  {
    id: "choice-abundance",
    kind: "choice",
    beforeBlank: "Add lots of ",
    afterBlank: " to the video.",
    responses: createChoiceResponses(
      "choice-abundance",
      [
        "floating bubbles",
        "giant flowers",
        "paper birds",
        "glowing jellyfish",
        "spinning disco planets",
        "tiny friendly clouds",
        "crystal butterflies",
        "bouncing geometric fruit",
        "ribbons of colored light",
        "soft fuzzy stars"
      ],
      [
        "drifting in slow motion",
        "pulsing gently with the beat",
        "spiraling toward the camera",
        "changing color as they move",
        "forming playful patterns"
      ]
    )
  },
  {
    id: "choice-lighting",
    kind: "choice",
    beforeBlank: "Flood the scene with ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-lighting",
      [
        "electric blue moonlight",
        "warm amber spotlights",
        "hot pink rim light",
        "prismatic rainbow beams",
        "soft green bioluminescence",
        "silvery reflected light",
        "deep red sunset light",
        "ultraviolet glow",
        "golden shafts of light",
        "cool turquoise radiance"
      ],
      [
        "rising from below",
        "cutting through thick haze",
        "moving in wide bands",
        "casting sharp silhouettes",
        "pulsing gently with the rhythm"
      ]
    )
  },
  {
    id: "choice-motion",
    kind: "choice",
    beforeBlank: "Make the motion feel ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-motion",
      [
        "weightless",
        "rubbery and elastic",
        "like it is underwater",
        "precise and clockwork",
        "energetic and explosive",
        "dreamily slow",
        "bouncy and playful",
        "magnetically pulled",
        "windblown and airy",
        "kaleidoscopic"
      ],
      [
        "with smooth camera glides",
        "with rhythmic zooms",
        "with looping waves",
        "with sudden scale changes",
        "with graceful spirals"
      ]
    )
  },
  {
    id: "choice-camera",
    kind: "choice",
    beforeBlank: "Change the camera movement to ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-camera",
      [
        "a slow orbit around the scene",
        "a smooth dive through a tunnel",
        "a gentle rise into the sky",
        "a playful side-to-side glide",
        "a dramatic pullback",
        "a dreamy forward drift",
        "a circular dance around the subject",
        "a low sweep across the ground",
        "a floating overhead view",
        "a steady push through the center"
      ],
      [
        "with gentle acceleration",
        "with a subtle rolling tilt",
        "with wide cinematic framing",
        "with rhythmic perspective shifts",
        "with soft parallax layers"
      ]
    )
  },
  {
    id: "choice-palette",
    kind: "choice",
    beforeBlank: "Shift the color palette to ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-palette",
      [
        "hot pink, orange, and violet",
        "acid green, cyan, and black",
        "pearl white, silver, and lavender",
        "sunset red, gold, and deep blue",
        "mint, peach, and electric purple",
        "turquoise, coral, and midnight navy",
        "lemon yellow, magenta, and cobalt",
        "emerald, bronze, and smoky gray",
        "ice blue, lilac, and rose",
        "black, white, and laser red"
      ],
      [
        "with deep shadow contrast",
        "with luminous highlights",
        "with soft pastel transitions",
        "with glossy reflections",
        "with vivid color blocking"
      ]
    )
  },
  {
    id: "choice-texture",
    kind: "choice",
    beforeBlank: "Cover the scene in ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-texture",
      [
        "shimmering sequins",
        "soft translucent fur",
        "cracked iridescent glaze",
        "tiny glass tiles",
        "rippling satin",
        "sparkling sugar crystals",
        "layered paper fibers",
        "polished stone patterns",
        "pearlescent scales",
        "velvety moss"
      ],
      [
        "that catches every light",
        "that shifts with the motion",
        "with oversized surface details",
        "with subtle rainbow color",
        "with a gentle inner glow"
      ]
    )
  },
  {
    id: "choice-scale",
    kind: "choice",
    beforeBlank: "Make the world feel ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-scale",
      [
        "miniature like a toy set",
        "colossal and cathedral-sized",
        "endless in every direction",
        "tiny enough to fit in a snow globe",
        "towering above the clouds",
        "deep like a bottomless canyon",
        "wide like an alien horizon",
        "close and jewel-box intimate",
        "layered like infinite stages",
        "huge but strangely weightless"
      ],
      [
        "with dramatic depth",
        "with exaggerated perspective",
        "with floating foreground details",
        "with slow scale transformations",
        "with a sweeping cinematic view"
      ]
    )
  },
  {
    id: "choice-weather",
    kind: "choice",
    beforeBlank: "Fill the video with ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-weather",
      [
        "slow pink snow",
        "warm golden rain",
        "rolling rainbow fog",
        "sparkling crystal dust",
        "soft clouds of glitter",
        "floating mist bubbles",
        "glowing wind trails",
        "gentle meteor showers",
        "iridescent steam",
        "tiny drifting comets"
      ],
      [
        "moving toward the camera",
        "swirling around every shape",
        "pulsing softly with the music",
        "forming waves in the air",
        "changing color over time"
      ]
    )
  },
  {
    id: "choice-shapes",
    kind: "choice",
    beforeBlank: "Turn the main shapes into ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-shapes",
      [
        "floating crystal fruit",
        "soft mechanical flowers",
        "inflatable geometric animals",
        "spinning glass sculptures",
        "folded-paper planets",
        "glowing ribbon creatures",
        "giant translucent candies",
        "blooming mirror spheres",
        "friendly cloud machines",
        "colorful liquid gemstones"
      ],
      [
        "with expressive movement",
        "with slowly changing surfaces",
        "with tiny orbiting details",
        "with luminous edges",
        "with playful scale changes"
      ]
    )
  },
  {
    id: "choice-rhythm",
    kind: "choice",
    beforeBlank: "Make the visual rhythm feel ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-rhythm",
      [
        "smooth and hypnotic",
        "playful and syncopated",
        "slowly building",
        "bold and celebratory",
        "gentle and breathing",
        "springy and upbeat",
        "mysterious and suspended",
        "fast but fluid",
        "spacious and dreamy",
        "punchy and geometric"
      ],
      [
        "with repeating visual echoes",
        "with waves of transformation",
        "with alternating close and wide views",
        "with shapes answering one another",
        "with color changes marking each phrase"
      ]
    )
  },
  {
    id: "choice-mood",
    kind: "choice",
    beforeBlank: "Give the whole scene ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-mood",
      [
        "a joyful and euphoric mood",
        "a mysterious midnight mood",
        "a playful carnival mood",
        "a serene floating mood",
        "a strange but friendly mood",
        "a luxurious cosmic mood",
        "a sunny optimistic mood",
        "a dreamy romantic mood",
        "a curious otherworldly mood",
        "a bold futuristic mood"
      ],
      [
        "with delightful surprises",
        "with soft atmospheric depth",
        "with expressive color changes",
        "with graceful movement",
        "with a vivid theatrical finish"
      ]
    )
  },
  {
    id: "choice-transformation",
    kind: "choice",
    beforeBlank: "Have the scene gradually transform into ",
    afterBlank: ".",
    responses: createChoiceResponses(
      "choice-transformation",
      [
        "a garden made of light",
        "an ocean of floating fabric",
        "a city of translucent toys",
        "a tunnel of blooming crystals",
        "a sky full of soft machines",
        "a palace made from clouds",
        "a forest of mirrored ribbons",
        "a colorful miniature universe",
        "a landscape of liquid glass",
        "a stage of dancing geometric forms"
      ],
      [
        "through one seamless wave",
        "as colors spread from the center",
        "while the camera glides forward",
        "with every surface changing in turn",
        "as glowing details multiply"
      ]
    )
  }
];

const imageTemplates: PublicRemixImageTemplate[] = [
  {
    id: "image-environment",
    kind: "image",
    statement:
      "Change the environment of the video to match the world seen in the attached image."
  },
  {
    id: "image-animal-dance",
    kind: "image",
    statement:
      "Bring the animal seen in the attached image into the video doing a silly, expressive dance."
  },
  {
    id: "image-color-material",
    kind: "image",
    statement:
      "Transform the video using the colors and materials seen in the attached image."
  },
  {
    id: "image-featured-object",
    kind: "image",
    statement:
      "Add the main object from the attached image to the video as a playful oversized centerpiece."
  },
  {
    id: "image-landscape",
    kind: "image",
    statement:
      "Turn the landscape seen in the attached image into the new world of the video."
  },
  {
    id: "image-architecture",
    kind: "image",
    statement:
      "Remix the architecture in the video to resemble the forms seen in the attached image."
  },
  {
    id: "image-floating-sculpture",
    kind: "image",
    statement:
      "Turn the central subject of the attached image into a huge floating sculpture in the video."
  },
  {
    id: "image-pattern",
    kind: "image",
    statement:
      "Weave the patterns and textures from the attached image across every surface in the video."
  },
  {
    id: "image-lighting",
    kind: "image",
    statement:
      "Recreate the lighting and atmosphere of the attached image throughout the video."
  },
  {
    id: "image-sky",
    kind: "image",
    statement:
      "Replace the sky and background of the video with a dreamlike version of the attached image."
  },
  {
    id: "image-portal",
    kind: "image",
    statement:
      "Open a glowing portal into the attached image and let its world spill into the video."
  },
  {
    id: "image-many-copies",
    kind: "image",
    statement:
      "Fill the video with many tiny animated versions of the main object in the attached image."
  },
  {
    id: "image-implied-motion",
    kind: "image",
    statement:
      "Make the video move with the energy and action suggested by the attached image."
  },
  {
    id: "image-silhouette",
    kind: "image",
    statement:
      "Borrow the bold shapes and silhouette of the attached image for the video’s main forms."
  },
  {
    id: "image-stage-set",
    kind: "image",
    statement:
      "Turn the attached image into a surreal, theatrical stage set for the video."
  }
];

if (choiceTemplates.length !== 15 || imageTemplates.length !== 15) {
  throw new Error(
    "The public remix catalog must contain exactly 15 choice templates and 15 image templates."
  );
}

export const publicRemixPromptTemplates: readonly PublicRemixPromptTemplate[] = [
  ...choiceTemplates,
  ...imageTemplates
];

const templateById = new Map(
  publicRemixPromptTemplates.map((template) => [template.id, template])
);

export function getPublicRemixPromptTemplate(templateId: string) {
  return templateById.get(templateId) ?? null;
}

export function formatChoiceTemplateStatement(
  template: PublicRemixChoiceTemplate,
  blankText = "_____"
) {
  return `${template.beforeBlank}${blankText}${template.afterBlank}`;
}

export function resolvePublicRemixPromptSelection(
  templateId: string,
  responseId?: string | null
): ResolvedPublicRemixPrompt {
  const template = getPublicRemixPromptTemplate(templateId);

  if (!template) {
    throw new Error("Choose one of the available remix statements.");
  }

  if (template.kind === "image") {
    if (responseId?.trim()) {
      throw new Error("Image remix statements do not accept a text answer.");
    }

    return {
      kind: "image",
      prompt: template.statement,
      template,
      response: null
    };
  }

  const response = template.responses.find(
    (candidate) => candidate.id === responseId
  );

  if (!response) {
    throw new Error("Choose one of the four remix answers.");
  }

  return {
    kind: "choice",
    prompt: `${template.beforeBlank}${response.label}${template.afterBlank}`,
    template,
    response
  };
}

export function sampleWithoutReplacement<T>(
  items: readonly T[],
  count: number,
  random: () => number = Math.random
) {
  const pool = [...items];
  const sampleSize = Math.max(0, Math.min(Math.floor(count), pool.length));

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomValue = random();
    const normalizedRandom = Number.isFinite(randomValue)
      ? Math.min(Math.max(randomValue, 0), 0.9999999999999999)
      : 0;
    const swapIndex = Math.floor(normalizedRandom * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool.slice(0, sampleSize);
}

export function pickRandomPublicRemixPromptTemplate(
  currentTemplateId?: string | null,
  random: () => number = Math.random,
  recentTemplateIds: readonly string[] = []
) {
  const candidates = currentTemplateId
    ? publicRemixPromptTemplates.filter(
        (template) => template.id !== currentTemplateId
      )
    : publicRemixPromptTemplates;
  const recentTemplates = recentTemplateIds
    .slice(-maximumConsecutiveTemplateKindCount)
    .map((templateId) => getPublicRemixPromptTemplate(templateId))
    .filter((template): template is PublicRemixPromptTemplate => Boolean(template));
  const repeatedKind =
    recentTemplates.length === maximumConsecutiveTemplateKindCount &&
    recentTemplates.every(
      (template) => template.kind === recentTemplates[0]?.kind
    )
      ? recentTemplates[0]?.kind
      : null;
  const balancedCandidates = repeatedKind
    ? candidates.filter((template) => template.kind !== repeatedKind)
    : candidates;

  return sampleWithoutReplacement(balancedCandidates, 1, random)[0] ?? null;
}

export function pickRandomChoiceResponses(
  template: PublicRemixChoiceTemplate,
  currentResponseIds: readonly string[] = [],
  random: () => number = Math.random
) {
  const nextResponses = sampleWithoutReplacement(template.responses, 4, random);
  const currentIds = new Set(currentResponseIds);
  const repeatedSameSet =
    nextResponses.length === currentIds.size &&
    nextResponses.every((response) => currentIds.has(response.id));

  if (!repeatedSameSet) {
    return nextResponses;
  }

  const replacement = template.responses.find(
    (response) => !currentIds.has(response.id)
  );

  return replacement
    ? [...nextResponses.slice(0, -1), replacement]
    : nextResponses;
}
