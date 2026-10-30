/* YupDar Concierge — the page. No framework, no build step.
   Talks only to this server's api/* (relative, so it also works mounted under a path); the server talks to the core. */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const state = { session: null, catalog: null, offer: null, busy: false };

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
      const data = await post('api/start', { birth_date: fd.get('birth_date'), email: fd.get('email') });
      state.session = data.session;
      state.catalog = data.catalog;
      $('#gift .gift-code').textContent = 'GIFT ' + data.gift.code;
      $('#gift .gift-name').textContent = data.gift.name;
      $('#gift .gift-metaphor').textContent = data.gift.metaphor;
      $('#gift .gift-essence').textContent = data.gift.essence;
      $('#start').hidden = true;
      $('#chat').hidden = false;
      addMessage('bot', 'This is your Gift. Tell me what is on your mind these days — work, people, energy, a decision — and I will show how your Gift plays into it, and whether there is a reading worth opening for you.');
      $('#message').focus();
    } catch (err) {
      showError('#start-error', err.message);
    } finally {
      btn.disabled = false;
      state.busy = false;
    }
  });

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
      const data = await post('api/chat', { session: state.session, message: text });
      thinking.remove();
      addMessage('bot', data.reply);
      if (data.recommend) showOffer(data.recommend);
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
      const order = await post('api/checkout', { session: state.session, kind: state.offer.kind, key: state.offer.key });
      btn.textContent = 'Opened PayPal — come back after paying';
      window.open(order.approve_url, '_blank', 'noopener');
      addMessage('bot', 'PayPal is open in a new tab. When you are done, press "Check my access" and I will confirm what is unlocked.');
    } catch (err) {
      showError('#chat-error', err.message);
      btn.disabled = false;
      btn.textContent = 'Pay with PayPal';
    } finally {
      state.busy = false;
    }
  });

  // ---- what is unlocked ----
  $('#status').addEventListener('click', async () => {
    if (state.busy) return;
    state.busy = true;
    const out = $('#status-text');
    out.textContent = 'checking…';
    try {
      const s = await post('api/status', { session: state.session });
      const parts = [];
      parts.push('plan: ' + s.tier);
      parts.push(s.book_access ? 'Book of DARs: unlocked' : 'Book of DARs: not yet');
      if (s.subscription_end) parts.push('until ' + new Date(s.subscription_end).toLocaleDateString());
      out.textContent = parts.join(' · ');
      if (s.book_access || (s.tier && s.tier !== 'basic')) {
        addMessage('bot', 'Confirmed — your access is open. Open YupDar at yupdar.com with the same email and the reading is waiting for you.');
        showOffer(null);
      }
    } catch (err) {
      out.textContent = '';
      showError('#chat-error', err.message);
    } finally {
      state.busy = false;
    }
  });
})();
