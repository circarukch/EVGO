import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BlockStatus,
  CheckoutStatus,
  CreateBlockInput,
  CreateCheckoutInput,
  CreatedBlock,
  CreatedCheckout,
  PaymentGateway,
  PaymentGatewayError,
  RefundInput,
  RefundState,
} from "./gateway";

interface MockCheckout {
  input: CreateCheckoutInput;
  status: CheckoutStatus;
  refundedPaise: number;
  refunds: Map<string, RefundState>;
}

/** Signs mock webhooks the same way Cashfree does, so the webhook path can be tested. */
export const MOCK_WEBHOOK_SECRET = "mock-webhook-secret";
export function signWebhook(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
}

interface MockBlock {
  input: CreateBlockInput;
  status: BlockStatus;
  capturedPaise: number;
}

/**
 * Stands in for Cashfree in development, tests and the demo. Behaves like UPI pre-authorisation:
 * a block waits for approval (approve/decline stand in for the customer's UPI app), can be captured
 * once for up to its amount (the rest is released), or released whole.
 */
export class MockPaymentGateway implements PaymentGateway {
  readonly name = "mock";
  private readonly blocks = new Map<string, MockBlock>();
  private readonly checkouts = new Map<string, MockCheckout>();
  /** Test hook: the next capture fails as if the gateway were down. */
  failNextCapture = false;
  /** Test hook: the next refund fails as if the gateway were down. */
  failNextRefund = false;

  async createCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout> {
    if (this.checkouts.has(input.ref)) throw new PaymentGatewayError("INVALID_STATE", "Order id already used");
    this.checkouts.set(input.ref, { input, status: { status: "PENDING" }, refundedPaise: 0, refunds: new Map() });
    return { gatewayRef: input.ref, paymentSessionId: `mock_session_${input.ref}` };
  }

  async checkoutStatus(gatewayRef: string): Promise<CheckoutStatus> {
    const c = this.checkout(gatewayRef);
    if (c.status.status === "PENDING" && Date.now() > c.input.expiresAt.getTime()) c.status = { status: "EXPIRED" };
    return c.status;
  }

  /** The customer paid on the checkout (stands in for Cashfree's page and the customer's bank). */
  pay(gatewayRef: string, method = "upi") {
    const c = this.checkout(gatewayRef);
    if (c.status.status === "PENDING") c.status = { status: "PAID", method, paymentRef: `mock_pay_${gatewayRef}` };
  }

  /** The payment failed or the customer gave up. */
  fail(gatewayRef: string) {
    const c = this.checkout(gatewayRef);
    if (c.status.status === "PENDING") c.status = { status: "FAILED" };
  }

  async refund(input: RefundInput) {
    const c = this.checkout(input.gatewayRef);
    const seen = c.refunds.get(input.refundRef);
    if (seen) return { status: seen, gatewayRefundId: `mock_rf_${input.refundRef}` };
    if (this.failNextRefund) {
      this.failNextRefund = false;
      throw new PaymentGatewayError("UNAVAILABLE", "Gateway did not respond");
    }
    if (c.status.status !== "PAID") throw new PaymentGatewayError("INVALID_STATE", "Order is not paid");
    if (input.amountPaise <= 0 || c.refundedPaise + input.amountPaise > c.input.amountPaise) {
      throw new PaymentGatewayError("INVALID_STATE", "Refund is more than was paid");
    }
    c.refundedPaise += input.amountPaise;
    c.refunds.set(input.refundRef, "SUCCEEDED");
    return { status: "SUCCEEDED" as const, gatewayRefundId: `mock_rf_${input.refundRef}` };
  }

  async refundStatus(gatewayRef: string, refundRef: string): Promise<RefundState> {
    return this.checkout(gatewayRef).refunds.get(refundRef) ?? "FAILED";
  }

  verifyWebhook(rawBody: string, timestamp: string, signature: string) {
    const a = Buffer.from(signWebhook(MOCK_WEBHOOK_SECRET, timestamp, rawBody));
    const b = Buffer.from(signature ?? "");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private checkout(ref: string): MockCheckout {
    const c = this.checkouts.get(ref);
    if (!c) throw new PaymentGatewayError("INVALID_STATE", "Unknown order");
    return c;
  }

  async createBlock(input: CreateBlockInput): Promise<CreatedBlock> {
    const gatewayRef = `mock_${input.ref}`;
    this.blocks.set(gatewayRef, { input, status: "PENDING", capturedPaise: 0 });
    const am = (input.amountPaise / 100).toFixed(2);
    return {
      gatewayRef,
      status: "PENDING",
      upiIntentUrl: `upi://mandate?pa=evgo@mock&pn=EVGO&am=${am}&tr=${encodeURIComponent(input.ref)}&purpose=14`,
    };
  }

  async blockStatus(gatewayRef: string): Promise<BlockStatus> {
    const b = this.get(gatewayRef);
    if (b.status === "PENDING" && Date.now() > b.input.approveBy.getTime()) b.status = "EXPIRED";
    return b.status;
  }

  /** The customer approved in their UPI app. */
  approve(gatewayRef: string) {
    const b = this.get(gatewayRef);
    if (b.status === "PENDING") b.status = "AUTHORIZED";
  }

  /** The customer declined, or entered a wrong PIN too often. */
  decline(gatewayRef: string) {
    const b = this.get(gatewayRef);
    if (b.status === "PENDING") b.status = "FAILED";
  }

  async capture(gatewayRef: string, amountPaise: number) {
    const b = this.get(gatewayRef);
    if (this.failNextCapture) {
      this.failNextCapture = false;
      throw new PaymentGatewayError("UNAVAILABLE", "Gateway did not respond");
    }
    if (b.status !== "AUTHORIZED") throw new PaymentGatewayError("INVALID_STATE", `Block is ${b.status}`);
    if (amountPaise <= 0 || amountPaise > b.input.amountPaise) throw new PaymentGatewayError("INVALID_STATE", "Capture outside the block");
    b.status = "CAPTURED";
    b.capturedPaise = amountPaise;
    return { captureRef: `${gatewayRef}_cap` };
  }

  async release(gatewayRef: string) {
    const b = this.get(gatewayRef);
    if (b.status === "CAPTURED") throw new PaymentGatewayError("INVALID_STATE", "Already captured");
    b.status = "RELEASED";
  }

  private get(gatewayRef: string): MockBlock {
    const b = this.blocks.get(gatewayRef);
    if (!b) throw new PaymentGatewayError("INVALID_STATE", "Unknown block");
    return b;
  }
}

/** Production until Cashfree keys are set: paying by UPI is refused clearly. */
export class NotConfiguredPaymentGateway implements PaymentGateway {
  readonly name = "none";
  private fail(): never {
    throw new PaymentGatewayError("NOT_CONFIGURED", "Online payments are not switched on yet");
  }
  createCheckout = async () => this.fail();
  checkoutStatus = async () => this.fail();
  refund = async () => this.fail();
  refundStatus = async () => this.fail();
  verifyWebhook = () => false;
  createBlock = async () => this.fail();
  blockStatus = async () => this.fail();
  capture = async () => this.fail();
  release = async () => this.fail();
}
