import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type Stripe from "stripe";
import type { Mailer } from "./mailer.js";
import { SESSION_MAX_AGE_MS, type Store, type User } from "./store.js";

/** The little slice of Stripe we use, so tests can swap in a fake. */
export interface StripeLike {
  createCheckoutUrl(args: { userId: string; email: string; priceId: string; successUrl: string; cancelUrl: string }): Promise<string>;
  constructEvent(rawBody: Buffer, signature: string, secret: string): Stripe.Event;
}

export interface AppConfig {
  appUrl: string;
  stripePriceId: string;
  stripeWebhookSecret: string;
  /** Trust X-Forwarded-For (true when running behind Caddy/nginx). */
  trustProxy: boolean;
}

export interface Deps {
  store: Store;
  mailer: Mailer;
  stripe: StripeLike;
  config: AppConfig;
  now?: () => number;
}

const LOGIN_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newId = () => randomBytes(12).toString("hex");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(json);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Request too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, 10_000);
  if (raw.length === 0) return {};
  try {
    const v = JSON.parse(raw.toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "Invalid request.");
}

/** Allow `max` hits per `windowMs` per key, in memory. */
function makeLimiter(max: number, windowMs: number, now: () => number) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => x > t - windowMs)) hits.delete(k);
    return true;
  };
}

export function createHandler(deps: Deps) {
  const { store, mailer, stripe, config } = deps;
  const now = deps.now ?? Date.now;
  const loginPerEmail = makeLimiter(5, 60 * 60 * 1000, now);
  const loginPerIp = makeLimiter(20, 60 * 60 * 1000, now);
  const verifyPerIp = makeLimiter(30, 15 * 60 * 1000, now);
  const checkoutPerUser = makeLimiter(20, 60 * 60 * 1000, now);

  const clientIp = (req: IncomingMessage) => {
    if (config.trustProxy) {
      const xff = req.headers["x-forwarded-for"];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? "unknown";
  };

  const publicUser = (u: User) => ({ email: u.email, premium: u.premium });

  const authUser = (req: IncomingMessage): { user: User; hash: string } => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new HttpError(401, "Please sign in.");
    const hash = sha256(token);
    const session = store.getSession(hash);
    if (!session || session.createdAt + SESSION_MAX_AGE_MS < now()) throw new HttpError(401, "Please sign in again.");
    const user = store.findUserById(session.userId);
    if (!user) throw new HttpError(401, "Please sign in again.");
    return { user, hash };
  };

  const startSession = (user: User) => {
    const token = randomBytes(32).toString("base64url");
    store.addSession(sha256(token), user.id);
    return { token, user: publicUser(user) };
  };

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/api/health") return send(res, 200, { ok: true });

    // --- Stripe webhook: needs the exact raw bytes to check the signature ---
    if (method === "POST" && path === "/api/stripe/webhook") {
      const raw = await readBody(req, 1_000_000);
      const sig = req.headers["stripe-signature"];
      if (typeof sig !== "string") throw new HttpError(400, "Missing signature.");
      let event: Stripe.Event;
      try {
        event = stripe.constructEvent(raw, sig, config.stripeWebhookSecret);
      } catch {
        throw new HttpError(400, "Bad signature.");
      }
      handleStripeEvent(event);
      return send(res, 200, { received: true });
    }

    // --- Sign in ---
    if (method === "POST" && path === "/api/auth/request") {
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "That doesn't look like an email address.");
      if (!loginPerIp(clientIp(req)) || !loginPerEmail(email)) throw new HttpError(429, "Too many tries. Please wait a while and try again.");

      const token = randomBytes(32).toString("base64url");
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      store.setLogin({ email, tokenHash: sha256(token), codeHash: sha256(`${email}:${code}`), expires: now() + LOGIN_TTL_MS, attempts: 0 });
      // The token goes after the # so it never appears in server logs or referrers.
      await mailer.sendLogin(email, `${config.appUrl}/#login=${token}`, code);
      return send(res, 200, { ok: true });
    }

    if (method === "POST" && path === "/api/auth/verify") {
      if (!verifyPerIp(clientIp(req))) throw new HttpError(429, "Too many tries. Please wait a few minutes.");
      const body = await readJson(req);
      let email: string | undefined;

      if (typeof body.token === "string" && body.token) {
        const login = store.findLoginByTokenHash(sha256(body.token));
        if (!login || login.expires < now()) throw new HttpError(400, "That link has expired. Request a new one.");
        email = login.email;
      } else if (typeof body.email === "string" && typeof body.code === "string") {
        const e = body.email.trim().toLowerCase();
        const login = store.getLogin(e);
        if (!login || login.expires < now() || login.attempts >= MAX_CODE_ATTEMPTS) {
          throw new HttpError(400, "That code has expired. Request a new one.");
        }
        if (!safeEqual(login.codeHash, sha256(`${e}:${body.code.trim()}`))) {
          store.bumpLoginAttempts(e);
          throw new HttpError(400, "That code isn't right.");
        }
        email = e;
      } else {
        throw new HttpError(400, "Invalid request.");
      }

      store.deleteLogin(email); // single use
      const user = store.upsertUser(email, newId);
      return send(res, 200, startSession(user));
    }

    if (method === "POST" && path === "/api/auth/logout") {
      const { hash } = authUser(req);
      store.deleteSession(hash);
      return send(res, 200, { ok: true });
    }

    // --- Account ---
    if (method === "GET" && path === "/api/me") {
      const { user } = authUser(req);
      return send(res, 200, publicUser(user));
    }

    if (method === "POST" && path === "/api/checkout") {
      const { user } = authUser(req);
      if (user.premium) return send(res, 200, { alreadyPremium: true });
      if (!checkoutPerUser(user.id)) throw new HttpError(429, "Too many tries. Please wait a while.");
      const checkoutUrl = await stripe.createCheckoutUrl({
        userId: user.id,
        email: user.email,
        priceId: config.stripePriceId,
        successUrl: `${config.appUrl}/?checkout=success`,
        cancelUrl: `${config.appUrl}/?checkout=cancel`,
      });
      return send(res, 200, { url: checkoutUrl });
    }

    throw new HttpError(404, "Not found.");
  }

  function handleStripeEvent(event: Stripe.Event) {
    if (!store.markEvent(event.id)) return; // already handled (Stripe retries)

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status !== "paid") return; // e.g. bank debit still pending; the async event follows
      const userId = s.client_reference_id ?? s.metadata?.userId;
      const user = userId ? store.findUserById(userId) : undefined;
      if (!user) {
        console.error(`Paid checkout ${s.id} but no matching user (${userId}).`);
        return;
      }
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      store.updateUser(user.id, { premium: true, premiumSince: now(), paymentIntent: pi });
      return;
    }

    if (event.type === "charge.refunded") {
      const c = event.data.object as Stripe.Charge;
      const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
      const user = pi ? store.findUserByPaymentIntent(pi) : undefined;
      if (user && c.amount_refunded >= c.amount) store.updateUser(user.id, { premium: false });
      return;
    }

    if (event.type === "charge.dispute.created") {
      const d = event.data.object as Stripe.Dispute;
      const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id;
      const user = pi ? store.findUserByPaymentIntent(pi) : undefined;
      if (user) store.updateUser(user.id, { premium: false });
    }
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: "Something went wrong. Please try again." });
    }
  };
}
