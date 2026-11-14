// Checks that the contact and bulk-quote forms never lose an enquiry when only
// the email or only the database fails. Email and database are faked: nothing
// is sent and nothing is saved.
//
// Run: node --experimental-test-module-mocks --test scripts/check-enquiry-forms.mjs
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const STAFF = 'staff@example.test';
process.env.EMAIL_TO = STAFF;

let failMailTo = [];   // addresses whose email fails ('*' = all)
let dbFails = false;
let mails = [];
let rows = [];

mock.module('nodemailer', {
  defaultExport: {
    createTransport: () => ({
      async sendMail(m) {
        if (failMailTo.includes('*') || failMailTo.includes(m.to)) throw new Error('smtp down');
        mails.push(m.to);
      },
    }),
  },
});
mock.module('../api/_supabase.js', {
  namedExports: {
    supabase: {
      from: (table) => ({
        async insert(row) {
          if (dbFails) return { error: { message: 'db down' } };
          rows.push({ table, row });
          return { error: null };
        },
      }),
    },
  },
});

const contact = await import('../api/contact.js');
const quote = await import('../api/quote.js');

const post = (handler, body) =>
  handler.POST(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }));

const CONTACT = { name: 'Test Person', email: 'customer@example.test', message: 'Do you deliver mulch?' };
const QUOTE = {
  items: [{ id: 'm1', name: 'Mulch', unit: 'm3', price: 80, quantity: 3 }],
  delivery: { suburb: 'Manly', postcode: '2095' },
  contact: { firstName: 'Test', lastName: 'Person', email: 'customer@example.test', phone: '0400 000 000' },
};

beforeEach(() => {
  failMailTo = []; dbFails = false; mails = []; rows = [];
  mock.method(console, 'error', () => {}); // the handlers log the faked failures
});

for (const [name, handler, body, table] of [
  ['contact form', contact, CONTACT, 'contacts'],
  ['quote form', quote, QUOTE, 'quotes'],
]) {
  test(`${name}: saves and emails`, async () => {
    const res = await post(handler, body);
    assert.equal(res.status, 200);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].table, table);
    assert.ok(mails.includes(STAFF));
  });

  test(`${name}: email down, enquiry is still saved`, async () => {
    failMailTo = ['*'];
    const res = await post(handler, body);
    assert.equal(res.status, 200);
    assert.equal(rows.length, 1);
  });

  test(`${name}: database down, staff still get the email`, async () => {
    dbFails = true;
    const res = await post(handler, body);
    assert.equal(res.status, 200);
    assert.ok(mails.includes(STAFF));
  });

  test(`${name}: both down, the customer is told it failed`, async () => {
    failMailTo = ['*']; dbFails = true;
    const res = await post(handler, body);
    assert.equal(res.status, 500);
  });
}

test('quote form: a failed confirmation email to the customer does not lose the quote', async () => {
  failMailTo = ['customer@example.test'];
  const res = await post(quote, QUOTE);
  assert.equal(res.status, 200);
  assert.equal(rows.length, 1);
  assert.ok(mails.includes(STAFF));
  assert.match((await res.json()).referenceId, /^BQ-/);
});

test('quote form: saved row carries the estimate in cents', async () => {
  await post(quote, QUOTE);
  assert.equal(rows[0].row.estimated_total_cents, 24000);
  assert.equal(rows[0].row.status, 'new');
});
