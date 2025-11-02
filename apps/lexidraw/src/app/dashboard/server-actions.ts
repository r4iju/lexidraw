"use server";

import { revalidatePath } from "next/cache";

export const revalidateDashboard = async () => {
  return await new Promise<void>((resolve) => {
    revalidatePath("/dashboard", "layout");
    resolve();
  });
};
