import { z } from 'zod';

export const ProfileSchema = z.object({
  name: z.string().min(1).default(''),
  email: z.string().min(1).email().default(''),
});

export type ProfileSchema = z.infer<typeof ProfileSchema>;