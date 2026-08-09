export default function setTheme(theme, root = document.documentElement) {
  root.dataset.theme = theme;
}
