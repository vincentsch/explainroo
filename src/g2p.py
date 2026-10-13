import contextlib
import json
import sys

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

mode = sys.argv[1]


DIGITS = ['ゼロ', 'イチ', 'ニ', 'サン', 'ヨン', 'ゴ', 'ロク', 'ナナ', 'ハチ', 'キュー']


def below_10000(n):
    th, h, t, o = n // 1000, n // 100 % 10, n // 10 % 10, n % 10
    out = {1: 'セン', 3: 'サンゼン', 8: 'ハッセン'}.get(th, DIGITS[th] + 'セン') if th else ''
    out += {1: 'ヒャク', 3: 'サンビャク', 6: 'ロッピャク', 8: 'ハッピャク'}.get(h, DIGITS[h] + 'ヒャク') if h else ''
    out += ('' if t == 1 else DIGITS[t]) + 'ジュー' if t else ''
    return out + (DIGITS[o] if o else '')


def number(digits):
    # UniDic leaves digits unread. Whisper may write a number in digits or
    # kana, so both sides get the same reading.
    n = int(digits)
    if n == 0 or n >= 10 ** 8 or digits[0] == '0':
        return ''.join(DIGITS[int(d)] for d in digits)
    man, rest = divmod(n, 10000)
    return (below_10000(man) + 'マン' if man else '') + below_10000(rest)


def readings(tagger, text):
    # [start, end, katakana reading] for each word, in characters.
    out, pos, decimal = [], 0, False
    for word in tagger(text):
        start = text.find(word.surface, pos)
        if start < 0:
            continue
        pos = start + len(word.surface)
        pron = getattr(word.feature, 'pron', None)
        surface = word.surface
        if surface.isascii() and surface.isdigit():
            # After a decimal point, digits are read one by one.
            reading = ''.join(DIGITS[int(d)] for d in surface) if decimal else number(surface)
        elif surface == '.' and out and text[start - 1:start].isdigit() and text[pos:pos + 1].isdigit():
            reading = 'テン'
        else:
            reading = pron if pron and pron != '*' else surface
        decimal = reading == 'テン' or (decimal and surface.isdigit())
        out.append([start, pos, reading])
    return out


try:
    with contextlib.redirect_stdout(sys.stderr):
        # Mandarin 1.1 uses a different phoneme alphabet from Kokoro v1.0.
        if mode == 'ja':
            from misaki.ja import JAG2P
            g2p = JAG2P()
            run = lambda text: g2p(text)[0]
        elif mode == 'zh':
            from misaki.zh import ZHG2P
            g2p = ZHG2P(version=None)
            run = lambda text: g2p(text)[0]
        else:
            # The speech check compares Japanese by sound, with the UniDic
            # dictionary misaki uses.
            import fugashi
            tagger = fugashi.Tagger()
            run = lambda text: readings(tagger, text)
        for line in sys.stdin:
            print(json.dumps(run(json.loads(line)), ensure_ascii=False), file=sys.__stdout__, flush=True)
except Exception as error:
    print(f'{type(error).__name__}: {error}'.splitlines()[0], file=sys.stderr)
    sys.exit(1)
