/**
 * Pay-per-use without a wallet: block an amount in the customer's bank by UPI, capture only what was
 * used, release the rest. Cashfree calls this UPI pre-authorisation (authorize_only + capture/void);
 * other gateways call it a UPI one-time mandate. The rest of the app only sees this interface.
 */
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");

export type BlockStatus = "PENDING" | "AUTHORIZED" | "FAILED" | "EXPIRED" | "CAPTURED" | "RELEASED";

export interface CreateBlockInput {
  /** Our own id for the block; the gateway order id. */
  ref: string;
  amountPaise: number;
  description: string;
  customerId: string;
  customerPhone: string;
  /** The customer must approve in their UPI app before this. */
  approveBy: Date;
  /** The block lapses (and is released by the bank) after this. */
  expiresAt: Date;
}

export interface CreatedBlock {
  gatewayRef: string;
  status: BlockStatus;
  /** upi://pay… link that opens the customer's UPI app on the approval screen. */
  upiIntentUrl?: string;
}

export interface PaymentGateway {
  readonly name: string;
  createBlock(input: CreateBlockInput): Promise<CreatedBlock>;
  /** Current status at the gateway (the source of truth; webhooks only speed this up). */
  blockStatus(gatewayRef: string): Promise<BlockStatus>;
  /** Take the used amount; the gateway releases the rest of the block. */
  capture(gatewayRef: string, amountPaise: number): Promise<{ captureRef: string }>;
  /** Release the whole block (nothing used, or the charger never started). */
  release(gatewayRef: string): Promise<void>;
}

export class PaymentGatewayError extends Error {
  constructor(
    readonly kind: "NOT_CONFIGURED" | "DECLINED" | "UNAVAILABLE" | "INVALID_STATE",
    message: string,
  ) {
    super(message);
  }
}
