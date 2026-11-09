// Little Ledger: a small invoice app for testing recordings. Everything lives
// in memory and resets when the page loads.
const invoices = [
  { no: 1041, customer: 'Harbor Books', amount: 320, status: 'Paid' },
  { no: 1042, customer: 'Maple Bakery', amount: 1250, status: 'Paid' },
  { no: 1043, customer: 'Ridge Cycling', amount: 860, status: 'Open' },
];
const customers = ['Harbor Books', 'Maple Bakery', 'Ridge Cycling', 'Acme Studio'];
// Sounds the shop plays in its waiting room, on a page with a player bar that
// stays at the bottom of the window, over the list.
const tracks = ['Morning Ledger', 'Paid in Full', 'Net Thirty', 'Late Fee Blues', 'Receipt Rain', 'Tax Season', 'Double Entry', 'Round Numbers', 'Balance Due', 'Closing Time'];
const money = (n) => '$' + n.toLocaleString('en-US');
const main = document.getElementById('main');
let fresh = null;

function total() { return invoices.reduce((s, i) => s + i.amount, 0); }

const pages = {
  dashboard: () => `
    <h1>Good morning, Jane</h1><p class="sub">Here is where your invoices stand.</p>
    <div class="cards">
      <div class="card"><div class="n">${money(total())}</div><div class="l">Billed this month</div></div>
      <div class="card"><div class="n">${invoices.filter((i) => i.status === 'Open').length}</div><div class="l">Open invoices</div></div>
      <div class="card"><div class="n">${customers.length}</div><div class="l">Customers</div></div>
    </div>`,
  invoices: () => `
    <div class="bar"><div><h1>Invoices</h1><p class="sub">${invoices.length} invoices this month</p></div><button class="primary" id="new">New invoice</button></div>
    <table><thead><tr><th>Number</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>
    ${invoices.map((i) => `<tr class="${i.no === fresh ? 'new' : ''}"><td>#${i.no}</td><td>${i.customer}</td><td>${money(i.amount)}</td><td><span class="pill ${i.status === 'Paid' ? 'paid' : ''}">${i.status}</span></td></tr>`).join('')}
    </tbody></table>
    <p class="total">Total <b id="total">${money(total())}</b></p>`,
  'new-invoice': () => `
    <h1>New invoice</h1><p class="sub">Fill in who pays and how much.</p>
    <form id="form">
      <label for="customer">Customer<select id="customer">${customers.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label for="amount">Amount<input id="amount" inputmode="numeric" placeholder="0"></label>
      <label for="note">Note<input id="note" placeholder="What is it for?"></label>
      <div class="actions"><button class="primary" type="submit">Save invoice</button><a href="#/invoices"><button type="button">Cancel</button></a></div>
    </form>`,
  customers: () => `<h1>Customers</h1><p class="sub">${customers.length} customers</p>
    <table><tbody>${customers.map((c) => `<tr><td>${c}</td></tr>`).join('')}</tbody></table><div class="long"></div><p id="bottom">End of the list</p>`,
  tracks: () => `<h1>Tracks</h1><p class="sub">${tracks.length} tracks for the waiting room</p>
    <table><tbody>${tracks.map((t, i) => `<tr><td>${t}</td><td><button class="play" data-track="${i}">Play</button></td></tr>`).join('')}</tbody></table><div class="long"></div>
    <div class="player" id="player">Nothing plays yet</div>`,
  reports: () => `<h1>Reports</h1><p class="sub">Every invoice of the year in one file.</p><button class="primary" id="download">Download report</button>
    <div class="locked"><p>Reports come with Little Ledger Pro.</p></div>`,
  settings: () => `<h1>Settings</h1><p class="sub">Invoices go out from <span class="email">jane.doe@example.com</span>.</p>`,
};

function show() {
  const route = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const name = pages[route] ? route : 'dashboard';
  main.innerHTML = pages[name]();
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('on', a.dataset.page === name || (name === 'new-invoice' && a.dataset.page === 'invoices'));
  document.getElementById('new')?.addEventListener('click', () => { location.hash = '#/new-invoice'; });
  for (const b of document.querySelectorAll('.play')) {
    b.addEventListener('click', () => { document.getElementById('player').textContent = `Playing ${tracks[b.dataset.track]}`; });
  }
  document.getElementById('form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Number(document.getElementById('amount').value.replace(/[^0-9]/g, '')) || 0;
    fresh = invoices.at(-1).no + 1;
    invoices.push({ no: fresh, customer: document.getElementById('customer').value, amount, status: 'Open' });
    location.hash = '#/invoices';
    toast('Invoice saved');
  });
}

function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 2500);
}

window.addEventListener('hashchange', show);
show();
if (!document.cookie.includes('cookies=ok')) {
  const banner = document.getElementById('cookies');
  banner.hidden = false;
  document.getElementById('accept').addEventListener('click', () => {
    document.cookie = 'cookies=ok; path=/; max-age=31536000';
    banner.hidden = true;
  });
}
