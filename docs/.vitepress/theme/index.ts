import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import WebhookPlayground from "./components/WebhookPlayground.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("WebhookPlayground", WebhookPlayground);
  },
} satisfies Theme;
