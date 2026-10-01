/* global document, fetch, location, setInterval, window */
// Shown by the service worker when Conch doesn't answer: look again, quietly, and
// go back to Conch the moment it does.
(function () {
  var note = document.getElementById('note');
  var button = document.getElementById('retry');
  function look() {
    return fetch('/api/health', { cache: 'no-store' }).then(
      function (response) {
        if (response.ok) location.reload();
        return response.ok;
      },
      function () {
        return false;
      },
    );
  }
  button.addEventListener('click', function () {
    note.textContent = 'Looking…';
    look().then(function (ok) {
      if (!ok) note.textContent = 'Still not there. Looking again every few seconds…';
    });
  });
  setInterval(look, 5000);
  window.addEventListener('online', look);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') look();
  });
})();
