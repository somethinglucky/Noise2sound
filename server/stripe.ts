import Stripe from "stripe";
import type { StripeLike } from "./app.js";

export function realStripe(secretKey: string): StripeLike {
  const stripe = new Stripe(secretKey);
  return {
    async createCheckoutUrl({ userId, email, priceId, successUrl, cancelUrl }) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: userId,
        customer_email: email,
        metadata: { userId },
        payment_intent_data: { metadata: { userId } },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL.");
      return session.url;
    },
    constructEvent(rawBody, signature, secret) {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    },
  };
}
