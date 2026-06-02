import type { EmailProvider } from "./EmailProvider";

export class AppResendProvider implements EmailProvider {
  readonly name = "resend";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send({ to, subject, html, fromName }: { to: string; subject: string; html: string; fromName: string }) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <onboarding@resend.dev>`,
        to: [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend API error: ${response.status} ${body}`);
    }
  }
}
