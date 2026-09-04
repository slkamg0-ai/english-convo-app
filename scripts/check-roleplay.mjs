// Admin helper: log in and make one /api/roleplay call to see the raw response.
// Run: WORKER_URL=https://<name>.<subdomain>.workers.dev node scripts/check-roleplay.mjs <email> <password>
const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('Usage: WORKER_URL=<worker-url> node scripts/check-roleplay.mjs <email> <password>');
  process.exit(1);
}
const base = process.env.WORKER_URL;
if (!base) {
  console.error('Set WORKER_URL to your deployed Worker origin.');
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
console.log('Logged in as:', login.user.email);

const scenario = {
  title: 'Airport check-in',
  description: 'Check in at the airport counter.',
  opening: 'Hello, may I see your passport and ticket, please?',
  openingKo: '안녕하세요, 여권과 항공권을 보여주시겠어요?',
  hint: 'Here you go.',
  hintKo: '여기 있습니다.',
};

const response = await fetch(`${base}/api/roleplay`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.session.token}` },
  body: JSON.stringify({ action: 'start', scenario, level: 'beginner', messages: [] }),
});

console.log('status:', response.status);
console.log('body:', await response.text());
