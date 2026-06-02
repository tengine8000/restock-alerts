import type { EmailProvider } from "./EmailProvider";

export class ConsoleProvider implements EmailProvider {
  readonly name = "console";

  async send({ to, subject, html, fromName }: { to: string; subject: string; html: string; fromName: string }) {
    console.log(
      `[Email] From: ${fromName} | To: ${to} | Subject: ${subject}\n${html}`,
    );
  }
}
