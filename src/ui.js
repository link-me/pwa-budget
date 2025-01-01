export function setCategories(selects, categories) {
  for (const sel of selects) {
    sel.innerHTML = '';
    const allOpt = sel.id === 'filter-category'
      ? new Option('Все', '')
      : null;
    if (allOpt) sel.appendChild(allOpt);
    for (const c of categories) sel.appendChild(new Option(c, c));
  }
}

export function setMembers(selects, members) {
  for (const sel of selects) {
    sel.innerHTML = '';
    const allOpt = sel.id === 'filter-member' ? new Option('Все', '') : null;
    if (allOpt) sel.appendChild(allOpt);
    for (const m of members) sel.appendChild(new Option(m, m));
  }
}

export function setSources(selects, sources) {
  for (const sel of selects) {
    sel.innerHTML = '';
    const allOpt = sel.id === 'filter-source' ? new Option('Все', '') : null;
    if (allOpt) sel.appendChild(allOpt);
    for (const s of sources) sel.appendChild(new Option(s, s));
  }
}

export function readForm() {
  const type = document.getElementById('type').value;
  const amount = document.getElementById('amount').value;
  const category = document.getElementById('category').value;
  const member = document.getElementById('member').value;
  const source = document.getElementById('source').value;
  const note = document.getElementById('note').value;
  const date = document.getElementById('date').value;
  return { type, amount, category, member, source, note, date };
}

export function clearForm() {
  document.getElementById('transaction-form').reset();
}

export function renderList(items, { onDelete, onEdit }) {
  const ul = document.getElementById('transactions');
  ul.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('details');
    li.className = `item ${it.type}`;
    li.innerHTML = `
      <summary>
        <div class="title"><strong>${it.category}</strong>: ${it.note || 'без комментария'}</div>
        <div class="amount">${(it.type === 'expense' ? '-' : '+') + Number(it.amount).toFixed(2)}</div>
      </summary>
      <div class="details-body">
        <div class="meta-grid">
          <span><strong>Член:</strong> ${it.member || 'Семья'}</span>
          <span><strong>Источник:</strong> ${it.source || ''}</span>
          <span><strong>Дата:</strong> ${it.date}</span>
        </div>
        <div class="actions">
          <button class="secondary icon-btn edit-btn" aria-label="Редактировать" title="Редактировать">✎</button>
          <button class="delete icon-btn del-btn" aria-label="Удалить" title="Удалить">🗑️</button>
        </div>
      </div>
    `;
    li.querySelector('.del-btn').onclick = () => onDelete(it.id);
    li.querySelector('.edit-btn').onclick = () => onEdit(it);
    ul.appendChild(li);
  }
}

export function renderSummary(items) {
  let income = 0, expense = 0;
  for (const it of items) {
    if (it.type === 'income') income += Number(it.amount);
    else expense += Number(it.amount);
  }
  const balance = income - expense;
  document.getElementById('sum-income').textContent = income.toFixed(2);
  document.getElementById('sum-expense').textContent = expense.toFixed(2);
  document.getElementById('sum-balance').textContent = balance.toFixed(2);
}