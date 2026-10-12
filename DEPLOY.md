# Deploying Premium (phone-friendly)

Premium needs a small API next to the website. The website still lives in `/var/www/noise2sound`; the API runs on the droplet at `127.0.0.1:8787` and Caddy forwards `/api/*` to it.

## 1. Stripe (one time)
1. Create an account at stripe.com and stay in **Test mode** (toggle top right) at first.
2. Products → Add product: "Noise2sound Premium", **One-off** price (e.g. $9.99). Copy the **price ID** (`price_...`).
3. Developers → API keys: copy the **Secret key** (`sk_test_...`).
4. Developers → Webhooks → Add endpoint:
   - URL: `https://noise2sound.vbuds.app/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`
   - Copy the **Signing secret** (`whsec_...`).

## 2. Resend (sign-in emails)
1. Sign up at resend.com, add and verify your domain `vbuds.app` (it gives you DNS records to add).
2. Create an API key (`re_...`).

## 3. Droplet
```bash
cd ~/Noise2sound            # your clone
git pull
sudo cp .env.example /etc/noise2sound.env
sudo nano /etc/noise2sound.env      # paste the keys
sudo chmod 600 /etc/noise2sound.env
sudo cp deploy/noise2sound-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable noise2sound-api
```
Add the `/api/*` block from `deploy/Caddyfile.example` to your Caddyfile for noise2sound.vbuds.app (keep your existing site block, just add the `handle /api/*` part), then `sudo systemctl reload caddy`.

Then deploy (builds site and API, restarts the API):
```bash
bash deploy/deploy.sh
```

## 4. Try it
Open the app, tap **Sign in**, get the emailed code, tap **Unlock Premium**, and pay with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). Premium should turn on within a few seconds.

## 5. Going live
Switch Stripe out of Test mode, create the live price and live webhook, put the live `sk_live_...`, price and `whsec_...` in `/etc/noise2sound.env`, then `sudo systemctl restart noise2sound-api`.

## Notes
- Accounts live in `/var/lib/noise2sound/noise2sound.json`. Back it up (it is the only record of who paid, besides Stripe).
- Refunds and lost disputes in Stripe switch premium off automatically.
- Logs: `sudo journalctl -u noise2sound-api -f`
