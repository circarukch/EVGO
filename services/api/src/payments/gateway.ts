/**
 * The one payment gateway for everything customers pay: bus tickets, wallet top-ups and charging.
 * Cashfree in production; a mock in development and tests. Refunds go back the same way.
 *
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

/** A one-time payment the customer makes on the gateway's checkout: UPI, card, netbanking or a wallet app. */
export interface CreateCheckoutInput {
  /** Our own id; becomes the gateway order id. */
  ref: string;
  amountPaise: number;
  description: string;
  customerId: string;
  customerPhone: string;
  /** Checkout stops accepting payment after this. */
  expiresAt: Date;
}

export interface CreatedCheckout {
  gatewayRef: string;
  /** Hand this to the gateway's app or web SDK to open its checkout. */
  paymentSessionId: string;
  /** Which Cashfree environment the SDK must use; absent for the mock. */
  environment?: "SANDBOX" | "PRODUCTION";
}

export type CheckoutState = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

export interface CheckoutStatus {
  status: CheckoutState;
  /** How the customer paid: upi, card, netbanking, app_wallet, paylater, emi. */
  method?: string;
  /** The gateway's id for the successful payment. */
  paymentRef?: string;
}

export interface RefundInput {
  /** The order the money was paid on. */
  gatewayRef: string;
  /** Our refund id; sending it twice does not refund twice. */
  refundRef: string;
  amountPaise: number;
  reason: string;
}

export type RefundState = "PENDING" | "SUCCEEDED" | "FAILED";

export interface PaymentGateway {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout>;
  checkoutStatus(gatewayRef: string): Promise<CheckoutStatus>;
  /** Send money back to where it came from. Partial refunds allowed. */
  refund(input: RefundInput): Promise<{ status: RefundState; gatewayRefundId?: string }>;
  refundStatus(gatewayRef: string, refundRef: string): Promise<RefundState>;
  /** True if a webhook really came from the gateway. */
  verifyWebhook(rawBody: string, timestamp: string, signature: string): boolean;

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
