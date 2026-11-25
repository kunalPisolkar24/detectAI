import { z } from "zod";

const envTypeSchema = z.enum(["prod", "dev", "preview"]).default("dev");

const publicSchema = z.object({
  envType: envTypeSchema,
  siteKey: z.string().min(1),
});

const serverSchema = publicSchema.extend({
  secretKey: z.string().min(1),
});

const PREVIEW_SITE_KEY = "1x00000000000000000000AA";
const PREVIEW_SECRET_KEY = "1x0000000000000000000000000000000AA";

export type AuthEnv = z.infer<typeof serverSchema> & {
  isPreview: boolean;
};

export type PublicAuthEnv = Omit<AuthEnv, "secretKey">;

export function getPublicAuthEnv(): PublicAuthEnv {
  const envType = process.env.NEXT_PUBLIC_ENV_TYPE;

  if (envType === "preview") {
    return {
      envType: "preview",
      siteKey: PREVIEW_SITE_KEY,
      isPreview: true,
    };
  }

  const parsed = publicSchema.parse({
    envType,
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  });

  return { ...parsed, isPreview: false };
}

export function getAuthEnv(): AuthEnv {
  const publicEnv = getPublicAuthEnv();

  if (publicEnv.isPreview) {
    return { ...publicEnv, secretKey: PREVIEW_SECRET_KEY };
  }

  const parsed = serverSchema.parse({
    envType: publicEnv.envType,
    siteKey: publicEnv.siteKey,
    secretKey: process.env.TURNSTILE_SECRET_KEY,
  });

  if (
    parsed.envType === "prod" &&
    (parsed.siteKey === PREVIEW_SITE_KEY || parsed.secretKey === PREVIEW_SECRET_KEY)
  ) {
    throw new Error("Production must not use Turnstile test keys");
  }

  return { ...parsed, isPreview: false };
}
