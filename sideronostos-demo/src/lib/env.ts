import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Agrisata"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_API_BASE_URL: z.url().default("http://localhost:8000"),
  // This is an isolated demo app, so a plain `pnpm dev` must not require the API.
  // Set NEXT_PUBLIC_DEMO_MODE=false only when intentionally testing against a backend.
  NEXT_PUBLIC_DEMO_MODE: z.preprocess((value) => value === undefined ? true : value === true || value === "true", z.boolean()),
});

export const env = schema.parse({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
});

export const demoMode = env.NEXT_PUBLIC_DEMO_MODE;
