import { z } from "zod";

export const getSignInSchema = () =>
  z.object({
    email: z.string().email().default(""),
    password: z
      .string()
      .refine((password) => password.length >= 16, {
        message: "Password must be at least 16 characters long.",
      })
      .refine((password) => /[A-Z]/.test(password), {
        message: "Password must contain at least one uppercase letter.",
      })
      .refine((password) => /[a-z]/.test(password), {
        message: "Password must contain at least one lowercase letter.",
      })
      .refine((password) => /\d/.test(password), {
        message: "Password must contain at least one number.",
      })
      .refine((password) => /[!@#$%^&*]/.test(password), {
        message:
          "Password must contain at least one special character (!@#$%^&*).",
      })
      .default(""),
  });

export type SignInSchema = z.infer<ReturnType<typeof getSignInSchema>>;
