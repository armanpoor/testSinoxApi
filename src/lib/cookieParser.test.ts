import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookieInput } from './cookieParser';

test('parses raw HTTP Cookie header string and extracts wanted keys', () => {
  const raw =
    'Cookie: SID=abc; HSID=def; SAPISID=sap123; __Secure-1PSID=psid1; __Secure-1PSIDTS=ts1; __Secure-1PSIDCC=cc1; OTHER=ignore';
  const res = parseCookieInput(raw);
  assert.equal(res.format, 'header');
  assert.equal(res.valid, true);
  assert.equal(res.foundCount, 6);
  assert.equal(res.has1PSID, true);
  assert.equal(res.has1PSIDTS, true);
  assert.equal(res.warnings.length, 0);
  assert.ok(res.sapisidHash);
  assert.ok(!res.cookieHeader.includes('OTHER='));
});

test('parses Firefox Cookie-Editor JSON array and filters non-Google domains', () => {
  const json = JSON.stringify([
    { name: '__Secure-1PSID', value: 'p1', domain: '.google.com' },
    { name: '__Secure-1PSIDTS', value: 'pts1', domain: '.google.com' },
    { name: 'SAPISID', value: 's1', domain: '.google.com' },
    { name: 'SID', value: 'evil', domain: '.example.com' },
  ]);
  const res = parseCookieInput(json);
  assert.equal(res.format, 'json');
  assert.equal(res.valid, true);
  assert.equal(res.foundCount, 3);
  assert.equal(res.cookies['SID'], undefined);
  assert.equal(res.cookies['__Secure-1PSID'], 'p1');
});

test('parses Netscape cookies.txt format and warns when 1PSIDTS is missing', () => {
  const netscape = [
    '# Netscape HTTP Cookie File',
    '.google.com\tTRUE\t/\tTRUE\t1999999999\t__Secure-1PSID\tnet1',
    '.google.com\tTRUE\t/\tTRUE\t1999999999\tSAPISID\tsap2',
  ].join('\n');
  const res = parseCookieInput(netscape);
  assert.equal(res.format, 'netscape');
  assert.equal(res.valid, true);
  assert.equal(res.has1PSID, true);
  assert.equal(res.has1PSIDTS, false);
  assert.ok(res.warnings.some((w) => w.includes('__Secure-1PSIDTS')));
});

test('rejects input missing __Secure-1PSID', () => {
  const res = parseCookieInput('SID=abc; NID=xyz');
  assert.equal(res.valid, false);
  assert.ok(res.errors.length > 0);
});
