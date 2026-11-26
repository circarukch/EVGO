import { HttpException, HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { PaymentGatewayError } from "./gateway";

/** Calls the payment gateway and turns its failures into answers the app can show. */
export async function gatewayCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PaymentGatewayError && e.kind === "NOT_CONFIGURED") throw new ServiceUnavailableException(e.message);
    if (e instanceof PaymentGatewayError && e.kind === "DECLINED") throw new HttpException(e.message, HttpStatus.PAYMENT_REQUIRED);
    throw new ServiceUnavailableException("The payment service did not respond. Please try again");
  }
}

/** Gateway order ids. The prefix says what the money is for, so a webhook knows where to go. */
export const checkoutRef = {
  topUp: (topUpId: string) => `topup_${topUpId}`,
  order: (orderId: string) => `ord_${orderId.replace(/-/g, "").slice(0, 24)}_${Date.now().toString(36)}`,
};
