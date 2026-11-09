// A product demo made from a real recording of the Little Ledger demo app.
// recordings/new-invoice.json holds the steps, and "explainroo record" ran
// them in a browser. Each step with a cue happens on its [#marker] in
// script.md, and the zoom steps move in on the form and the list.

export default {
  intro(s) {
    const { top, h } = s.safe;
    s.title('Send an invoice', { y: top + h * 0.4, size: 110, at: 0 });
    s.text('in Little Ledger', { y: top + h * 0.58, size: 56, color: 'accent', at: 0.3 });
  },

  demo(s) {
    s.recording('new-invoice', { frame: 'browser', url: 'ledger.example', enter: 'none' });
  },

  outro(s) {
    const { top, h } = s.safe;
    s.title('Invoice saved', { y: top + h * 0.42, size: 110, at: 0 });
    s.text('#1044 for Acme Studio, $2,400', { y: top + h * 0.6, size: 52, color: 'muted', at: 'Acme' });
  },
};
