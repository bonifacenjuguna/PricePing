/**
 * Minimal pure-JS reader for POSIX ustar-format .tar archives.
 *
 * Why hand-rolled instead of a package: this sandbox has no network access
 * to install (or verify) a tar library, and the ustar format itself is
 * simple enough — a sequence of 512-byte headers, each followed by the
 * file's content padded to a 512-byte boundary — to parse safely by hand.
 * .tar.gz is handled by gunzipping first with Node's built-in `zlib`
 * (no dependency needed there either), then feeding the result in here.
 *
 * Deliberately NOT supported: GNU longname entries (typeflag 'L') and PAX
 * extended headers ('x'/'g'), which need their own multi-block parsing to
 * get right. Rather than risk silently mis-reading a filename from those,
 * matching entries are skipped and reported back as a warning so the
 * upload flow can tell the person exactly what didn't come through.
 */

function readOctal(buf) {
  const str = buf.toString('ascii').replace(/\0.*$/, '').trim();
  return str ? parseInt(str, 8) : 0;
}

function readString(buf) {
  const idx = buf.indexOf(0);
  return (idx === -1 ? buf : buf.slice(0, idx)).toString('utf8');
}

function extractTar(buffer) {
  const entries = [];
  let skippedCount = 0;
  let offset = 0;
  let skipNext = false; // set when the previous header was a GNU longname/PAX block

  while (offset + 512 <= buffer.length) {
    const header = buffer.slice(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker (two all-zero blocks)

    const name = readString(header.slice(0, 100));
    if (!name) { offset += 512; continue; }

    const size = readOctal(header.slice(124, 136));
    const typeflag = String.fromCharCode(header[156] || 0);
    const prefix = readString(header.slice(345, 500));
    const fullName = prefix ? `${prefix}/${name}` : name;

    const dataStart = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;

    if (typeflag === 'L' || typeflag === 'x' || typeflag === 'g') {
      // GNU longname / PAX extended header — the real path for the file
      // this describes lives in this block's data, not the 100-char `name`
      // field above. Reconstructing it correctly needs its own parsing this
      // reader doesn't do, and reading the FOLLOWING entry under its
      // truncated 100-char name would be worse than skipping it outright
      // (a file silently committed under the wrong path). So: skip this
      // header block and the one file entry it describes, and count it.
      skipNext = true;
      skippedCount++;
    } else if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
      if (skipNext) {
        skipNext = false;
      } else {
        entries.push({ name: fullName, data: buffer.slice(dataStart, dataStart + size) });
      }
    } else {
      skipNext = false; // directory/symlink/etc. — resets the flag defensively
    }
    // typeflag '5' = directory, others (symlinks, devices, ...) intentionally
    // skipped — none of those are meaningful to a GitHub file commit.

    offset = dataStart + paddedSize;
  }

  return { entries, skippedCount };
}

module.exports = { extractTar };
