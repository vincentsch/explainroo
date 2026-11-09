# Recording demo

A product demo made from a real recording. Little Ledger is a small invoice
app that comes with the tests, in `test/fixtures/demo-app/`. Its data is made
up and lives in the page.

`recordings/new-invoice.json` holds the steps: click New invoice, fill in the
form, save it. `explainroo record` ran them in a browser and saved the video
and the step log in `assets/recordings/`. The scene plays it with
`s.recording('new-invoice')`, and each step with a cue happens on its
`[#marker]` in `script.md`. The email address in the app is blurred by the
script's `blur` list.

To record it again, start the app and run `record`:

```bash
node test/fixtures/demo-app/serve.js 4500
node bin/explainroo.js record examples/recording-demo new-invoice
node bin/explainroo.js check examples/recording-demo
node bin/explainroo.js render examples/recording-demo
node bin/explainroo.js verify examples/recording-demo
```

The first run clicks away the cookie banner before the video starts. Later
runs keep the cookie in the browser profile, so that step finds nothing and
is skipped. `record --fresh` starts with an empty profile.
