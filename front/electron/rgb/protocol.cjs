// OpenRGB SDK protocol v1: negotiated deliberately to keep one stable layout.
const VERSION = 1;
const MAX_PACKET = 1024 * 1024;
const uint32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
function packet(id, device = 0, body = Buffer.alloc(0)) {
  const header = Buffer.alloc(16);
  header.write("ORGB"); header.writeUInt32LE(device, 4);
  header.writeUInt32LE(id, 8); header.writeUInt32LE(body.length, 12);
  return Buffer.concat([header, body]);
}
function parseController(body, id) {
  let offset = 0;
  const take = (size) => {
    if (size < 0 || offset + size > body.length) throw new Error("Invalid RGB controller data");
    const result = body.subarray(offset, offset + size); offset += size; return result;
  };
  const u16 = () => take(2).readUInt16LE();
  const u32 = () => take(4).readUInt32LE();
  const string = () => take(u16()).toString("utf8").replace(/\0+$/, "");
  if (u32() !== body.length) throw new Error("Invalid RGB data size");
  const type = u32(), name = string();
  for (let i = 0; i < 5; i++) string(); // vendor, description, version, serial, location
  const modeCount = u16(), activeMode = u32(), modes = [];
  for (let i = 0; i < modeCount; i++) {
    const start = offset, name = string();
    u32(); const flags = u32();
    take(7 * 4); // speed bounds, color bounds, speed, direction, color mode
    take(u16() * 4);
    modes.push({ name, flags, raw: body.subarray(start, offset) });
  }
  const zones = u16();
  for (let i = 0; i < zones; i++) { string(); take(16); take(u16()); }
  const leds = u16();
  for (let i = 0; i < leds; i++) { string(); take(4); }
  const colorCount = u16(), colors = Buffer.from(take(colorCount * 4));
  if (offset !== body.length || colorCount > 4096 || !modes[activeMode]) throw new Error("Invalid RGB controller layout");
  return { id, type, name, modes, activeMode, colors, colorCount };
}
function colorBody(colors) {
  const header = Buffer.alloc(6); header.writeUInt32LE(6 + colors.length); header.writeUInt16LE(colors.length / 4, 4);
  return Buffer.concat([header, colors]);
}
function modeBody(index, raw) { return Buffer.concat([uint32(8 + raw.length), uint32(index), raw]); }
module.exports = { VERSION, MAX_PACKET, uint32, packet, parseController, colorBody, modeBody };
