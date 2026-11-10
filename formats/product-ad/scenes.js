// The example of the product-ad format: a 20-second ad for a made-up invoicing
// app. Replace the words with the real product's, and keep it under 30 seconds.
import { benefits, hookQuestion, offer, productShot } from './format.js';

export default {
  hook(s) {
    hookQuestion(s, 'Still writing\n*payment reminders?*', { icon: 'mail-warning', color: 'red' });
    const u = s.safe.w / 100;
    const y = s.safe.top + s.safe.h * 0.66;
    s.ui.pop('#unpaid', s.cx + u * 16, y - u * 14, () => s.ui.pill('Unpaid', s.cx + u * 16, y - u * 14, 'red', { size: u * 4, dot: true }), { sfx: 'pop' });
  },

  product(s) {
    productShot(s, { name: 'Acme Invoices', icon: 'receipt-text', line: 'Sends the reminders *for you*', at: '#meet', lineAt: '#sends' });
  },

  benefits(s) {
    benefits(s, [
      { text: 'See who paid', at: '#b1' },
      { text: "See who didn't", at: '#b2' },
      { text: 'Stop chasing', at: '#b3' },
    ]);
  },

  offer(s) {
    offer(s, { name: 'Acme Invoices', url: 'acme.example', at: '#cta' });
  },
};
