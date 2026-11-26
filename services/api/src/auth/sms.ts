import { Injectable, Logger } from "@nestjs/common";

export const SMS_SENDER = Symbol("SMS_SENDER");

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Development sender. Production swaps in a DLT-registered Indian SMS provider (e.g. MSG91). */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly log = new Logger("SMS");
  async send(phone: string, text: string) {
    this.log.log(`to ${phone.slice(0, 5)}*****${phone.slice(-2)}: ${text}`);
  }
}
