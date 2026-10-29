import { describe, it, expect } from "vitest";
import { fromDbSupporter, groupSupporters, searchSupporters, supporterStats, approvalEmail } from "./supporters.js";

const s = (o) => fromDbSupporter({ auth_user_id: o.id, full_name: o.name, phone: o.phone || "", email: o.email || `${o.id}@x.co`, status: o.status, email_confirmed: o.confirmed ?? true, created_at: o.created || "2026-09-20T10:00:00Z" });
const list = [
  s({ id: "a", name: "Thabo Nkosi", status: "pending", phone: "082 555 0142" }),
  s({ id: "b", name: "Not Confirmed", status: "pending", confirmed: false }),
  s({ id: "c", name: "Grace Mokoena", status: "approved", created: "2026-09-25T10:00:00Z" }),
  s({ id: "d", name: "Old Fan", status: "approved", created: "2026-05-01T10:00:00Z" }),
  s({ id: "e", name: "Declined Person", status: "declined" }),
];

describe("supporters", () => {
  it("groups by status, keeping unconfirmed emails apart", () => {
    const g = groupSupporters(list);
    expect(g.waiting.map((x) => x.id)).toEqual(["a"]);
    expect(g.unconfirmed.map((x) => x.id)).toEqual(["b"]);
    expect(g.approved.map((x) => x.id)).toEqual(["c", "d"]);
    expect(g.declined.map((x) => x.id)).toEqual(["e"]);
  });
  it("searches name, email and phone digits", () => {
    expect(searchSupporters(list, "grace").map((x) => x.id)).toEqual(["c"]);
    expect(searchSupporters(list, "0825550142").map((x) => x.id)).toEqual(["a"]);
    expect(searchSupporters(list, "555 01").map((x) => x.id)).toEqual(["a"]);
    expect(searchSupporters(list, "").length).toBe(5);
  });
  it("counts stats", () => {
    expect(supporterStats(list, new Date("2026-09-27T10:00:00Z"))).toEqual({ waiting: 1, approved: 2, joinedRecently: 1 });
  });
  it("builds a safe approval email", () => {
    const e = approvalEmail({ name: "<b>Thabo</b> Nkosi" }, "https://gfcplayers.co.za");
    expect(e.subject).toMatch(/supporter account is ready/);
    expect(e.html).toContain("&lt;b&gt;Thabo&lt;/b&gt;");
    expect(e.html).toContain('href="https://gfcplayers.co.za"');
  });
});
