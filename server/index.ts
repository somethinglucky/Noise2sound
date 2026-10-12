import { createServer } from "node:http";
import { join } from "node:path";
import { createHandler } from "./app.js";
import { consoleMailer, resendMailer } from "./mailer.js";
import { realStripe } from "./stripe.js";
import { Store } from "./store.js";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See DEPLOY.md.`);
    process.exit(1);
  }
  return v;
}

const appUrl = need("APP_URL").replace(/\/+$/, "");
const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? "./data";
const resendKey = process.env.RESEND_API_KEY;

if (!resendKey) console.warn("RESEND_API_KEY not set: sign-in emails will only be printed in this log (dev mode).");

const store = new Store(join(dataDir, "noise2sound.json"));
store.prune();
setInterval(() => store.prune(), 6 * 60 * 60 * 1000).unref();

const handler = createHandler({
  store,
  mailer: resendKey ? resendMailer(resendKey, need("MAIL_FROM")) : consoleMailer(),
  stripe: realStripe(need("STRIPE_SECRET_KEY")),
  config: {
    appUrl,
    stripePriceId: need("STRIPE_PRICE_ID"),
    stripeWebhookSecret: need("STRIPE_WEBHOOK_SECRET"),
    trustProxy: process.env.TRUST_PROXY !== "false",
  },
});

// Listen on localhost only; Caddy sits in front and talks to us there.
createServer(handler).listen(port, "127.0.0.1", () => console.log(`Noise2sound API on http://127.0.0.1:${port}`));
