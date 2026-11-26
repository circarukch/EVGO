// OCPP-J (JSON over WebSocket) framing for OCPP 1.6.
// A frame is a JSON array: [MessageTypeId, UniqueId, ...].

export const CALL = 2;
export const CALL_RESULT = 3;
export const CALL_ERROR = 4;

export type Call = [typeof CALL, string, string, Record<string, unknown>];
export type CallResult = [typeof CALL_RESULT, string, Record<string, unknown>];
export type CallError = [typeof CALL_ERROR, string, OcppErrorCode, string, Record<string, unknown>];
export type Frame = Call | CallResult | CallError;

export type OcppErrorCode =
  | "NotImplemented"
  | "NotSupported"
  | "InternalError"
  | "ProtocolError"
  | "SecurityError"
  | "FormationViolation"
  | "PropertyConstraintViolation"
  | "OccurrenceConstraintViolation"
  | "TypeConstraintViolation"
  | "GenericError";

export class OcppError extends Error {
  constructor(public code: OcppErrorCode, message: string) {
    super(message);
  }
}

export function parseFrame(raw: string): Frame {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new OcppError("FormationViolation", "Frame is not valid JSON");
  }
  if (!Array.isArray(data) || typeof data[1] !== "string") {
    throw new OcppError("FormationViolation", "Frame must be an array with a string unique id");
  }
  const type = data[0];
  if (type === CALL) {
    if (data.length !== 4 || typeof data[2] !== "string" || typeof data[3] !== "object" || data[3] === null) {
      throw new OcppError("FormationViolation", "CALL must be [2, id, action, payload]");
    }
    return data as Call;
  }
  if (type === CALL_RESULT && data.length === 3) return data as CallResult;
  if (type === CALL_ERROR && data.length === 5) return data as CallError;
  throw new OcppError("FormationViolation", `Unknown or malformed message type ${String(type)}`);
}

// Payload shapes for the 1.6 messages handled in the MVP.
export interface BootNotificationReq {
  chargePointVendor: string;
  chargePointModel: string;
  chargePointSerialNumber?: string;
  firmwareVersion?: string;
}
export interface StatusNotificationReq {
  connectorId: number;
  errorCode: string;
  status:
    | "Available"
    | "Preparing"
    | "Charging"
    | "SuspendedEVSE"
    | "SuspendedEV"
    | "Finishing"
    | "Reserved"
    | "Unavailable"
    | "Faulted";
  timestamp?: string;
}
export interface AuthorizeReq {
  idTag: string;
}
export interface StartTransactionReq {
  connectorId: number;
  idTag: string;
  meterStart: number; // Wh
  timestamp: string;
}
export interface StopTransactionReq {
  transactionId: number;
  meterStop: number; // Wh
  timestamp: string;
  idTag?: string;
  reason?: string;
}
export interface MeterValuesReq {
  connectorId: number;
  transactionId?: number;
  meterValue: Array<{
    timestamp: string;
    sampledValue: Array<{ value: string; measurand?: string; unit?: string }>;
  }>;
}
export type IdTagStatus = "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx";
