const scaleLabels = {
  thoroughness: [[1, 'Glimpse'], [4, 'Examine'], [7, 'See beyond'], [10, 'Nothing remains hidden']],
  nitpicking: [[1, 'Merciful'], [4, 'Exacting'], [7, 'Unforgiving'], [10, 'Perfection alone']],
  conventions: [[1, 'Individuality permitted'], [4, 'Patterns respected'], [7, 'Deviations questioned'], [10, 'All things in their place']],
  tone: [[1, 'Serene'], [3, 'Benevolent'], [5, 'Impartial'], [7, 'Severe'], [8, 'Wrathful'], [9, 'Unbound'], [10, 'Beyond mortal restraint']],
  archaic_english: [[0, 'Modern'], [2, 'Faintly ancient'], [4, 'Archaic'], [6, 'Shakespearean'], [8, 'Antiquated'], [10, 'The ancient tongue']],
};

function updateSlider(input) {
  const value = Number(input.value);
  const output = document.getElementById(input.id + '-value');
  if (output) output.value = value;
  const label = document.getElementById(input.id + '-level');
  const levels = scaleLabels[input.id];
  if (label && levels) {
    label.textContent = levels.filter(([minimum]) => value >= minimum).at(-1)[1];
  }
}

function sameRevision(review, changes) {
  return ['sourceCommit', 'targetCommit', 'baseCommit', 'iteration'].every(
    field => review.dataset[field] === changes.dataset[field]
  );
}

function diffRow(finding) {
  const changes = document.getElementById('changes');
  const review = finding.closest('.review-result');
  if (!changes || !review || !sameRevision(review, changes)) return null;
  const lineField = finding.dataset.side === 'right' ? 'new' : 'old';
  return [...changes.querySelectorAll('tr[data-file]')].find(row =>
    row.dataset.file === finding.dataset.file && row.dataset[lineField] === finding.dataset.line
  );
}

function syncInlineFindings() {
  document.querySelectorAll('.inline-finding-row, .stale-review-note').forEach(row => row.remove());
  const changes = document.getElementById('changes');
  const latest = document.querySelector('#reviews .review-result');
  if (!changes || !latest) return;
  if (!sameRevision(latest, changes)) {
    const notice = document.createElement('p');
    notice.className = 'notice warning stale-review-note';
    notice.textContent = 'This review refers to an earlier PR revision. Generate a new review before publishing.';
    latest.prepend(notice);
  } else {
    latest.querySelectorAll('.finding').forEach(finding => {
      const row = diffRow(finding);
      if (!row) return;
      const inline = document.createElement('tr');
      inline.className = 'inline-finding-row';
      inline.id = 'inline-' + finding.id;
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'inline-finding-cell';
      const body = document.createElement('div');
      body.className = 'inline-finding-body';
      const badge = document.createElement('span');
      badge.className = 'badge severity-' + finding.dataset.severity;
      badge.textContent = finding.dataset.severity;
      const comment = document.createElement('p');
      comment.textContent = finding.dataset.explanation;
      const link = document.createElement('a');
      link.href = '#' + finding.id;
      link.textContent = 'View finding and edit comment →';
      body.append(badge, comment, link);
      cell.append(body);
      inline.append(cell);
      row.after(inline);
    });
  }
  document.querySelectorAll('[data-show-diff]').forEach(button => {
    button.disabled = !diffRow(button.closest('.finding'));
    if (button.disabled) button.title = 'This finding refers to a different revision or a line not shown in this diff.';
  });
}

function initialize() {
  const disclosure = document.querySelector('.controls-disclosure');
  if (disclosure && !disclosure.dataset.initialized) {
    disclosure.open = !window.matchMedia('(max-width: 760px)').matches;
    disclosure.dataset.initialized = 'true';
  }
  document.querySelectorAll('input[type="range"]').forEach(updateSlider);
  syncInlineFindings();
}

document.addEventListener('DOMContentLoaded', initialize);
document.addEventListener('input', event => {
  if (event.target.matches('input[type="range"]')) updateSlider(event.target);
});
document.addEventListener('htmx:afterSwap', event => {
  initialize();
  if (event.detail.target?.id === 'reviews' && document.querySelector('#reviews .notice.success')?.textContent.includes('Review generated')) {
    document.getElementById('reviews').scrollIntoView({ block: 'start' });
  }
});
document.addEventListener('click', event => {
  const fileLink = event.target.closest('[data-open-file]');
  if (fileLink) {
    const file = document.getElementById(fileLink.hash.slice(1));
    if (file) file.open = true;
  }
  const button = event.target.closest('[data-show-diff]');
  if (button) {
    const finding = button.closest('.finding');
    const row = diffRow(finding);
    if (!row) return;
    row.closest('.file-diff').open = true;
    row.scrollIntoView({ block: 'center' });
    document.querySelectorAll('.diff-focus').forEach(item => item.classList.remove('diff-focus'));
    row.classList.add('diff-focus');
  }
});
for (const name of ['htmx:responseError', 'htmx:sendError', 'htmx:timeout']) {
  document.addEventListener(name, () => {
    const banner = document.getElementById('request-error');
    if (banner) {
      banner.textContent = 'Observation interrupted. The request failed or timed out. Reload to check saved results before trying again.';
      banner.classList.remove('hidden');
    }
  });
}
document.addEventListener('submit', event => {
  if (event.target.action?.includes('/publish')) {
    const button = event.target.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = 'Publishing to Azure DevOps…'; }
  }
});
