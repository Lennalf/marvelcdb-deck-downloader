// zip.js — dependency-free, store-only ZIP writer (no compression) + text encoder.
// Pure: no network, no DOM. Exposed as window.MCB.zip.
(function () {
  const MCB = (window.MCB = window.MCB || {});

  const enc = (s) => new TextEncoder().encode(s);

  function crc32(buf) {
    let t = crc32._t;
    if (!t) {
      t = crc32._t = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xff];
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{ name: string, data: Uint8Array }] → Blob
  function makeZip(files) {
    const chunks = [],
      central = [];
    let offset = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255];
    const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = enc(f.name),
        data = f.data,
        crc = crc32(data);
      const local = [].concat(
        u32(0x04034b50),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
      );
      chunks.push(new Uint8Array(local), name, data);
      central.push(
        [].concat(
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(0x0800),
          u16(0),
          u16(0),
          u16(0),
          u32(crc),
          u32(data.length),
          u32(data.length),
          u16(name.length),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
        ),
        name,
      );
      offset += local.length + name.length + data.length;
    }
    const cdStart = offset;
    const cdParts = [];
    for (const c of central) {
      const arr = Array.isArray(c) ? new Uint8Array(c) : c;
      cdParts.push(arr);
      offset += arr.length;
    }
    const cdSize = offset - cdStart;
    const eocd = new Uint8Array(
      [].concat(
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(files.length),
        u16(files.length),
        u32(cdSize),
        u32(cdStart),
        u16(0),
      ),
    );
    return new Blob([...chunks, ...cdParts, eocd], { type: 'application/zip' });
  }

  MCB.zip = { enc, crc32, makeZip };
})();
