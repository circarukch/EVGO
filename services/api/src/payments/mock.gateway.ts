import { BlockStatus, CreateBlockInput, CreatedBlock, PaymentGateway, PaymentGatewayError } from "./gateway";

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
  /** Test hook: the next capture fails as if the gateway were down. */
  failNextCapture = false;

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
    throw new PaymentGatewayError("NOT_CONFIGURED", "Paying by UPI is not switched on yet");
  }
  createBlock = async () => this.fail();
  blockStatus = async () => this.fail();
  capture = async () => this.fail();
  release = async () => this.fail();
}
