import jsPDF from "jspdf";
import LETTERHEAD_SRC from "../assets/letterhead.jpg";
import { fmtMoney, fmtDate, todayISO } from "./format.js";

// ---------------------------------------------------------------------------
// Generates the subscription statement PDF (used for both individual and
// bulk email sending). Uses the club's real letterhead as the header banner.
// ---------------------------------------------------------------------------

export function generateStatementPDF(player, clubSettings) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;

  // Letterhead banner spans the full page width, keeping its real aspect ratio.
  const letterheadAspect = 1600 / 277;
  const letterheadHeight = pageWidth / letterheadAspect;
  try {
    doc.addImage(LETTERHEAD_SRC, "JPEG", 0, 0, pageWidth, letterheadHeight);
  } catch (e) {
    // ignore if the image fails to embed - statement still generates without it
  }

  let y = letterheadHeight + 34;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(36, 26, 69); // T.indigo
  doc.text("Subscription Statement", margin, y);

  y += 24;
  doc.setDrawColor(226, 219, 201);
  doc.line(margin, y, pageWidth - margin, y);
  y += 28;

  doc.setTextColor(28, 23, 48);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(player.name, margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y += 16;
  doc.text(`Age group: ${player.ageGroup || "-"}`, margin, y);
  doc.text(`Statement date: ${fmtDate(todayISO())}`, pageWidth - margin - 150, y);
  y += 14;
  doc.text(`Tier: ${player.tierName || "No tier assigned"}${player.fee ? ` (${fmtMoney(player.fee)}/mo)` : ""}`, margin, y);
  if (player.regNo) {
    y += 14;
    doc.text(`Federation reg. no: ${player.regNo}`, margin, y);
  }

  y += 30;
  doc.setFillColor(239, 233, 218); // T.paperDim
  doc.rect(margin, y, pageWidth - margin * 2, 24, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(91, 84, 112);
  doc.text("DATE", margin + 8, y + 16);
  doc.text("METHOD", margin + 160, y + 16);
  doc.text("AMOUNT", pageWidth - margin - 80, y + 16);
  y += 24;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(28, 23, 48);
  const payments = [...(player.payments || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (payments.length === 0) {
    y += 18;
    doc.setTextColor(90, 84, 112);
    doc.text("No payments recorded yet.", margin + 8, y);
    y += 10;
  } else {
    payments.forEach((p) => {
      y += 18;
      if (y > 760) { doc.addPage(); y = 56; }
      doc.setTextColor(28, 23, 48);
      doc.text(fmtDate(p.date), margin + 8, y);
      doc.text(p.method || "-", margin + 160, y);
      doc.text(fmtMoney(p.amount), pageWidth - margin - 80, y);
    });
  }

  y += 30;
  doc.setDrawColor(226, 219, 201);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Total billed to date", margin, y);
  doc.text(fmtMoney(player.due), pageWidth - margin - 80, y);
  y += 16;
  doc.text("Total paid", margin, y);
  doc.text(fmtMoney(player.paid), pageWidth - margin - 80, y);
  y += 16;
  doc.setFontSize(12);
  doc.setTextColor(player.balance > 0 ? 193 : 30, player.balance > 0 ? 68 : 122, player.balance > 0 ? 60 : 65);
  doc.text("Balance due", margin, y);
  doc.text(fmtMoney(player.balance), pageWidth - margin - 80, y);

  if (clubSettings?.bankDetails) {
    y += 40;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(28, 23, 48);
    doc.text("Payment details", margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(clubSettings.bankDetails, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12;
  }

  if (clubSettings?.invoiceFooterNote) {
    y += 26;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(90, 84, 112);
    const lines = doc.splitTextToSize(clubSettings.invoiceFooterNote, pageWidth - margin * 2);
    doc.text(lines, margin, y);
  }

  return doc.output("datauristring").split(",")[1]; // base64 only, no data: prefix
}
