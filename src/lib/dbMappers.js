import { groupsFromRow, audienceColumns } from "./audience.js";
// ---------------------------------------------------------------------------
// Mapping functions between Supabase's snake_case Postgres rows and the
// camelCase shape the rest of the app works in. Pure functions, no side
// effects - kept separate so the data-shape contract with the database is
// in one place rather than scattered through component code.
// ---------------------------------------------------------------------------

export function fromDbPlayer(row) {
  return {
    id: row.id,
    name: row.name || "",
    dob: row.dob || "",
    ageGroupOverride: row.age_group_override || "",
    phone: row.phone || "",
    email: row.email || "",
    guardianName: row.guardian_name || "",
    guardianPhone: row.guardian_phone || "",
    joinDate: row.join_date || "",
    billingStartDate: row.billing_start_date || "",
    monthlyFee: row.monthly_fee ?? 0,
    documentsComplete: !!row.documents_complete,
    notes: row.notes || "",
    regNo: row.reg_no || "",
    squadNumber: row.squad_number === null || row.squad_number === undefined ? "" : row.squad_number,
    tierId: row.tier_id || "",
    active: row.active === false ? false : true,
    // Number of Player Portal logins linked to this player (guardians, or
    // the player themselves). Comes from the guardian_players join table;
    // falls back to the legacy players.user_id column for rows loaded
    // without that embed.
    appAccountCount: Array.isArray(row.guardian_players) ? row.guardian_players.length : (row.user_id ? 1 : 0),
    hasAppAccount: Array.isArray(row.guardian_players) ? row.guardian_players.length > 0 : !!row.user_id,
    statusLog: (row.player_status_log || []).map((s) => ({ id: s.id, status: s.status, changedAt: s.changed_at })),
    payments: (row.payments || [])
      .map((p) => ({ id: p.id, amount: Number(p.amount), date: p.date, method: p.method }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
  };
}

export function toDbPlayer(form) {
  return {
    name: form.name,
    dob: form.dob || null,
    age_group_override: form.ageGroupOverride || "",
    phone: form.phone || "",
    email: form.email || "",
    guardian_name: form.guardianName || "",
    guardian_phone: form.guardianPhone || "",
    join_date: form.joinDate || null,
    billing_start_date: form.billingStartDate || null,
    documents_complete: !!form.documentsComplete,
    notes: form.notes || "",
    reg_no: form.regNo && form.regNo.trim() ? form.regNo.trim() : null,
    squad_number: form.squadNumber === "" || form.squadNumber === null || form.squadNumber === undefined ? null : Number(form.squadNumber),
    tier_id: form.tierId || null,
    active: form.active === false ? false : true,
  };
}

export function fromDbTier(row) {
  return {
    id: row.id,
    name: row.name || "",
    monthlyFee: Number(row.monthly_fee) || 0,
    description: row.description || "",
  };
}

export function toDbTier(form) {
  return {
    name: form.name || "",
    monthly_fee: Number(form.monthlyFee) || 0,
    description: form.description || "",
  };
}

export function fromDbMatch(row) {
  return {
    id: row.id,
    leagueName: row.league_name || "",
    homeTeam: row.home_team || "",
    opponent: row.opponent || "",
    homeAway: row.home_away || "H",
    venue: row.venue || "",
    matchDate: row.match_date || "",
    kickoffTime: row.kickoff_time || "",
    division: row.division || "",
    competition: row.competition || "",
    ageGroup: row.age_group || "",
    fixtureId: row.fixture_id || "",
    cornerFlags: row.corner_flags || "",
    fieldConditions: row.field_conditions || "",
    fieldMarking: row.field_marking || "",
    firstAidPresent: row.first_aid_present || "",
    refereeName: row.referee_name || "",
    assistantRef1: row.assistant_ref_1 || "",
    assistantRef2: row.assistant_ref_2 || "",
    halfTimeScoreHome: row.half_time_score_home || "",
    fullTimeScoreHome: row.full_time_score_home || "",
    halfTimeScoreAway: row.half_time_score_away || "",
    fullTimeScoreAway: row.full_time_score_away || "",
    coachName: row.coach_name || "",
    coachRegNo: row.coach_reg_no || "",
    managerName: row.manager_name || "",
    managerRegNo: row.manager_reg_no || "",
    captainPlayerId: row.captain_player_id || "",
    physioName: row.physio_name || "",
    physioRegNo: row.physio_reg_no || "",
    comments: row.comments || "",
    locationLink: row.location_link || "",
    locationEmbed: row.location_embed || "",
  };
}

export function toDbMatch(form) {
  return {
    league_name: form.leagueName || "Cape Town Tygerberg LFA",
    home_team: form.homeTeam || "Garlandale FC",
    opponent: form.opponent || "",
    home_away: form.homeAway || "H",
    venue: form.venue || "",
    match_date: form.matchDate || null,
    kickoff_time: form.kickoffTime || null,
    division: form.division || "",
    competition: form.competition || "",
    age_group: form.ageGroup || "",
    corner_flags: form.cornerFlags || "",
    field_conditions: form.fieldConditions || "",
    field_marking: form.fieldMarking || "",
    first_aid_present: form.firstAidPresent || "",
    referee_name: form.refereeName || "",
    assistant_ref_1: form.assistantRef1 || "",
    assistant_ref_2: form.assistantRef2 || "",
    half_time_score_home: form.halfTimeScoreHome || "",
    full_time_score_home: form.fullTimeScoreHome || "",
    half_time_score_away: form.halfTimeScoreAway || "",
    full_time_score_away: form.fullTimeScoreAway || "",
    coach_name: form.coachName || "",
    coach_reg_no: form.coachRegNo || "",
    manager_name: form.managerName || "",
    manager_reg_no: form.managerRegNo || "",
    captain_player_id: form.captainPlayerId || null,
    physio_name: form.physioName || "",
    physio_reg_no: form.physioRegNo || "",
    comments: form.comments || "",
    location_link: form.locationLink || null,
    location_embed: form.locationEmbed || null,
  };
}

export function fromDbItem(row) {
  return {
    id: row.id,
    name: row.name || "",
    category: row.category || "",
    size: row.size || "",
    quantityOnHand: row.quantity_on_hand ?? 0,
  };
}

export function toDbItem(form) {
  return {
    name: form.name || "",
    category: form.category || "",
    size: form.size || "",
    quantity_on_hand: Number(form.quantityOnHand) || 0,
  };
}

export function fromDbAsset(row) {
  return {
    id: row.id,
    name: row.name || "",
    category: row.category || "Other",
    quantity: row.quantity ?? 0,
    unitValue: Number(row.unit_value) || 0,
    lowStockThreshold: row.low_stock_threshold ?? 0,
    notes: row.notes || "",
  };
}

export function toDbAsset(form) {
  return {
    name: form.name || "",
    category: form.category || "Other",
    quantity: Number(form.quantity) || 0,
    unit_value: Number(form.unitValue) || 0,
    low_stock_threshold: Number(form.lowStockThreshold) || 0,
    notes: form.notes || "",
  };
}

export function fromDbFinanceEntry(row) {
  return {
    id: row.id,
    date: row.entry_date || "",
    description: row.description || "",
    category: row.category || "",
    type: row.type || "income",
    amount: Number(row.amount) || 0,
  };
}

export function toDbFinanceEntry(form) {
  return {
    entry_date: form.date || null,
    description: form.description || "",
    category: form.category || "",
    type: form.type === "expense" ? "expense" : "income",
    amount: Number(form.amount) || 0,
  };
}

export function fromDbReminderBatch(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
  };
}

export function fromDbAuditLog(row) {
  return {
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
    oldData: row.old_data,
    newData: row.new_data,
    changedBy: row.changed_by,
    changedByEmail: row.changed_by_email,
    changedAt: row.changed_at,
  };
}

export function fromDbLeagueSource(row) {
  return {
    id: row.id,
    divisionLabel: row.division_label || "",
    sourceUrl: row.source_url || "",
    displayOrder: row.display_order ?? 0,
    lastFetchedAt: row.last_fetched_at,
    lastFetchError: row.last_fetch_error || "",
  };
}

export function toDbLeagueSource(form) {
  return {
    division_label: form.divisionLabel || "",
    source_url: form.sourceUrl || "",
    display_order: Number(form.displayOrder) || 0,
  };
}

export function fromDbLeagueStanding(row) {
  return {
    id: row.id,
    sourceId: row.source_id,
    position: row.position,
    teamName: row.team_name || "",
    played: row.played ?? 0,
    won: row.won ?? 0,
    drawn: row.drawn ?? 0,
    lost: row.lost ?? 0,
    goalsFor: row.goals_for ?? 0,
    goalsAgainst: row.goals_against ?? 0,
    goalDifference: row.goal_difference ?? 0,
    points: row.points ?? 0,
    isGarlandale: !!row.is_garlandale,
  };
}

export function fromDbFixture(row) {
  return {
    id: row.id,
    divisionKey: row.division_key || "",
    teamLabel: row.team_label || "",
    squadAgeGroup: row.squad_age_group || "",
    opponent: row.opponent || "",
    matchDate: row.match_date,
    kickoffTime: row.kickoff_time || "",
    venue: row.venue || "",
    homeAway: row.home_away || "H",
    refereeId: row.referee_id || "",
    locationLink: row.location_link || "",
    locationEmbed: row.location_embed || "",
  };
}

// Used by the spreadsheet import. Deliberately leaves out location_link /
// location_embed, so re-importing the league schedule never wipes a
// location someone pasted in by hand (the upsert only sets the columns it
// is given). Single-fixture edits save those via saveFixture() in App.jsx.
export function toDbFixture(f) {
  return {
    division_key: f.divisionKey || "",
    team_label: f.teamLabel || "",
    squad_age_group: f.squadAgeGroup || "",
    opponent: f.opponent || "",
    match_date: f.matchDate,
    kickoff_time: f.kickoffTime || null,
    venue: f.venue || "",
    home_away: f.homeAway === "A" ? "A" : "H",
  };
}

// Referee appointments (payment log) - one row per fixture that has a
// referee assigned. fixture/referee display fields (opponent, date,
// email) are joined in from the already-loaded fixtures/staff lists in
// App.jsx rather than re-fetched here, same approach as staffTeams.
export function fromDbRefereeAppointment(row) {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    refereeId: row.referee_id,
    feeAmount: Number(row.fee_amount) || 0,
    paid: !!row.paid,
    paidAt: row.paid_at || "",
  };
}

// Deliberately does NOT include posted_by_email - that's filled in by the
// set_notice_posted_by trigger from whoever's actually logged in, not
// something the client should be trusted to supply.
export function fromDbNotice(row) {
  return {
    id: row.id,
    title: row.title || "",
    body: row.body || "",
    category: row.category || "announcement",
    pinned: !!row.pinned,
    postedByEmail: row.posted_by_email || "",
    postedBy: row.posted_by || "",
    targetAgeGroups: groupsFromRow(row), // [] = everyone
    postedAt: row.posted_at,
    locationLink: row.location_link || "",
    locationEmbed: row.location_embed || "",
    showToSupporters: !!row.show_to_supporters,
    // Push notifications (Player Portal's hourly job). pushSentAt is read
    // only - the job stamps it; the client never writes it.
    urgent: !!row.urgent,
    pushSentAt: row.push_sent_at || null,
  };
}

// posted_by is deliberately included here (unlike posted_by_email, which a
// trigger fills in automatically) - the RLS insert policy requires
// posted_by to equal the caller's own current_staff_id(), so the client
// must supply it explicitly. Only relevant for a brand new notice -
// saveNotice() below strips it back out before an update, so editing a
// notice never silently reassigns who it's attributed to. target_age_group
// of "ALL" is stored as null, matching the convention the player-app side
// already uses (null or 'ALL' both mean "everyone").
export function toDbNotice(form, staffId) {
  return {
    title: form.title || "",
    body: form.body || "",
    category: form.category === "training" ? "training" : "announcement",
    pinned: !!form.pinned,
    posted_by: staffId,
    ...audienceColumns(form.targetAgeGroups || [], null),
    location_link: form.locationLink || null,
    location_embed: form.locationEmbed || null,
    show_to_supporters: !!form.showToSupporters,
    urgent: !!form.urgent,
  };
}
