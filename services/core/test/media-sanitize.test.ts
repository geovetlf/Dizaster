import { describe, expect, it } from "vitest";
import { MalformedMediaError, neutralizeIsoBmffLocation, sniffFamily, stripJpegMetadata, topLevelBoxes } from "../src/modules/media/sanitize.js";
import { ANDROID_LOCATION, IOS_LOCATION, makeJpeg, makeMp4 } from "./media-fixtures.js";

const has = (buf: Uint8Array, s: string) => Buffer.from(buf).includes(Buffer.from(s, "latin1"));

describe("detección del tipo real", () => {
  it("reconoce JPEG y MP4/MOV por su contenido, no por lo que declara el cliente", () => {
    expect(sniffFamily(makeJpeg())).toBe("image/jpeg");
    expect(sniffFamily(makeMp4())).toBe("video/isobmff");
    expect(sniffFamily(makeMp4({ brand: "qt  " }))).toBe("video/isobmff");
    expect(sniffFamily(Buffer.from("<html>no soy una foto</html>"))).toBeNull();
  });
});

describe("JPEG sin metadatos", () => {
  it("quita Exif (con GPS) y comentarios, conserva perfil de color y la imagen", () => {
    const src = makeJpeg();
    const { data, removed } = stripJpegMetadata(src);
    expect(has(src, "GPSLatitude")).toBe(true);
    expect(has(data, "GPSLatitude")).toBe(false);
    expect(has(data, "Exif")).toBe(false);
    expect(has(data, "comentario")).toBe(false);
    expect(has(data, "ICC_PROFILE")).toBe(true);
    expect(has(data, "JFIF")).toBe(true);
    expect(removed).toEqual(["APP1 (Exif/XMP)", "COM"]);
    // Los datos de imagen (tras SOS) quedan idénticos.
    const tail = (b: Uint8Array) => Buffer.from(b).subarray(Buffer.from(b).indexOf(Buffer.from([0xff, 0xda])));
    expect(tail(data).equals(tail(src))).toBe(true);
  });

  it("una foto ya limpia no cambia", () => {
    const src = makeJpeg({ exif: false });
    const { data } = stripJpegMetadata(src);
    expect(Buffer.from(data).length).toBe(src.length - (src.indexOf(Buffer.from([0xff, 0xdb])) - src.indexOf(Buffer.from([0xff, 0xfe]))));
  });

  it("rechaza JPEG truncados o falsos", () => {
    expect(() => stripJpegMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow(MalformedMediaError);
    expect(() => stripJpegMetadata(Buffer.from("no"))).toThrow(MalformedMediaError);
  });
});

describe("MP4/MOV sin ubicación", () => {
  it("neutraliza ©xyz (Android), ISO6709 de iOS y loci sin cambiar el tamaño", () => {
    const src = makeMp4();
    const { data, removed } = neutralizeIsoBmffLocation(src);
    expect(data.length).toBe(src.length);
    const moov = topLevelBoxes(data).find((b) => b.type === "moov")!;
    const moovBytes = Buffer.from(data).subarray(moov.start, moov.end);
    expect(moovBytes.includes(Buffer.from(ANDROID_LOCATION))).toBe(false);
    expect(moovBytes.includes(Buffer.from(IOS_LOCATION))).toBe(false);
    expect(moovBytes.includes(Buffer.from("+00.0000-000.0000/"))).toBe(true);
    expect(moovBytes.includes(Buffer.from("Lima"))).toBe(false);
    expect(removed.sort()).toEqual(["ISO6709", "loci"]);
    // La estructura sigue siendo válida y los datos de video no se tocan.
    expect(topLevelBoxes(data).map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    const mdat = topLevelBoxes(data).find((b) => b.type === "mdat")!;
    expect(Buffer.from(data).subarray(mdat.start, mdat.end).includes(Buffer.from(ANDROID_LOCATION))).toBe(true);
  });

  it("funciona con moov al final (videos sin faststart)", () => {
    const { data } = neutralizeIsoBmffLocation(makeMp4({ moovFirst: false }));
    const moov = topLevelBoxes(data).find((b) => b.type === "moov")!;
    expect(Buffer.from(data).subarray(moov.start, moov.end).includes(Buffer.from(ANDROID_LOCATION))).toBe(false);
  });

  it("no modifica la entrada", () => {
    const src = makeMp4();
    const copy = Buffer.from(src);
    neutralizeIsoBmffLocation(src);
    expect(src.equals(copy)).toBe(true);
  });

  it("rechaza videos sin moov o con cajas corruptas", () => {
    expect(() => neutralizeIsoBmffLocation(Buffer.concat([makeMp4().subarray(0, 24)]))).toThrow(MalformedMediaError);
    const bad = Buffer.from(makeMp4());
    bad.writeUInt32BE(0xffffff, 28); // tamaño de moov (tras ftyp de 28 bytes) fuera del archivo
    expect(() => neutralizeIsoBmffLocation(bad)).toThrow(MalformedMediaError);
  });
});

describe("videoInfo (ADR 0071)", () => {
  it("lee duración de mvhd y tamaño del tkhd de la pista de video", async () => {
    const { videoInfo } = await import("../src/modules/media/sanitize.js");
    expect(videoInfo(makeMp4({ durationMs: 12_345, width: 1080, height: 1920 }))).toEqual({ durationMs: 12_345, width: 1080, height: 1920, codec: "avc1" });
    expect(videoInfo(makeMp4({ codec: "hvc1" })).codec).toBe("hvc1");
    expect(videoInfo(makeMp4({ codec: null })).codec).toBeNull();
    expect(videoInfo(makeMp4({ moovFirst: false })).durationMs).toBe(24_000);
    expect(() => videoInfo(makeMp4().subarray(0, 30))).toThrow();
  });
});
