// ---------------------------------------------------------------------------
// Club calendar: reading and writing in Supabase as the logged-in staff
// member. Row-level security decides who may change what: Admin, Chairman
// and Treasurer can change events and categories; everyone else on the
// staff can only view them (migrations/2026-10-club-calendar.sql).
// ---------------------------------------------------------------------------

import { supabase } from "../supabaseClient";
import { hhmm } from "./calendar.js";
import { audienceColumns } from "./audience.js";

const NO_PERMISSION = "Only an Admin, Chairman or Treasurer can change the calendar.";

export function fromDbCategory(row) {
  return {
    id: row.id,
    name: row.name || "",
    color: row.color || "#e2dbc9",
    textColor: row.text_color || "#1c1730",
    sortOrder: Number(row.sort_order) || 0,
    isSystem: row.is_system || null,
  };
}

export function fromDbEvent(row) {
  return {
    id: row.id,
    title: row.title || "",
    categoryId: row.category_id,
    date: row.event_date,
    allDay: !!row.all_day,
    start: hhmm(row.start_time),
    end: hhmm(row.end_time),
    venue: row.venue || "",
    description: row.description || "",
    locationLink: row.location_link || "",
    locationEmbed: row.location_embed || "",
    seriesId: row.series_id || "",
    repeatRule: row.repeat_rule || "",
    repeatUntil: row.repeat_until || "",
    noticeId: row.notice_id || "",
  };
}

/** The columns an event form sets (everything except its date and series). */
export function eventFields(form) {
  return {
    title: String(form.title || "").trim(),
    category_id: form.categoryId,
    all_day: !!form.allDay,
    start_time: form.allDay ? null : form.start || null,
    end_time: form.allDay ? null : form.end || null,
    venue: String(form.venue || "").trim(),
    description: String(form.description || "").trim(),
    location_link: form.locationLink || null,
    location_embed: form.locationEmbed || null,
  };
}

function friendly(error, fallback) {
  const msg = error?.message || "";
  if (/row-level security|permission denied/i.test(msg)) return new Error(NO_PERMISSION);
  if (/calendar_events_location/i.test(msg)) return new Error("That location isn't a Google Maps link or map embed.");
  if (/calendar_categories_name_key|duplicate key/i.test(msg)) return new Error("There's already a category with that name.");
  return new Error(msg || fallback);
}

// An update or delete the database's rules don't allow changes nothing and
// reports no error, so check that rows were actually affected.
function expectRows(data) {
  if (!data || data.length === 0) throw new Error(NO_PERMISSION);
}

export async function loadCalendar() {
  const [cats, events] = await Promise.all([
    supabase.from("calendar_categories").select("*").order("sort_order").order("name"),
    supabase.from("calendar_events").select("*").order("event_date").order("start_time"),
  ]);
  if (cats.error) throw friendly(cats.error, "Couldn't load the calendar categories.");
  if (events.error) throw friendly(events.error, "Couldn't load the calendar.");
  return { categories: (cats.data || []).map(fromDbCategory), events: (events.data || []).map(fromDbEvent) };
}

// ---------- events ----------

/** Creates one event per date. All share a series id when there's more than one. */
export async function createEvents(form, dates) {
  const seriesId = dates.length > 1 ? crypto.randomUUID() : null;
  const rows = dates.map((date) => ({
    ...eventFields(form),
    event_date: date,
    series_id: seriesId,
    repeat_rule: seriesId ? form.repeatRule : null,
    repeat_until: seriesId ? form.repeatUntil : null,
  }));
  const { data, error } = await supabase.from("calendar_events").insert(rows).select("*");
  if (error) throw friendly(error, "Couldn't add the event.");
  return (data || []).map(fromDbEvent);
}

/** Saves changes to one date only. It leaves its series, if it had one. */
export async function updateOneEvent(form) {
  const row = { ...eventFields(form), event_date: form.date, series_id: null, repeat_rule: null, repeat_until: null };
  const { data, error } = await supabase.from("calendar_events").update(row).eq("id", form.id).select("id");
  if (error) throw friendly(error, "Couldn't save the event.");
  expectRows(data);
}

/** Saves changes to this date and every later date of its series (dates stay as they are). */
export async function updateSeriesFrom(form, fromDate) {
  const { data, error } = await supabase.from("calendar_events")
    .update(eventFields(form)).eq("series_id", form.seriesId).gte("event_date", fromDate).select("id");
  if (error) throw friendly(error, "Couldn't save the events.");
  expectRows(data);
  return data.length;
}

export async function deleteEvent(id) {
  const { data, error } = await supabase.from("calendar_events").delete().eq("id", id).select("id");
  if (error) throw friendly(error, "Couldn't delete the event.");
  expectRows(data);
}

/** Deletes this date and every later one in the series. Returns how many went. */
export async function deleteSeriesFrom(seriesId, fromDate) {
  const { data, error } = await supabase.from("calendar_events")
    .delete().eq("series_id", seriesId).gte("event_date", fromDate).select("id");
  if (error) throw friendly(error, "Couldn't delete the events.");
  expectRows(data);
  return data.length;
}

/** After the end of a series is deleted, its "until" date moves to the last date left. */
export async function setSeriesUntil(seriesId, until) {
  const { error } = await supabase.from("calendar_events").update({ repeat_until: until }).eq("series_id", seriesId);
  if (error) throw friendly(error, "Couldn't update the repeat.");
}

export async function linkNotice(eventIds, noticeId) {
  if (!eventIds.length) return;
  const { error } = await supabase.from("calendar_events").update({ notice_id: noticeId }).in("id", eventIds);
  if (error) throw friendly(error, "Couldn't link the notice.");
}

// ---------- Notice Board ----------

/**
 * Posts a notice for everyone (guardians and supporters), which also shows
 * the unread badge in the Player Portal. Uses the same columns as
 * Messages -> Notice Board. Returns the new notice's id.
 */
export async function postCalendarNotice({ title, body, locationLink, locationEmbed }, staffId) {
  const { data, error } = await supabase.from("notices").insert({
    title,
    body,
    category: "announcement",
    pinned: false,
    posted_by: staffId,
    ...audienceColumns([], null), // everyone
    location_link: locationLink || null,
    location_embed: locationEmbed || null,
    show_to_supporters: true,
  }).select("id").single();
  if (error) throw new Error(error.message || "Couldn't post the notice.");
  return data.id;
}

// ---------- categories ----------

export async function saveCategory(cat, sortOrder) {
  const row = { name: cat.name.trim(), color: cat.color, text_color: cat.textColor };
  if (cat.id) {
    const { data, error } = await supabase.from("calendar_categories").update(row).eq("id", cat.id).select("*");
    if (error) throw friendly(error, "Couldn't save the category.");
    expectRows(data);
    return fromDbCategory(data[0]);
  }
  const { data, error } = await supabase.from("calendar_categories").insert({ ...row, sort_order: sortOrder }).select("*").single();
  if (error) throw friendly(error, "Couldn't add the category.");
  return fromDbCategory(data);
}

/** Deletes a category; its events move to Other. Returns how many moved. */
export async function deleteCategory(id) {
  const { data, error } = await supabase.rpc("delete_calendar_category", { p_id: id });
  if (error) throw friendly(error, "Couldn't delete the category.");
  return Number(data) || 0;
}
