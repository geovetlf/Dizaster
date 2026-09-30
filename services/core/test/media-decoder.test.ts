import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { inProcessDecoder, IsolatedDecoder } from "../src/modules/media/index.js";
import { MalformedMediaError } from "../src/modules/media/sanitize.js";
import { makeJpeg, makeMp4 } from "./media-fixtures.js";

// Decodificación aislada (ADR 0194). NO AI REQUIRED.
const decoder = new IsolatedDecoder({ timeoutMs: 20_000, maxOldSpaceMb: 128 });
afterAll(() => decoder.close());

const realJpeg = () => sharp({ create: { width: 640, height: 480, channels: 3, background: "#336699" } }).jpeg().toBuffer();

describe("decodificador aislado", () => {
  it("da lo mismo que en el mismo proceso: saneado, video y variantes", async () => {
    const jpeg = makeJpeg({ exif: true });
    const iso = await decoder.sanitize("image/jpeg", jpeg);
    const local = await inProcessDecoder.sanitize("image/jpeg", jpeg);
    expect(Buffer.from(iso.data).equals(Buffer.from(local.data))).toBe(true);
    expect(iso.removed).toEqual(local.removed);

    const mp4 = makeMp4({ durationMs: 5000, width: 1280, height: 720 });
    expect(await decoder.videoInfo(mp4)).toEqual(await inProcessDecoder.videoInfo(mp4));

    const img = await decoder.renderImage(await realJpeg());
    expect(img.width).toBe(640);
    expect(img.variants.map((v) => v.variant)).toEqual(["DISPLAY", "THUMB_S"]);
    expect(Buffer.isBuffer(img.variants[0]!.data)).toBe(true);
    expect(img.phash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("un archivo ilegible se rechaza como dañado y el proceso sigue sirviendo", async () => {
    await expect(decoder.renderImage(Buffer.from("no soy una imagen"))).rejects.toBeInstanceOf(MalformedMediaError);
    expect((await decoder.renderImage(await realJpeg())).height).toBe(480);
  });

  it("al vencer el tiempo se mata el proceso y el archivo se rechaza", async () => {
    const slow = new IsolatedDecoder({ timeoutMs: 1, maxOldSpaceMb: 128 });
    try {
      const big = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#000" } }).jpeg().toBuffer();
      const err = await slow.renderImage(big).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MalformedMediaError);
      expect((err as Error).message).toMatch(/sin terminar|interrumpida/);
    } finally {
      await slow.close();
    }
  });
});
