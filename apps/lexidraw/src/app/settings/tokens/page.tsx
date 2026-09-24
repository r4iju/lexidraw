import { redirect } from "next/navigation";

/** API tokens are a section of Settings now; old links still land there. */
export default function TokensPage() {
  redirect("/settings#api-tokens");
}
