// The app's own page (ADR 0054): "Starting Conch…", or why it stopped. What it
// says comes in the address and is only ever set as text.
const params = new URLSearchParams(location.search);
if (params.get('state') === 'stopped') {
  document.getElementById('main').dataset.state = 'stopped';
  document.getElementById('title').textContent = 'Conch stopped';
  document.getElementById('detail').textContent =
    params.get('message') || 'Conch stopped unexpectedly.';
  document.getElementById('actions').hidden = false;
  document.querySelector('a.primary').focus();
} else if (params.get('message')) {
  document.getElementById('title').textContent = 'Helping Conch recover…';
  document.getElementById('detail').textContent = params.get('message');
}

// A button is a fragment the app hears (`#retry`); it's cleared again so the
// same button can be pressed twice.
for (const link of document.querySelectorAll('.actions a'))
  link.addEventListener('click', () =>
    setTimeout(() => history.replaceState(null, '', location.pathname + location.search), 50),
  );
