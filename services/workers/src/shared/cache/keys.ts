export const CacheKeys = {
  user: (id: string) => `user:id:${id}`,
  userByEmail: (email: string) => `user:email:${email}`,
}
