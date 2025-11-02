"use server";

import { revalidatePath } from "next/cache";

export async function revalidate(drawingId: string) {
  return new Promise<void>((resolve) => {
    revalidatePath(`/drawings/${drawingId}`, "page");
    revalidatePath(`/dashboard`, "page");
    resolve();
  });
}
