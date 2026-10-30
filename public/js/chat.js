/* YupDar Concierge — the page. No framework, no build step.
   Talks only to this server's api/* (relative, so it also works mounted under a path); the server talks to the core. */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const state = { session: null, catalog: null, offer: null, busy: false, birth: '', email: '', history: [], paying: null, unlocked: null };

  // ---- the person's own conversation, kept in their browser ----
  // The server forgets sessions on restart. Without this the person would type
  // their date and their questions again after every deploy or a trip to PayPal.
  const SAVE_KEY = 'yupdar-concierge-v1';
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        birth: state.birth, email: state.email, history: state.history.slice(-24), offer: state.offer,
        paying: state.paying, unlocked: state.unlocked
      }));
    } catch { /* private mode: works, just does not remember */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
  }
  function forget() { try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to forget */ } }

  // ---- birth date typed as digits: 10091977 → 10.09.1977 ----
  const birthInput = document.querySelector('#start-form input[name="birth_date"]');
  birthInput.addEventListener('input', () => {
    const d = birthInput.value.replace(/\D/g, '').slice(0, 8);
    birthInput.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('.');
  });

  async function post(path, body) {
    const r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    });
    let data = {};
    try { data = await r.json(); } catch { /* empty body */ }
    if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
    return data;
  }

  function showError(where, text) {
    const el = $(where);
    el.textContent = text || '';
    el.hidden = !text;
  }

  function addMessage(role, text, extraClass) {
    const div = document.createElement('div');
    div.className = 'msg ' + role + (extraClass ? ' ' + extraClass : '');
    div.textContent = text;
    $('#log').appendChild(div);
    $('#log').scrollTop = $('#log').scrollHeight;
    return div;
  }

  function productLabel(rec) {
    const c = state.catalog;
    if (!c) return rec.key;
    if (rec.kind === 'book') return c.book.name;
    const list = rec.kind === 'plan' ? c.plans : c.addons;
    const item = list.find(x => x.key === rec.key);
    return item ? item.name : rec.key;
  }

  function showOffer(rec) {
    state.offer = rec;
    const box = $('#offer');
    if (!rec) { box.hidden = true; return; }
    const price = rec.usd != null ? ' — $' + rec.usd : '';
    box.querySelector('.offer-text').textContent = productLabel(rec) + price;
    $('#pay').disabled = false;
    $('#pay').textContent = 'Pay with PayPal';
    box.hidden = false;
  }

  const GREETING = 'This is your Gift. Tell me what is on your mind these days — work, people, energy, a decision — and I will show how your Gift plays into it, and whether there is a reading worth opening for you.';

  /** New server session for the same person, carrying the conversation so far. */
  async function openSession() {
    const data = await post('api/start', { birth_date: state.birth, email: state.email, history: state.history });
    state.session = data.session;
    state.catalog = data.catalog;
    return data;
  }

  /** The server forgot us (restart, a day of silence) → reopen quietly and retry once. */
  async function postInSession(path, body) {
    try {
      return await post(path, Object.assign({ session: state.session }, body));
    } catch (err) {
      if (!/Session expired/i.test(err.message)) throw err;
      await openSession();
      return post(path, Object.assign({ session: state.session }, body));
    }
  }

  function showGift(gift) {
    $('#gift .gift-code').textContent = 'GIFT ' + gift.code;
    $('#gift .gift-name').textContent = gift.name;
    $('#gift .gift-metaphor').textContent = gift.metaphor;
    $('#gift .gift-essence').textContent = gift.essence;
    $('#start').hidden = true;
    $('#chat').hidden = false;
    addMessage('bot', GREETING);
  }

  // ---- step 1: birth date + email → Gift card ----
  $('#start-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    state.busy = true;
    showError('#start-error', '');
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      state.birth = String(fd.get('birth_date') || '');
      state.email = String(fd.get('email') || '');
      state.history = [];
      const data = await openSession();
      showGift(data.gift);
      save();
      $('#message').focus();
    } catch (err) {
      showError('#start-error', err.message);
    } finally {
      btn.disabled = false;
      state.busy = false;
    }
  });

  // ---- back on the page: the same conversation, nothing to retype ----
  (async function resume() {
    const saved = load();
    if (!saved || !saved.birth || !saved.email) return;
    state.birth = saved.birth;
    state.email = saved.email;
    state.history = Array.isArray(saved.history) ? saved.history : [];
    try {
      const data = await openSession();
      showGift(data.gift);
      for (const m of state.history) addMessage(m.role === 'user' ? 'user' : 'bot', m.content);
      state.paying = saved.paying || null;
      if (saved.unlocked) showUnlocked(saved.unlocked);
      else if (saved.offer) showOffer(saved.offer);
      // Back from PayPal (`?paid=1` from the return page): confirm right away —
      // the person should not have to find and press a button to see the result.
      const back = new URLSearchParams(location.search).get('paid') === '1';
      if (back) history.replaceState(null, '', location.pathname);
      if (back || state.paying) await checkAccess({ auto: true });
    } catch {
      forget(); // the saved date no longer works — start from the form
    }
  })();

  // ---- step 2: conversation ----
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const input = $('#message');
    const text = input.value.trim();
    if (!text) return;
    state.busy = true;
    showError('#chat-error', '');
    addMessage('user', text);
    input.value = '';
    const thinking = addMessage('bot', 'thinking…', 'thinking');
    try {
      const data = await postInSession('api/chat', { message: text });
      thinking.remove();
      addMessage('bot', data.reply);
      state.history.push({ role: 'user', content: text }, { role: 'assistant', content: data.reply });
      if (data.recommend) showOffer(data.recommend);
      save();
    } catch (err) {
      thinking.remove();
      showError('#chat-error', err.message);
    } finally {
      state.busy = false;
      input.focus();
    }
  });

  // ---- payment: PayPal approve link from the core ----
  $('#pay').addEventListener('click', async () => {
    if (!state.offer || state.busy) return;
    state.busy = true;
    const btn = $('#pay');
    btn.disabled = true;
    btn.textContent = 'Creating the order…';
    showError('#chat-error', '');
    try {
      const order = await postInSession('api/checkout', { kind: state.offer.kind, key: state.offer.key });
      btn.textContent = 'Opening PayPal…';
      // Same tab: PayPal returns the person here, and the conversation picks up
      // where it stopped (saved above) with the purchase already confirmed.
      state.paying = Object.assign({}, state.offer);
      save();
      location.href = order.approve_url;
      return;
    } catch (err) {
      showError('#chat-error', err.message);
      btn.disabled = false;
      btn.textContent = 'Pay with PayPal';
    } finally {
      state.busy = false;
    }
  });

  // ---- after payment: what was bought, opened in one click ----
  function showUnlocked(rec) {
    state.unlocked = rec;
    showOffer(null);
    const name = productLabel(rec);
    $('#unlocked .offer-text').textContent = name + ' — unlocked';
    $('#open-product').textContent = 'Open my ' + name;
    $('#unlocked-email').textContent = state.email;
    $('#unlocked').hidden = false;
  }

  function isUnlocked(s, rec) {
    if (!rec || rec.kind === 'book') return !!s.book_access;
    if (rec.kind === 'plan') return !!(s.tier && s.tier !== 'basic');
    return !!(s.book_access || (s.tier && s.tier !== 'basic') || (s.addons && s.addons.length));
  }

  /** Ask the core what is open. `auto` — right after PayPal brought the person back. */
  async function checkAccess({ auto } = {}) {
    if (state.busy) return;
    state.busy = true;
    const out = $('#status-text');
    out.textContent = auto ? 'confirming your payment…' : 'checking…';
    try {
      let s = await postInSession('api/status', {});
      const rec = state.paying || state.offer || state.unlocked;
      // The capture can land a few seconds after the person is back: one more look.
      if (auto && !isUnlocked(s, rec)) { await new Promise(r => setTimeout(r, 3000)); s = await postInSession('api/status', {}); }
      out.textContent = '';
      if (isUnlocked(s, rec)) {
        const name = productLabel(rec || { kind: 'book', key: 'book' });
        if (state.paying || !state.unlocked) {
          const reply = 'Done — your payment went through and ' + name + ' is yours. Open it with the button below; sign in with the same email you gave me.';
          addMessage('bot', reply);
          state.history.push({ role: 'assistant', content: reply });
        }
        state.paying = null;
        showUnlocked(rec || { kind: 'book', key: 'book' });
      } else if (auto) {
        addMessage('bot', 'PayPal is still confirming the payment. Give it a minute and press "Check my access" below.');
      } else {
        out.textContent = 'Nothing unlocked yet for ' + state.email + '.';
      }
      save();
    } catch (err) {
      out.textContent = '';
      showError('#chat-error', err.message);
    } finally {
      state.busy = false;
    }
  }

  $('#status').addEventListener('click', () => checkAccess());
})();
