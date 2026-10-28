"""Extract data-expect test cases (Manual words with expected joins) from Spaceport's site pages.

Skips cases inside force-junior runs or under a stylistic set, which test optional behaviour.
Writes [{file, expect, canonical}] as JSON.
"""
import sys, json, re
from html.parser import HTMLParser

VOID = {'br', 'img', 'meta', 'link', 'input', 'hr', 'col', 'source', 'wbr'}


class P(HTMLParser):
    def __init__(self, fname):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.cases = []
        self.fname = fname

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        flags = set()
        cls = (a.get('class') or '').split()
        if 'force-junior' in cls: flags.add('junior')
        if a.get('data-stylistic-set') or a.get('style', '').find('font-feature-settings') >= 0: flags.add('ss')
        inherited = set().union(*[s[1] for s in self.stack]) if self.stack else set()
        exp = a.get('data-expect')
        canon = True
        if exp is None and a.get('data-expect-noncanonically') is not None:
            exp = a.get('data-expect-noncanonically'); canon = False
        if exp is not None and not (inherited | flags):
            self.cases.append({'file': self.fname, 'expect': exp, 'canonical': canon})
        if tag not in VOID:
            self.stack.append((tag, flags))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


cases = []
for fn in sys.argv[2:]:
    p = P(fn.split('/')[-1])
    p.feed(open(fn, encoding='utf-8').read())
    cases += p.cases
json.dump(cases, open(sys.argv[1], 'w'), ensure_ascii=False, indent=0)
print(len(cases), 'cases;', sum(c['canonical'] for c in cases), 'canonical')
