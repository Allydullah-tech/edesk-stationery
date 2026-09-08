/**
 * EDESK STATIONERY - Profile page logic
 */
(async function init() {
  await requireAuth();
  const res = await API.get('profile.php');
  if (!res.success) { toast(res.message, 'error'); return; }
  const p = res.data;
  document.getElementById('pf-name').value = p.full_name;
  document.getElementById('pf-username').value = p.username;
  document.getElementById('pf-role').value = p.role.charAt(0).toUpperCase() + p.role.slice(1);
})();

async function saveName() {
  const name = document.getElementById('pf-name').value.trim();
  if (!name) { toast('Please enter your full name.', 'error'); return; }
  const res = await API.put('profile.php', { full_name: name });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast('Name updated successfully.');
  paintUserChip();
}

async function changePassword() {
  const current = document.getElementById('pf-current').value;
  const p1 = document.getElementById('pf-newpass').value;
  const p2 = document.getElementById('pf-newpass2').value;

  if (!current || !p1 || !p2) { toast('Please fill in all password fields.', 'error'); return; }
  if (p1 !== p2) { toast('New passwords do not match.', 'error'); return; }
  if (p1.length < 6) { toast('New password must be at least 6 characters.', 'error'); return; }

  const res = await API.put('profile.php', { current_password: current, new_password: p1 });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast('Password updated successfully.');
  document.getElementById('pf-current').value = '';
  document.getElementById('pf-newpass').value = '';
  document.getElementById('pf-newpass2').value = '';
}

async function changeSecurityQuestion() {
  const current = document.getElementById('sq-current').value;
  const q = document.getElementById('sq-question').value.trim();
  const a = document.getElementById('sq-answer').value.trim();

  if (!current || !q || !a) { toast('Please fill in all security question fields.', 'error'); return; }

  const res = await API.put('profile.php', { current_password: current, security_question: q, security_answer: a });
  if (!res.success) { toast(res.message, 'error'); return; }
  toast('Security question updated successfully.');
  document.getElementById('sq-current').value = '';
  document.getElementById('sq-question').value = '';
  document.getElementById('sq-answer').value = '';
}
