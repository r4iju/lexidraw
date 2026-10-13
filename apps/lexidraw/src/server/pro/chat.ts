import { createByokSession } from "~/lib/byok/session";
import { createHash } from "node:crypto";
import { prepareChat } from "~/lib/generation/chat";
import { textMaximum, trialPolicy } from "./contracts";
import { ProError, type ProLedger } from "./ledger";
import type { ProTextOperation } from "./operation";
export { ChatQuote, ChatAccept } from "~/lib/generation/chat-contracts";
import { ChatQuote } from "~/lib/generation/chat-contracts";
export function chatIdentity(input: unknown) {
  const text = JSON.stringify(prepareChat(input));
  try {
    createByokSession(async () => {
      throw new Error("No network");
    }, "https://app.invalid").assertSafe(text);
  } catch {
    throw new ProError("Credential material is not accepted");
  }
  return { text, hash: createHash("sha256").update(text).digest("hex") };
}
export class ProChat {
  constructor(
    readonly ledger: ProLedger,
    readonly executor: ProTextOperation,
  ) {}
  async quote(account: string, input: unknown) {
    const request = chatIdentity(input);
    const status = await this.ledger.status(account);
    if (!status.entitled || !status.entitlementPeriodId)
      throw new ProError("Private entitlement required");
    return ChatQuote.parse({
      periodId: status.entitlementPeriodId,
      maximum: textMaximum(status.pricebook),
      book: status.pricebook,
      inputHash: request.hash,
      policy: trialPolicy(status.pricebook).disclosure,
    });
  }
  async accept(
    account: string,
    key: string,
    input: unknown,
    offered: unknown,
    documentId?: string,
  ) {
    const quote = ChatQuote.parse(offered);
    const request = chatIdentity(input);
    if (request.hash !== quote.inputHash)
      throw new ProError("Chat input changed. Review a new quote.");
    return this.ledger.reserve(
      account,
      key,
      request.hash,
      "chat",
      documentId ? { documentId } : undefined,
      quote,
    );
  }
  async stream(
    account: string,
    id: string,
    input: unknown,
    onText: (text: string) => void,
  ) {
    const request = chatIdentity(input);
    const operation = await this.ledger.operation(account, id);
    if (operation.feature !== "chat" || operation.input_hash !== request.hash)
      throw new ProError("Chat input does not match accepted operation");
    if (operation.state === "settled") {
      if (operation.result) onText(operation.result);
      return operation;
    }
    let partial = "";
    const result = await this.executor.execute(
      account,
      id,
      request.text,
      (text) => {
        partial = text;
        onText(text);
      },
    );
    if (
      result.state === "settled" &&
      result.result &&
      result.result !== partial
    )
      onText(result.result);
    return result;
  }
}
