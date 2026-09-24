import { redirect } from "next/navigation";

/** Profile became the Account part of Settings; old links still land there. */
export default function ProfilePage() {
  redirect("/settings#settings-account");
}
