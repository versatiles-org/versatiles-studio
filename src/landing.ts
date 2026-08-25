import { mount } from 'svelte';
import Launcher from './Launcher.svelte';

// The launcher's entry point (S7.5). Its own page, not the workbench with the workbench hidden —
// so what loads here is four cards and a list of recent files, and none of MapLibre.
import './lib/styles/tokens.css';
import './lib/styles/base.css';

export default mount(Launcher, { target: document.getElementById('app')! });
