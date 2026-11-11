import { z } from "zod";

export const PASSWORD_HINT =
  "At least 16 characters, with upper- and lowercase letters, a number and one of ! @ # $ % ^ & *.";

const email = () => z.string().email({ message: "Enter your email address." });

const name = () =>
  z.string().min(3, { message: "Use at least 3 characters for your name." });

const password = () =>
  z
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
    });

/**
 * The sign-up form's fields. The empty defaults are for its controlled inputs
 * only: a missing field takes the default without running its checks, so the
 * server validates with {@link signUpInput} instead.
 */
export const getSignUpSchema = () =>
  z.object({
    email: email().default(""),
    name: name().default(""),
    password: password().default(""),
  });

export type SignUpSchema = z.infer<ReturnType<typeof getSignUpSchema>>;

/** The form's rules with every field required and the email normalized. */
export const signUpInput = z.object({
  email: z.string().trim().toLowerCase().pipe(email()),
  name: name(),
  password: password(),
});
