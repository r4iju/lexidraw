import { z } from 'zod';

export const SignInSchema = z.object({
  email: z.string().email().default(''),
  password: z.string()
    .min(16, { message: 'Password must be at least 16 characters long' }).default(''),
});

export type SignInSchema = z.infer<typeof SignInSchema>;