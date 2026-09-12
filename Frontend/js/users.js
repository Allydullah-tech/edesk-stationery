/**
 * EDESK STATIONERY - Manage Users page logic (admin only)
 */
let USERS_CACHE = [];

(async function init() {
  await requireAuth(['admin']);
  document.getElementById('print-date-users').textContent = new Date().toLocaleString('en-GB');
  await loadUsers();
})();

async function loadUsers() {
  const tbody = document.getElementById('usersBody');
  tbody.innerHTML = '<tr><td colspan="6" class="muted">Loading...</td></tr>';

  const res = await API.get('users.php');
  if (!res.success) { tbody.innerHTML = `<tr><td colspan="6" class="muted">${res.message}</td></tr>`; return; }
  USERS_CACHE = res.data;

  tbody.innerHTML = res.data.map(u => `
    <tr>
      <td><strong>${u.full_name}</strong> ${u.id == CURRENT_USER.id ? '<span class="tag tag-gold">You</span>' : ''}</td>
      <td>${u.username}</td>
      <td>${u.role === 'admin' ? '<span class="tag tag-gold">Admin</span>' : '<span class="tag tag-gray">Worker</span>'}</td>
      <td class="no-print">${u.status === 'active' ? '<span class="tag tag-green">Active</span>' : '<span class="tag tag-red">Disabled</span>'}</td>
      <td class="muted">${fmtDate(u.created_at)}</td>
      <td class="no-print">
        <button class="icon-action-btn edit-btn" title="Edit" onclick="editUser(${u.id})"><svg class="ui-icon"><use href="assets/icons.svg#edit"></use></svg></button>
        ${u.id != CURRENT_USER.id ? `<button class="icon-action-btn delete-btn" title="Delete" onclick="deleteUser(${u.id})"><svg class="ui-icon"><use href="assets/icons.svg#trash"></use></svg></button>` : ''}
      </td>
    </tr>`).join('');
}

function openUserModal() {
  document.getElementById('userForm').reset();
  document.getElementById('u-id').value = '';
  document.getElementById('userModalTitle').textContent = 'Add User';
  document.getElementById('usernameField').style.display = 'block';
  document.getElementById('newUserFields').classList.remove('hidden');
  document.getElementById('resetPasswordField').classList.add('hidden');
  document.getElementById('u-password').required = true;
  document.getElementById('u-question').required = true;
  document.getElementById('u-answer').required = true;
  document.getElementById('u-username').required = true;
  document.getElementById('statusField').style.display = 'none';
  openModal('userModal');
}

function editUser(id) {
  const u = USERS_CACHE.find(x => x.id == id);
  if (!u) return;
  document.getElementById('userForm').reset();
  document.getElementById('userModalTitle').textContent = 'Edit User';
  document.getElementById('u-id').value = u.id;
  document.getElementById('u-name').value = u.full_name;
  document.getElementById('u-username').value = u.username;
  document.getElementById('u-role').value = u.role;
  document.getElementById('u-status').value = u.status;
  document.getElementById('usernameField').style.display = 'none';
  document.getElementById('newUserFields').classList.add('hidden');
  document.getElementById('resetPasswordField').classList.remove('hidden');
  document.getElementById('u-password').required = false;
  document.getElementById('u-question').required = false;
  document.getElementById('u-answer').required = false;
  document.getElementById('u-username').required = false;
  document.getElementById('statusField').style.display = 'block';
  openModal('userModal');
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('u-id').value;

  let res;
  if (id) {
    const payload = {
      id,
      full_name: document.getElementById('u-name').value.trim(),
      role: document.getElementById('u-role').value,
      status: document.getElementById('u-status').value,
    };
    const newPass = document.getElementById('u-newpassword').value;
    if (newPass) payload.password = newPass;
    res = await API.put('users.php', payload);
  } else {
    res = await API.post('users.php', {
      full_name: document.getElementById('u-name').value.trim(),
      username: document.getElementById('u-username').value.trim(),
      password: document.getElementById('u-password').value,
      role: document.getElementById('u-role').value,
      security_question: document.getElementById('u-question').value.trim(),
      security_answer: document.getElementById('u-answer').value.trim(),
    });
  }

  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  closeModal('userModal');
  loadUsers();
});

async function deleteUser(id) {
  if (!confirm('Remove this user? They will no longer be able to log in.')) return;
  const res = await API.del('users.php', { id });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast(res.message);
  loadUsers();
}

function downloadUsersExcel() {
  const rows = USERS_CACHE.map(u => [u.full_name, u.username, u.role, u.status, u.created_at]);
  exportToExcel('eDESK_Users_' + new Date().toISOString().slice(0, 10) + '.csv',
    ['Full Name', 'Username', 'Role', 'Status', 'Joined'], rows);
}

