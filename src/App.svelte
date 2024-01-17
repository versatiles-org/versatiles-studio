<script lang="ts">
	import Menu from './menu/Menu.svelte';
	import MenuEntry from './menu/MenuEntry.svelte';
	import BasemapStyle from './pane/BasemapStyle.svelte';
	let view: any;
</script>

<main class="container">
	{#if !view}
		<Menu>
			<MenuEntry title="Convert GeoJSON to a VersaTiles container"></MenuEntry>
			<MenuEntry title="Recompress a VersaTiles container"></MenuEntry>
			<MenuEntry title="Generate a choropleth map"></MenuEntry>
			<MenuEntry title="Generate a basemap style" show={() => view = BasemapStyle}></MenuEntry>
			<MenuEntry title="Overlay data onto a basemap"></MenuEntry>
		</Menu>
	{:else}
		<svelte:component this={view} />
	{/if}
</main>

<style>
</style>
