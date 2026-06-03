// Minimal, dependency-free XPI (zip) packer.
// Usage: node build-xpi.mjs <srcDir> <outFile>
// Written because PowerShell's Compress-Archive produces archives that
// Zotero's zip reader (libjar) rejects as corrupt.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

function listFiles(dir, base = dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
		else out.push(relative(base, p).split(sep).join("/"));
	}
	return out;
}

const [srcDir, outFile] = process.argv.slice(2);
if (!srcDir || !outFile) {
	console.error("Usage: node build-xpi.mjs <srcDir> <outFile>");
	process.exit(1);
}

const names = listFiles(srcDir).sort();
// Fixed timestamp (2026-06-03 12:00) for deterministic builds
const dosTime = 12 << 11;
const dosDate = ((2026 - 1980) << 9) | (6 << 5) | 3;

const chunks = [];
const central = [];
let offset = 0;

for (const name of names) {
	const data = readFileSync(join(srcDir, name));
	const crc = crc32(data) >>> 0;
	let method = 8;
	let comp = deflateRawSync(data, { level: 9 });
	if (comp.length >= data.length) {
		method = 0;
		comp = data;
	}
	const nameBuf = Buffer.from(name, "utf8");

	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0); // local file header signature
	local.writeUInt16LE(20, 4); //         version needed
	local.writeUInt16LE(0, 6); //          flags
	local.writeUInt16LE(method, 8);
	local.writeUInt16LE(dosTime, 10);
	local.writeUInt16LE(dosDate, 12);
	local.writeUInt32LE(crc, 14);
	local.writeUInt32LE(comp.length, 18);
	local.writeUInt32LE(data.length, 22);
	local.writeUInt16LE(nameBuf.length, 26);
	local.writeUInt16LE(0, 28); //         extra field length
	chunks.push(local, nameBuf, comp);

	const cen = Buffer.alloc(46); // trailing fields stay zero
	cen.writeUInt32LE(0x02014b50, 0); //   central directory signature
	cen.writeUInt16LE(20, 4); //           version made by
	cen.writeUInt16LE(20, 6); //           version needed
	cen.writeUInt16LE(0, 8); //            flags
	cen.writeUInt16LE(method, 10);
	cen.writeUInt16LE(dosTime, 12);
	cen.writeUInt16LE(dosDate, 14);
	cen.writeUInt32LE(crc, 16);
	cen.writeUInt32LE(comp.length, 20);
	cen.writeUInt32LE(data.length, 24);
	cen.writeUInt16LE(nameBuf.length, 28);
	cen.writeUInt32LE(offset, 42); //      local header offset
	central.push(cen, nameBuf);

	offset += local.length + nameBuf.length + comp.length;
}

const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
eocd.writeUInt16LE(names.length, 8);
eocd.writeUInt16LE(names.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

mkdirSync(dirname(outFile) || ".", { recursive: true });
writeFileSync(outFile, Buffer.concat([...chunks, centralBuf, eocd]));
console.log(`Built ${outFile} (${names.length} files)`);
