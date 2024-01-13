import "./styles.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw Error();
const app = new App({ target });

export default app;
