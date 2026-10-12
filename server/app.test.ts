import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler, type StripeLike } from "./app.js";
import { realStripe } from "./stripe.js";
import { Store } from "./store.js";

const WEBHOOK_SECRET = "whsec_test_secret";
const stripeSdk = new Stripe("sk_test_dummy");

let server: Server;
let base: string;
let store: Store;
let mails: { to: string; link: string; code: string }[];
let checkoutArgs: Parameters<StripeLike["createCheckoutUrl"]>[0][];
let clock: number;

beforeEach(async () => {
  store = new Store(null);
  mails = [];
  checkoutArgs = [];
  clock = 1_000_000;
  const stripe: StripeLike = {
    ...realStripe("sk_test_dummy"), // real signature checking, no network
    async createCheckoutUrl(args) {
      checkoutArgs.push(args);
      return "https://checkout.stripe.test/session";
    },
  };
  const handler = createHandler({
    store,
    stripe,
    mailer: { async sendLogin(to, link, code) { mails.push({ to, link, code }); } },
    config: { appUrl: "https://app.test", stripePriceId: "price_123", stripeWebhookSecret: WEBHOOK_SECRET, trustProxy: false },
    now: () => clock,
  });
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function signIn(email = "sj@example.com") {
  await api("/api/auth/request", { body: { email } });
  const { code } = mails[mails.length - 1];
  const r = await api("/api/auth/verify", { body: { email, code } });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

function webhook(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = stripeSdk.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(base + "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": header, "Content-Type": "application/json" }, body: payload });
}

const paidEvent = (id: string, userId: string, extra: object = {}) => ({
  id,
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", payment_status: "paid", client_reference_id: userId, payment_intent: "pi_1", ...extra } },
});

describe("sign in", () => {
  it("emails a link and a code, and the code signs you in", async () => {
    const r = await api("/api/auth/request", { body: { email: "  SJ@Example.com " } });
    expect(r.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("sj@example.com");
    expect(mails[0].link).toMatch(/^https:\/\/app\.test\/#login=[\w-]{40,}$/);
    expect(mails[0].code).toMatch(/^\d{6}$/);

    const v = await api("/api/auth/verify", { body: { email: "sj@example.com", code: mails[0].code } });
    expect(v.status).toBe(200);
    expect(v.json.user).toEqual({ email: "sj@example.com", premium: false });
    const me = await api("/api/me", { token: v.json.token });
    expect(me.json).toEqual({ email: "sj@example.com", premium: false });
  });

  it("the link token signs you in once only", async () => {
    await api("/api/auth/request", { body: { email: "a@b.co" } });
    const token = mails[0].link.split("#login=")[1];
    expect((await api("/api/auth/verify", { body: { token } })).status).toBe(200);
    expect((await api("/api/auth/verify", { body: { token } })).status).toBe(400);
  });

  it("rejects wrong codes and locks after 5 tries", async () => {
    await api("/api/auth/request", { body: { email: "a@b.co" } });
    const good = mails[0].code;
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await api("/api/auth/verify", { body: { email: "a@b.co", code: bad } })).status).toBe(400);
    // even the right code no longer works
    expect((await api("/api/auth/verify", { body: { email: "a@b.co", code: good } })).status).toBe(400);
  });

  it("expires after 15 minutes", async () => {
    await api("/api/auth/request", { body: { email: "a@b.co" } });
    clock += 16 * 60 * 1000;
    expect((await api("/api/auth/verify", { body: { email: "a@b.co", code: mails[0].code } })).status).toBe(400);
  });

  it("a new request replaces the old code", async () => {
    await api("/api/auth/request", { body: { email: "a@b.co" } });
    await api("/api/auth/request", { body: { email: "a@b.co" } });
    const [first, second] = mails;
    if (first.code !== second.code) expect((await api("/api/auth/verify", { body: { email: "a@b.co", code: first.code } })).status).toBe(400);
    expect((await api("/api/auth/verify", { body: { email: "a@b.co", code: second.code } })).status).toBe(200);
  });

  it("validates emails and rate limits per email", async () => {
    expect((await api("/api/auth/request", { body: { email: "nope" } })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await api("/api/auth/request", { body: { email: "a@b.co" } })).status).toBe(200);
    expect((await api("/api/auth/request", { body: { email: "a@b.co" } })).status).toBe(429);
    clock += 61 * 60 * 1000;
    expect((await api("/api/auth/request", { body: { email: "a@b.co" } })).status).toBe(200);
  });

  it("same email always maps to the same account", async () => {
    const t1 = await signIn();
    const t2 = await signIn();
    expect(t1).not.toBe(t2);
    await webhook(paidEvent("evt_a", "x")); // unknown user: ignored
    expect((await api("/api/me", { token: t1 })).json.email).toBe("sj@example.com");
    expect(Object.keys((store as any).data.users)).toHaveLength(1);
  });

  it("logout ends the session; bad tokens get 401", async () => {
    const token = await signIn();
    expect((await api("/api/auth/logout", { method: "POST", token })).status).toBe(200);
    expect((await api("/api/me", { token })).status).toBe(401);
    expect((await api("/api/me")).status).toBe(401);
    expect((await api("/api/me", { token: "garbage" })).status).toBe(401);
  });
});

describe("premium", () => {
  it("needs sign in to start checkout, then returns the Stripe URL", async () => {
    expect((await api("/api/checkout", { method: "POST" })).status).toBe(401);
    const token = await signIn();
    const r = await api("/api/checkout", { method: "POST", token });
    expect(r.json.url).toBe("https://checkout.stripe.test/session");
    expect(checkoutArgs[0]).toMatchObject({ email: "sj@example.com", priceId: "price_123", successUrl: "https://app.test/?checkout=success" });
  });

  it("a signed paid webhook unlocks premium", async () => {
    const token = await signIn();
    const userId = checkoutArgsUser();
    expect((await webhook(paidEvent("evt_1", userId))).status).toBe(200);
    expect((await api("/api/me", { token })).json.premium).toBe(true);
    // buying again is not offered
    expect((await api("/api/checkout", { method: "POST", token })).json.alreadyPremium).toBe(true);
  });

  it("rejects a bad or missing signature and does not unlock", async () => {
    const token = await signIn();
    const userId = checkoutArgsUser();
    expect((await webhook(paidEvent("evt_2", userId), "whsec_wrong")).status).toBe(400);
    const none = await fetch(base + "/api/stripe/webhook", { method: "POST", body: JSON.stringify(paidEvent("evt_3", userId)) });
    expect(none.status).toBe(400);
    expect((await api("/api/me", { token })).json.premium).toBe(false);
  });

  it("does not unlock for an unpaid session; async success does", async () => {
    const token = await signIn();
    const userId = checkoutArgsUser();
    await webhook(paidEvent("evt_4", userId, { payment_status: "unpaid" }));
    expect((await api("/api/me", { token })).json.premium).toBe(false);
    await webhook({ ...paidEvent("evt_5", userId), type: "checkout.session.async_payment_succeeded" });
    expect((await api("/api/me", { token })).json.premium).toBe(true);
  });

  it("a full refund takes premium away; a partial one does not", async () => {
    const token = await signIn();
    const userId = checkoutArgsUser();
    await webhook(paidEvent("evt_6", userId));
    await webhook({ id: "evt_7", type: "charge.refunded", data: { object: { payment_intent: "pi_1", amount: 1000, amount_refunded: 300 } } });
    expect((await api("/api/me", { token })).json.premium).toBe(true);
    await webhook({ id: "evt_8", type: "charge.refunded", data: { object: { payment_intent: "pi_1", amount: 1000, amount_refunded: 1000 } } });
    expect((await api("/api/me", { token })).json.premium).toBe(false);
  });

  it("handles duplicate events once", async () => {
    const token = await signIn();
    const userId = checkoutArgsUser();
    await webhook(paidEvent("evt_9", userId));
    await webhook({ id: "evt_10", type: "charge.refunded", data: { object: { payment_intent: "pi_1", amount: 5, amount_refunded: 5 } } });
    await webhook(paidEvent("evt_9", userId)); // Stripe retry of an old event must not re-grant
    expect((await api("/api/me", { token })).json.premium).toBe(false);
  });
});

describe("misc", () => {
  it("404s unknown routes and rejects huge bodies", async () => {
    expect((await api("/api/nothing")).status).toBe(404);
    const big = await fetch(base + "/api/auth/request", { method: "POST", body: "x".repeat(20_000) });
    expect(big.status).toBe(413);
  });
});

function checkoutArgsUser(): string {
  return Object.values((store as any).data.users as Record<string, { id: string }>)[0].id;
}
