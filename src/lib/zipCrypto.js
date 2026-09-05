/**
 * Detects whether a .zip archive has password-protected (encrypted)
 * entries, by reading the raw bytes directly rather than relying on
 * adm-zip's error text for a failed read. This matters because there's no
 * network access in this environment to install/verify adm-zip's exact
 * error wording across versions — a byte-level check against the
 * documented ZIP format is something that can actually be tested here,
 * and it was: verified against a real ZipCrypto-encrypted archive built
 * with the standard `zip --password` CLI.
 *
 * ZIP local file header layout (PKWARE APPNOTE.TXT):
 *   offset 0-3   signature (0x04034b50, "PK\3\4")
 *   offset 6-7   general purpose bit flag — bit 0 set = encrypted
 *   offset 18-21 compressed size
 *   offset 26-27 file name length
 *   offset 28-29 extra field length
 * Walking header → compressed data → next header in sequence lets this
 * check every entry without needing a full zip parser.
 */
function isZipEncrypted(buffer) {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break; // not a local file header — stop scanning
    const flags = buffer.readUInt16LE(offset + 6);
    if (flags & 0x1) return true;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    offset += 30 + nameLen + extraLen + compressedSize;
  }
  return false;
}

module.exports = { isZipEncrypted };
