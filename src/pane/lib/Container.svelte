<script lang="ts">
	export let title: string;
</script>

<div class="container">
	<h2>{title}</h2>
	<div class="content">
		<slot />
	</div>
</div>

<style>
	div.container {
		background-color: #fff1;
		border: 1px solid #fff4;
		border-radius: 0.5em;
		padding: 0;
		margin: 1em 0;
	}
	h2 {
		background-color: #fff1;
		margin: 0;
		padding: 0.3em 0 0.2em 0;
		text-align: center;
	}
	div.content {
		padding: 1em 0;
		margin: 0;
		text-align: center;
	}
</style>
