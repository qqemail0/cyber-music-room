import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const required = [
  "public/index.html",
  "public/assets/styles.css",
  "public/assets/app.js",
  "public/firebase-config.js",
  "public/.nojekyll",
];

for (const file of required) {
  if (!existsSync(join(root, file))) {
    throw new Error(`Missing ${file}`);
  }
}

const html = readFileSync(join(root, "public/index.html"), "utf8");
const js = readFileSync(join(root, "public/assets/app.js"), "utf8");
const css = readFileSync(join(root, "public/assets/styles.css"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const privatePathMarkers = [
  ["C:", "\\", "Users", "\\"].join(""),
  ["M:", "\\"].join(""),
  ["Users", "/", "mo"].join(""),
  ["Users", "\\", "mo"].join(""),
  ["test", "chatcpt"].join(""),
  ["Downloads", "\\", ["public", "-", "apis", "-", "master"].join("")].join("")
].map(escapeRegExp);
const privatePathPattern = new RegExp(privatePathMarkers.join("|"), "i");

const checks = [
  ["title", html.includes("Neon Pulse 在线听歌房")],
  ["audio player", html.includes("<audio")],
  ["open source link", html.includes("https://github.com/qqemail0/cyber-music-room")],
  ["upload input", html.includes('type="file"')],
  ["chat ttl", js.includes("120 * 60 * 1000")],
  ["indexeddb", js.includes("indexedDB.open")],
  ["firebase optional", js.includes("NEON_FIREBASE_CONFIG")],
  ["cyber colors", css.includes("--cyan") && css.includes("--pink")],
  ["no private host paths", !privatePathPattern.test(readme)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  throw new Error(`Failed checks: ${failed.map(([name]) => name).join(", ")}`);
}

console.log("OK: static music room verified.");
