# Switching the player app from PayFast to Yoco

## What changed
- Removed: `create-payfast-payment`, `payfast-itn`, `_shared/payfast.js`
- Added: `create-yoco-checkout`, `yoco-webhook`, `_shared/yoco.js`
- `home.html`'s "Pay now" button now calls `create-yoco-checkout` and redirects
  the browser to Yoco's hosted checkout, instead of building a hidden form
  POST to PayFast.
- `payments` table (management app DB) has a new nullable `reference` column
  with a unique index, so a duplicate webhook delivery can't double-count a
  payment. Manually-captured EFT payments are unaffected (no reference).

## 1. Get your API keys
In the Yoco Business Portal: **Sales/Selling Online → Payment Gateway**.
You'll see both Test and Live keys:
- Secret key: `sk_test_...` / `sk_live_...` — server-side only, never expose it
  to the browser.
- Public key: `pk_test_...` / `pk_live_...` — not actually needed for this
  integration, since the whole flow is server-created hosted checkout, not
  Yoco's inline/client-side SDK.

Start with the **test** secret key until you've done a full round-trip test
payment.

## 2. Set Supabase secrets (player app project)
```
supabase secrets set YOCO_SECRET_KEY=sk_test_xxxxxxxxxxxx
supabase secrets set YOCO_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx   # from step 3
```
`APP_URL` should already be set from the PayFast setup (same variable, reused).

## 3. Register the webhook
In the Yoco Business Portal: **Selling Online → Payment Gateway → Webhooks**
(or via Yoco's Webhooks API directly). Add:
```
https://<your-supabase-project-ref>.supabase.co/functions/v1/yoco-webhook
```
Select at least the `payment.succeeded` event. Yoco will show you the
webhook's signing secret (`whsec_...`) at this point — that's the
`YOCO_WEBHOOK_SECRET` from step 2.

## 4. Run the database migration
`add-payments-reference.sql` — run once in the Supabase SQL editor (management
app project, since both apps share one database):
```sql
alter table payments add column if not exists reference text;
create unique index if not exists payments_reference_idx
  on payments(reference) where reference is not null;
```

## 5. Deploy
```
supabase functions deploy create-yoco-checkout
supabase functions deploy yoco-webhook
supabase functions delete create-payfast-payment   # optional cleanup
supabase functions delete payfast-itn               # optional cleanup
```
Redeploy `home.html` with the rest of the player app's static files.

## 6. Test before going live
1. Keep `YOCO_SECRET_KEY` set to the **test** key.
2. Trigger a full "Pay now" round trip from the player app. Yoco's test
   card: `4111 1111 1111 1111`, any future expiry, any 3-digit CVC.
3. Check the `yoco-webhook` function logs (Supabase Dashboard → Edge
   Functions → yoco-webhook → Logs) for `signature verification failed` —
   if you see it, double check `YOCO_WEBHOOK_SECRET` matches exactly what
   Yoco showed you (including no accidental whitespace).
4. Confirm the test payment inserts a row into `payments` with
   `method = 'Yoco'` and a `reference` starting with `p_`, and that the
   guardian's balance in the app reflects it after a refresh.
5. Only then switch `YOCO_SECRET_KEY` to the live key, and re-register the
   webhook against your live account if Test/Live webhooks are separate in
   your Yoco account (confirm in the Business Portal).

## Notes
- Yoco's Checkout API won't accept payments under R2 — `create-yoco-checkout`
  already checks for this and returns a friendly error rather than letting
  Yoco reject it.
- There's no recurring/subscription billing product here — same as the
  PayFast setup, this creates one Checkout per outstanding balance, on
  demand, each time "Pay now" is pressed.
