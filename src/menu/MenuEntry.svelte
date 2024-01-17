<script lang="ts">
	export let title: string;
	export let show: null | (() => void) = null;
</script>

<button class:enabled={show} on:click={show}>
	<h2>{title}</h2>
</button>

<style>
	button {
		background-color: #fff1;
		border: 1px solid #fff3;
		border-radius: 1em;
		margin: 1em auto;
		cursor: pointer;
		opacity: 0.2;
		pointer-events: none;
		display: block;
		width: 80%;
		padding: 0.1em;
	}
	button.enabled {
		pointer-events: inherit;
		opacity: 1;
	}
	button.enabled:hover {
		background-color: #fff2;
		border: 1px solid #fff6;
	}
</style>
