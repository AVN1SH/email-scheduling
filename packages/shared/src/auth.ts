import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use at most 128 characters.");

export const loginRequestSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const registerRequestSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name.").max(80),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  avatarUrl: z.url({ protocol: /^https$/ }).nullable(),
});

export const authResponseSchema = z.object({
  user: publicUserSchema,
  csrfToken: z.string().min(32),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
