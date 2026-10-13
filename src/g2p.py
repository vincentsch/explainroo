import contextlib
import json
import sys

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

mode = sys.argv[1]


def readings(tagger, text):
    # [start, end, katakana reading] for each word, in characters.
    out, pos = [], 0
    for word in tagger(text):
        start = text.find(word.surface, pos)
        if start < 0:
            continue
        pos = start + len(word.surface)
        pron = getattr(word.feature, 'pron', None)
        out.append([start, pos, pron if pron and pron != '*' else word.surface])
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
