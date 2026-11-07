# Warum es Schaltjahre gibt

A short German version of [leap-years](../leap-years/), in five scenes. Its
voice is a recording, `assets/narration.m4a`, so it needs no key:

```bash
npx --yes explainroo render examples/leap-years-de
```

The subject brings German numbers into the speech check: the decimal
"365,2422", the years 1582, 1900 and 2000, the ordinal in "der 29. Februar",
and 365 and 400.

## How the narration was made

Nobody read this narration aloud. Kokoro, the voice model that explainroo uses,
has no German voice. So espeak-ng's German rules turned each sentence into
German sounds, and Kokoro's French voice `ff_siwis` read them. The few German
sounds that the French voice doesn't have were replaced with the closest ones
it has. The numbers are read the way German speakers say them, like
"fünfzehnhundertzweiundachtzig" for 1582. The French voice can't say a German
"h", so two sentences avoid words that need one.

So the narration has a French accent. It stands in for a recording of your own.
A German video of your own would use your recording, ElevenLabs or Cartesia, as
`explainroo docs languages` describes.

## License

The narration was made with Kokoro, which is under the Apache 2.0 license, and
espeak-ng, which is under the GPL 3.0. Both ran only on the computer that made
it, and neither is part of this example. The narration file is part of this
repository and under its MIT license, like the rest of the example.
