import type { EmailProvider } from "./EmailProvider";

export class NoOpProvider implements EmailProvider {
  readonly name = "noop";

  async send({ to, subject }: { to: string; subject: string; html: string; fromName: string }) {
    console.log(`[NoOp] Auto-send is off. Would have sent "${subject}" to ${to}`);
  }
}
