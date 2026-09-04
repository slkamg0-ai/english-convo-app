// Admin helper: log in and create an invite code against the deployed Worker.
// Run: WORKER_URL=https://<name>.<subdomain>.workers.dev node scripts/create-invite.mjs <admin-email> <admin-password>
const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('Usage: WORKER_URL=<worker-url> node scripts/create-invite.mjs <admin-email> <admin-password>');
  process.exit(1);
}
const base = process.env.WORKER_URL;
if (!base) {
  console.error('Set WORKER_URL to your deployed Worker origin, e.g. https://lake-english-convo-api.<subdomain>.workers.dev');
  process.exit(1);
}

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then(r => r.json());

if (!login.session?.token) {
  console.error('Login failed:', login);
  process.exit(1);
}
console.log('Logged in as:', login.user.email, '(role:', login.user.role + ')');

const invite = await fetch(`${base}/api/admin/invites`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.session.token}` },
  body: JSON.stringify({ maxUses: 10 }),
}).then(r => r.json());

console.log('Invite created:', invite);
