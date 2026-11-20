import React from 'react'
import ReactDOM from 'react-dom/client'
import './lib/language'
import App from './App.tsx'
import { listenForChunkErrors } from './lib/clientErrors'

listenForChunkErrors()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
