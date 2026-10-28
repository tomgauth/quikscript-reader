// node build_ipa.js cmudict.dict out.txt  ->  "word\tIPA" (American, first pronunciation)
const fs = require('fs');
const Core = require('../extension/engine/qs-core.js');
const out = [];
for (const line of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!line || line.startsWith(';;;')) continue;
  const m = line.match(/^(\S+)\s+(.+?)(\s+#.*)?$/);
  if (!m || /\(\d+\)$/.test(m[1]) || !/^[a-z][a-z']*$/.test(m[1])) continue;
  out.push(m[1] + '\t' + Core.arpaToIpa(m[2]));
}
fs.writeFileSync(process.argv[3], out.join('\n'));
console.log(out.length);
