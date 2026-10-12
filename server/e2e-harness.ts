// Local test harness: real handler, fake mail (writes the code to a file) and fake Stripe checkout.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import Stripe from "stripe";
import { createHandler } from "./app.js";
import { realStripe } from "./stripe.js";
import { Store } from "./store.js";

const out = process.env.OUT_DIR!;
const secret = "whsec_e2e";
const sdk = new Stripe("sk_test_dummy");
const store = new Store(null);
const handler = createHandler({
  store,
  mailer: { async sendLogin(to, link, code) { writeFileSync(`${out}/mail.json`, JSON.stringify({ to, link, code })); } },
  stripe: {
    ...realStripe("sk_test_dummy"),
    async createCheckoutUrl(a) {
      // Pretend the user paid: deliver the signed webhook, then send them back to the app.
      const payload = JSON.stringify({ id: "evt_" + Date.now(), type: "checkout.session.completed", data: { object: { id: "cs_x", payment_status: "paid", client_reference_id: a.userId, payment_intent: "pi_x" } } });
      setTimeout(() => void fetch("http://127.0.0.1:8787/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sdk.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload }), 1500);
      return a.successUrl;
    },
  },
  config: { appUrl: "http://localhost:4173", stripePriceId: "price_x", stripeWebhookSecret: secret, trustProxy: false },
});
createServer(handler).listen(8787, "127.0.0.1", () => console.log("harness up"));
