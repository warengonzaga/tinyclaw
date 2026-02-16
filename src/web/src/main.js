import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'

const target = document.getElementById('app')

if (!target) {
  throw new Error('Tiny Claw UI failed to find #app root element.')
}

target.textContent = 'Booting Tiny Claw UI...'

let app

try {
  target.textContent = ''
  app = mount(App, { target })
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error.'
  target.textContent = `Tiny Claw UI failed to start: ${message}`
  console.error(error)
}

export default app
