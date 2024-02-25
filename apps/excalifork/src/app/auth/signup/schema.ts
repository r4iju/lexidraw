import { z } from 'zod';

export const SignUpSchema = z.object({
  email: z.string().email("Ogiltig e-postadress").default(''),
  name: z.string().min(3, { message: 'Namnet måste vara minst 3 tecken' }).default(''),
  password: z.string()
    .min(16, { message: 'Lösenordet måste vara minst 16 tecken' }).default(''),
});

export type SignUpSchema = z.infer<typeof SignUpSchema>;