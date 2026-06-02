import type { ShopSettings } from "@prisma/client";
import { AppResendProvider } from "./AppResendProvider";
import { ConsoleProvider } from "./ConsoleProvider";
import { NoOpProvider } from "./NoOpProvider";
import type { EmailProvider } from "./EmailProvider";

export function getEmailProvider(settings: ShopSettings | null): EmailProvider {
  if (settings && !settings.autoSendEnabled) {
    return new NoOpProvider();
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return new AppResendProvider(apiKey);
  }

  return new ConsoleProvider();
}

export type { EmailProvider };
export { NoOpProvider } from "./NoOpProvider";
export { ConsoleProvider } from "./ConsoleProvider";
export { AppResendProvider } from "./AppResendProvider";
