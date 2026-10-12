import { useState } from "react";
import { useAccount } from "../account/AccountContext";
import { FREE_CLIP_SECONDS, PREMIUM_CLIP_SECONDS, formatLimit } from "../config";

export default function AccountSheet() {
  const acct = useAccount();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      const e = email.trim();
      await acct.requestLogin(e);
      setSentTo(e);
      setCode("");
    });

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Account" onClick={acct.closeAccount}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{acct.premium ? "Premium" : acct.signedIn ? "Account" : "Sign in"}</h2>
          <button className="btn-text" onClick={acct.closeAccount}>
            Close
          </button>
        </div>

        {acct.sheetReason && <p className="notice">{acct.sheetReason}</p>}

        {!acct.signedIn && !sentTo && (
          <>
            <p className="dim">
              Sign in with your email so Premium follows you to any device. No password, we email you a code.
            </p>
            <input
              className="text-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn-primary sheet-btn" disabled={busy || !email.includes("@")} onClick={() => void sendCode()}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </>
        )}

        {!acct.signedIn && sentTo && (
          <>
            <p className="dim">
              We emailed a 6-digit code to <strong>{sentTo}</strong>. It works for 15 minutes. Check spam if you don't see it.
            </p>
            <input
              className="text-input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button
              className="btn-primary sheet-btn"
              disabled={busy || code.length !== 6}
              onClick={() => void run(async () => acct.verifyCode(sentTo, code))}
            >
              {busy ? "Checking…" : "Sign in"}
            </button>
            <div className="sheet-row">
              <button className="btn-text" disabled={busy} onClick={() => void sendCode()}>
                Send a new code
              </button>
              <button
                className="btn-text"
                onClick={() => {
                  setSentTo(null);
                  setError(null);
                }}
              >
                Different email
              </button>
            </div>
          </>
        )}

        {acct.signedIn && (
          <>
            <p className="dim small">Signed in as {acct.email}</p>
            {acct.premium ? (
              <p>
                You have Premium. Clips can be up to {formatLimit(PREMIUM_CLIP_SECONDS)} long. Thank you for supporting Noise2sound!
              </p>
            ) : (
              <>
                <div className="fx-card on">
                  <h3>Unlock Premium</h3>
                  <p className="dim">
                    One payment, yours for good. No subscription. Removes the {FREE_CLIP_SECONDS} second limit so clips can be up to{" "}
                    {formatLimit(PREMIUM_CLIP_SECONDS)}.
                  </p>
                </div>
                <button className="btn-primary sheet-btn" disabled={busy} onClick={() => void run(acct.startCheckout)}>
                  {busy ? "Opening checkout…" : "Unlock Premium"}
                </button>
                <p className="dim small">Checkout opens on Stripe's secure page and brings you back here. It leaves this page, so export anything you're working on first.</p>
              </>
            )}
            <button className="btn-text sheet-signout" disabled={busy} onClick={() => void run(acct.signOut).then(acct.closeAccount)}>
              Sign out
            </button>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
