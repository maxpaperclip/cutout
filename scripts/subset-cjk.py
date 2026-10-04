#!/usr/bin/env python3
"""Makes src/fonts/noto-sans-sc.woff: Noto Sans SC Regular cut down to the characters people actually type.

The full font is about 10 MB. This keeps the 3,755 common Chinese characters (GB2312 level 1), the GB2312
symbol rows (punctuation, full-width forms, Greek, Cyrillic, pinyin letters), plain ASCII, Latin-1 and the usual
curly quotes and dashes: about 0.8 MB as a .woff. Hinting and layout features other than kerning are dropped
(FriendShaped turns text into outlines, so it needs neither).

Needs: python3, fonttools (pip install fonttools), npm, tar, internet. Run: python3 scripts/subset-cjk.py
"""
import os, subprocess, sys, tempfile, glob

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONTS = os.path.join(ROOT, 'src', 'fonts')

def gb2312(rows):
    out = []
    for r in rows:
        for c in range(0xA1, 0xFF):
            try:
                out.append(bytes([0xA0 + r, c]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return ''.join(out)

chars = (gb2312(range(16, 56))                      # 3,755 common characters
         + gb2312(range(1, 10))                     # symbols, punctuation, full-width forms, Greek, Cyrillic, pinyin
         + ''.join(chr(i) for i in range(0x20, 0x7F)) + ''.join(chr(i) for i in range(0xA0, 0x100))
         + '‘’“”…—–•·、。，！？：；（）《》【】')

with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['npm', 'pack', '@expo-google-fonts/noto-sans-sc', '--silent'], cwd=tmp, check=True, stdout=subprocess.DEVNULL)
    tgz = glob.glob(os.path.join(tmp, '*.tgz'))[0]
    subprocess.run(['tar', '-xzf', tgz, 'package/400Regular/NotoSansSC_400Regular.ttf'], cwd=tmp, check=True)
    with open(os.path.join(tmp, 'chars.txt'), 'w', encoding='utf-8') as f:
        f.write(chars)
    out = os.path.join(FONTS, 'noto-sans-sc.woff')
    subprocess.run(['pyftsubset', os.path.join(tmp, 'package/400Regular/NotoSansSC_400Regular.ttf'),
                    '--text-file=' + os.path.join(tmp, 'chars.txt'), '--flavor=woff', '--no-hinting',
                    '--layout-features=kern', '--drop-tables+=DSIG', '--output-file=' + out], check=True)
    # The font's own license (SIL Open Font License 1.1) comes from the Fontsource package; the npm wrapper
    # used above for the font file carries its own, unrelated license
    lic_dir = os.path.join(tmp, 'lic'); os.makedirs(lic_dir)
    subprocess.run(['npm', 'pack', '@fontsource/noto-sans-sc', '--silent'], cwd=lic_dir, check=True, stdout=subprocess.DEVNULL)
    fs_tgz = glob.glob(os.path.join(lic_dir, '*.tgz'))[0]
    subprocess.run(['tar', '-xzf', fs_tgz, 'package/LICENSE'], cwd=lic_dir, check=True)
    os.makedirs(os.path.join(FONTS, 'licenses'), exist_ok=True)
    with open(os.path.join(lic_dir, 'package', 'LICENSE'), 'rb') as a, open(os.path.join(FONTS, 'licenses', 'noto-sans-sc.txt'), 'wb') as b:
        b.write(a.read())
print('wrote', out, os.path.getsize(out), 'bytes,', len(set(chars)), 'characters')
