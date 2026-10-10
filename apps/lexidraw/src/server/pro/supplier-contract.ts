import { z } from "zod";
import { TextBook, PRICEBOOK_V1, Completion, Usage } from "./contracts";
import {
  NarrationBook,
  NARRATION_BOOK_V1,
  NarrationPart,
} from "~/lib/narration/contracts";
import { ImagePricebook, ImageCompletion } from "~/lib/images/contracts";
import {
  AgentBook,
  AGENT_BOOK,
  AgentCompletion,
  SandboxBook,
} from "~/lib/agent/contracts";

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export function safeCost(...terms: number[]) {
  if (terms.some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new Error("Unsafe supplier cost");
  const value = terms.reduce((sum, n) => sum + BigInt(n), 0n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Unsafe supplier cost");
  return Number(value);
}
export function textCost(
  usage: Usage,
  book: z.infer<typeof TextBook> | AgentBook,
) {
  return safeCost(
    (usage.input - usage.cachedInput) * book.inputNanoUsd,
    usage.cachedInput * book.cachedInputNanoUsd,
    usage.output * book.outputNanoUsd,
  );
}
export const SupplierBooks = z.strictObject({
  verification: z.enum(["verified-server", "test-injection"]),
  text: TextBook.optional(),
  narration: NarrationBook.optional(),
  image: ImagePricebook.optional(),
  agent: AgentBook.optional(),
});
const contractFields = {
  version: z.literal("supplier-attempt-v1"),
  verification: z.enum(["verified-server", "test-injection", "archived-v1"]),
  maximumNanoUsd: money,
};
const ContractShape = z.discriminatedUnion("feature", [
  z.strictObject({
    ...contractFields,
    feature: z.enum(["text", "autocomplete", "chat"]),
    book: TextBook,
  }),
  z.strictObject({
    ...contractFields,
    feature: z.literal("narration"),
    book: NarrationBook,
  }),
  z.strictObject({
    ...contractFields,
    feature: z.literal("image"),
    book: ImagePricebook,
  }),
  z.strictObject({
    ...contractFields,
    feature: z.literal("agent"),
    phase: z.enum([
      "plan",
      "decision",
      "generation",
      "search",
      "image",
      "sandbox",
      "delegate_plan",
      "delegate_generation",
    ]),
    book: AgentBook,
  }),
]);
export type SupplierPhase =
  | "plan"
  | "decision"
  | "generation"
  | "search"
  | "image"
  | "sandbox"
  | "delegate_plan"
  | "delegate_generation";
export type SupplierContract = z.infer<typeof ContractShape>;
export function supplierMaximum(
  feature: SupplierContract["feature"],
  raw: unknown,
  phase?: SupplierPhase,
) {
  if (feature === "narration") {
    const b = NarrationBook.parse(raw);
    return safeCost(
      b.maxChunkInputTokens * b.inputNanoUsd,
      b.maxChunkAudioTokens * b.audioNanoUsd,
    );
  }
  if (feature === "image") return ImagePricebook.parse(raw).maximumNanoUsd;
  if (feature === "agent") {
    const b = AgentBook.parse(raw);
    if (!phase) throw new Error("Supplier phase required");
    if (phase === "image") return ImagePricebook.parse(b.image).maximumNanoUsd;
    if (phase === "search") return b.searchMaximumNanoUsd;
    if (phase === "sandbox") {
      if (!b.sandbox) throw new Error("Sandbox supplier unavailable");
      return b.sandbox.maximumNanoUsd;
    }
    return safeCost(
      b.maxInputTokens * Math.max(b.inputNanoUsd, b.cachedInputNanoUsd),
      b.maxOutputTokens * b.outputNanoUsd,
    );
  }
  const b = TextBook.parse(raw);
  return safeCost(
    b.maxInputTokens * Math.max(b.inputNanoUsd, b.cachedInputNanoUsd),
    (feature === "autocomplete" ? 64 : b.maxOutputTokens) * b.outputNanoUsd,
  );
}
export const SupplierContract = ContractShape.refine(
  (c) =>
    c.maximumNanoUsd ===
    supplierMaximum(
      c.feature,
      c.book,
      c.feature === "agent" ? c.phase : undefined,
    ),
  "Supplier exposure differs from contract",
);
export function makeSupplierContract(
  feature: SupplierContract["feature"],
  book: unknown,
  verification: SupplierContract["verification"],
  phase?: SupplierPhase,
) {
  return SupplierContract.parse({
    version: "supplier-attempt-v1",
    verification,
    feature,
    book,
    ...(phase ? { phase } : {}),
    maximumNanoUsd: supplierMaximum(feature, book, phase),
  });
}
/** Only dispatch configurations whose historical identity is known can be recovered without a durable contract. */
export function archivedSupplier(
  feature: SupplierContract["feature"],
  book: unknown,
  phase?: SupplierPhase,
) {
  if (feature === "narration") {
    const b = NarrationBook.parse(book);
    if (
      JSON.stringify(b) !==
      JSON.stringify(NarrationBook.parse(NARRATION_BOOK_V1))
    )
      throw new Error("Unknown historical supplier");
    return makeSupplierContract(feature, b, "archived-v1");
  }
  if (["text", "autocomplete", "chat"].includes(feature)) {
    const b = TextBook.parse(book);
    return makeSupplierContract(
      feature,
      feature === "chat" ? b : PRICEBOOK_V1,
      "archived-v1",
    );
  }
  if (feature === "agent") {
    if (
      phase &&
      ["sandbox", "delegate_plan", "delegate_generation"].includes(phase)
    )
      throw new Error("Durable tool supplier contract required");
    const b = AgentBook.parse(book);
    return makeSupplierContract(
      feature,
      {
        ...AGENT_BOOK,
        ...(b.image
          ? {
              image: b.image,
              provenance: "deterministic-whole-action-fixture",
              maxImageSteps: 1,
              maxAttempts: 16,
            }
          : {}),
        maximumNanoUsd:
          AGENT_BOOK.maximumNanoUsd + (b.image?.maximumNanoUsd ?? 0),
        quote: Math.ceil(
          ((AGENT_BOOK.maximumNanoUsd + (b.image?.maximumNanoUsd ?? 0)) *
            1_000_000) /
            AGENT_BOOK.creditNanoUsd,
        ),
      },
      "archived-v1",
      phase,
    );
  }
  return makeSupplierContract(
    feature,
    ImagePricebook.parse(book),
    "archived-v1",
    phase,
  );
}

export function validateSupplierCompletion(
  contract: SupplierContract,
  value: unknown,
) {
  const c = (
    contract.feature === "agent"
      ? AgentCompletion
      : contract.feature === "narration"
        ? NarrationPart
        : contract.feature === "image"
          ? ImageCompletion
          : Completion
  ).parse(value);
  let measured: number;
  if (contract.feature === "narration" && "audio" in c.usage) {
    const b = NarrationBook.parse(contract.book);
    measured = safeCost(
      c.usage.input * b.inputNanoUsd,
      c.usage.audio * b.audioNanoUsd,
    );
  } else if (
    contract.feature === "image" ||
    (contract.feature === "agent" && contract.phase === "image")
  ) {
    const b =
      contract.feature === "image"
        ? ImagePricebook.parse(contract.book)
        : ImagePricebook.parse(AgentBook.parse(contract.book).image);
    const image =
      contract.feature === "image"
        ? ImageCompletion.parse(c)
        : ImageCompletion.parse(AgentCompletion.parse(c).output);
    const u = image.usage;
    measured = safeCost(
      u.inputTokens * b.inputTokenNanoUsd,
      (u.thinkingTokens + u.textOutputTokens) * b.outputTokenNanoUsd,
      u.outputImages * b.outputImageNanoUsd,
    );
    if (
      image.actualCostNanoUsd !== undefined &&
      image.actualCostNanoUsd > contract.maximumNanoUsd
    )
      throw new Error("Image invoice exceeds supplier contract");
  } else if (contract.feature === "agent" && contract.phase === "sandbox")
    measured = SandboxBook.parse(
      AgentBook.parse(contract.book).sandbox,
    ).maximumNanoUsd;
  else if (contract.feature === "agent" && contract.phase === "search")
    measured = AgentBook.parse(contract.book).searchMaximumNanoUsd;
  else {
    const b =
      contract.feature === "agent"
        ? AgentBook.parse(contract.book)
        : TextBook.parse(contract.book);
    const usage = Usage.parse(c.usage);
    if (
      usage.output >
      (contract.feature === "autocomplete" ? 64 : b.maxOutputTokens)
    )
      throw new Error("Supplier output cap exceeded");
    measured = textCost(usage, b);
  }
  if (
    "phase" in c &&
    c.phase !== (contract.feature === "agent" ? contract.phase : undefined)
  )
    throw new Error("Supplier phase mismatch");
  if (
    measured > contract.maximumNanoUsd ||
    (c.actualCostNanoUsd !== undefined &&
      c.actualCostNanoUsd > contract.maximumNanoUsd) ||
    ("estimatedCostNanoUsd" in c &&
      c.estimatedCostNanoUsd !== undefined &&
      c.estimatedCostNanoUsd > contract.maximumNanoUsd)
  )
    throw new Error("Completion exceeds supplier contract");
}
