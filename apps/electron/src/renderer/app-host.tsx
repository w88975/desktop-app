import React from 'react'
import ReactDOM from 'react-dom/client'
import './app-host.css'

const appId = new URLSearchParams(window.location.search).get('appId')
const label = appId === 'todo-placeholder' ? 'TODO Placeholder' : 'Home'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <main><h1>{label}</h1></main>
)
