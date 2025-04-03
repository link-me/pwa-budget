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

export function readForm() {
  const type = document.getElementById('type').value;
  const amount = document.getElementById('amount').value;
  const category = document.getElementById('category').value;
  const note = document.getElementById('note').value;
  const date = document.getElementById('date').value;
  return { type, amount, category, note, date };
}

export function clearForm() {
  document.getElementById('transaction-form').reset();
}

export function renderList(items, { onDelete }) {
  const ul = document.getElementById('transactions');
  ul.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = `item ${it.type}`;
    const main = document.createElement('div');
    main.innerHTML = `<div><strong>${it.category}</strong> — ${it.note || 'без комментария'}</div>
                      <div class="meta">${it.date}</div>`;
    const amount = document.createElement('div');
    amount.className = 'amount';
    amount.textContent = (it.type === 'expense' ? '-' : '+') + Number(it.amount).toFixed(2);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = 'Удалить';
    del.onclick = () => onDelete(it.id);
    actions.appendChild(del);
    li.appendChild(main);
    li.appendChild(amount);
    li.appendChild(actions);
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