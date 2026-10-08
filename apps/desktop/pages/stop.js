// The Stop card says what the assistant is doing: the app writes it in the
// address (`#l=Clicking%20in%20Notes`). Words only, never markup.
const label = document.getElementById('label');
const show = () => {
  const hash = location.hash;
  if (!label || !hash.startsWith('#l=')) return;
  try {
    label.textContent = decodeURIComponent(hash.slice(3)).slice(0, 160);
  } catch {
    label.textContent = '';
  }
};
window.addEventListener('hashchange', show);
show();
