import { describe, it, expect } from "vitest";
import { parseMapsLink, parseMapsEmbed, checkLocationFields } from "./mapLinks.js";

const EMBED_SRC = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3309.8!2d18.52!3d-33.95!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1";
const EMBED_CODE = `<iframe src="${EMBED_SRC}" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;

describe("parseMapsLink", () => {
  it("accepts blank as no link", () => {
    expect(parseMapsLink("")).toEqual({ value: "" });
    expect(parseMapsLink("   ")).toEqual({ value: "" });
  });
  it("accepts Google Maps share links", () => {
    expect(parseMapsLink("https://maps.app.goo.gl/AbC123xyz").value).toBe("https://maps.app.goo.gl/AbC123xyz");
    expect(parseMapsLink(" https://www.google.com/maps/place/Athlone+Stadium/@-33.95,18.52,17z ").value)
      .toBe("https://www.google.com/maps/place/Athlone+Stadium/@-33.95,18.52,17z");
    expect(parseMapsLink("https://www.google.co.za/maps?q=-33.95,18.52").value).toBeTruthy();
    expect(parseMapsLink("https://maps.google.com/?q=-33.95,18.52").value).toBeTruthy();
    expect(parseMapsLink("https://goo.gl/maps/abc").value).toBeTruthy();
  });
  it("rejects other sites and lookalikes", () => {
    for (const bad of [
      "https://example.com/maps",
      "http://maps.app.goo.gl/abc",
      "https://maps.app.goo.gl.evil.com/abc",
      "https://www.google.com/search?q=stadium",
      "https://evil.com/?https://maps.app.goo.gl/x",
      "javascript:alert(1)",
      "https://user:pw@maps.app.goo.gl/abc",
      "https://maps.app.goo.gl/",
      "Athlone Stadium",
    ]) {
      expect(parseMapsLink(bad).error, bad).toBeTruthy();
    }
  });
  it("points embed code to the other box", () => {
    expect(parseMapsLink(EMBED_CODE).error).toMatch(/Map embed box/);
  });
});

describe("parseMapsEmbed", () => {
  it("accepts blank as no map", () => {
    expect(parseMapsEmbed("")).toEqual({ value: "" });
  });
  it("extracts the address from Google's iframe code", () => {
    expect(parseMapsEmbed(EMBED_CODE).value).toBe(EMBED_SRC);
  });
  it("accepts the bare embed address", () => {
    expect(parseMapsEmbed(EMBED_SRC).value).toBe(EMBED_SRC);
  });
  it("decodes &amp; in pasted code", () => {
    const src = "https://www.google.com/maps/embed/v1/place?key=abc&amp;q=Athlone";
    expect(parseMapsEmbed(`<iframe src="${src}"></iframe>`).value)
      .toBe("https://www.google.com/maps/embed/v1/place?key=abc&q=Athlone");
  });
  it("rejects iframes from other sites and script tricks", () => {
    for (const bad of [
      `<iframe src="https://evil.com/maps/embed?pb=1"></iframe>`,
      `<iframe src="javascript:alert(1)"></iframe>`,
      `<iframe srcdoc="<script>alert(1)</script>"></iframe>`,
      "https://www.google.com/maps/embed",
      "https://www.google.com/maps/embedx?pb=1",
      `https://www.google.com/maps/embed?pb=1"onload="alert(1)`,
      "<script>alert(1)</script>",
    ]) {
      expect(parseMapsEmbed(bad).error, bad).toBeTruthy();
    }
  });
  it("points share links to the other box", () => {
    expect(parseMapsEmbed("https://maps.app.goo.gl/AbC123").error).toMatch(/Directions link box/);
  });
});

describe("checkLocationFields", () => {
  it("returns cleaned values when both are valid", () => {
    const r = checkLocationFields({ locationLink: "https://maps.app.goo.gl/x1", locationEmbed: EMBED_CODE });
    expect(r.ok).toBe(true);
    expect(r.locationEmbed).toBe(EMBED_SRC);
  });
  it("is ok with both blank", () => {
    expect(checkLocationFields({}).ok).toBe(true);
  });
  it("reports each bad field", () => {
    const r = checkLocationFields({ locationLink: "nope", locationEmbed: "nope" });
    expect(r.ok).toBe(false);
    expect(r.errors.link).toBeTruthy();
    expect(r.errors.embed).toBeTruthy();
  });
});
