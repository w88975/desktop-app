const STORAGE_KEY = 'hxsy.todo.items'

function loadItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let items = loadItems()
const list = document.querySelector('#todo-list')
const emptyState = document.querySelector('#empty-state')
const summary = document.querySelector('#summary')
const form = document.querySelector('#create-form')
const titleInput = document.querySelector('#todo-title')

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

function createTodo(title) {
  const item = { id: crypto.randomUUID(), title, completed: false }
  items.unshift(item)
  saveItems()
  render()
  return {
    item: { ...item },
    pendingCount: items.filter(candidate => !candidate.completed).length,
    totalCount: items.length,
  }
}

function render() {
  list.replaceChildren()
  for (const item of items) {
    const row = document.createElement('li')
    if (item.completed) row.classList.add('completed')

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = item.completed
    checkbox.setAttribute('aria-label', `完成 ${item.title}`)
    checkbox.addEventListener('change', () => {
      item.completed = checkbox.checked
      saveItems()
      render()
    })

    const title = document.createElement('span')
    title.textContent = item.title

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '删除'
    remove.addEventListener('click', () => {
      items = items.filter(candidate => candidate.id !== item.id)
      saveItems()
      render()
    })

    row.append(checkbox, title, remove)
    list.append(row)
  }

  const pending = items.filter(item => !item.completed).length
  summary.textContent = `${pending} 个待办事项`
  emptyState.hidden = items.length > 0
}

form.addEventListener('submit', event => {
  event.preventDefault()
  const title = titleInput.value.trim()
  if (!title) return
  createTodo(title)
  titleInput.value = ''
  titleInput.focus()
})

window.agent.tools.createTodo = async ({ title }) => createTodo(title.trim())

document.querySelector('#open-agent').addEventListener('click', () => {
  void window.hxsyApp.openAgentPanel()
})

render()
