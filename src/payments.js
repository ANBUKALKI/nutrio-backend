import { HttpError } from "./errors.js";

/**
 * Payment seam. This DEMO provider validates the card shape and "charges"
 * nothing; only the last 4 digits are ever kept. To take real money, replace
 * `charge` with Stripe/Razorpay (create the charge/subscription server-side,
 * confirm via webhook) and never accept raw card numbers on this API.
 */
export async function charge({ amount, card }) {
  const number = String(card?.number ?? "").replace(/\s/g, "");
  if (!/^\d{16}$/.test(number)) throw new HttpError(400, "Enter a valid 16-digit card number");
  const m = /^(\d{2})\/(\d{2})$/.exec(String(card?.expiry ?? ""));
  if (!m || +m[1] < 1 || +m[1] > 12) throw new HttpError(400, "Expiry must be MM/YY");
  const now = new Date();
  const expired = 2000 + +m[2] < now.getFullYear() || (2000 + +m[2] === now.getFullYear() && +m[1] < now.getMonth() + 1);
  if (expired) throw new HttpError(400, "This card has expired");
  if (!/^\d{3,4}$/.test(String(card?.cvc ?? ""))) throw new HttpError(400, "Enter a valid CVC");
  return { ok: true, amount, last4: number.slice(-4) };
}
