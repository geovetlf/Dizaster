/** Archivos sintéticos mínimos, con la misma estructura que los de una cámara real. */

const seg = (marker: number, payload: Buffer) => {
  const len = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, len >> 8, len & 0xff]), payload]);
};

export const EXIF_WITH_GPS = Buffer.concat([Buffer.from("Exif\0\0MM\0*"), Buffer.from("GPSLatitude -12.0464 GPSLongitude -77.0428")]);

export function makeJpeg(opts: { exif?: boolean } = {}): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    ...(opts.exif === false ? [] : [seg(0xe1, EXIF_WITH_GPS)]),
    seg(0xe2, Buffer.from("ICC_PROFILE\0perfil")),
    seg(0xfe, Buffer.from("comentario con nombre")),
    seg(0xdb, Buffer.alloc(67, 1)), // tabla de cuantización
    seg(0xda, Buffer.from([0, 1, 2, 3])), // inicio de escaneo
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), // datos comprimidos (con byte de relleno 0xFF00)
    Buffer.from([0xff, 0xd9]),
  ]);
}

const box = (type: string, payload: Buffer) => {
  const b = Buffer.alloc(8);
  b.writeUInt32BE(payload.length + 8, 0);
  b.write(type, 4, "latin1");
  return Buffer.concat([b, payload]);
};

export const ANDROID_LOCATION = "+12.0464-077.0428/";
export const IOS_LOCATION = "-12.0464-077.0428+150.123/";

export function makeMp4(opts: { location?: boolean; moovFirst?: boolean; brand?: string } = {}): Buffer {
  const ftyp = box("ftyp", Buffer.from(`${opts.brand ?? "isom"}\0\0\0\0isomiso2mp41`, "latin1"));
  const xyz = Buffer.concat([Buffer.from([0, ANDROID_LOCATION.length, 0x15, 0xc7]), Buffer.from(ANDROID_LOCATION, "latin1")]);
  const loci = Buffer.concat([Buffer.alloc(4), Buffer.from([0x15, 0xc7]), Buffer.from("Lima\0", "latin1"), Buffer.from([0]), Buffer.from([0xff, 0xb3, 0x40, 0x00, 0xff, 0xf4, 0x10, 0x00, 0, 0, 0, 0]), Buffer.from("tierra\0notas\0")]);
  const udta = opts.location === false
    ? box("udta", box("name", Buffer.from("clip")))
    : box("udta", Buffer.concat([box("©xyz", xyz), box("loci", loci), box("keys", Buffer.from(`com.apple.quicktime.location.ISO6709 ${IOS_LOCATION}`, "latin1"))]));
  const moov = box("moov", Buffer.concat([box("mvhd", Buffer.alloc(100, 0)), udta]));
  // Los bytes del video pueden contener cualquier cosa, incluido algo con forma de coordenada: no se tocan.
  const mdat = box("mdat", Buffer.from(`frames...${ANDROID_LOCATION}...frames`, "latin1"));
  return opts.moovFirst === false ? Buffer.concat([ftyp, mdat, moov]) : Buffer.concat([ftyp, moov, mdat]);
}
