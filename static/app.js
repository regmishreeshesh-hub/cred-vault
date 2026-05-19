const API = '';

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (data.locked && !path.includes('unlock') && !path.includes('status')) {
    showLogin();
    return null;
  }
  return data;
}

async function unlock() {
  const pass = document.getElementById('master-pass').value;
  if (!pass) return;
  const confirmEl = document.getElementById('master-pass-confirm');
  if (confirmEl.style.display !== 'none') {
    const confirm = confirmEl.value;
    if (pass !== confirm) {
      document.getElementById('login-error').textContent = 'Passwords do not match';
      return;
    }
  }
  const res = await api('/api/unlock', {
    method: 'POST',
    body: JSON.stringify({ password: pass }),
  });
  if (res && res.status === 'ok') {
    document.getElementById('login-error').textContent = '';
    showVault();
    renderList();
  } else if (res) {
    document.getElementById('login-error').textContent = res.message || 'Wrong password';
  }
}

async function lock() {
  await api('/api/lock', { method: 'POST' });
  document.getElementById('master-pass').value = '';
  showLogin(false);
}

function showLogin(firstRun) {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('vault-screen').classList.add('hidden');
  const prompt = document.getElementById('login-prompt');
  const passEl = document.getElementById('master-pass');
  const confirmEl = document.getElementById('master-pass-confirm');
  const btn = document.getElementById('login-btn');
  passEl.value = '';
  confirmEl.value = '';
  document.getElementById('login-error').textContent = '';
  if (firstRun) {
    prompt.textContent = 'Create a master password to secure your vault.';
    confirmEl.style.display = '';
    btn.textContent = 'Create Vault';
  } else {
    prompt.textContent = 'Enter your master password to unlock the vault.';
    confirmEl.style.display = 'none';
    btn.textContent = 'Unlock';
  }
  passEl.focus();
}

function showVault() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('vault-screen').classList.remove('hidden');
}

async function renderList() {
  const creds = await api('/api/credentials');
  if (!creds) return;
  const search = document.getElementById('search').value.toLowerCase();
  const filtered = creds.filter(c =>
    c.url.toLowerCase().includes(search) ||
    c.username.toLowerCase().includes(search)
  );
  const container = document.getElementById('cred-list');
  container.innerHTML = filtered.length === 0
    ? '<p style="color:#888;text-align:center;margin-top:40px;">No credentials found.</p>'
    : filtered.map(c => `
      <div class="cred-item" onclick="viewCredential('${c.id}')" style="cursor:pointer">
        <div class="info">
          <div class="url">${esc(c.url)}</div>
          <div class="username">${esc(c.username)}</div>
        </div>
        <div class="actions" onclick="event.stopPropagation()">
          ${c.port ? `<button data-connect-id="${c.id}" onclick="event.stopPropagation();connectSSH('${c.id}')" style="background:#1a6b3c;">Connect</button>` : `<button onclick="event.stopPropagation();openURL('${c.id}')">Open</button>`}
          <button onclick="showEditForm('${c.id}')">Edit</button>
          <button onclick="deleteCred('${c.id}')" style="background:#ff4444;">Del</button>
        </div>
      </div>
    `).join('');
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function normalizeURL(url) {
  if (!url) return url;
  if (!url.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//)) return 'https://' + url;
  return url;
}

async function openURL(id) {
  const creds = await api('/api/credentials');
  if (!creds) return;
  const c = creds.find(x => x.id === id);
  if (!c || !c.url) return;
  window.open(normalizeURL(c.url), '_blank');
  navigator.clipboard.writeText(c.username).then(() => {
    showToast('Opening URL · Username copied to clipboard');
  }).catch(() => {});
}

let detailCredId = null;

async function viewCredential(id) {
  const creds = await api('/api/credentials');
  if (!creds) return;
  const c = creds.find(x => x.id === id);
  if (!c) return;
  detailCredId = c.id;
  const isSSH = !!c.port;
  document.getElementById('detail-url-group').style.display = isSSH ? 'none' : '';
  document.getElementById('detail-ssh-group').style.display = isSSH ? '' : 'none';
  document.getElementById('detail-open-btn').style.display = isSSH ? 'none' : '';
  document.getElementById('detail-connect-btn').style.display = isSSH ? '' : 'none';
  if (isSSH) {
    document.getElementById('detail-host').textContent = c.url;
    document.getElementById('detail-port').textContent = 'port ' + c.port + (c.key_file ? ' · key: ' + c.key_file : '');
  }
  document.getElementById('detail-url').textContent = c.url;
  document.getElementById('detail-url').href = normalizeURL(c.url);
  document.getElementById('detail-username').textContent = c.username;
  document.getElementById('detail-password-real').value = c.password;
  document.getElementById('detail-password').textContent = '••••••••';
  document.getElementById('detail-password').className = 'password-masked';
  document.getElementById('toggle-pw-btn').textContent = '👁';
  document.getElementById('detail-notes').textContent = c.notes || '(none)';
  document.getElementById('detail-modal').classList.remove('hidden');
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  detailCredId = null;
}

function togglePassword() {
  const pwEl = document.getElementById('detail-password');
  const real = document.getElementById('detail-password-real').value;
  const btn = document.getElementById('toggle-pw-btn');
  if (pwEl.textContent === '••••••••') {
    pwEl.textContent = real;
    pwEl.className = '';
    btn.textContent = '🙈';
  } else {
    pwEl.textContent = '••••••••';
    pwEl.className = 'password-masked';
    btn.textContent = '👁';
  }
}

function copyField(elementId, label) {
  const el = document.getElementById(elementId);
  const text = el.tagName === 'INPUT' ? el.value : el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast(label + ' copied to clipboard');
  }).catch(() => {
    showToast('Failed to copy');
  });
}

async function editFromDetail() {
  closeDetailModal();
  if (detailCredId) showEditForm(detailCredId);
}

async function connectFromDetail() {
  closeDetailModal();
  if (detailCredId) connectSSH(detailCredId);
}

async function deleteFromDetail() {
  closeDetailModal();
  if (detailCredId) deleteCred(detailCredId);
}

function getHostPort(c) {
  let host = c.url;
  let port = c.port || 22;
  if (host.includes('://')) host = host.split('/')[2] || host.split('/')[0] || host;
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    if (parts[1] && !isNaN(parts[1])) port = parseInt(parts[1]);
  }
  return { host, port };
}

async function connectSSH(id) {
  const btn = document.querySelector(`[data-connect-id="${id}"]`) || document.getElementById('detail-connect-btn');
  if (btn) btn.disabled = true;
  const creds = await api('/api/credentials');
  if (!creds) { if (btn) btn.disabled = false; return; }
  const c = creds.find(x => x.id === id);
  if (!c || !c.url || !c.username) { if (btn) btn.disabled = false; return; }
  const { host, port } = getHostPort(c);
  const res = await api('/api/connect', {
    method: 'POST',
    body: JSON.stringify({ host, port, username: c.username, password: c.password, key_file: c.key_file || '' }),
  });
  if (btn) btn.disabled = false;
  if (res && res.status === 'ok') {
    showToast(res.message || 'Connecting...');
  } else if (res) {
    showToast('Connection failed: ' + (res.message || 'unknown error'));
  }
}

async function openFromDetail() {
  if (!detailCredId) return;
  const creds = await api('/api/credentials');
  if (!creds) return;
  const c = creds.find(x => x.id === detailCredId);
  if (!c || !c.url) return;
  window.open(normalizeURL(c.url), '_blank');
  navigator.clipboard.writeText(c.username).then(() => {
    closeDetailModal();
    showToast('Opened URL · Username copied, paste into the login field');
  }).catch(() => {
    closeDetailModal();
  });
}

function toggleSSHPort() {
  const checked = document.getElementById('cred-is-ssh').checked;
  document.getElementById('ssh-port-group').style.display = checked ? '' : 'none';
  if (checked) {
    const host = document.getElementById('cred-url').value;
    if (host && !document.getElementById('cred-port').value) {
      document.getElementById('cred-port').value = '22';
    }
  }
}

function showAddForm() {
  document.getElementById('modal-title').textContent = 'Add Credential';
  document.getElementById('cred-id').value = '';
  document.getElementById('cred-url').value = '';
  document.getElementById('cred-username').value = '';
  document.getElementById('cred-password').value = '';
  document.getElementById('cred-port').value = '22';
  document.getElementById('cred-key-file').value = '';
  document.getElementById('cred-is-ssh').checked = false;
  document.getElementById('ssh-port-group').style.display = 'none';
  document.getElementById('cred-notes').value = '';
  document.getElementById('form-submit').textContent = 'Add';
  document.getElementById('modal').classList.remove('hidden');
}

async function showEditForm(id) {
  const creds = await api('/api/credentials');
  if (!creds) return;
  const c = creds.find(x => x.id === id);
  if (!c) return;
  document.getElementById('modal-title').textContent = 'Edit Credential';
  document.getElementById('cred-id').value = c.id;
  document.getElementById('cred-url').value = c.url;
  document.getElementById('cred-username').value = c.username;
  document.getElementById('cred-password').value = c.password;
  document.getElementById('cred-port').value = c.port || 22;
  document.getElementById('cred-key-file').value = c.key_file || '';
  document.getElementById('cred-is-ssh').checked = !!c.port;
  document.getElementById('ssh-port-group').style.display = c.port ? '' : 'none';
  document.getElementById('cred-notes').value = c.notes;
  document.getElementById('form-submit').textContent = 'Save';
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

document.getElementById('cred-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('cred-id').value;
  const body = {
    url: document.getElementById('cred-url').value,
    username: document.getElementById('cred-username').value,
    password: document.getElementById('cred-password').value,
    port: document.getElementById('cred-is-ssh').checked ? parseInt(document.getElementById('cred-port').value) || 22 : 0,
    key_file: document.getElementById('cred-is-ssh').checked ? document.getElementById('cred-key-file').value : '',
    notes: document.getElementById('cred-notes').value,
  };
  if (id) {
    await api('/api/credentials/' + id, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    await api('/api/credentials', { method: 'POST', body: JSON.stringify(body) });
  }
  closeModal();
  renderList();
});

async function deleteCred(id) {
  if (!confirm('Delete this credential?')) return;
  await api('/api/credentials/' + id, { method: 'DELETE' });
  renderList();
}

function copyPassword(pass) {
  navigator.clipboard.writeText(pass).then(() => {
    showToast('Password copied to clipboard');
  }).catch(() => {
    showToast('Failed to copy');
  });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2000);
}

async function checkStatus() {
  const res = await api('/api/status');
  if (res && !res.locked) {
    showVault();
    renderList();
  } else if (res) {
    showLogin(res.first_run);
  }
}
checkStatus();
document.getElementById('master-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
