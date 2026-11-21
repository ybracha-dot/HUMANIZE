const doc = document.getElementById('doc');
const count = document.getElementById('count');

if (new URLSearchParams(location.search).has('welcome')) {
  document.getElementById('welcome').hidden = false;
}

function updateCount() {
  const n = (doc.value.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  count.textContent = `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`;
}

doc.addEventListener('input', updateCount);

document.getElementById('clear').addEventListener('click', () => {
  doc.value = '';
  updateCount();
  doc.focus();
});

document.getElementById('copy').addEventListener('click', async (e) => {
  await navigator.clipboard.writeText(doc.value);
  e.target.textContent = 'Copied';
  setTimeout(() => { e.target.textContent = 'Copy text'; }, 1400);
});

updateCount();
