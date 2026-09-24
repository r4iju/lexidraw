import { z } from "zod";

export const PASSWORD_HINT =
  "At least 16 characters, with upper- and lowercase letters, a number and one of ! @ # $ % ^ & *.";

export const getSignUpSchema = () =>
  z.object({
    email: z
      .string()
      .email({ message: "Enter your email address." })
      .default(""),
    name: z
      .string()
      .min(3, { message: "Use at least 3 characters for your name." })
      .default(""),
    password: z
      .string()
      .refine((password) => password.length >= 16, {
        message: "Use at least 16 characters.",
      })
      .refine((password) => /[A-Z]/.test(password), {
        message: "Add an uppercase letter.",
      })
      .refine((password) => /[a-z]/.test(password), {
        message: "Add a lowercase letter.",
      })
      .refine((password) => /\d/.test(password), {
        message: "Add a number.",
      })
      .refine((password) => /[!@#$%^&*]/.test(password), {
        message: "Add one of ! @ # $ % ^ & *.",
      })
      .default(""),
  });

export type SignUpSchema = z.infer<ReturnType<typeof getSignUpSchema>>;
