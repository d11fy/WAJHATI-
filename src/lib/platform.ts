export function base32(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  let remainder = 0;
  let count = 0;
  for (const byte of bytes) {
    remainder = (remainder << 8) | byte;
    count += 8;
    while (count >= 5) {
      count -= 5;
      out += alphabet[(remainder >> count) & 31];
    }
  }
  return count ? out + alphabet[(remainder << (5 - count)) & 31] : out;
}
