import { proLedger } from "~/server/pro/runtime";
import { serverProText } from "~/server/pro/provider";
import { ProTextOperation } from "~/server/pro/operation";
export async function executeProTextStep(
  account: string,
  id: string,
  text: string,
) {
  "use step";
  return new ProTextOperation(proLedger(), serverProText).execute(
    account,
    id,
    text,
  );
}
