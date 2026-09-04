import { createHash } from "crypto";

export const CacheKeys = {
  user: (id: string) => `v1:user:id:${id}`,
  userByEmail: (email: string) => {
    const normalized = email.trim().toLowerCase();
    const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
    return `v1:user:email:${hash}`;
  },
}
