import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'

const target = document.getElementById('app')

if (!target) {
  throw new Error('Landing page failed to find #app root element.')
}

mount(App, { target })
