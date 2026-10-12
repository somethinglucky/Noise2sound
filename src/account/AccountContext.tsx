import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clipLimit } from "../config";
import AccountSheet from "../components/AccountSheet";
import { api, ApiError, type AccountInfo } from "./api";

interface Stored {
  token: string;
  email: string;
  premium: boolean;
}

const KEY = "n2s.account";

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.token === "string" && typeof v.email === "string") return { token: v.token, email: v.email, premium: v.premium === true };
  } catch {
    /* storage unavailable or corrupt */
  }
  return null;
}

function save(s: Stored | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export interface Account {
  signedIn: boolean;
  email: string | null;
  premium: boolean;
  /** Longest clip, in seconds, that can be recorded, loaded or built. */
  clipSeconds: number;
  /** A one-off message to show (e.g. "Premium unlocked"), cleared after it is read. */
  notice: string | null;
  clearNotice: () => void;
  openAccount: (reason?: string) => void;
  closeAccount: () => void;
  requestLogin: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  startCheckout: () => Promise<void>;
  signOut: () => Promise<void>;
  sheetOpen: boolean;
  sheetReason: string | null;
}

const Ctx = createContext<Account | null>(null);

export function useAccount(): Account {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount must be used inside AccountProvider");
  return v;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Stored | null>(load);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetReason, setSheetReason] = useState<string | null>(null);
  const alive = useRef(true);
  const tokenRef = useRef(stored?.token ?? null);
  tokenRef.current = stored?.token ?? null;

  const apply = useCallback((token: string, user: AccountInfo) => {
    const next = { token, email: user.email, premium: user.premium };
    save(next);
    setStored(next);
  }, []);

  const clear = useCallback(() => {
    save(null);
    setStored(null);
  }, []);

  /** Ask the server who we are. Keeps the cached copy if we're just offline. */
  const refresh = useCallback(async (): Promise<AccountInfo | null> => {
    const token = tokenRef.current;
    if (!token) return null;
    try {
      const user = await api.me(token);
      if (alive.current) apply(token, user);
      return user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && alive.current) clear();
      return null;
    }
  }, [apply, clear]);

  /** If the address has #login=TOKEN (from the emailed link), sign in with it. */
  const signInFromHash = useCallback(async (): Promise<boolean> => {
    const m = /^#login=([\w-]+)$/.exec(window.location.hash);
    if (!m) return false;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    try {
      const r = await api.verifyToken(m[1]);
      if (!alive.current) return true;
      apply(r.token, r.user);
      setNotice(r.user.premium ? "Signed in. Premium is on." : "Signed in.");
      setSheetOpen(false);
    } catch (e) {
      if (alive.current) setNotice(e instanceof Error ? e.message : "Couldn't sign in.");
    }
    return true;
  }, [apply]);

  // The link can also open while the app is already showing (only the # changes).
  useEffect(() => {
    const onHash = () => void signInFromHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [signInFromHash]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;

    const run = async () => {
      const query = new URLSearchParams(window.location.search);

      // Came back from the emailed link.
      if (await signInFromHash()) return;

      // Came back from Stripe.
      const checkout = query.get("checkout");
      if (checkout) {
        history.replaceState(null, "", window.location.pathname + window.location.hash);
        if (checkout === "cancel") {
          setNotice("Checkout cancelled. You haven't been charged.");
        } else if (tokenRef.current) {
          setNotice("Thanks! Confirming your payment…");
          // The payment is confirmed by Stripe calling our server, which can take a few seconds.
          for (let i = 0; i < 15 && !cancelled; i++) {
            const u = await refresh();
            if (u?.premium) {
              setNotice("Premium unlocked. Thank you!");
              return;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          if (!cancelled) setNotice("Payment received but not confirmed yet. Reopen the app in a minute; if it still isn't unlocked, sign out and back in.");
        } else {
          setNotice("Thanks! Sign in with the same email to use Premium.");
        }
        return;
      }

      await refresh();
    };
    void run();
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [refresh, signInFromHash]);

  const premium = stored?.premium === true;

  const value = useMemo<Account>(
    () => ({
      signedIn: !!stored,
      email: stored?.email ?? null,
      premium,
      clipSeconds: clipLimit(premium),
      notice,
      clearNotice: () => setNotice(null),
      sheetOpen,
      sheetReason,
      openAccount: (reason) => {
        setSheetReason(reason ?? null);
        setSheetOpen(true);
      },
      closeAccount: () => setSheetOpen(false),
      requestLogin: async (email) => {
        await api.requestLogin(email);
      },
      verifyCode: async (email, code) => {
        const r = await api.verifyCode(email, code);
        apply(r.token, r.user);
      },
      startCheckout: async () => {
        const token = tokenRef.current;
        if (!token) throw new ApiError(401, "Please sign in first.");
        const r = await api.checkout(token);
        if (r.alreadyPremium) {
          await refresh();
          return;
        }
        if (!r.url) throw new ApiError(500, "Couldn't start checkout.");
        window.location.href = r.url;
      },
      signOut: async () => {
        const token = tokenRef.current;
        clear();
        if (token) await api.logout(token).catch(() => undefined);
      },
    }),
    [stored, premium, notice, sheetOpen, sheetReason, apply, clear, refresh],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {sheetOpen && <AccountSheet />}
    </Ctx.Provider>
  );
}
