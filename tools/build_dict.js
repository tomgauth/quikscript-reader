// node build_dict.js cmudict.dict transformation.json nrl.json out.txt
const fs = require('fs');
const Core = require('../extension/engine/qs-core.js');
const [,, cmuPath, trPath, nrlPath, outPath] = process.argv;
Core.init({ transformation: JSON.parse(fs.readFileSync(trPath, 'utf8')), nrl: JSON.parse(fs.readFileSync(nrlPath, 'utf8')) });
const lines = fs.readFileSync(cmuPath, 'utf8').split('\n');
const out = [];
let n = 0;
for (const line of lines) {
  if (!line || line.startsWith(';;;')) continue;
  const m = line.match(/^(\S+)\s+(.+?)(\s+#.*)?$/);
  if (!m) continue;
  const word = m[1];
  if (/\(\d+\)$/.test(word)) continue; // alternates: keep the first pronunciation
  if (!/^[a-z][a-z']*$/.test(word)) continue;
  const names = Core.fromArpabet(m[2], word);
  if (!names.length) continue;
  out.push(word + '\t' + Core.encode(names));
  n++;
}
fs.writeFileSync(outPath, out.join('\n'));
console.log(n, 'words');
