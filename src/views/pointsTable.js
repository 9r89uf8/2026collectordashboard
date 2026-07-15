function cell(text, className) {
  const element = document.createElement('td')
  element.textContent = text ?? '—'
  if (className) element.className = className
  return element
}

export function renderPointsTable(refs, rows = []) {
  refs['points-body'].replaceChildren()

  rows.slice(-50).reverse().forEach((row) => {
    const tr = document.createElement('tr')
    tr.append(
      cell(row.targetLabel, 'mono'),
      cell(row.projectedLabel, 'mono'),
      cell(row.actualLabel, 'mono'),
      cell(row.errorLabel, `mono${row.errorTone ? ` is-${row.errorTone}` : ''}`),
      cell(row.statusLabel || 'valid'),
    )
    refs['points-body'].append(tr)
  })

  refs['point-count'].textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`
  refs['points-disclosure'].hidden = rows.length === 0
}
