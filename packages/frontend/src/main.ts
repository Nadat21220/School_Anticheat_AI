import "./ui/styles.css";
import { mountApp } from "./ui/app.js";

const root = document.getElementById("app");
if (!root) {
  throw new Error("No se encontró el contenedor #app en index.html");
}

mountApp(root);
