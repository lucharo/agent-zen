import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createHttpBridge } from './bridge/httpBridge'
import { AgentZenProvider } from './state/store'
import './styles/base.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')
const bridge = createHttpBridge()

createRoot(root).render(
  <StrictMode>
    <AgentZenProvider bridge={bridge}>
      <App />
    </AgentZenProvider>
  </StrictMode>,
)
