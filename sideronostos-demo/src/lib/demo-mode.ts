import { demoMode } from "@/lib/env";

export const isDemoMode = () => demoMode;

export const demoUser = {
  id: "demo-farmer",
  email: "demo@agrisata.local",
  display_name: "Farmer User",
  email_verified: true,
} as const;
