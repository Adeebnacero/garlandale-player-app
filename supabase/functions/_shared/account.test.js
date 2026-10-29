// account.test.js - run with: deno test supabase/functions/_shared/
import { parseSupporterUpdate, supporterNoticeFilter } from "./account.js";
function assertEquals(a, e, m) { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); }

Deno.test("supporter profile updates are checked", () => {
  assertEquals(parseSupporterUpdate({ full_name: " Thabo Nkosi ", phone: "082 555 0142", follows: ["Seniors", "U13", "U13"] }),
    { ok: true, row: { full_name: "Thabo Nkosi", phone: "082 555 0142", follows: ["Seniors", "U13"] } }, "good");
  assertEquals(parseSupporterUpdate({ full_name: "T" }).ok, false, "short name");
  assertEquals(parseSupporterUpdate({ full_name: "Thabo", phone: "12" }).ok, false, "bad phone");
  assertEquals(parseSupporterUpdate({ full_name: "Thabo", phone: "" }).ok, true, "phone optional");
  assertEquals(parseSupporterUpdate({ full_name: "Thabo", follows: ["<script>"] }).ok, false, "bad team");
});

Deno.test("supporters never see birthday notices, and only notices marked for them", () => {
  assertEquals(supporterNoticeFilter({ show_to_supporters: true, category: "announcement" }), true, "marked");
  assertEquals(supporterNoticeFilter({ show_to_supporters: false, category: "announcement" }), false, "not marked");
  assertEquals(supporterNoticeFilter({ show_to_supporters: true, category: "birthday" }), false, "birthday");
});
