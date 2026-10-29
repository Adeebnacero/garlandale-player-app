import { digitsOnly } from "./format.js";
import { fmtMoney } from "./format.js";

export function waLink(phone, text) {
  const p = digitsOnly(phone);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

export function smsLink(phone, text) {
  return `sms:${phone || ""}?body=${encodeURIComponent(text)}`;
}

/**
 * Fills a message template's placeholders from an "enriched" player object
 * (one that already has .balance and .ageGroup computed by the caller -
 * see App.jsx's `enriched` useMemo). Deliberately uses those pre-computed
 * values rather than recalculating them here, since recalculating balance
 * without the tiers array was a real bug that silently produced a wrong
 * (meaningless) figure in outgoing WhatsApp/SMS messages.
 */
export function fillTemplate(tpl, player) {
  return tpl
    .replaceAll("{first_name}", (player.name || "").split(" ")[0] || "Player")
    .replaceAll("{name}", player.name || "")
    .replaceAll("{age_group}", player.ageGroup || "")
    .replaceAll("{balance}", fmtMoney(player.balance))
    .replaceAll("{club}", "Garlandale FC");
}

export const TEMPLATES = [
  {
    id: "payment_reminder",
    label: "Payment reminder",
    text: "Hi {first_name}, this is Garlandale FC. Our records show an outstanding subscription balance of {balance} for {age_group}. Please settle this at your earliest convenience. Thank you!",
  },
  {
    id: "welcome",
    label: "Welcome message",
    text: "Welcome to Garlandale FC, {first_name}! We're excited to have you in {age_group}. Training details will follow shortly.",
  },
  {
    id: "compliance",
    label: "Compliance reminder",
    text: "Hi {first_name}, we're missing some outstanding paperwork for your registration at Garlandale FC ({age_group}). Please reach out to the club office so we can get this sorted.",
  },
  {
    id: "training",
    label: "Training update",
    text: "Hi {first_name}, a quick note from Garlandale FC re: {age_group} training this week — please check the club noticeboard for the latest schedule.",
  },
  {
    id: "custom",
    label: "Blank / custom",
    text: "",
  },
];
