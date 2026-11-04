// Encrypts the cards in ./cards/*.json into cards.enc.json for the site,
// and writes anki-export.txt for anyone who prefers Anki.
//
// Usage: node build.mjs "your password"
// Needs Node 18+ and nothing else.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";

const ITERATIONS = 250000;
const password = process.argv[2] || process.env.QF_PASSWORD;
if (!password) {
  console.error('Usage: node build.mjs "your password"');
  process.exit(1);
}

// Load and check the card files
const files = readdirSync("cards").filter((f) => f.endsWith(".json")).sort();
const categories = [];
const seen = new Set();
let problems = 0;
for (const file of files) {
  const cat = JSON.parse(readFileSync(`cards/${file}`, "utf8"));
  if (!cat.category || !cat.title || !Array.isArray(cat.cards)) {
    console.error(`${file}: needs "category", "title" and "cards"`);
    problems++;
    continue;
  }
  for (const card of cat.cards) {
    if (!card.id || !card.q || !card.a) {
      console.error(`${file}: card ${JSON.stringify(card).slice(0, 60)} needs "id", "q" and "a"`);
      problems++;
    } else if (seen.has(card.id)) {
      console.error(`${file}: duplicate card id "${card.id}"`);
      problems++;
    }
    seen.add(card.id);
    if (![1, 2, 3].includes(card.d)) card.d = 2;
  }
  categories.push({ category: cat.category, title: cat.title, cards: cat.cards });
}
if (problems) {
  console.error(`\n${problems} problem(s) found, nothing written.`);
  process.exit(1);
}

// Make sure the config only names categories that exist
const config = JSON.parse(readFileSync("config.json", "utf8"));
const known = new Set(categories.map((c) => c.category));
const named = [...Object.values(config.people).flat(), ...(config.everyone || [])];
for (const slug of named) {
  if (!known.has(slug)) console.warn(`Warning: config.json names "${slug}", but no card file has that category.`);
}

// Encrypt with AES-256-GCM, key from PBKDF2-SHA256 (matches the browser's Web Crypto)
const plain = Buffer.from(JSON.stringify({ categories }), "utf8");
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const data = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
writeFileSync(
  "cards.enc.json",
  JSON.stringify({ v: 1, iter: ITERATIONS, salt: salt.toString("base64"), iv: iv.toString("base64"), data: data.toString("base64") })
);

// Anki: tab-separated Front, Back, Tags (File > Import, "Fields separated by: Tab", map the 3rd field to Tags)
const clean = (s) => String(s).replace(/[\t\r\n]+/g, " ");
const lines = ["#separator:tab", "#html:false", "#tags column:3"];
for (const cat of categories) {
  for (const c of cat.cards) {
    const front = c.opts ? `${c.q} (${c.opts.join(" / ")})` : c.q;
    const back = c.note ? `${c.a} | ${c.note}` : c.a;
    const tags = [`QF::${cat.category}`, ["", "easy", "medium", "hard"][c.d]].join(" ");
    lines.push([clean(front), clean(back), tags].join("\t"));
  }
}
writeFileSync("anki-export.txt", lines.join("\n") + "\n");

console.log(`Encrypted ${seen.size} cards in ${categories.length} categories into cards.enc.json`);
console.log("Wrote anki-export.txt (plain text, do not commit it)");
