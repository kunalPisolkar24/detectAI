import z from "zod";

export const MessageSchema = z.object({
  message: z
    .string()
    .min(150, { message: "Message must be at least 150 characters" })
    .refine(
      (text) => {
        try {
          const nonLatinChars = text.replace(/[a-zA-Z0-9\s.,!?'"@#$%^&*()_+\-=\[\]{}|\\:;<>()%]/g, '');
          const nonLatinRatio = nonLatinChars.length / text.length;
          return nonLatinRatio < 0.15; 
        } catch (error) {
          return false;
        }
      },
      { message: "Message must be primarily in English" }
    ),
});
