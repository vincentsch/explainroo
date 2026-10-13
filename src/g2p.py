import contextlib
import json
import sys

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

language = sys.argv[1]
try:
    with contextlib.redirect_stdout(sys.stderr):
        # Mandarin 1.1 uses a different phoneme alphabet from Kokoro v1.0.
        if language == 'ja':
            from misaki.ja import JAG2P
            g2p = JAG2P()
        else:
            from misaki.zh import ZHG2P
            g2p = ZHG2P(version=None)
        for line in sys.stdin:
            text = json.loads(line)
            phonemes, _ = g2p(text)
            print(json.dumps(phonemes, ensure_ascii=False), file=sys.__stdout__, flush=True)
except Exception as error:
    print(f'{type(error).__name__}: {error}'.splitlines()[0], file=sys.stderr)
    sys.exit(1)
