// Reads JSON on stdin and prints it with every password-like field replaced.
// Used on CLI dry-run output, which echoes the request body verbatim.
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) =>
        [key, /password/i.test(key) ? '<redacted>' : redact(inner)]));
    }
    return value;
  };
  try { console.log(JSON.stringify(redact(JSON.parse(input)), null, 2)); }
  catch { console.log('<non-JSON output suppressed: it may contain the password>'); }
});
