export interface EmailProvider {
  readonly name: string;
  send(opts: {
    to: string;
    subject: string;
    html: string;
    fromName: string;
  }): Promise<void>;
}
