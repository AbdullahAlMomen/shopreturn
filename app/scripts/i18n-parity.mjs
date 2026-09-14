import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const en = new Set(Object.keys(JSON.parse(read("blocks/localization/common.en.json"))));
const bn = new Set(Object.keys(JSON.parse(read("blocks/localization/common.bn.json"))));
const dict = new Set([...read("src/lib/i18n/dictionary.ts").matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));

// LocalizationProvider.tsx merges the cloud "common" module (the only module
// this app loads -- see its `MODULES = ["common"]`) into the app's key space
// with this exact rule:
//   const appKey = moduleName === "common" && key in defaultDictionary ? key : `${moduleName}.${key}`;
// A raw JSON key resolves to itself only when that bare string already is a
// dictionary key (e.g. raw "nav.profile" -> app "nav.profile"); otherwise the
// provider implicitly prefixes it with "common." (e.g. raw "save" -> app
// "common.save"). That's why common.en.json/common.bn.json store "save"
// rather than "common.save". This function must stay in sync with that rule
// in LocalizationProvider.tsx -- it mirrors the provider's prefix-strip for
// "common.*", not a hand-picked list of aliases.
function toAppKeys(rawKeys, dictionaryKeys) {
  return new Set([...rawKeys].map((rawKey) => (dictionaryKeys.has(rawKey) ? rawKey : `common.${rawKey}`)));
}

const enAppKeys = toAppKeys(en, dict);
const bnAppKeys = toAppKeys(bn, dict);

const missing = (from, into) => [...from].filter((key) => !into.has(key));
const problems = [
  ["dictionary.ts -> en", missing(dict, enAppKeys)], ["dictionary.ts -> bn", missing(dict, bnAppKeys)],
  ["en -> dictionary.ts", missing(enAppKeys, dict)], ["bn -> dictionary.ts", missing(bnAppKeys, dict)]
].filter(([, keys]) => keys.length > 0);

console.log(`dictionary=${dict.size} en=${en.size} bn=${bn.size}`);
for (const [label, keys] of problems) console.log(`MISSING ${label}: ${keys.join(", ")}`);
process.exit(problems.length === 0 ? 0 : 1);
