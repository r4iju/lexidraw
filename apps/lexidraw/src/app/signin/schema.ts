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

/**
 * What the server takes as credentials: the form's rules with both fields
 * required and the email normalized the way sign-up stores it.
 */
export const signInInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email({ message: "Enter your email address." })),
  password: z.string().min(1, { message: "Enter your password." }),
});
