"use server";

import { revalidatePath } from "next/cache";

export const revalidateUrl = async (urlId: string) => {
  return await new Promise<void>((resolve) => {
    revalidatePath(`/urls/${urlId}`, "page");
    resolve();
  });
};
