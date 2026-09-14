import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const en = new Set(Object.keys(JSON.parse(read("blocks/localization/common.en.json"))));
const bn = new Set(Object.keys(JSON.parse(read("blocks/localization/common.bn.json"))));
const dict = new Set([...read("src/lib/i18n/dictionary.ts").matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));

const missing = (from, into) => [...from].filter((key) => !into.has(key));
const problems = [
  ["dictionary.ts -> en", missing(dict, en)], ["dictionary.ts -> bn", missing(dict, bn)],
  ["en -> dictionary.ts", missing(en, dict)], ["bn -> dictionary.ts", missing(bn, dict)]
].filter(([, keys]) => keys.length > 0);

console.log(`dictionary=${dict.size} en=${en.size} bn=${bn.size}`);
for (const [label, keys] of problems) console.log(`MISSING ${label}: ${keys.join(", ")}`);
process.exit(problems.length === 0 ? 0 : 1);
