import './app.css';
import { mount } from 'svelte';
import HatchingPreview from './HatchingPreview.svelte';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Preview: failed to find #app root element.');
}

target.textContent = '';
mount(HatchingPreview, { target });
