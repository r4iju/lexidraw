import { z } from "zod";

/**
 * Only asks that both fields are filled: the password policy is sign-up's,
 * and an account made under an older policy must still be able to sign in.
 */
export const getSignInSchema = () =>
  z.object({
    email: z
      .string()
      .email({ message: "Enter your email address." })
      .default(""),
    password: z
      .string()
      .min(1, { message: "Enter your password." })
      .default(""),
  });

export type SignInSchema = z.infer<ReturnType<typeof getSignInSchema>>;
