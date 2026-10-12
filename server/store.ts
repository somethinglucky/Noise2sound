import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface User {
  id: string;
  email: string;
  createdAt: number;
  premium: boolean;
  premiumSince?: number;
  /** Stripe PaymentIntent id of the purchase, used to find the user again on a refund. */
  paymentIntent?: string;
}

export interface PendingLogin {
  email: string;
  tokenHash: string;
  codeHash: string;
  expires: number;
  attempts: number;
}

interface Data {
  users: Record<string, User>;
  /** email -> pending login (one at a time per email; a new request replaces the old one) */
  logins: Record<string, PendingLogin>;
  /** sha256(session token) -> session */
  sessions: Record<string, { userId: string; createdAt: number }>;
  /** Stripe event ids already handled, newest last. */
  events: string[];
}

const EMPTY = (): Data => ({ users: {}, logins: {}, sessions: {}, events: [] });

/**
 * A tiny JSON-file database. Fine for an MVP with one server process: every change is
 * written to a temp file and renamed over the real one, so a crash can't leave half a file.
 * Pass `null` as the path for an in-memory store (tests).
 */
export class Store {
  private data: Data;

  constructor(private path: string | null) {
    this.data = EMPTY();
    if (path && existsSync(path)) {
      this.data = { ...EMPTY(), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<Data>) };
    }
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  findUserByEmail(email: string): User | undefined {
    return Object.values(this.data.users).find((u) => u.email === email);
  }

  findUserById(id: string): User | undefined {
    return this.data.users[id];
  }

  findUserByPaymentIntent(pi: string): User | undefined {
    return Object.values(this.data.users).find((u) => u.paymentIntent === pi);
  }

  upsertUser(email: string, newId: () => string): User {
    let u = this.findUserByEmail(email);
    if (!u) {
      u = { id: newId(), email, createdAt: Date.now(), premium: false };
      this.data.users[u.id] = u;
      this.save();
    }
    return u;
  }

  updateUser(id: string, patch: Partial<User>) {
    const u = this.data.users[id];
    if (!u) return;
    Object.assign(u, patch);
    this.save();
  }

  setLogin(login: PendingLogin) {
    this.data.logins[login.email] = login;
    this.save();
  }

  getLogin(email: string): PendingLogin | undefined {
    return this.data.logins[email];
  }

  findLoginByTokenHash(hash: string): PendingLogin | undefined {
    return Object.values(this.data.logins).find((l) => l.tokenHash === hash);
  }

  bumpLoginAttempts(email: string) {
    const l = this.data.logins[email];
    if (l) {
      l.attempts += 1;
      this.save();
    }
  }

  deleteLogin(email: string) {
    delete this.data.logins[email];
    this.save();
  }

  addSession(hash: string, userId: string) {
    this.data.sessions[hash] = { userId, createdAt: Date.now() };
    this.save();
  }

  getSession(hash: string) {
    return this.data.sessions[hash];
  }

  deleteSession(hash: string) {
    delete this.data.sessions[hash];
    this.save();
  }

  /** Returns false if this Stripe event was already handled. */
  markEvent(id: string): boolean {
    if (this.data.events.includes(id)) return false;
    this.data.events.push(id);
    if (this.data.events.length > 1000) this.data.events.splice(0, this.data.events.length - 1000);
    this.save();
    return true;
  }

  /** Drop expired logins and old sessions. Called now and then. */
  prune(now = Date.now(), sessionMaxAgeMs = SESSION_MAX_AGE_MS) {
    for (const [k, l] of Object.entries(this.data.logins)) if (l.expires < now) delete this.data.logins[k];
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.createdAt + sessionMaxAgeMs < now) delete this.data.sessions[k];
    this.save();
  }
}

export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;
