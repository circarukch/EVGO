import { checkPassword, hashPassword, randomPassword } from "../common/password";

/** A fresh charger password: 20 letters and digits (no look-alikes), easy to type into a charger's setup app. */
export const newChargerPassword = (): string => randomPassword(20);

/** Stored as "scrypt:<salt>:<hash>". The plain password is shown once and never stored. */
export const hashChargerPassword = hashPassword;
export const checkChargerPassword = checkPassword;
