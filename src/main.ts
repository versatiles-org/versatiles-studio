import { mount } from 'svelte';
import App from './App.svelte';

// Loaded before the application mounts, so tokens are always defined by the time anything renders.
// That is what lets components use `var(--token)` with no fallback — see docs/styling.md.
import './lib/styles/tokens.css';
import './lib/styles/base.css';

export default mount(App, { target: document.getElementById('app')! });
