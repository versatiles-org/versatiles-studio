<script lang="ts">
import Container from './lib/Container.svelte';
	import Input from './lib/Input.svelte';
let url:string;
</script>

<h1>Make a Basemap Style</h1>

<Container title="Select a VersaTiles source">
	<Input bind:value={url} title="URL" />
</Container>

<Container title="Select a VersaTiles source">
	<Input bind:value={url} title="URL" /> 
</Container>
