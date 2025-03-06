import * as z from "zod";

export const SignupSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email address",
  }),
  firstName: z.string().min(1, {
    message: "Please enter your first name",
  }),
  lastName: z.string().min(1, {
    message: "Please enter your last name",
  }),
  password: z.string().min(6, {
    message: "Password must be at least 6 characters long",
  }),
  confirmPassword: z.string().min(6, {
    message: "Password must be at least 6 characters long",
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords must match",
  path: ["confirmPassword"],
});

export const LoginSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email address",
  }),
  password: z.string().min(6, {
    message: "Please enter a valid password",
  }),
});

// add types for session user
declare module "next-auth" {
    interface User {
      id?: string;
      role?: string;
      firstName?: string,
      lastName?: string,
    }
  }

export type LoginSchemaType = z.infer<typeof LoginSchema>
export type SignupSchemaType = z.infer<typeof SignupSchema>