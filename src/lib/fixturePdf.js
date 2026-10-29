import jsPDF from "jspdf";
import LETTERHEAD_SRC from "../assets/letterhead.jpg";

// ---------------------------------------------------------------------------
// Produces a PDF matching the club's own real weekly fixture sheet exactly:
// same letterhead as the statement PDFs, underlined "Weekly Fixtures for
// {date}" heading per date, a fully-bordered black/white table (Division,
// Opponents, Time, Field - no referee column, per the club's preference),
// and the standard footer notices + contact line.
//
// Takes the same `groups` shape the poster uses (parsed fresh from the
// fixture text box at generate-time) - this is deliberate: whatever's
// currently in the text box is what gets rendered, for both the poster
// and this PDF, with no separate/stale data source.
// ---------------------------------------------------------------------------

const DEFAULT_FOOTER_NOTICES = [
  "PLEASE BRING YOUR SHINGUARDS!",
  "PLEASE REPORT 1 HOUR BEFORE YOUR GAME!",
];

export function generateFixturesPdf(groups, options = {}) {
  const {
    footerNotices = DEFAULT_FOOTER_NOTICES,
    contactName = "Yusuf Nacerodien",
    contactPhone = "083-556-4102",
  } = options;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const rowHeight = 22;

  const letterheadAspect = 1600 / 277;
  const letterheadHeight = pageWidth / letterheadAspect;

  function drawLetterhead() {
    try {
      doc.addImage(LETTERHEAD_SRC, "JPEG", 0, 0, pageWidth, letterheadHeight);
    } catch (e) {
      // ignore if the image fails to embed - the document still generates without it
    }
  }

  drawLetterhead();
  let y = letterheadHeight + 40;

  const colWidths = { division: 150, opponents: 155, time: 60, field: 0 };
  const tableWidth = pageWidth - margin * 2;
  colWidths.field = tableWidth - colWidths.division - colWidths.opponents - colWidths.time;
  const colX = {
    division: margin,
    opponents: margin + colWidths.division,
    time: margin + colWidths.division + colWidths.opponents,
    field: margin + colWidths.division + colWidths.opponents + colWidths.time,
  };

  function ensureSpace(neededHeight) {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      drawLetterhead();
      y = letterheadHeight + 40;
    }
  }

  for (const group of (groups || [])) {
    ensureSpace(70 + group.rows.length * rowHeight);

    // Bold, centered "Weekly Fixtures for {date}" heading, matching the real sheet.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0);
    const title = `Weekly Fixtures for ${group.headerRaw}`;
    const titleWidth = doc.getTextWidth(title);
    const titleX = margin + (tableWidth - titleWidth) / 2;
    doc.text(title, titleX, y);
    doc.setDrawColor(0, 0, 0);
    doc.line(titleX, y + 2, titleX + titleWidth, y + 2);
    y += 24;

    // Fully-bordered header row, matching the real sheet's plain black/white table.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.rect(colX.division, y, colWidths.division, rowHeight);
    doc.rect(colX.opponents, y, colWidths.opponents, rowHeight);
    doc.rect(colX.time, y, colWidths.time, rowHeight);
    doc.rect(colX.field, y, colWidths.field, rowHeight);
    doc.text("Division", colX.division + 6, y + 15);
    doc.text("Opponents", colX.opponents + 6, y + 15);
    doc.text("Time", colX.time + 6, y + 15);
    doc.text("Field", colX.field + 6, y + 15);
    y += rowHeight;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    for (const row of group.rows) {
      ensureSpace(rowHeight);
      doc.rect(colX.division, y, colWidths.division, rowHeight);
      doc.rect(colX.opponents, y, colWidths.opponents, rowHeight);
      doc.rect(colX.time, y, colWidths.time, rowHeight);
      doc.rect(colX.field, y, colWidths.field, rowHeight);
      doc.text(row.team || "", colX.division + 6, y + 15, { maxWidth: colWidths.division - 10 });
      doc.text(row.vs || "", colX.opponents + 6, y + 15, { maxWidth: colWidths.opponents - 10 });
      doc.text(row.time || "", colX.time + 6, y + 15, { maxWidth: colWidths.time - 10 });
      doc.text(row.venue || "", colX.field + 6, y + 15, { maxWidth: colWidths.field - 10 });
      y += rowHeight;
    }

    y += 30;
  }

  // Footer notices + contact block, matching the real sheet.
  ensureSpace(70);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  for (const notice of footerNotices) {
    doc.text(notice, margin, y);
    y += 16;
  }
  y += 14;
  doc.text("Contact person:", margin, y);
  y += 16;
  doc.text(contactName, margin, y);
  y += 16;
  doc.text(contactPhone, margin, y);

  return doc;
}

export function downloadFixturesPdf(groups, options, filename) {
  const doc = generateFixturesPdf(groups, options);
  doc.save(filename || "garlandale-fixtures.pdf");
}
