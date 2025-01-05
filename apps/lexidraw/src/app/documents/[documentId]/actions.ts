"use server";

import { revalidatePath } from "next/cache";

export async function revalidate(documentId: string) {
  return new Promise<void>((resolve) => {
    revalidatePath(`/documents/${documentId}`, "page");
    revalidatePath(`/dashboard`, "page");
    resolve();
  });
}
