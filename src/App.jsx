import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase, initialUrlHash } from "./supabaseClient";
import html2canvas from "html2canvas";
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import BADGE_SRC from "./assets/badge.png";
import {
  fromDbPlayer,
  toDbPlayer,
  fromDbTier,
  toDbTier,
  fromDbMatch,
  toDbMatch,
  fromDbItem,
  toDbItem,
  fromDbAsset,
  toDbAsset,
  fromDbFinanceEntry,
  toDbFinanceEntry,
  fromDbReminderBatch,
  fromDbAuditLog,
  fromDbLeagueSource,
  toDbLeagueSource,
  fromDbLeagueStanding,
  fromDbFixture,
  toDbFixture,
  fromDbRefereeAppointment,
  fromDbNotice,
  toDbNotice,
} from "./lib/dbMappers.js";
import { T, GLOBAL_CSS, STATUS_COLOR } from "./theme.js";
import { sortAgeGroups, computeAgeGroup, playerFinance, complianceStatus, complianceReason } from "./lib/billing.js";
import { aggregatePlayerStats } from "./lib/playerStats.js";
import { todayISO, fmtMoney, fmtDate, digitsOnly } from "./lib/format.js";
import { waLink, smsLink, fillTemplate, TEMPLATES } from "./lib/messaging.js";
import { extractFunctionErrorMessage } from "./lib/errors.js";
import { generateStatementPDF } from "./lib/statementPdf.js";
import { sendStatementEmail } from "./lib/email.js";
import { Badge, InactiveToggle } from "./components/shared.jsx";
import { DashboardView } from "./components/Dashboard.jsx";
import { SquadView, PlayerModal } from "./components/Squad.jsx";
import { SubscriptionsView, LedgerModal, TierManagerModal, TierModal } from "./components/Subscriptions.jsx";
import { MessagesView } from "./components/Messages.jsx";
import { MatchdayView, MatchModal } from "./components/Matchday.jsx";
import { KitView, ItemModal } from "./components/Kit.jsx";
import { AssetsView, AssetModal } from "./components/Assets.jsx";
import { FinanceView, FinanceEntryModal } from "./components/Finance.jsx";
import { BackupsView } from "./components/Backups.jsx";
import { FixturesPostView } from "./components/FixturesPost.jsx";
import { FixturesView } from "./components/Fixtures.jsx";
import { CalendarView } from "./components/Calendar.jsx";
import { SettingsView, LeagueSourceModal } from "./components/Settings.jsx";
import { UsersView } from "./components/Users.jsx";
import { RefereePayView } from "./components/RefereePay.jsx";
import { StoreView } from "./components/Store.jsx";
import { SupportersView } from "./components/Supporters.jsx";
import { LoginView, AcceptInviteView, NoAccessView } from "./components/Auth.jsx";

/* ---------- HELPERS ---------- */

/* ---------- MAIN APP ---------- */

const CLUB_NAME = "Garlandale FC";

const CLUB_OPS_NAV = [
  { id: "dashboard", label: "Dashboard", icon: "◆", roles: ["admin", "treasurer"] },
  { id: "subscriptions", label: "Subscriptions", icon: "$", roles: ["admin", "treasurer"] },
  { id: "finance", label: "Finance", icon: "🏦", roles: ["admin", "treasurer"] },
  { id: "assets", label: "Club Assets", icon: "📦", roles: ["admin"] },
  { id: "messages", label: "Messages", icon: "✉", roles: ["admin", "treasurer", "coach"] },
  { id: "squad", label: "Squad", icon: "▤", roles: ["admin", "coach"] },
  { id: "matchday", label: "Matchday", icon: "⚽", roles: ["admin", "coach"] },
  { id: "fixtures", label: "Fixtures", icon: "📋", roles: ["admin", "treasurer", "coach", "referee"] },
  { id: "calendar", label: "Calendar", icon: "📅", roles: ["admin", "treasurer", "coach", "referee"] },
  { id: "kit", label: "Kit", icon: "▦", roles: ["admin", "coach"] },
  { id: "store", label: "Store", icon: "🛍", roles: ["admin", "treasurer"] },
];

const ADMIN_NAV = [
  { id: "fixtures-post", label: "Fixtures Post", icon: "🖼", roles: ["admin", "treasurer"] },
  { id: "referee-pay", label: "Referee Pay", icon: "🟨", roles: ["admin", "treasurer"] },
  { id: "backups", label: "Backups", icon: "⟳", roles: ["admin"] },
  { id: "settings", label: "Settings", icon: "⚙", roles: ["admin", "treasurer"] },
  { id: "users", label: "Users", icon: "👤", roles: ["admin"] },
  { id: "supporters", label: "Supporters", icon: "📣", roles: ["admin", "treasurer"] },
];

// A Chairman has exactly the same access as an Admin everywhere in this
// app (and the database treats them the same - see
// migrations/2026-09-chairman-and-home-banners.sql). Every access decision
// below uses `role`, which is "admin" for a Chairman; `accountRole` is only
// used to show the account's real role.
function accessRoleFor(accountRole) {
  return accountRole === "chairman" ? "admin" : accountRole;
}

function MainApp({ role: accountRole, staffId, onLogout }) {
  const role = accessRoleFor(accountRole);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [tab, setTab] = useState(role === "coach" ? "squad" : role === "referee" ? "fixtures" : "dashboard");
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [ageFilter, setAgeFilter] = useState("All");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [editingPlayer, setEditingPlayer] = useState(null); // player object or "new" or null
  const [ledgerPlayerId, setLedgerPlayerId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [customText, setCustomText] = useState("");

  const [matches, setMatches] = useState([]);
  const [matchSquads, setMatchSquads] = useState({}); // matchId -> array of squad rows (with player joined)
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [editingMatch, setEditingMatch] = useState(null); // match object or "new" or null

  const [inventory, setInventory] = useState([]);
  const [issuedItems, setIssuedItems] = useState([]);
  const [editingItem, setEditingItem] = useState(null); // inventory item or "new" or null

  const [assets, setAssets] = useState([]);
  const [editingAsset, setEditingAsset] = useState(null); // club asset or "new" or null

  const [financeEntries, setFinanceEntries] = useState([]);
  const [editingFinanceEntry, setEditingFinanceEntry] = useState(null); // entry or "new" or null

  const [pendingReminderBatch, setPendingReminderBatch] = useState(null);

  const [auditLog, setAuditLog] = useState([]);
  const [allSquadRows, setAllSquadRows] = useState([]);

  const [leagueSources, setLeagueSources] = useState([]);
  const [leagueStandings, setLeagueStandings] = useState([]);
  const [editingLeagueSource, setEditingLeagueSource] = useState(null); // source or "new" or null

  const [tiers, setTiers] = useState([]);
  const [editingTier, setEditingTier] = useState(null); // tier object or "new" or null
  const [managingTiers, setManagingTiers] = useState(false);

  const [backupsList, setBackupsList] = useState([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");

  const [clubSettings, setClubSettings] = useState({
    senderEmail: "", senderDisplayName: "Garlandale FC", replyToEmail: "", bankDetails: "", invoiceFooterNote: "", defaultRefereeFee: 0,
  });
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");

  const [divisionLabels, setDivisionLabels] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [refereeAppointments, setRefereeAppointments] = useState([]);
  const [notices, setNotices] = useState([]);
  const [editingNotice, setEditingNotice] = useState(null); // notice or "new" or null
  const [staffTeams, setStaffTeams] = useState([]);

  const [staffList, setStaffList] = useState([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [usersMessage, setUsersMessage] = useState("");

  const loadTiers = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("tiers").select("*").order("monthly_fee", { ascending: false });
      if (error) throw error;
      setTiers((rows || []).map(fromDbTier));
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load subscription tiers.");
    }
  }, []);

  const loadClubSettings = useCallback(async () => {
    try {
      // maybeSingle (not single) - Referees don't have club_settings select
      // permission at all (they shouldn't see banking details), so this
      // legitimately comes back with zero rows for that role. single()
      // would treat that as an error and throw a full-screen "Try again"
      // for a role that's supposed to only ever see Fixtures; maybeSingle()
      // just leaves clubSettings at its (safe, blank) default instead.
      const { data: row, error } = await supabase.from("club_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      if (row) {
        setClubSettings({
          senderEmail: row.sender_email || "",
          senderDisplayName: row.sender_display_name || "Garlandale FC",
          replyToEmail: row.reply_to_email || "",
          bankDetails: row.bank_details || "",
          invoiceFooterNote: row.invoice_footer_note || "",
          defaultRefereeFee: row.default_referee_fee ?? 0,
        });
      }
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load club settings.");
    }
  }, []);

  async function saveClubSettings(form) {
    setSaveError("");
    try {
      const { error } = await supabase
        .from("club_settings")
        .update({
          sender_email: form.senderEmail || "",
          sender_display_name: form.senderDisplayName || "Garlandale FC",
          reply_to_email: form.replyToEmail || "",
          bank_details: form.bankDetails || "",
          invoice_footer_note: form.invoiceFooterNote || "",
          default_referee_fee: Number(form.defaultRefereeFee) || 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
      if (error) throw error;
      setClubSettings(form);
      return null;
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
      return e.message || "Could not save settings.";
    }
  }

  const loadDivisionLabels = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("division_labels").select("*").order("division_key");
      if (error) throw error;
      setDivisionLabels((rows || []).map((r) => ({ id: r.id, divisionKey: r.division_key, teamLabel: r.team_label, squadAgeGroup: r.squad_age_group || "" })));
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load division labels.");
    }
  }, []);

  async function saveDivisionLabel(divisionKey, teamLabel, squadAgeGroup) {
    try {
      const { error } = await supabase
        .from("division_labels")
        .upsert({ division_key: divisionKey, team_label: teamLabel, squad_age_group: squadAgeGroup || "" }, { onConflict: "division_key" });
      if (error) throw error;
      await loadDivisionLabels();
      return null;
    } catch (e) {
      setSaveError(e.message || "Could not save that division label.");
      return e.message;
    }
  }

  const loadFixtures = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("fixtures").select("*").order("match_date");
      if (error) throw error;
      setFixtures((rows || []).map(fromDbFixture));
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load fixtures.");
    }
  }, []);

  // Upserts every imported row against the (opponent, match_date,
  // division_key) unique constraint - re-importing an overlapping date
  // range updates existing rows (in case a time/venue genuinely changed)
  // rather than creating duplicates.
  async function importFixtures(rows) {
    if (!rows || rows.length === 0) return { success: true };
    try {
      const payload = rows.map((f) => ({ ...toDbFixture(f), updated_at: new Date().toISOString() }));
      const { error } = await supabase
        .from("fixtures")
        .upsert(payload, { onConflict: "opponent,match_date,division_key" });
      if (error) throw error;
      await loadFixtures();
      return { success: true };
    } catch (e) {
      return { error: e.message || "Could not import those fixtures." };
    }
  }

  // Creates a skeleton Matchday entry for each selected fixture that
  // doesn't already have one (opponent/date/time/venue/home-away/age-group
  // only - referee, coach, captain, comments, squad selections all stay
  // blank, exactly like starting a match manually). For a fixture that
  // already has a linked entry (matches.fixture_id), only those same basic
  // fields are refreshed - nothing else on the existing entry is touched.
  async function syncFixturesToMatchday(fixtureIds) {
    setSaveError("");
    try {
      const selected = fixtures.filter((f) => fixtureIds.includes(f.id));
      let created = 0;
      let updated = 0;
      for (const f of selected) {
        const existing = matches.find((m) => m.fixtureId === f.id);
        const basicFields = {
          opponent: f.opponent,
          match_date: f.matchDate,
          kickoff_time: f.kickoffTime || null,
          venue: f.venue || "",
          home_away: f.homeAway || "H",
          age_group: f.squadAgeGroup || "",
          division: f.divisionKey || "",
        };
        if (existing) {
          // A location is only copied onto an existing Matchday entry if
          // that entry doesn't have its own yet, so a location a coach set
          // directly on the Matchday entry is never overwritten.
          const locationFields = {};
          if (f.locationLink && !existing.locationLink) locationFields.location_link = f.locationLink;
          if (f.locationEmbed && !existing.locationEmbed) locationFields.location_embed = f.locationEmbed;
          const { error } = await supabase.from("matches").update({ ...basicFields, ...locationFields }).eq("id", existing.id);
          if (error) throw error;
          updated++;
        } else {
          const { error } = await supabase.from("matches").insert({
            ...basicFields,
            location_link: f.locationLink || null,
            location_embed: f.locationEmbed || null,
            fixture_id: f.id,
          });
          if (error) throw error;
          created++;
        }
      }
      await loadMatches();
      return { success: true, created, updated };
    } catch (e) {
      return { error: e.message || "Could not sync those fixtures to Matchday." };
    }
  }

  // Handles both a brand new manual fixture (no id yet) and editing an
  // existing one (imported or manual). Editing deliberately leaves
  // team_label and division_key untouched - team_label may be a nicer
  // poster-friendly label than the squad age group (e.g. "Under 12 'A'"
  // vs "U12") for an imported fixture, and division_key is what keeps
  // re-importing the spreadsheet matching up correctly; neither should be
  // silently overwritten just because someone fixed the kickoff time.
  async function saveFixture(form) {
    setSaveError("");
    try {
      if (form.id) {
        const { error } = await supabase
          .from("fixtures")
          .update({
            squad_age_group: form.squadAgeGroup || "",
            opponent: form.opponent,
            match_date: form.matchDate,
            kickoff_time: form.kickoffTime || null,
            venue: form.venue || "",
            home_away: form.homeAway || "H",
            referee_id: form.refereeId || null,
            location_link: form.locationLink || null,
            location_embed: form.locationEmbed || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", form.id);
        if (error) throw error;
      } else {
        // A brand new manual fixture has no imported division to key off,
        // so it gets a synthetic one - "manual:<age group>" - unique enough
        // to avoid colliding with any real spreadsheet division, while
        // still keeping the (opponent, match_date, division_key)
        // uniqueness constraint meaningful (two different age groups
        // playing the same opponent on the same day remain distinct rows).
        const divisionKey = `manual:${form.squadAgeGroup || "unspecified"}`;
        const { error } = await supabase.from("fixtures").insert({
          division_key: divisionKey,
          team_label: form.squadAgeGroup || "",
          squad_age_group: form.squadAgeGroup || "",
          opponent: form.opponent,
          match_date: form.matchDate,
          kickoff_time: form.kickoffTime || null,
          venue: form.venue || "",
          home_away: form.homeAway || "H",
          referee_id: form.refereeId || null,
          location_link: form.locationLink || null,
          location_embed: form.locationEmbed || null,
        });
        if (error) throw error;
      }
      await loadFixtures();
      await loadRefereeAppointments();
      return { success: true };
    } catch (e) {
      return { error: e.message || "Could not save that fixture." };
    }
  }

  async function deleteFixture(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("fixtures").delete().eq("id", id);
      if (error) throw error;
      await loadFixtures();
      return { success: true };
    } catch (e) {
      return { error: e.message || "Could not delete that fixture." };
    }
  }

  // referee_appointments is the payment log - a row here is created/synced
  // automatically (by a database trigger, see schema.sql) whenever a
  // fixture's referee_id is set or changed, so the client only ever reads
  // it and edits the fee/paid fields - it never inserts or deletes rows
  // itself.
  const loadRefereeAppointments = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("referee_appointments").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setRefereeAppointments((rows || []).map(fromDbRefereeAppointment));
    } catch (e) {
      // Silent for roles without access (Coach/Referee) - same reasoning
      // as loadStaffList: an RLS-denied read here is expected and fine,
      // this tab is hidden from those roles anyway.
    }
  }, []);

  async function updateRefereeAppointment(id, updates) {
    setSaveError("");
    try {
      const payload = {};
      if (updates.feeAmount !== undefined) payload.fee_amount = Number(updates.feeAmount) || 0;
      if (updates.paid !== undefined) {
        payload.paid = !!updates.paid;
        payload.paid_at = updates.paid ? new Date().toISOString() : null;
      }
      const { error } = await supabase.from("referee_appointments").update(payload).eq("id", id);
      if (error) throw error;
      await loadRefereeAppointments();
      return { success: true };
    } catch (e) {
      return { error: e.message || "Could not update that appointment." };
    }
  }

  const loadNotices = useCallback(async () => {
    try {
      // Birthday notices (posted automatically by the daily
      // create_birthday_notices() job - see schema.sql) are meant to be
      // short-lived. The job itself deletes anything older than 48h once a
      // day, but that leaves a gap right up until the next run; filtering
      // them out of the client's own query as soon as they cross 48h keeps
      // the board looking clean in the meantime without needing a delete
      // permission every role has.
      const cutoffIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data: rows, error } = await supabase
        .from("notices")
        .select("*")
        .or(`category.neq.birthday,posted_at.gte.${cutoffIso}`)
        .order("pinned", { ascending: false })
        .order("posted_at", { ascending: false });
      if (error) throw error;
      setNotices((rows || []).map(fromDbNotice));
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load notices.");
    }
  }, []);

  async function saveNotice(form) {
    setSaveError("");
    const payload = toDbNotice(form, staffId);
    try {
      if (form.id) {
        const { posted_by, ...updatePayload } = payload; // never reassign ownership on edit
        const { error } = await supabase.from("notices").update(updatePayload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("notices").insert(payload);
        if (error) throw error;
      }
      await loadNotices();
      return { success: true };
    } catch (e) {
      return { error: e.message || "Could not save that notice." };
    }
  }

  async function deleteNotice(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("notices").delete().eq("id", id);
      if (error) throw error;
      await loadNotices();
      return { success: true };
    } catch (e) {
      return { error: e.message || "Could not delete that notice." };
    }
  }

  const loadStaffList = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("staff").select("*").order("invited_at", { ascending: false });
      if (error) throw error; // non-admins get an RLS-denied error here, which is expected and fine
      setStaffList(rows || []);
    } catch (e) {
      // Silent for non-admins - they simply can't see this table, by design.
    }
  }, []);

  async function inviteStaffMember(email, roleToAssign) {
    setUsersBusy(true);
    setUsersMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: { email, role: roleToAssign, redirectTo: window.location.origin },
      });
      if (error || data?.error) {
        const msg = await extractFunctionErrorMessage(error, data);
        throw new Error(msg);
      }
      setUsersMessage(`Invited ${email} as ${roleToAssign}.`);
      await loadStaffList();
    } catch (e) {
      setUsersMessage(`Failed to invite ${email}: ${e.message || "unknown error"}`);
    } finally {
      setUsersBusy(false);
    }
  }

  // Invites a SPECIFIC player to claim their own account, sending them to
  // the separate Player Portal app (invite-player Edge Function) rather
  // than this one. This redirectTo only takes effect if that URL is also
  // present in Supabase's Auth > URL Configuration > Redirect URLs
  // allow-list; if it's missing there, Supabase silently falls back to the
  // project's Site URL and the player ends up here instead. As a safety
  // net for that case (and for any other way an invite link lands on the
  // wrong app), AcceptInviteView/NoAccessView in Auth.jsx offer a "go to
  // the Player Portal instead" option once the password is set, and the
  // Player Portal's accept-invite.html offers the mirror-image "go to Club
  // Management instead" option - so a misdirected invite degrades to an
  // extra click rather than a dead end.
  // Returns {success:true} or {error:message} rather than managing global
  // state, since this is triggered from inside PlayerModal, not a tab.
  async function invitePlayer(playerId, email) {
    try {
      const { data, error } = await supabase.functions.invoke("invite-player", {
        body: { playerId, email, redirectTo: "https://www.gfcplayers.co.za/accept-invite.html" },
      });
      if (error || data?.error) {
        const msg = await extractFunctionErrorMessage(error, data);
        throw new Error(msg);
      }
      await loadPlayers();
      // The account can be successfully linked even if the invite email
      // itself failed to send - surface both, so the UI never claims
      // "invite sent" when it wasn't.
      return {
        success: true,
        emailSent: !!data.emailSent,
        emailError: data.emailError || null,
        alreadyRegistered: !!data.alreadyRegistered,
        alreadyLinked: !!data.alreadyLinked,
      };
    } catch (e) {
      return { error: e.message || "Failed to send app invite." };
    }
  }

  // Lists every Player Portal login linked to a player (e.g. both
  // parents). Goes through an Edge Function because login emails and
  // activation status live in Supabase Auth, not a public table.
  async function listPlayerGuardians(playerId) {
    try {
      const { data, error } = await supabase.functions.invoke("manage-player-guardians", {
        body: { action: "list", playerId },
      });
      if (error || data?.error) throw new Error(await extractFunctionErrorMessage(error, data));
      return { accounts: data.accounts || [] };
    } catch (e) {
      return { error: e.message || "Could not load linked accounts." };
    }
  }

  // Unlinks ONE login from ONE player. The login itself is kept, since it
  // may also be linked to a sibling or belong to a staff member.
  async function removePlayerGuardian(playerId, authUserId) {
    try {
      const { data, error } = await supabase.functions.invoke("manage-player-guardians", {
        body: { action: "remove", playerId, authUserId },
      });
      if (error || data?.error) throw new Error(await extractFunctionErrorMessage(error, data));
      await loadPlayers();
      return { success: true };
    } catch (e) {
      return { error: e.message || "Could not remove access." };
    }
  }

  async function removeStaffMember(staffId) {
    const confirmed = window.confirm("Remove this person's access to the app? Their login will still exist, but they won't be able to see or change anything until re-invited.");
    if (!confirmed) return;
    setUsersBusy(true);
    setUsersMessage("");
    try {
      const { error } = await supabase.from("staff").delete().eq("id", staffId);
      if (error) throw error;
      await loadStaffList();
      setUsersMessage("Access removed.");
    } catch (e) {
      setUsersMessage(`Failed to remove access: ${e.message || "unknown error"}`);
    } finally {
      setUsersBusy(false);
    }
  }

  const loadStaffTeams = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("staff_teams").select("*");
      if (error) throw error;
      setStaffTeams((rows || []).map((r) => ({ staffId: r.staff_id, ageGroup: r.age_group })));
    } catch (e) {
      // Non-critical - a coach whose teams fail to load just sees no
      // options in the target dropdown, which is safe (fails closed).
    }
  }, []);

  // Replaces the FULL set of a given staff member's team assignments with
  // the provided list - simpler and less error-prone than diffing which
  // ones were added/removed, and this is a low-frequency admin action.
  async function saveStaffTeamsForStaff(staffMemberId, ageGroupList) {
    setSaveError("");
    try {
      const { error: deleteErr } = await supabase.from("staff_teams").delete().eq("staff_id", staffMemberId);
      if (deleteErr) throw deleteErr;
      if (ageGroupList.length > 0) {
        const { error: insertErr } = await supabase
          .from("staff_teams")
          .insert(ageGroupList.map((ageGroup) => ({ staff_id: staffMemberId, age_group: ageGroup })));
        if (insertErr) throw insertErr;
      }
      await loadStaffTeams();
      return { success: true };
    } catch (e) {
      return { error: e.message || "Could not save team assignments." };
    }
  }

  const loadBackups = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase
        .from("backups")
        .select("id, created_at, kind")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      setBackupsList(rows || []);
    } catch (e) {
      // Non-fatal - the rest of the app still works without backups visible.
      setBackupMessage("Could not load backup history: " + (e.message || "unknown error"));
    }
  }, []);

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const { data: rows, error } = await supabase
        .from("players")
        .select("*, payments(*), player_status_log(*), guardian_players(auth_user_id)")
        .order("name", { ascending: true });
      if (error) throw error;
      setPlayers((rows || []).map(fromDbPlayer));
    } catch (e) {
      setLoadError(e.message || "Could not reach the database.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase
        .from("matches")
        .select("*")
        .order("match_date", { ascending: false });
      if (error) throw error;
      setMatches((rows || []).map(fromDbMatch));
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load fixtures.");
    }
  }, []);

  const loadMatchSquad = useCallback(async (matchId) => {
    if (!matchId) return;
    try {
      const { data: rows, error } = await supabase
        .from("match_squad")
        .select("*, players(*)")
        .eq("match_id", matchId)
        .order("slot_no", { ascending: true });
      if (error) throw error;
      setMatchSquads((prev) => ({
        ...prev,
        [matchId]: (rows || []).map((r) => ({
          id: r.id,
          matchId: r.match_id,
          playerId: r.player_id,
          slotNo: r.slot_no,
          jerseyNo: r.jersey_no || "",
          role: r.role || "starting",
          goals: r.goals ?? 0,
          assists: r.assists ?? 0,
          player: r.players ? fromDbPlayer({ ...r.players, payments: [] }) : null,
        })),
      }));
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }, []);

  const loadKit = useCallback(async () => {
    try {
      const { data: items, error: itemsErr } = await supabase.from("inventory_items").select("*").order("name");
      if (itemsErr) throw itemsErr;
      setInventory((items || []).map(fromDbItem));

      const { data: issued, error: issuedErr } = await supabase
        .from("issued_items")
        .select("*, players(*), inventory_items(*)")
        .order("date_issued", { ascending: false });
      if (issuedErr) throw issuedErr;
      setIssuedItems(
        (issued || []).map((r) => ({
          id: r.id,
          playerId: r.player_id,
          itemId: r.item_id,
          size: r.size || "",
          quantity: r.quantity || 1,
          dateIssued: r.date_issued || "",
          dateReturned: r.date_returned || "",
          notes: r.notes || "",
          playerName: r.players ? r.players.name : "Unknown player",
          itemName: r.inventory_items ? r.inventory_items.name : "Unknown item",
        }))
      );
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load kit records.");
    }
  }, []);

  const loadAssets = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("club_assets").select("*").order("name");
      if (error) throw error;
      setAssets((rows || []).map(fromDbAsset));
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load club assets.");
    }
  }, []);

  const loadFinanceEntries = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("finance_entries").select("*").order("entry_date", { ascending: false });
      if (error) throw error;
      setFinanceEntries((rows || []).map(fromDbFinanceEntry));
    } catch (e) {
      setLoadError((prev) => prev || e.message || "Could not load finance entries.");
    }
  }, []);

  const loadReminderBatch = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase
        .from("reminder_batches")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      setPendingReminderBatch(rows && rows.length > 0 ? fromDbReminderBatch(rows[0]) : null);
    } catch (e) {
      // Non-critical - a missing/failed load just means the reminder banner
      // doesn't show up this session, nothing else depends on it.
    }
  }, []);

  const loadAuditLog = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(200);
      if (error) throw error; // non-admins get an RLS-denied error here, which is expected and fine
      setAuditLog((rows || []).map(fromDbAuditLog));
    } catch (e) {
      // Silent for non-admins - they simply can't see this table, by design.
    }
  }, []);

  const loadAllSquadStats = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("match_squad").select("player_id, goals, assists");
      if (error) throw error;
      setAllSquadRows((rows || []).map((r) => ({ playerId: r.player_id, goals: r.goals ?? 0, assists: r.assists ?? 0 })));
    } catch (e) {
      // Non-critical - season stats just won't show if this fails.
    }
  }, []);

  const loadLeagueSources = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("league_table_sources").select("*").order("display_order");
      if (error) throw error;
      setLeagueSources((rows || []).map(fromDbLeagueSource));
    } catch (e) {
      // Non-critical - league table section just won't show if this fails.
    }
  }, []);

  const loadLeagueStandings = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.from("league_standings").select("*").order("position");
      if (error) throw error;
      setLeagueStandings((rows || []).map(fromDbLeagueStanding));
    } catch (e) {
      // Non-critical - league table section just won't show if this fails.
    }
  }, []);

  useEffect(() => {
    loadPlayers();
    loadMatches();
    loadKit();
    loadTiers();
    loadBackups();
    loadClubSettings();
    loadStaffList();
    loadDivisionLabels();
    loadAssets();
    loadFinanceEntries();
    loadReminderBatch();
    loadAuditLog();
    loadAllSquadStats();
    loadLeagueSources();
    loadLeagueStandings();
    loadFixtures();
    loadRefereeAppointments();
    loadNotices();
    loadStaffTeams();
  }, [loadPlayers, loadMatches, loadKit, loadTiers, loadBackups, loadClubSettings, loadStaffList, loadDivisionLabels, loadAssets, loadFinanceEntries, loadReminderBatch, loadAuditLog, loadAllSquadStats, loadLeagueSources, loadLeagueStandings, loadFixtures, loadRefereeAppointments, loadNotices, loadStaffTeams]);

  useEffect(() => {
    if (activeMatchId) loadMatchSquad(activeMatchId);
  }, [activeMatchId, loadMatchSquad]);

  const ageGroups = useMemo(() => {
    const set = new Set();
    players.forEach((p) => set.add(p.ageGroupOverride || computeAgeGroup(p.dob)));
    return ["All", ...sortAgeGroups(Array.from(set))];
  }, [players]);

  const enriched = useMemo(() => {
    return players.map((p) => {
      const fin = playerFinance(p, tiers);
      const status = complianceStatus(p, tiers);
      const reason = complianceReason(p, tiers);
      const ageGroup = p.ageGroupOverride || computeAgeGroup(p.dob);
      return { ...p, ...fin, status, reason, ageGroup };
    });
  }, [players, tiers]);

  const playerStats = useMemo(() => aggregatePlayerStats(allSquadRows, enriched), [allSquadRows, enriched]);

  const visiblePlayers = useMemo(() => {
    return includeInactive ? enriched : enriched.filter((p) => p.active);
  }, [enriched, includeInactive]);

  const filtered = useMemo(() => {
    return visiblePlayers.filter((p) => {
      if (ageFilter !== "All" && p.ageGroup !== ageFilter) return false;
      if (statusFilter !== "All" && p.status !== statusFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [visiblePlayers, ageFilter, statusFilter, search]);

  const stats = useMemo(() => {
    const totalOwed = visiblePlayers.reduce((s, p) => s + Math.max(0, p.balance), 0);
    const compliant = visiblePlayers.filter((p) => p.status === "green").length;
    const nonCompliant = visiblePlayers.filter((p) => p.status === "red").length;
    const dueSoon = visiblePlayers.filter((p) => p.status === "amber").length;
    return { total: visiblePlayers.length, totalOwed, compliant, nonCompliant, dueSoon };
  }, [visiblePlayers]);

  async function savePlayer(form) {
    setSaveError("");
    const payload = toDbPlayer(form);
    try {
      if (form.id) {
        const existing = players.find((p) => p.id === form.id);
        const { error } = await supabase.from("players").update(payload).eq("id", form.id);
        if (error) throw error;

        let newStatusLog = existing?.statusLog || [];
        if (existing && existing.active !== !!form.active) {
          const newStatus = form.active ? "active" : "inactive";
          const changedAt = new Date().toISOString();
          const { data: logRow, error: logErr } = await supabase
            .from("player_status_log")
            .insert({ player_id: form.id, status: newStatus, changed_at: changedAt })
            .select()
            .single();
          if (!logErr && logRow) {
            newStatusLog = [...newStatusLog, { id: logRow.id, status: logRow.status, changedAt: logRow.changed_at }];
          }
        }

        setPlayers((prev) => prev.map((p) => (p.id === form.id ? { ...p, ...form, statusLog: newStatusLog } : p)));
      } else {
        const { data: inserted, error } = await supabase.from("players").insert(payload).select().single();
        if (error) throw error;
        setPlayers((prev) => [...prev, fromDbPlayer({ ...inserted, payments: [], player_status_log: [] })]);
      }
      setEditingPlayer(null);
      return null;
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
      if ((e.message || "").toLowerCase().includes("reg_no")) {
        return "That federation number is already assigned to another player.";
      }
      return e.message || "Something went wrong saving this player.";
    }
  }

  async function deletePlayer(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("players").delete().eq("id", id);
      if (error) throw error;
      setPlayers((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
    setEditingPlayer(null);
    setLedgerPlayerId(null);
  }

  async function addPayment(playerId, payment) {
    setSaveError("");
    try {
      const { data: inserted, error } = await supabase
        .from("payments")
        .insert({ player_id: playerId, amount: payment.amount, date: payment.date, method: payment.method })
        .select()
        .single();
      if (error) throw error;
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId
            ? { ...p, payments: [{ id: inserted.id, amount: Number(inserted.amount), date: inserted.date, method: inserted.method }, ...(p.payments || [])] }
            : p
        )
      );
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function removePayment(playerId, paymentId) {
    setSaveError("");
    try {
      const { error } = await supabase.from("payments").delete().eq("id", paymentId);
      if (error) throw error;
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId ? { ...p, payments: (p.payments || []).filter((pm) => pm.id !== paymentId) } : p
        )
      );
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  /* ----- Matchday CRUD ----- */

  async function saveMatch(form) {
    setSaveError("");
    const payload = toDbMatch(form);
    try {
      if (form.id) {
        const { error } = await supabase.from("matches").update(payload).eq("id", form.id);
        if (error) throw error;
        setMatches((prev) => prev.map((m) => (m.id === form.id ? { ...m, ...form } : m)));
      } else {
        const { data: inserted, error } = await supabase.from("matches").insert(payload).select().single();
        if (error) throw error;
        const newMatch = fromDbMatch(inserted);
        setMatches((prev) => [newMatch, ...prev]);
        setActiveMatchId(newMatch.id);
      }
      setEditingMatch(null);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function deleteMatch(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("matches").delete().eq("id", id);
      if (error) throw error;
      setMatches((prev) => prev.filter((m) => m.id !== id));
      if (activeMatchId === id) setActiveMatchId(null);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
    setEditingMatch(null);
  }

  async function setSquadSlot(matchId, slotNo, role, player) {
    setSaveError("");
    try {
      const existing = (matchSquads[matchId] || []).find((r) => r.slotNo === slotNo);
      if (!player) {
        if (existing) {
          const { error } = await supabase.from("match_squad").delete().eq("id", existing.id);
          if (error) throw error;
        }
      } else if (existing) {
        const { error } = await supabase
          .from("match_squad")
          .update({ player_id: player.id, jersey_no: String(player.squadNumber ?? "") })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("match_squad").insert({
          match_id: matchId,
          player_id: player.id,
          slot_no: slotNo,
          role,
          jersey_no: String(player.squadNumber ?? ""),
        });
        if (error) throw error;
      }
      await loadMatchSquad(matchId);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function updateSquadJersey(matchId, rowId, jerseyNo) {
    setSaveError("");
    try {
      const { error } = await supabase.from("match_squad").update({ jersey_no: jerseyNo }).eq("id", rowId);
      if (error) throw error;
      setMatchSquads((prev) => ({
        ...prev,
        [matchId]: (prev[matchId] || []).map((r) => (r.id === rowId ? { ...r, jerseyNo } : r)),
      }));
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function updateSquadStats(matchId, rowId, field, value) {
    setSaveError("");
    const num = Math.max(0, Number(value) || 0);
    try {
      const { error } = await supabase.from("match_squad").update({ [field]: num }).eq("id", rowId);
      if (error) throw error;
      setMatchSquads((prev) => ({
        ...prev,
        [matchId]: (prev[matchId] || []).map((r) => (r.id === rowId ? { ...r, [field]: num } : r)),
      }));
      loadAllSquadStats();
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  /* ----- Tier CRUD ----- */

  async function saveTier(form) {
    setSaveError("");
    const payload = toDbTier(form);
    try {
      if (form.id) {
        const { error } = await supabase.from("tiers").update(payload).eq("id", form.id);
        if (error) throw error;
        setTiers((prev) => prev.map((t) => (t.id === form.id ? { ...t, ...form, monthlyFee: Number(form.monthlyFee) } : t)));
      } else {
        const { data: inserted, error } = await supabase.from("tiers").insert(payload).select().single();
        if (error) throw error;
        setTiers((prev) => [...prev, fromDbTier(inserted)]);
      }
      setEditingTier(null);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function deleteTier(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("tiers").delete().eq("id", id);
      if (error) throw error;
      setTiers((prev) => prev.filter((t) => t.id !== id));
      setPlayers((prev) => prev.map((p) => (p.tierId === id ? { ...p, tierId: "" } : p)));
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
    setEditingTier(null);
  }

  /* ----- Kit CRUD ----- */

  async function saveItem(form) {
    setSaveError("");
    const payload = toDbItem(form);
    try {
      if (form.id) {
        const { error } = await supabase.from("inventory_items").update(payload).eq("id", form.id);
        if (error) throw error;
        setInventory((prev) => prev.map((i) => (i.id === form.id ? { ...i, ...form, quantityOnHand: Number(form.quantityOnHand) } : i)));
      } else {
        const { data: inserted, error } = await supabase.from("inventory_items").insert(payload).select().single();
        if (error) throw error;
        setInventory((prev) => [...prev, fromDbItem(inserted)]);
      }
      setEditingItem(null);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function deleteItem(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("inventory_items").delete().eq("id", id);
      if (error) throw error;
      setInventory((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
    setEditingItem(null);
  }

  async function saveAsset(form) {
    setSaveError("");
    const payload = toDbAsset(form);
    try {
      if (form.id) {
        const { error } = await supabase.from("club_assets").update(payload).eq("id", form.id);
        if (error) throw error;
        setAssets((prev) => prev.map((a) => (a.id === form.id ? { ...a, ...form, quantity: Number(form.quantity), unitValue: Number(form.unitValue), lowStockThreshold: Number(form.lowStockThreshold) } : a)));
      } else {
        const { data: inserted, error } = await supabase.from("club_assets").insert(payload).select().single();
        if (error) throw error;
        setAssets((prev) => [...prev, fromDbAsset(inserted)]);
      }
      setEditingAsset(null);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function deleteAsset(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("club_assets").delete().eq("id", id);
      if (error) throw error;
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
    setEditingAsset(null);
  }

  async function saveFinanceEntry(form) {
    setSaveError("");
    const payload = toDbFinanceEntry(form);
    try {
      if (form.id) {
        const { error } = await supabase.from("finance_entries").update(payload).eq("id", form.id);
        if (error) throw error;
        setFinanceEntries((prev) => prev.map((e) => (e.id === form.id ? { ...e, ...form, amount: Number(form.amount) } : e)));
      } else {
        const { data: inserted, error } = await supabase.from("finance_entries").insert(payload).select().single();
        if (error) throw error;
        setFinanceEntries((prev) => [fromDbFinanceEntry(inserted), ...prev]);
      }
      setEditingFinanceEntry(null);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function deleteFinanceEntry(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("finance_entries").delete().eq("id", id);
      if (error) throw error;
      setFinanceEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
    setEditingFinanceEntry(null);
  }

  async function dismissReminderBatch() {
    if (!pendingReminderBatch) return;
    try {
      const { error } = await supabase.from("reminder_batches").update({ status: "dismissed" }).eq("id", pendingReminderBatch.id);
      if (error) throw error;
      setPendingReminderBatch(null);
    } catch (e) {
      setSaveError(e.message || "Could not dismiss the reminder banner.");
    }
  }

  async function saveLeagueSource(form) {
    setSaveError("");
    const payload = toDbLeagueSource(form);
    try {
      if (form.id) {
        const { error } = await supabase.from("league_table_sources").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("league_table_sources").insert(payload);
        if (error) throw error;
      }
      await loadLeagueSources();
      setEditingLeagueSource(null);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function deleteLeagueSource(id) {
    setSaveError("");
    try {
      const { error } = await supabase.from("league_table_sources").delete().eq("id", id);
      if (error) throw error;
      await loadLeagueSources();
      await loadLeagueStandings();
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
    setEditingLeagueSource(null);
  }

  async function issueItem({ playerId, itemId, size, quantity, dateIssued, notes }) {
    setSaveError("");
    try {
      const item = inventory.find((i) => i.id === itemId);
      const { data: inserted, error } = await supabase
        .from("issued_items")
        .insert({ player_id: playerId, item_id: itemId, size, quantity, date_issued: dateIssued, notes })
        .select()
        .single();
      if (error) throw error;
      const { error: updErr } = await supabase
        .from("inventory_items")
        .update({ quantity_on_hand: Math.max(0, (item?.quantityOnHand || 0) - Number(quantity)) })
        .eq("id", itemId);
      if (updErr) throw updErr;
      await Promise.all([loadKit()]);
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  async function returnItem(issuedId) {
    setSaveError("");
    try {
      const row = issuedItems.find((r) => r.id === issuedId);
      const { error } = await supabase.from("issued_items").update({ date_returned: todayISO() }).eq("id", issuedId);
      if (error) throw error;
      if (row) {
        const item = inventory.find((i) => i.id === row.itemId);
        if (item) {
          await supabase.from("inventory_items").update({ quantity_on_hand: (item.quantityOnHand || 0) + row.quantity }).eq("id", item.id);
        }
      }
      await loadKit();
    } catch (e) {
      setSaveError(e.message || "Something went wrong. Please try again.");
    }
  }

  /* ----- Backups ----- */

  async function reloadEverything() {
    await Promise.all([loadPlayers(), loadMatches(), loadKit(), loadTiers()]);
  }

  async function runManualBackup() {
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const { error } = await supabase.rpc("create_backup_snapshot", { p_kind: "manual" });
      if (error) throw error;
      await loadBackups();
      setBackupMessage("Backup created successfully.");
    } catch (e) {
      setBackupMessage("Backup failed: " + (e.message || "unknown error"));
    } finally {
      setBackupBusy(false);
    }
  }

  async function downloadSnapshot(backupId) {
    try {
      const { data, error } = await supabase.from("backups").select("*").eq("id", backupId).single();
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data.snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `garlandale-backup-${(data.created_at || "").slice(0, 19).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setBackupMessage("Could not download backup: " + (e.message || "unknown error"));
    }
  }

  async function applySnapshot(snapshot) {
    // A single call to a Postgres function that runs the whole restore as
    // one transaction - either all of it applies, or none of it does. See
    // schema.sql's restore_from_snapshot() for why this replaced ~15
    // sequential client-side delete/insert calls (that approach could leave
    // the database partially restored if any single call failed midway).
    const { error } = await supabase.rpc("restore_from_snapshot", { snapshot });
    if (error) throw error;
  }

  async function restoreFromSnapshot(backupId) {
    const confirmed = window.confirm(
      "This will replace ALL current data with this backup. This cannot be undone. Are you sure you want to continue?"
    );
    if (!confirmed) return;
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const { data, error } = await supabase.from("backups").select("*").eq("id", backupId).single();
      if (error) throw error;
      await applySnapshot(data.snapshot);
      await reloadEverything();
      await loadBackups();
      setBackupMessage("Restore complete.");
    } catch (e) {
      setBackupMessage("Restore failed: " + (e.message || "unknown error"));
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreFromUploadedFile(file) {
    const confirmed = window.confirm(
      "This will replace ALL current data with the contents of this file. This cannot be undone. Are you sure you want to continue?"
    );
    if (!confirmed) return;
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text);
      await applySnapshot(snapshot);
      await reloadEverything();
      await loadBackups();
      setBackupMessage("Restore from file complete.");
    } catch (e) {
      setBackupMessage("Restore failed: " + (e.message || "invalid backup file"));
    } finally {
      setBackupBusy(false);
    }
  }

  /* ----- Email statements ----- */

  async function sendPlayerStatement(player) {
    setEmailBusy(true);
    setEmailMessage("");
    const result = await sendStatementEmail(player, clubSettings);
    setEmailBusy(false);
    if (result.error) {
      setEmailMessage(`Failed to email ${player.name}: ${result.error}`);
      return false;
    }
    setEmailMessage(`Statement emailed to ${player.name} (${player.email}).`);
    return true;
  }

  async function sendBulkStatements(playersToEmail) {
    setEmailBusy(true);
    setEmailMessage("");
    let sent = 0;
    let failed = [];
    for (const p of playersToEmail) {
      const result = await sendStatementEmail(p, clubSettings);
      if (result.error) failed.push(`${p.name} (${result.error})`);
      else sent++;
    }
    setEmailBusy(false);
    setEmailMessage(
      `Sent ${sent} of ${playersToEmail.length} statement${playersToEmail.length === 1 ? "" : "s"}.` +
      (failed.length ? ` Failed: ${failed.join(", ")}` : "")
    );
  }

  if (loading) {
    return (
      <div className="gfc-app" style={{ alignItems: "center", justifyContent: "center" }}>
        <style>{GLOBAL_CSS}</style>
        <div style={{ color: T.indigo, fontFamily: "'Anton', sans-serif" }}>LOADING SQUAD…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="gfc-app" style={{ alignItems: "center", justifyContent: "center" }}>
        <style>{GLOBAL_CSS}</style>
        <div style={{ maxWidth: 420, textAlign: "center", padding: 24 }}>
          <div className="gfc-display" style={{ color: T.danger, fontSize: 20, marginBottom: 10 }}>Couldn't reach the database</div>
          <div style={{ color: T.inkSoft, fontSize: 13, marginBottom: 16 }}>{loadError}</div>
          <div style={{ color: T.inkSoft, fontSize: 12, marginBottom: 16 }}>
            Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set correctly in your .env file, and that schema.sql has been run in your Supabase project.
          </div>
          <button className="gfc-btn gfc-btn-primary" onClick={loadPlayers}>Try again</button>
        </div>
      </div>
    );
  }

  const ledgerPlayer = ledgerPlayerId ? enriched.find((p) => p.id === ledgerPlayerId) : null;

  return (
    <div className="gfc-app">
      <style>{GLOBAL_CSS}</style>

      {/* SIDEBAR */}
      <aside className="gfc-sidebar">
        <div className="gfc-crest-wrap">
          <img src={BADGE_SRC} alt={`${CLUB_NAME} crest`} />
          <div className="gfc-club-name gfc-display">{CLUB_NAME}</div>
          <div className="gfc-club-sub">Club Management</div>
        </div>
        <nav className="gfc-nav">
          {CLUB_OPS_NAV.filter((n) => n.roles.includes(role)).map((n) => (
            <button
              key={n.id}
              className={`gfc-nav-item ${tab === n.id ? "active" : ""}`}
              onClick={() => setTab(n.id)}
            >
              <span className="gfc-nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}

          {(() => {
            const visibleAdminItems = ADMIN_NAV.filter((n) => n.roles.includes(role));
            if (visibleAdminItems.length === 0) return null;
            const isAdminExpanded = adminExpanded || visibleAdminItems.some((n) => n.id === tab);
            return (
              <>
                <button
                  className="gfc-nav-item"
                  onClick={() => setAdminExpanded((v) => !v)}
                  style={{ marginTop: 10, opacity: 0.75 }}
                >
                  <span className="gfc-nav-icon">{isAdminExpanded ? "▾" : "▸"}</span>
                  Admin
                </button>
                {isAdminExpanded && visibleAdminItems.map((n) => (
                  <button
                    key={n.id}
                    className={`gfc-nav-item ${tab === n.id ? "active" : ""}`}
                    style={{ paddingLeft: 30 }}
                    onClick={() => setTab(n.id)}
                  >
                    <span className="gfc-nav-icon">{n.icon}</span>
                    {n.label}
                  </button>
                ))}
              </>
            );
          })()}
        </nav>
        <div className="gfc-sidebar-foot">
          <div style={{ marginBottom: 8, textTransform: "capitalize" }}>{accountRole} account</div>
          <button
            onClick={onLogout}
            style={{ background: "none", border: "none", color: T.gold, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0, marginBottom: 8 }}
          >
            Log out
          </button>
          <div>{saveError ? `⚠ ${saveError}` : "Connected to Supabase"}</div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="gfc-main">
        {saveError && (
          <div style={{
            background: T.dangerSoft, border: `1px solid ${T.danger}`, borderRadius: 10,
            padding: "10px 16px", marginBottom: 18, display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 12, fontSize: 13, color: T.danger, fontWeight: 600,
          }}>
            <span>⚠ {saveError}</span>
            <button
              onClick={() => setSaveError("")}
              style={{ background: "none", border: "none", color: T.danger, fontSize: 16, cursor: "pointer", lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
        )}
        {tab === "dashboard" && (
          <DashboardView
            stats={stats}
            enriched={visiblePlayers}
            includeInactive={includeInactive}
            setIncludeInactive={setIncludeInactive}
            onGoSquad={(status) => { setTab("squad"); setStatusFilter(status); setAgeFilter("All"); }}
          />
        )}

        {tab === "squad" && (
          <SquadView
            filtered={filtered}
            ageGroups={ageGroups}
            ageFilter={ageFilter}
            setAgeFilter={setAgeFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            search={search}
            setSearch={setSearch}
            includeInactive={includeInactive}
            setIncludeInactive={setIncludeInactive}
            role={role}
            onAdd={() => setEditingPlayer("new")}
            onEdit={(p) => setEditingPlayer(p)}
            onOpenLedger={(p) => setLedgerPlayerId(p.id)}
            playerStats={playerStats}
            leagueSources={leagueSources}
            leagueStandings={leagueStandings}
          />
        )}

        {tab === "subscriptions" && (
          <SubscriptionsView
            enriched={visiblePlayers}
            tiers={tiers}
            includeInactive={includeInactive}
            setIncludeInactive={setIncludeInactive}
            onOpenLedger={(p) => setLedgerPlayerId(p.id)}
            onManageTiers={() => setManagingTiers(true)}
          />
        )}

        {tab === "finance" && (
          <FinanceView
            financeEntries={financeEntries}
            players={enriched}
            assets={assets}
            onAdd={() => setEditingFinanceEntry("new")}
            onEdit={(entry) => setEditingFinanceEntry(entry)}
          />
        )}

        {tab === "matchday" && (
          <MatchdayView
            matches={matches}
            enriched={enriched}
            ageGroups={ageGroups}
            activeMatchId={activeMatchId}
            setActiveMatchId={setActiveMatchId}
            squad={matchSquads[activeMatchId] || []}
            onAddMatch={() => setEditingMatch("new")}
            onEditMatch={(m) => setEditingMatch(m)}
            onSetSlot={setSquadSlot}
            onUpdateJersey={updateSquadJersey}
            onUpdateStats={updateSquadStats}
            fixtures={fixtures}
            staffList={staffList}
            onSyncFixtures={syncFixturesToMatchday}
          />
        )}

        {tab === "store" && <StoreView role={role} />}
        {tab === "supporters" && <SupportersView clubSettings={clubSettings} />}

        {tab === "kit" && (
          <KitView
            inventory={inventory}
            issuedItems={issuedItems}
            enriched={enriched}
            onAddItem={() => setEditingItem("new")}
            onEditItem={(i) => setEditingItem(i)}
            onIssue={issueItem}
            onReturn={returnItem}
          />
        )}

        {tab === "assets" && (
          <AssetsView
            assets={assets}
            onAdd={() => setEditingAsset("new")}
            onEdit={(a) => setEditingAsset(a)}
          />
        )}

        {tab === "backups" && (
          <BackupsView
            backups={backupsList}
            onRefresh={loadBackups}
            onBackupNow={runManualBackup}
            onRestore={restoreFromSnapshot}
            onDownload={downloadSnapshot}
            onRestoreFromFile={restoreFromUploadedFile}
            busy={backupBusy}
            lastMessage={backupMessage}
            auditLog={auditLog}
            players={enriched}
          />
        )}

        {tab === "fixtures-post" && (
          <FixturesPostView fixtures={fixtures} />
        )}

        {tab === "fixtures" && (
          <FixturesView
            fixtures={fixtures}
            divisionLabels={divisionLabels}
            role={role}
            ageGroups={ageGroups}
            staffList={staffList}
            onImportFixtures={importFixtures}
            onSaveDivisionLabel={saveDivisionLabel}
            onSaveFixture={saveFixture}
            onDeleteFixture={deleteFixture}
          />
        )}

        {tab === "calendar" && (
          <CalendarView
            role={role}
            staffId={staffId}
            fixtures={fixtures}
            matches={matches}
            onOpenTab={setTab}
          />
        )}

        {tab === "referee-pay" && (
          <RefereePayView
            fixtures={fixtures}
            staffList={staffList}
            appointments={refereeAppointments}
            onUpdateAppointment={updateRefereeAppointment}
          />
        )}

        {tab === "settings" && (
          <SettingsView
            clubSettings={clubSettings}
            onSave={saveClubSettings}
            leagueSources={leagueSources}
            onAddLeagueSource={() => setEditingLeagueSource("new")}
            onEditLeagueSource={(s) => setEditingLeagueSource(s)}
          />
        )}

        {tab === "users" && (
          <UsersView
            staffList={staffList}
            onInvite={inviteStaffMember}
            onRemove={removeStaffMember}
            busy={usersBusy}
            message={usersMessage}
            staffTeams={staffTeams}
            ageGroups={ageGroups}
            onSaveStaffTeams={saveStaffTeamsForStaff}
          />
        )}

        {tab === "messages" && (
          <MessagesView
            enriched={enriched}
            ageGroups={ageGroups}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            templateId={templateId}
            setTemplateId={setTemplateId}
            customText={customText}
            setCustomText={setCustomText}
            onEmailStatement={sendPlayerStatement}
            onBulkEmailStatements={sendBulkStatements}
            emailBusy={emailBusy}
            emailMessage={emailMessage}
            pendingReminderBatch={pendingReminderBatch}
            onDismissReminderBatch={dismissReminderBatch}
            notices={notices}
            editingNotice={editingNotice}
            setEditingNotice={setEditingNotice}
            onSaveNotice={saveNotice}
            onDeleteNotice={deleteNotice}
            role={role}
            staffId={staffId}
            staffTeams={staffTeams}
          />
        )}
      </main>

      {/* MODALS */}
      {editingPlayer && (
        <PlayerModal
          player={editingPlayer === "new" ? null : editingPlayer}
          tiers={tiers}
          onClose={() => setEditingPlayer(null)}
          onSave={savePlayer}
          onDelete={deletePlayer}
          onManageTiers={() => setManagingTiers(true)}
          onInvitePlayer={invitePlayer}
          onListGuardians={listPlayerGuardians}
          onRemoveGuardian={removePlayerGuardian}
        />
      )}

      {ledgerPlayer && (
        <LedgerModal
          player={ledgerPlayer}
          onClose={() => setLedgerPlayerId(null)}
          onAddPayment={(payment) => addPayment(ledgerPlayer.id, payment)}
          onRemovePayment={(paymentId) => removePayment(ledgerPlayer.id, paymentId)}
          onEmailStatement={sendPlayerStatement}
          emailBusy={emailBusy}
          emailMessage={emailMessage}
        />
      )}

      {managingTiers && (
        <TierManagerModal
          tiers={tiers}
          onClose={() => setManagingTiers(false)}
          onAdd={() => setEditingTier("new")}
          onEdit={(t) => setEditingTier(t)}
        />
      )}

      {editingTier && (
        <TierModal
          tier={editingTier === "new" ? null : editingTier}
          onClose={() => setEditingTier(null)}
          onSave={saveTier}
          onDelete={deleteTier}
        />
      )}

      {editingMatch && (
        <MatchModal
          match={editingMatch === "new" ? null : editingMatch}
          players={players}
          ageGroups={ageGroups}
          onClose={() => setEditingMatch(null)}
          onSave={saveMatch}
          onDelete={deleteMatch}
        />
      )}

      {editingItem && (
        <ItemModal
          item={editingItem === "new" ? null : editingItem}
          onClose={() => setEditingItem(null)}
          onSave={saveItem}
          onDelete={deleteItem}
        />
      )}

      {editingAsset && (
        <AssetModal
          asset={editingAsset === "new" ? null : editingAsset}
          onClose={() => setEditingAsset(null)}
          onSave={saveAsset}
          onDelete={deleteAsset}
        />
      )}

      {editingFinanceEntry && (
        <FinanceEntryModal
          entry={editingFinanceEntry === "new" ? null : editingFinanceEntry}
          onClose={() => setEditingFinanceEntry(null)}
          onSave={saveFinanceEntry}
          onDelete={deleteFinanceEntry}
        />
      )}

      {editingLeagueSource && (
        <LeagueSourceModal
          source={editingLeagueSource === "new" ? null : editingLeagueSource}
          onClose={() => setEditingLeagueSource(null)}
          onSave={saveLeagueSource}
          onDelete={deleteLeagueSource}
        />
      )}
    </div>
  );
}
/* ---------- DASHBOARD ---------- */

/* ---------- OFFICIAL TEAM SHEET GENERATOR ---------- */


/* ---------- BACKUPS ---------- */


/* ---------- FIXTURES POST (Instagram graphic generator) ---------- */


/* ---------- SETTINGS ---------- */


/* ---------- USERS (staff management, admin only) ---------- */


/* ---------- AUTH: LOGIN / ACCEPT INVITE ---------- */




/* ---------- ROOT: auth gate ---------- */

export default function AppRoot() {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [staffId, setStaffId] = useState(null);
  // Evaluated once, from the hash captured the instant supabaseClient.js
  // loaded - NOT from window.location.hash here, since Supabase's client
  // may have already auto-processed and cleared the real one by the time
  // this component's effects run (a race that previously caused invited
  // users to get silently logged in without ever setting a password).
  const [isInviteFlow, setIsInviteFlow] = useState(
    () => initialUrlHash.includes("type=invite") || initialUrlHash.includes("type=recovery")
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession || null);
      if (event === "PASSWORD_RECOVERY") setIsInviteFlow(true);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const loadRole = useCallback(async () => {
    if (!session?.user?.id) { setRole(null); setStaffId(null); return; }
    try {
      const { data, error } = await supabase.from("staff").select("id, role").eq("user_id", session.user.id).single();
      if (error || !data) { setRole("none"); setStaffId(null); return; }
      setRole(data.role);
      setStaffId(data.id);
    } catch (e) {
      setRole("none");
      setStaffId(null);
    }
  }, [session]);

  useEffect(() => {
    if (session && !isInviteFlow) loadRole();
  }, [session, isInviteFlow, loadRole]);

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setRole(null);
    setStaffId(null);
  }

  function handleInviteDone() {
    setIsInviteFlow(false);
    // clear the hash so a refresh doesn't re-trigger the invite flow
    window.history.replaceState(null, "", window.location.pathname);
    loadRole();
  }

  if (authLoading) {
    return (
      <div className="gfc-app" style={{ alignItems: "center", justifyContent: "center" }}>
        <style>{GLOBAL_CSS}</style>
        <div style={{ color: T.indigo, fontFamily: "'Anton', sans-serif" }}>LOADING…</div>
      </div>
    );
  }

  if (session && isInviteFlow) {
    return <AcceptInviteView onDone={handleInviteDone} />;
  }

  if (!session) {
    return <LoginView onLoggedIn={() => {}} />;
  }

  if (role === null) {
    return (
      <div className="gfc-app" style={{ alignItems: "center", justifyContent: "center" }}>
        <style>{GLOBAL_CSS}</style>
        <div style={{ color: T.indigo, fontFamily: "'Anton', sans-serif" }}>LOADING…</div>
      </div>
    );
  }

  if (role === "none") {
    return <NoAccessView email={session.user.email} onLogout={handleLogout} />;
  }

  return <MainApp role={role} staffId={staffId} onLogout={handleLogout} />;
}
