<script context="module">
	let counter = 0;
</script>

<script lang="ts">
	export let title: string;
	export let value: any;
	export let type: 'text' | 'button' = 'text';
	let id = 'input' + counter++;

	const handleInput = (e: { currentTarget: HTMLInputElement }) => {
		const target = e.target as HTMLInputElement;
		switch (type) {
			case 'number':
				value = parseFloat(e.target.value);
				return;
			case 'text':
				value = e.target.value;
				return;
		}
	};
</script>

<div>
	<label for={id}>{title}: </label>
	<input id={id} on:input={handleInput} type={type} />
</div>

<style>
	div {
		display: flex;
		flex-wrap: nowrap;
		justify-content: center;
		align-items: center;
		gap: 0.3em;
		padding: 0 1em;
	}
	label {
		font-weight: bold;
	}
	input {
		flex-grow: 1;
		font-size: inherit;
		border: 1px solid #fff5;
		border-radius: 0.3em;
		background-color: #fff3;
	}
</style>
