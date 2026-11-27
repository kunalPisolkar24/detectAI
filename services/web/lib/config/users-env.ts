import { z } from "zod";

const schema = z.object({
  url: z.url(),
  apiKey: z.string().min(1),
});

export type UsersServiceEnv = z.infer<typeof schema>;

export function getUsersServiceEnv(): UsersServiceEnv {
  return schema.parse({
    url: process.env.USERS_SERVICE_URL,
    apiKey: process.env.USERS_SERVICE_API_KEY,
  });
}
