// ---------------------------------------------------------------------------
// Generates the printable official league team sheet (Cape Town Tygerberg
// LFA format) as a raw HTML string, opened in a new browser tab/window for
// printing. No React/styling dependency - self-contained.
// ---------------------------------------------------------------------------

export function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 1) return { first: "", surname: parts[0] || "" };
  const surname = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(" ");
  return { first, surname };
}

export function fmtDDMMYY(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear());
  return `${dd}/${mm}/${yy}`;
}

export function buildTeamSheetHTML(match, squadRows, players) {
  const captain = players.find((p) => p.id === match.captainPlayerId);

  // The printed form always labels the HOME side "TEAM SHEET OF" and the
  // AWAY side "OPPONENTS", regardless of which club is filling it in.
  const homeName = match.homeAway === "H" ? match.homeTeam : match.opponent;
  const awayName = match.homeAway === "H" ? match.opponent : match.homeTeam;

  const starters = Array.from({ length: 11 }, (_, i) => squadRows.find((r) => r.slotNo === i + 1) || null);
  const subs = Array.from({ length: 9 }, (_, i) => squadRows.find((r) => r.slotNo === i + 12) || null);

  function playerRow(rowNum, squadRow) {
    const p = squadRow?.player;
    const { first, surname } = splitName(p?.name);
    const regNo = p?.regNo || "";
    return `
      <tr>
        <td class="num">${rowNum}</td>
        <td class="jersey">${squadRow?.jerseyNo || ""}</td>
        <td class="name-cell">${surname}</td>
        <td class="name-cell">${first}</td>
        <td class="reg-cell">${regNo}</td>
        <td class="small"></td>
        <td class="small"></td>
        <td class="small"></td>
        <td class="small"></td>
      </tr>`;
  }

  const starterRows = starters.map((r, i) => playerRow(i + 1, r)).join("");
  const subRows = subs.map((r, i) => playerRow(i + 12, r)).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Team Sheet - ${match.opponent || "Fixture"}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1.5px solid #111; padding: 4px 6px; vertical-align: middle; }
  .title-row td { text-align: center; font-weight: bold; font-size: 16px; background: #e5e5e5; padding: 8px; }
  .label { font-weight: bold; font-size: 10.5px; text-transform: uppercase; white-space: nowrap; }
  .side-letter { font-weight: bold; font-size: 15px; text-align: center; width: 22px; }
  .value-cell { font-size: 13px; }
  .header-table td { height: 26px; }
  .player-table th { background: #e5e5e5; text-transform: uppercase; font-size: 10.5px; text-align: center; }
  .player-table td.num { text-align: center; font-weight: bold; width: 26px; }
  .player-table td.jersey { text-align: center; width: 40px; }
  .player-table td.reg-cell { width: 80px; }
  .player-table td.small { width: 30px; }
  .name-cell { min-width: 120px; }
  .sub-header td { text-align: center; font-weight: bold; background: #e5e5e5; text-transform: uppercase; }
  .footer-table td { padding: 8px 6px; }
  .sig-line { display: inline-block; border-bottom: 1px solid #111; min-width: 160px; height: 18px; }
  .print-btn { margin: 14px 0; padding: 8px 16px; font-weight: bold; cursor: pointer; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>

<button class="print-btn" onclick="window.print()">Print this sheet</button>

<table>
  <tr class="title-row"><td colspan="4">${match.leagueName || "Official Team Sheet"} &ndash; Official Team Sheet</td></tr>
</table>

<table class="header-table" style="margin-top:-1.5px;">
  <tr>
    <td class="side-letter">H</td>
    <td class="label" style="width:130px;">Team Sheet Of:</td>
    <td class="value-cell" colspan="2">${homeName}</td>
    <td class="label" style="width:110px;">Half Time Score</td>
    <td style="width:60px;"></td>
    <td class="label" style="width:110px;">Full Time Score</td>
    <td style="width:60px;"></td>
  </tr>
  <tr>
    <td class="side-letter">A</td>
    <td class="label">Opponents:</td>
    <td class="value-cell" colspan="2">${awayName}</td>
    <td class="label">Half Time Score</td>
    <td></td>
    <td class="label">Full Time Score</td>
    <td></td>
  </tr>
  <tr>
    <td colspan="2" class="label">Venue &amp; Field:</td>
    <td class="value-cell" colspan="2">${match.venue || ""}</td>
    <td class="label" colspan="2">Referee</td>
    <td class="value-cell" colspan="2">${match.refereeName || ""}</td>
  </tr>
  <tr>
    <td colspan="2" class="label">Date (DD/MM/YY):</td>
    <td class="value-cell" colspan="2">${fmtDDMMYY(match.matchDate)}</td>
    <td class="label" colspan="2">Assistant Ref (1)</td>
    <td class="value-cell" colspan="2">${match.assistantRef1 || ""}</td>
  </tr>
  <tr>
    <td colspan="2" class="label">Time:</td>
    <td class="value-cell" colspan="2">${match.kickoffTime || ""}</td>
    <td class="label" colspan="2">Assistant Ref (2)</td>
    <td class="value-cell" colspan="2">${match.assistantRef2 || ""}</td>
  </tr>
  <tr>
    <td colspan="2" class="label">Division:</td>
    <td class="value-cell" colspan="2">${match.division || ""}</td>
    <td class="label" colspan="2">Competition</td>
    <td class="value-cell" colspan="2">${match.competition || ""}</td>
  </tr>
  <tr>
    <td class="label" colspan="2">Corner Flags (Yes/No)</td>
    <td class="value-cell">${match.cornerFlags || ""}</td>
    <td class="label">Field Conditions</td>
    <td class="value-cell">${match.fieldConditions || ""}</td>
    <td class="label">Field Marking</td>
    <td class="value-cell" colspan="2">${match.fieldMarking || ""} &nbsp;|&nbsp; First Aid: ${match.firstAidPresent || ""}</td>
  </tr>
</table>

<table class="player-table" style="margin-top:10px;">
  <tr>
    <th style="width:26px;">No</th>
    <th style="width:40px;">Jersey No</th>
    <th>Surname</th>
    <th>First Name</th>
    <th style="width:80px;">Reg No</th>
    <th style="width:30px;">GS</th>
    <th style="width:30px;">YC</th>
    <th style="width:30px;">RC</th>
    <th style="width:30px;">INJ</th>
  </tr>
  ${starterRows}
  <tr class="sub-header"><td colspan="9">Substitutes</td></tr>
  ${subRows}
</table>

<table class="footer-table" style="margin-top:10px;">
  <tr>
    <td class="label" style="width:25%;">Coach Name / Surname &amp; Reg No:</td>
    <td style="width:25%;">${match.coachName || ""} ${match.coachRegNo ? "(" + match.coachRegNo + ")" : ""}</td>
    <td class="label" style="width:25%;">Captain Name &amp; Surname &amp; Reg No:</td>
    <td style="width:25%;">${captain ? captain.name : ""} ${captain?.regNo ? "(" + captain.regNo + ")" : ""}</td>
  </tr>
  <tr>
    <td class="label">Manager Name / Surname &amp; Reg No:</td>
    <td>${match.managerName || ""} ${match.managerRegNo ? "(" + match.managerRegNo + ")" : ""}</td>
    <td class="label">Physio / First Aider Name &amp; Reg No:</td>
    <td>${match.physioName || ""} ${match.physioRegNo ? "(" + match.physioRegNo + ")" : ""}</td>
  </tr>
  <tr>
    <td class="label">Signature of Coach/Manager:</td>
    <td><span class="sig-line"></span></td>
    <td class="label">Signature of Referee:</td>
    <td><span class="sig-line"></span></td>
  </tr>
</table>

<table class="footer-table" style="margin-top:10px;">
  <tr><td class="label" style="width:20%;">Substitutions</td><td>1- No In: _______  No Out: _______ &nbsp;&nbsp; 2- No In: _______  No Out: _______ &nbsp;&nbsp; 3- No In: _______  No Out: _______</td></tr>
  <tr><td></td><td>4- No In: _______  No Out: _______ &nbsp;&nbsp; 5- No In: _______  No Out: _______ &nbsp;&nbsp; C- No In: _______  No Out: _______</td></tr>
  <tr><td class="label">Comments:</td><td>${match.comments || ""}</td></tr>
</table>

</body>
</html>`;
}

export function printTeamSheet(match, squadRows, players) {
  const html = buildTeamSheetHTML(match, squadRows, players);
  const w = window.open("", "_blank");
  if (!w) {
    alert("Please allow pop-ups for this site to print the team sheet.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}
